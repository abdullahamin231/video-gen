# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["faster-whisper==1.2.1", "huggingface-hub==0.36.0"]
# ///
"""Local measured ASR words, no credentials or synthesized timing."""
import argparse
import json
import os
import subprocess
from pathlib import Path
import numpy as np
from faster_whisper import WhisperModel

parser = argparse.ArgumentParser()
parser.add_argument("audio")
parser.add_argument("output")
parser.add_argument("--model", default="small.en")
parser.add_argument("--language", default="en")
args = parser.parse_args()
model = WhisperModel(args.model, device="cpu", compute_type="int8",
                     cpu_threads=min(8, os.cpu_count() or 2))
# Decode with the same FFmpeg used by preparation rather than PyAV. Passing
# samples also avoids decoder API changes across otherwise-compatible wheels.
pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", args.audio, "-f", "f32le",
                      "-ar", "16000", "-ac", "1", "pipe:1"],
                     check=True, stdout=subprocess.PIPE).stdout
samples = np.frombuffer(pcm, dtype=np.float32)
segments, info = model.transcribe(samples, language=args.language,
                                 word_timestamps=True, beam_size=5,
                                 condition_on_previous_text=False)
words = []
for segment in segments:
    for word in segment.words or []:
        words.append({"id": f"w{len(words)}", "text": word.word.strip(),
                      "start": round(word.start, 3), "end": round(word.end, 3),
                      "probability": round(word.probability, 4)})
if not words:
    raise SystemExit("No speech detected; no timing artifact written.")
Path(args.output).write_text(json.dumps(words, indent=2) + "\n")
print(f"Measured {len(words)} words with faster-whisper {args.model} ({info.language}).")
