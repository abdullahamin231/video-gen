# Generated narration: Kokoro or Gemini

Use this when there is no recording: the script was written by the `script-writer` agent, or the user asks for a
generated voice. Never use it to replace a supplied recording.

New UI jobs choose **Kokoro** (default, local) or **Gemini** (Google API). Always generate the whole
narration with `npm run video -- tts <script> --narration --provider kokoro|gemini`. The wrapper handles
paragraphs, pauses, output format and fallback. Keep every input and output inside the repository.

## Gemini setup

Set `GEMINI_API_KEY` in the server environment or the ignored repository `.env`, then restart the UI server
when no jobs are running. `GOOGLE_API_KEY` is also accepted. Never put a key in a job, prompt, command-line
argument or committed file. The standalone TTS command reads the same `.env`.

The default model is `gemini-3.8-flash-tts`, using the `Charon` voice. Optional server settings are
`GEMINI_TTS_MODEL` and `GEMINI_TTS_VOICE`. Requests use Google's Interactions REST API with the transcript
separate from delivery instructions. The script is sent to Google; billing, free-tier availability and quotas
belong to the API project. Selecting Gemini does not enforce a free billing plan.

Gemini requests use IPv4. On this server, Google accepts IPv4 but rejects IPv6 with
`User location is not supported for the API use.` This choice is confined to the TTS request and does not
change system networking or other providers. Other API errors include Google's message with the API key redacted.
Temporary HTTP 500/502/503/504 errors are retried up to three attempts on the same Gemini model. A persistent
service failure stops generation; only HTTP 429 switches to Kokoro.

On HTTP 429 (usage/rate limit), the wrapper immediately switches to Kokoro and regenerates **every paragraph**
so one narration never mixes the two voices. It records `tts-status.json` beside the narration, prints a notice,
and the UI displays that notice in the conversation and Progress. Retries and resumes of that job keep using
Kokoro. New jobs can try Gemini again. Missing keys, authentication failures, invalid requests, network failures
and empty audio are surfaced as errors rather than disguised as quota exhaustion.

Keep the Kokoro environment below ready even for Gemini jobs, so fallback can run without setup.
Google references: [TTS REST format](https://ai.google.dev/gemini-api/docs/speech-generation),
[pricing](https://ai.google.dev/gemini-api/docs/pricing), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

## One-time setup

Kokoro needs a Python environment with `kokoro-onnx` and `soundfile`. Keep it out of the system Python, in the
repository's `.cache/video-gen` (never `~/.cache`: sandboxed agents can only write inside the repository). Run these
from the repository root, and skip them when `.cache/video-gen/tts-env/bin/python` already exists:

```bash
python3 -m venv .cache/video-gen/tts-env
.cache/video-gen/tts-env/bin/pip install -q --no-cache-dir kokoro-onnx soundfile
```

The wrapper selects that interpreter automatically and redirects HyperFrames’ hardcoded home-cache lookup
into `.cache/video-gen/.cache/hyperframes/tts`. It also keeps Python and temporary caches in `.cache/video-gen`.
Do not call `npx hyperframes tts` directly: this version ignores `XDG_CACHE_HOME` for model downloads.
The first call downloads the model (about 311 MB) and voice data (about 27 MB) and takes a few minutes; later calls take about 30–60 s per paragraph.

## Voice and speed

- Default voice: `am_michael` (male, American). `npm run video -- tts --list` shows the others.
- At speed 1.0, `am_michael` reads about 170 words per minute. Choose `--speed` from the script's word count and the
  target duration (requested, or the one the writer chose and recorded in `research.md`): `speed = (words / minutes) / 170`. For example, 1,600 words in 8 minutes is 200 wpm, so speed 1.15–1.2.
  Stay between 0.9 and 1.25; outside that range, cut or extend the script instead.

## Steps

Run from the repository root, with `<slug>` the script's folder under `jobs/scripts/`.

1. Complete the Kokoro setup above (also needed as Gemini's fallback), then choose a speed using the word count.
2. Run one command for the entire reviewed narration. Use the provider selected in the job; outside the UI,
   omitting `--provider` uses Kokoro:

   ```bash
   npm run video -- tts jobs/scripts/<slug>/SCRIPT.md --narration --provider gemini -s 1.0 -o jobs/scripts/<slug>/narration.wav
   ```

   `-v` / `--voice` selects the Kokoro voice, including when used as fallback. `-s` / `--speed` sets Kokoro's
   speed and Gemini's requested speaking pace. Gemini's pace is an instruction, so measure the result.
   The command reads paragraphs, normalises them to 24 kHz mono PCM WAV, joins them with 0.6 s pauses and
   adds 1.5 s of trailing silence. It replaces the output only after the full recording is ready.

   The UI sets `VIDEO_TTS_PROVIDER` and `VIDEO_TTS_STATUS` for each job; its explicit command also includes
   `--status jobs/scripts/<slug>/tts-status.json`. Do not override these or synthesize paragraphs separately.
   Older standalone `tts <paragraph.txt> -v am_michael -s 1.15 -o <paragraph.wav>` calls remain supported.

3. Measure duration with `ffprobe -v error -show_entries format=duration -of csv=p=0 jobs/scripts/<slug>/narration.wav`.
   If it is more than about 7% off target, adjust speed within 0.9–1.25 and regenerate the whole recording,
   or revise the script through its writing/review workflow.
4. Start the film with the finished audio and the same script:

   ```bash
   npm run video -- start --audio jobs/scripts/<slug>/narration.wav --script jobs/scripts/<slug>/SCRIPT.md
   ```

   Preserve supplied recordings; the narration provider choice applies only when no recording was supplied.
   If preparation fails on a symbol such as `%`, write the symbol as a word in the script ("percent") and
   regenerate, or use the other transcription engine with `prepare --engine hyperframes`.

## Writing for the voice

See the script-writing skill's `references/speech-and-tts.md`. In short: plain text only, symbols and units as words,
no dashes, colons, semicolons or parentheses, and check product names in the rendered audio.
