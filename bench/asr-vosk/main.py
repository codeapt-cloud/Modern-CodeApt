"""
EVALUATION ARTIFACT — NOT PRODUCTION (CodeApt Step 31 investigation).

A throwaway Vosk (Kaldi) transcriber that speaks the EXACT same HTTP contract as
apps/asr (faster-whisper), so the existing apps/asr/bench.mjs and the eval scripts
in ../ can point at it UNCHANGED. It exists only to benchmark Vosk's speed and
accuracy against Whisper for an Indian-accented-English speech drive. Nothing in
the app imports or depends on it; delete the whole bench/ tree when the decision
is made.

Contract (subset of apps/asr, transcribe only):
  POST /transcribe  {audio_url, word_timestamps?, vad_filter?}
    -> {transcript, words:[{word,start,end}], language, duration}
  GET  /health      -> {ok, model}

The model is MOUNTED at VOSK_MODEL_PATH (default /model) so the image stays tiny
and small-vs-large is just a different -v mount (see README.md). Vosk needs 16 kHz
mono PCM, so we transcode with ffmpeg first. Vosk emits per-word conf/start/end
natively (SetWords), which we pass through in the SAME shape + units (seconds) as
Whisper so the fluency inputs are identical.
"""
import json
import os
import subprocess
import tempfile
import urllib.request
import wave

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from vosk import KaldiRecognizer, Model, SetLogLevel

SetLogLevel(-1)  # quiet Kaldi
MODEL_PATH = os.getenv("VOSK_MODEL_PATH", "/model")
MODEL_LABEL = os.getenv("VOSK_MODEL_LABEL", os.path.basename(MODEL_PATH.rstrip("/")))
SAMPLE_RATE = 16000

model = Model(MODEL_PATH)  # loaded once at boot, reused across requests
app = FastAPI(title="CodeApt ASR (Vosk eval)")


class TranscribeRequest(BaseModel):
    audio_url: str
    word_timestamps: bool = True
    vad_filter: bool = True  # accepted for contract parity; Vosk VADs internally


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model": MODEL_LABEL, "engine": "vosk"}


def _to_wav_16k_mono(src: str, dst: str) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-i", src, "-ar", str(SAMPLE_RATE), "-ac", "1",
         "-f", "wav", dst],
        check=True, capture_output=True, timeout=120,
    )


@app.post("/transcribe")
def transcribe(req: TranscribeRequest) -> dict:
    try:
        with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as tmp:
            urllib.request.urlretrieve(req.audio_url, tmp.name)
            raw = tmp.name
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"could not fetch audio: {exc}")

    wav_path = raw + ".wav"
    try:
        _to_wav_16k_mono(raw, wav_path)
        wf = wave.open(wav_path, "rb")
        duration = wf.getnframes() / float(wf.getframerate() or SAMPLE_RATE)
        rec = KaldiRecognizer(model, wf.getframerate())
        rec.SetWords(True)
        words = []
        text_parts = []

        def _drain(payload: str) -> None:
            r = json.loads(payload or "{}")
            if r.get("text"):
                text_parts.append(r["text"])
            for w in r.get("result", []) or []:
                words.append(
                    {
                        "word": (w.get("word") or "").strip(),
                        "start": round(float(w.get("start", 0.0)), 3),
                        "end": round(float(w.get("end", 0.0)), 3),
                    }
                )

        while True:
            data = wf.readframes(4000)
            if len(data) == 0:
                break
            if rec.AcceptWaveform(data):
                _drain(rec.Result())
        _drain(rec.FinalResult())

        return {
            "transcript": " ".join(p for p in text_parts if p).strip(),
            "words": words,
            "language": "en",
            "duration": round(duration, 3),
        }
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"ffmpeg failed: {(exc.stderr or b'').decode('utf-8', 'ignore')[:300]}",
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        for p in (raw, wav_path):
            try:
                os.unlink(p)
            except OSError:
                pass
