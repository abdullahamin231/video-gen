# Ming narration

Use only when the user has not supplied a recording. Keep the reviewed `SCRIPT.md` unchanged.
Ming runs locally with `US_James`.

Install once in this checkout:

```bash
npm run video -- tts --setup-ming
```

Setup needs git, ffmpeg and Python 3.12 with venv support. It downloads the pinned model/runtime into
`.cache/video-gen/ming-benchmark/`. Generation then runs offline. `MING_SETUP_PYTHON` selects the setup
interpreter. All caches stay under the repository `.cache/`.

Generate the entire recording in one invocation:

```bash
npm run video -- tts jobs/scripts/<slug>/SCRIPT.md --narration -s 1.0 -o jobs/scripts/<slug>/narration.wav
```

The adapter holds one neutral acoustic reference across every internal fragment and performance segment
through `scripts/ming_continuity.py`. Separate invocations would lose that shared reference. Output is
24 kHz mono WAV with 1.5 seconds of trailing silence. Measure the resulting duration before preparation.

## Delivery sidecar

For controlled pacing, place `ming-performance.json` beside the script; it is loaded automatically.
`--performance <file>` selects an explicit file. Without a sidecar, a short script uses neutral delivery.

```json
{"segments":[
  {"text":"[Breathing] The exact reviewed words of the first thought group.","speed":1.0,"pauseAfter":0.3},
  {"text":"The exact remaining reviewed words.","speed":0.97,"pauseAfter":0}
]}
```

After supported cues are removed, segment text must match the reviewed narration in order, including
punctuation. Keep cues out of SCRIPT.md. Segments have a maximum of 150 words; split long narration into
natural thought groups. Segment speed is 0.9–1.15, combined with CLI speed 0.9–1.25; pauseAfter is 0–2 seconds.
`instruction` and `voiceInstruction` are unsupported. Choose pacing and cues for the meaning; no cue quota.

Supported inline vocal events, with exact spelling:
`[Breathing]`, `[Cough]`, `[Sigh]`, `[Laughter]`, `[Uhm]`, `[Surprise-ah]`, `[Surprise-oh]`,
`[Dissatisfaction-hnn]`, `[Confirmation-en]`, `[Question-ei]`, `[Question-ah]`, `[Question-en]`,
`[Question-oh]`, `[Question-huh]`. Arbitrary emotion tags are rejected.

## Status and recovery

`tts-status.json` reports queued, loading, generating, complete, failed or cancelled state. Jobs in this
checkout share a FIFO queue; a queued command is healthy. Wait for that invocation rather than launching
retries or changing voices. Stopping it cancels the worker; OS locks recover automatically after a crash.
The output file is replaced only after complete successful generation.

On failure, retain the script, sidecar, status and error for diagnosis. On regeneration, rebuild alignment
and the film from the new WAV. Check pronunciation and joins by listening when available; measurements
alone do not establish that a voice sounds natural. Never regenerate a supplied recording.
