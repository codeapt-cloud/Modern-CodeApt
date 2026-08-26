# EVALUATION ARTIFACT — NOT PRODUCTION (CodeApt Step 31).
# A tiny Vosk transcriber that speaks apps/asr's /transcribe contract, for
# benchmarking only. The MODEL is mounted at /model (see README.md) so this image
# stays small and the same image serves both the small and large Vosk models.
FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN pip install --no-cache-dir vosk==0.3.45 "fastapi==0.115.*" "uvicorn==0.30.*"
COPY main.py .

ENV VOSK_MODEL_PATH=/model
EXPOSE 2700
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "2700"]
