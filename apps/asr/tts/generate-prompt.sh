#!/usr/bin/env sh
# Authoring-time TTS with Piper (self-hosted). Generates a FIXED spoken-prompt
# WAV for a speaking item so EVERY student hears the SAME voice and the SAME
# file — a disputed result then has one fixed artifact. This is deliberately NOT
# the browser SpeechSynthesis API, whose voice differs per device (two students
# would sit different tests).
#
# Read-aloud (Step 10) doesn't strictly need this (the text is on screen), so it
# is used here for the item's instructions / a sample reading — but the pipeline
# is what Step 11's repeat / dictation items depend on, so it is proven now.
#
# Flow: generate the WAV here → upload it via the college's signed uploader
# (POST to .../video/upload, same as the comprehension audio) → paste the
# returned URL into the item's `promptAudioUrl`.
#
#   Usage:
#     PIPER=/path/to/piper VOICE=/path/to/en_US-amy-medium.onnx \
#       ./generate-prompt.sh "Read the following sentence aloud." prompt.wav
set -eu

TEXT="${1:?usage: generate-prompt.sh \"text to speak\" [out.wav]}"
OUT="${2:-prompt.wav}"
: "${PIPER:=piper}"
: "${VOICE:=en_US-amy-medium.onnx}"

printf '%s\n' "$TEXT" | "$PIPER" --model "$VOICE" --output_file "$OUT"
echo "Wrote $OUT."
echo "Next: upload it (video/upload) and paste the URL into the item's promptAudioUrl."
