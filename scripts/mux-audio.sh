#!/usr/bin/env bash
# Mux the source narration into a rendered silent video.
# Usage: mux-audio.sh <silent.mp4> <output.mp4>
set -euo pipefail
IN="$1"
OUT="$2"
SRC="inputs/audio/source.mp3"
ffmpeg -y -i "$IN" -i "$SRC" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -shortest "$OUT" </dev/null
echo "Muxed -> $OUT"
