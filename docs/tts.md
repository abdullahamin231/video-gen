# Narration with HyperFrames TTS

Use this when there is no recording: the script was written by the `script-writer` agent, or the user asks for a
generated voice. Never use it to replace a supplied recording.

The voice is Kokoro, run locally by `npx hyperframes tts`. This is the one allowed direct `npx hyperframes` command.

## One-time setup

Kokoro needs a Python environment with `kokoro-onnx` and `soundfile`. Keep it out of the system Python, in the
repository's `.cache/video-gen` (never `~/.cache`: sandboxed agents can only write inside the repository). Run these
from the repository root, and skip them when `.cache/video-gen/tts-env/bin/python` already exists:

```bash
python3 -m venv .cache/video-gen/tts-env
.cache/video-gen/tts-env/bin/pip install -q --no-cache-dir kokoro-onnx soundfile
```

Every `tts` call needs `HYPERFRAMES_PYTHON` pointing at that interpreter. The first call downloads the voice data
(about 27 MB) and takes a few minutes; later calls take about 30–60 s per paragraph.

## Voice and speed

- Default voice: `am_michael` (male, American). `npx --no-install hyperframes tts --list` shows the others.
- At speed 1.0, `am_michael` reads about 170 words per minute. Choose `--speed` from the script's word count and the
  target duration (requested, or the one the writer chose and recorded in `research.md`): `speed = (words / minutes) / 170`. For example, 1,600 words in 8 minutes is 200 wpm, so speed 1.15–1.2.
  Stay between 0.9 and 1.25; outside that range, cut or extend the script instead.

## Steps

Run from the repository root, with `<slug>` the script's folder under `jobs/scripts/`.

1. Split the script into paragraphs. Long input times out after about five minutes, so synthesise one paragraph at a
   time:

   ```bash
   S=jobs/scripts/<slug>; mkdir -p $S/tts
   python3 -c "
   import sys; s=sys.argv[1]
   ps=[p.strip() for p in open(s+'/SCRIPT.md').read().split('\n\n') if p.strip()]
   for i,p in enumerate(ps): open(f'{s}/tts/p{i:02d}.txt','w').write(p+'\n')
   " $S
   ```

2. Synthesise each paragraph:

   ```bash
   export HYPERFRAMES_PYTHON="$PWD/.cache/video-gen/tts-env/bin/python"
   for f in $S/tts/p*.txt; do
     npx --no-install hyperframes tts "$f" -v am_michael -s 1.15 -o "${f%.txt}.wav" > "${f%.txt}.log" 2>&1 || echo "FAILED $f"
   done
   ```

3. Join them with a 0.6 s pause between paragraphs, and add 1.5 s of silence at the end. The pipeline rejects a
   transcript whose last word ends at, or after, the end of the audio:

   ```bash
   ffmpeg -v error -y -f lavfi -i anullsrc=r=24000:cl=mono -t 0.6 -c:a pcm_s16le $S/tts/gap.wav
   ls $S/tts/p*.wav | sed '$!s/$/\ngap/' | sed "s|^gap$|$S/tts/gap.wav|; s|^|file '$PWD/|; s|$|'|" > $S/tts/list.txt
   ffmpeg -v error -y -f concat -safe 0 -i $S/tts/list.txt -af apad=pad_dur=1.5 -c:a pcm_s16le $S/narration.wav
   ffprobe -v error -show_entries format=duration -of csv=p=0 $S/narration.wav
   ```

4. Check the duration against the target. If it is more than about 7% off, change `--speed` and repeat step 2 (or
   trim the script). Keep the audio and script inside the repository.

5. Make the film from the generated audio and the same script:

   ```bash
   npm run video -- start --audio "$S/narration.wav" --script "$S/SCRIPT.md"
   ```

   If preparation fails with "Invalid/nonmonotonic measured interval" on a symbol such as `%`, the default transcriber
   split a token. Write the symbol as a word in the script ("percent") and regenerate that paragraph, or prepare with
   the other engine: `npm run video -- prepare --name <slug> --audio ... --script ... --engine hyperframes`.

## Writing for the voice

See the script-writing skill's `references/speech-and-tts.md`. In short: plain text only, symbols and units as words,
no dashes, colons, semicolons or parentheses, and check product names in the rendered audio.
