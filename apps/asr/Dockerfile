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
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY apps/asr/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/asr/main.py ./

# Bounded CPU threads (one of the two reservation levers; the other is the
# compose `cpus` cap). small + int8 for a CPU box.
ENV ASR_MODEL=small ASR_COMPUTE=int8 ASR_THREADS=2

EXPOSE 2600
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "2600"]
