# Build context is the REPO ROOT (see docker-compose.yml).
#
# faster-whisper is Python + CTranslate2, so this is a python:slim image, NOT the
# node/pnpm multi-stage the api/worker/web Dockerfiles use. ffmpeg is required
# for audio decoding. The `small` INT8 model (~0.5GB) downloads on first boot;
# pre-bake it in CI by running a warm-up transcription during the build if you
# want a cold-start-free image.
FROM python:3.11-slim AS runtime
ENV PYTHONUNBUFFERED=1
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl \
  && rm -rf /var/lib/apt/lists/*

COPY apps/asr/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# TTS (Step 19): bake the FIXED Piper voice so authoring-time synthesis is
# deterministic + offline. Bumping this voice MUST bump TTS_VOICE_VERSION below
# (a regenerated clip must never silently change how an item sounds mid-cohort).
RUN mkdir -p /voices \
  && curl -fsSL -o /voices/en_US-amy-medium.onnx \
     https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx \
  && curl -fsSL -o /voices/en_US-amy-medium.onnx.json \
     https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json

COPY apps/asr/main.py ./

# Bounded CPU threads (one of the two reservation levers; the other is the
# compose `cpus` cap). small + int8 for a CPU box.
ENV ASR_MODEL=small ASR_COMPUTE=int8 ASR_THREADS=2
# Fixed TTS voice + its version stamp (see main.py /synthesize).
ENV PIPER_BIN=piper \
    TTS_VOICE_MODEL=/voices/en_US-amy-medium.onnx \
    TTS_VOICE_ID=en_US-amy-medium \
    TTS_VOICE_VERSION=piper-voices-v1.0.0/amy-medium

EXPOSE 2600
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "2600"]
