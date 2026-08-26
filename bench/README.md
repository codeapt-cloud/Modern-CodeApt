# ASR bench: Vosk vs Whisper (Step 31 — EVALUATION ONLY)

Disposable. Nothing in the app imports this tree. It answers one question — is
Vosk accurate enough on Indian-accented English to replace/augment Whisper — and
is deleted once the decision is made. **No app wiring; no production dependency.**

The two clips (the user's own voice, ~15s and ~45s):

```
CLIP15=https://res.cloudinary.com/dsut5kquw/video/upload/v1787498986/Recording.mp3
CLIP45=https://res.cloudinary.com/dsut5kquw/video/upload/v1787499121/Recording_3.mp3
```

## 1. Vosk container (small + large models)

The image is tiny; the MODEL is mounted, so the same image serves both sizes.

```bash
# Build the eval image
docker build -t asr-vosk bench/asr-vosk

# Download models into host dirs (small ≈40MB, large ≈1.8GB)
mkdir -p bench/models && cd bench/models
curl -L -o small.zip https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
unzip -q small.zip
curl -L -o large.zip https://alphacephei.com/vosk/models/vosk-model-en-us-0.22.zip
unzip -q large.zip
cd ../..

# Run small on :2701, large on :2702 (one at a time is fine)
docker run -d --name vosk-small -p 2701:2700 \
  -v "$PWD/bench/models/vosk-model-small-en-us-0.15:/model" \
  -e VOSK_MODEL_LABEL=vosk-small asr-vosk
docker run -d --name vosk-large -p 2702:2700 \
  -v "$PWD/bench/models/vosk-model-en-us-0.22:/model" \
  -e VOSK_MODEL_LABEL=vosk-large asr-vosk
```

## 2. Whisper (existing apps/asr, for the same-box comparison)

```bash
docker build -t asr-whisper apps/asr
docker run -d --name whisper -p 2600:2600 -e ASR_MODEL=small -e ASR_COMPUTE=int8 asr-whisper
```

(On the production VPS Whisper already runs as the `asr` service on :2600 — point
the eval at that instead of rebuilding, to get the true production numbers.)

## 3. Speed + transcript capture (apples-to-apples, same runs)

```bash
node bench/asr-eval.mjs http://localhost:2600 whisper     "$CLIP15" "$CLIP45" 10
node bench/asr-eval.mjs http://localhost:2701 vosk-small  "$CLIP15" "$CLIP45" 10
node bench/asr-eval.mjs http://localhost:2702 vosk-large  "$CLIP15" "$CLIP45" 10
```

Transcripts are written to `bench/out/<prefix>-<15|45>.txt`.

## 4. Accuracy — WER via OUR OWN scorer (Whisper = reference baseline)

```bash
# needs @codeapt/shared built once: pnpm --filter @codeapt/shared build
node bench/asr-wer.mjs bench/out/whisper-45.txt bench/out/vosk-small-45.txt
node bench/asr-wer.mjs bench/out/whisper-45.txt bench/out/vosk-large-45.txt
node bench/asr-wer.mjs bench/out/whisper-15.txt bench/out/vosk-small-15.txt
node bench/asr-wer.mjs bench/out/whisper-15.txt bench/out/vosk-large-15.txt
```

## Cleanup

```bash
docker rm -f vosk-small vosk-large whisper
docker rmi asr-vosk asr-whisper
rm -rf bench/models bench/out
```
