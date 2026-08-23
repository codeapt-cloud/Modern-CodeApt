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

Contract:
  POST /transcribe  {audio_url, word_timestamps?, vad_filter?}
    -> {transcript, words:[{word,start,end}], language, duration}
  GET  /health      -> {ok, model}
"""
import os
import tempfile
import urllib.request

from fastapi import FastAPI, HTTPException
from faster_whisper import WhisperModel
from pydantic import BaseModel

MODEL_SIZE = os.getenv("ASR_MODEL", "small")
COMPUTE = os.getenv("ASR_COMPUTE", "int8")
THREADS = int(os.getenv("ASR_THREADS", "2"))

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
    return {"ok": True, "model": MODEL_SIZE, "compute": COMPUTE, "threads": THREADS}


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
