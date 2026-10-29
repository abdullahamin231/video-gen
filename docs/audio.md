# Ming narration

Use only when the user has not supplied a recording. Keep the reviewed `SCRIPT.md` unchanged.
Ming runs locally with `US_James`.

Install once in this checkout:

```bash
npm run video -- tts --setup-ming
```

Setup needs git, ffmpeg and Python 3.12 with venv support. It downloads the pinned model/runtime into
`.cache/video-gen/ming/`. Generation then runs offline. `MING_SETUP_PYTHON` selects the setup
interpreter. All caches stay under the repository `.cache/`.

Generate the entire recording in one invocation:

```bash
npm run video -- tts jobs/scripts/<slug>/SCRIPT.md --narration --target-seconds 60 -s 1.0 -o jobs/scripts/<slug>/narration.wav
```

The adapter holds one neutral acoustic reference across every internal fragment and performance segment
through `scripts/ming_continuity.py`. Separate invocations would lose that shared reference. Output is
24 kHz mono WAV with 1.5 seconds of trailing silence. Measure the resulting duration before preparation.
Use the brief's target for `--target-seconds`, or omit it when length is open. The command measures the WAV
before replacing the prior take; the default tolerance is 10% or 2 seconds, whichever is larger.
An out-of-range take is kept as `narration.rejected.wav` for diagnosis and marked failed in the status file.
`--duration-tolerance <seconds>` sets the accepted range explicitly. Generation completion establishes
neither speech fidelity nor natural delivery. A short take may have missing words; check that before
adjusting speed, pauses or script length. Do not stretch incomplete speech to meet a target.

Prepare generated speech with `start --full-script true` (the project handoff supplies this flag).
That compares the entire approved narration, including its opening and ending. The default excerpt
alignment is for supplied recordings: a 100% excerpt match can still omit most of a script.
ASR differences require checking the disputed passage against the audio or a second transcription;
they do not establish that Ming spoke different words. Keep the original script as the authority.

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

## Pipeline soundtrack

Narration is fixed. Music and effects are optional creative choices; silence does not require justification.
The pipeline mixes the soundtrack and verifies the encoded MP4 against it. Audio tags in native scene HTML
are not imported into this mix.

## Effects

Place effects in film.json `sounds`:

```json
{"sounds":[{"src":"assets/effects/click.wav","at":{"phrase":"the exact spoken words"},"volume":0.1,"why":"The switch closes"}]}
```

`at` resolves against the measured narration. It can use `wordId`, `occurrence`, `edge` and `offset`.
`align` is `start` (default), `peak` or `end`. `volume` is a linear gain from 0 to 1. Keep the file local
under assets/ and record source/licence in `assets/SOURCES.json`. Use `asset` or the library tools to bring
in cleared files. Build measures effects against speech; fix masking rather than trusting a chosen gain.

## Music

`music --job <job> --src <url|file> --name music/<name>.mp3 --source <page> --license <licence>` imports
and analyses a track. `setup-audio` installs the local analysis environment when needed.

```json
{"music":{"src":"assets/music/track.mp3","source":"source page","license":"licence","trackStart":0,"filmStart":0}}
```

Optional fields: `level` and `duck` (dB), `fadeIn`/`fadeOut` (seconds). Beat analysis is available for
edits where it helps; narrated action does not have to hit every beat. Source speech for actual-media news
belongs in `news.json`, not synthesized effects or the commentary recording.

Build writes `review/sounds.md`. Render writes `review/mix.json`, encoded verification and sound evidence.
The mix applies ducking and a master gain; loudness/peak targets are measured on the exported file. Inspect
masking findings and report measurement limits. Only claim listening when someone actually listened.
