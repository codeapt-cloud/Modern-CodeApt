"""
CodeApt ASR service — a thin HTTP wrapper over faster-whisper (small, INT8) for
the Communication speech spine. It transcribes a hosted audio URL and returns
the transcript WITH word-level timestamps (fluency scoring depends on them). VAD
is on. Mirrors the role of the external Piston service: one narrow HTTP contract
the worker's asr.ts client speaks to.

Core reservation: the model runs on CPU with a bounded thread count
(ASR_THREADS, default 2), and the container is CPU-capped in docker-compose
(`cpus: "2.0"`). Both levers together keep a burst of transcriptions from
starving the worker / API / Piston on a shared box.

TTS (Step 19) — the SAME container also synthesizes authoring-time prompt audio
with Piper (self-hosted), so every student hears the SAME fixed voice + file
(never the browser SpeechSynthesis API, whose voice differs per device). Piper
lives here (not a new box) because this container already carries ffmpeg + a
Python runtime and is the box provisioned for voice work; TTS is AUTHORING-time
only, so it never competes with student transcription during a live drive — the
CPU cap (`cpus: 2.0`) + ASR_THREADS still bound a burst either way. The synthesis
voice is FIXED (TTS_VOICE_ID / TTS_VOICE_VERSION) and reported so the API can pin
it on the item; regenerating a clip later can never silently change how it sounds.

Contract:
  POST /transcribe  {audio_url, word_timestamps?, vad_filter?}
    -> {transcript, words:[{word,start,end}], language, duration}
  POST /synthesize  {text}
    -> WAV bytes (audio/wav); headers X-Voice-Id / X-Voice-Version pin the voice
  GET  /health      -> {ok, model, tts}
"""
import os
import subprocess
import tempfile
import urllib.request

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from faster_whisper import WhisperModel
from pydantic import BaseModel

MODEL_SIZE = os.getenv("ASR_MODEL", "small")
COMPUTE = os.getenv("ASR_COMPUTE", "int8")
THREADS = int(os.getenv("ASR_THREADS", "2"))

# --- TTS (Piper) config — a FIXED voice, reported on every clip. -------------
PIPER_BIN = os.getenv("PIPER_BIN", "piper")
TTS_VOICE_MODEL = os.getenv("TTS_VOICE_MODEL", "/voices/en_US-amy-medium.onnx")
TTS_VOICE_ID = os.getenv("TTS_VOICE_ID", "en_US-amy-medium")
# Bumping the voice model MUST bump this so a regenerate is never silent.
TTS_VOICE_VERSION = os.getenv("TTS_VOICE_VERSION", "piper-1.2.0/amy-medium")
TTS_MAX_CHARS = int(os.getenv("TTS_MAX_CHARS", "600"))

# Loaded once at boot; reused across requests. INT8 keeps it CPU-friendly.
model = WhisperModel(
    MODEL_SIZE, device="cpu", compute_type=COMPUTE, cpu_threads=THREADS
)

app = FastAPI(title="CodeApt ASR")


class TranscribeRequest(BaseModel):
    audio_url: str
    word_timestamps: bool = True
    vad_filter: bool = True


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "model": MODEL_SIZE,
        "compute": COMPUTE,
        "threads": THREADS,
        "tts": {"voiceId": TTS_VOICE_ID, "voiceVersion": TTS_VOICE_VERSION},
    }


class SynthesizeRequest(BaseModel):
    text: str


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest) -> Response:
    """AUTHORING-time TTS: render `text` to WAV with the FIXED Piper voice and
    return the bytes. The voice id + version travel in headers so the API can pin
    them on the item — a later regenerate can never silently change the sound.
    Deliberately NOT the browser SpeechSynthesis API (device-dependent voice)."""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > TTS_MAX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"text exceeds {TTS_MAX_CHARS} characters",
        )
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        out = tmp.name
    try:
        # Same invocation as tts/generate-prompt.sh: text on stdin, fixed model.
        subprocess.run(
            [PIPER_BIN, "--model", TTS_VOICE_MODEL, "--output_file", out],
            input=text.encode("utf-8"),
            check=True,
            capture_output=True,
            timeout=60,
        )
        with open(out, "rb") as fh:
            wav = fh.read()
    except FileNotFoundError as exc:  # piper not installed / wrong PIPER_BIN
        raise HTTPException(status_code=503, detail=f"TTS unavailable: {exc}")
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"piper failed: {(exc.stderr or b'').decode('utf-8', 'ignore')[:300]}",
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="piper timed out")
    finally:
        try:
            os.unlink(out)
        except OSError:
            pass
    return Response(
        content=wav,
        media_type="audio/wav",
        headers={
            "X-Voice-Id": TTS_VOICE_ID,
            "X-Voice-Version": TTS_VOICE_VERSION,
        },
    )


@app.post("/transcribe")
def transcribe(req: TranscribeRequest) -> dict:
    # Fetch the hosted clip (Cloudinary). Only the URL crosses to this box.
    try:
        with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as tmp:
            urllib.request.urlretrieve(req.audio_url, tmp.name)
            path = tmp.name
    except Exception as exc:  # noqa: BLE001 - surface a clean 400 to the worker
        raise HTTPException(status_code=400, detail=f"could not fetch audio: {exc}")

    try:
        # DELIBERATELY NO `initial_prompt` / biasing toward any reference text.
        # Biasing the decoder toward the known read-aloud passage would "fix"
        # homophone spellings (right/write) — but it would ALSO transcribe a
        # student who genuinely MISREAD as if they had read correctly, inflating
        # every score and destroying the measurement. The ASR must stay unbiased;
        # homophone tolerance is handled downstream in the pure scorer
        # (packages/shared/src/phonetics.ts), never here. Do not "optimise" this.
        segments, info = model.transcribe(
            path,
            word_timestamps=req.word_timestamps,
            vad_filter=req.vad_filter,
        )
        words = []
        text_parts = []
        for seg in segments:
            text_parts.append(seg.text)
            for w in seg.words or []:
                words.append(
                    {
                        "word": (w.word or "").strip(),
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                    }
                )
        return {
            "transcript": "".join(text_parts).strip(),
            "words": words,
            "language": info.language,
            "duration": round(info.duration, 3),
        }
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
