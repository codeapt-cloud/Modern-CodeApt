# EVALUATION ARTIFACT — NOT PRODUCTION (CodeApt Step 31).
# The SAME faster-whisper /transcribe code as apps/asr (same model: small/INT8),
# but WITHOUT the Piper/TTS voice bake — /transcribe never touches Piper, so this
# gives a faithful Whisper transcription baseline for the bench with a fast,
# reliable build. Build context = repo root.
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY apps/asr/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY apps/asr/main.py ./
# Match production: small model, INT8. Threads=4 (the faster VPS core count).
ENV ASR_MODEL=small ASR_COMPUTE=int8 ASR_THREADS=4
EXPOSE 2600
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "2600"]
