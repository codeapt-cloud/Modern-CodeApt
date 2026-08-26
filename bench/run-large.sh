#!/usr/bin/env bash
# EVAL ONLY (Step 31): wait for the large Vosk model download to finish, then run
# its container + the same eval + WER. Backgrounded so it can run to completion.
set -u
ROOT="/f/Modern CodeApt"
cd "$ROOT/bench/models"
CLIP15=https://res.cloudinary.com/dsut5kquw/video/upload/v1787498986/Recording.mp3
CLIP45=https://res.cloudinary.com/dsut5kquw/video/upload/v1787499121/Recording_3.mp3

echo "waiting for large.zip to be a complete/valid archive..."
tries=0
until unzip -t large.zip >/dev/null 2>&1; do
  tries=$((tries+1))
  if [ "$tries" -gt 240 ]; then echo "GAVE UP waiting for large.zip"; exit 2; fi
  sleep 15
done
echo "large.zip valid ($(wc -c < large.zip) bytes). unzipping..."
unzip -q -o large.zip
ls -d vosk-model-en-us-0.22 || { echo "unzip produced no model dir"; exit 3; }

cd "$ROOT"
docker rm -f vosk-large >/dev/null 2>&1
MSYS_NO_PATHCONV=1 docker run -d --name vosk-large -p 2702:2700 \
  -v "//f/Modern CodeApt/bench/models/vosk-model-en-us-0.22:/model" \
  -e VOSK_MODEL_LABEL=vosk-large asr-vosk >/dev/null
echo "container started; waiting for model load (large ≈1.8GB → slow)..."
ok=""
for i in $(seq 1 40); do
  sleep 6
  if curl -sS -m 5 http://localhost:2702/health 2>/dev/null | grep -q '"ok"'; then ok=1; break; fi
done
if [ -z "$ok" ]; then echo "vosk-large never became healthy; logs:"; docker logs vosk-large 2>&1 | tail -8; exit 4; fi
echo "HEALTH: $(curl -sS http://localhost:2702/health)"

echo "===== VOSK-LARGE EVAL ====="
node bench/asr-eval.mjs http://localhost:2702 vosk-large "$CLIP15" "$CLIP45" 10
echo "===== WER 45s: whisper(ref) vs vosk-large ====="
node bench/asr-wer.mjs bench/out/whisper-45.txt bench/out/vosk-large-45.txt
echo "===== WER 15s: whisper(ref) vs vosk-large ====="
node bench/asr-wer.mjs bench/out/whisper-15.txt bench/out/vosk-large-15.txt
echo "===== DONE ====="
