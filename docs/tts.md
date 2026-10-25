# Generated narration: Kokoro, Ming or Gemini

Use this when there is no recording: the script was written by the `script-writer` agent, or the user asks for a
generated voice. Never use it to replace a supplied recording.

New UI and T3 Code jobs choose **Ming** (default, expressive, local), **Kokoro** (local), or **Gemini** (Google API). Always generate the whole
narration with `npm run video -- tts <script> --narration --provider kokoro|ming|gemini`. Gemini receives the whole
script in one request per model attempt, preserving paragraph breaks. The wrapper handles Kokoro paragraphs,
output format and fallback. Keep every input and output inside the repository.

## Ming setup and natural delivery

### Voice selection

The production adapter in `scripts/tts-ming.py` and the benchmark worker share
`scripts/ming_continuity.py`. They generate one neutral, cue-free `US_James` audio reference per invocation,
then condition **every spoken fragment in every performance segment** on that same audio, its transcript and
its extracted speaker embedding. The reference itself is never included in the narration. IP voice selection
replaces FREEFORM delivery instructions. This applies to newly generated narration; existing recordings keep
their original voice.

### Voice continuity and the former voice-change bug

Selecting the same IP voice name alone did not preserve acoustic identity. Upstream Ming split text internally
and generated each fragment independently with a zero speaker embedding. Our previous adapter also restarted
that process for each performance segment. Those boundaries could sound like a different speaker.

The shared adapter now owns bounded fragment generation, calls `synthesize(raw_text=True)` for each fragment
to prevent a second hidden split, and supplies the same reference WAV, transcript and real speaker embedding
with `use_spk_emb=True` and `use_zero_spk_emb=False`. Only the neutral reference uses a zero embedding.
Upstream semantic splitting is retained for manageable decode lengths; unusually long clauses are further
bounded to 24 whitespace-separated words. The short reference leaves room in Ming's finite decode context
for the target speech. Speed and pauses are applied afterward, leaving the reference
unmodified. The model and encoded prompt stay loaded across the whole narration. A reference-generation or
encoding failure stops the job; there is no fallback to independently selected voices.

`tts-status.json` records `voice: "US_James"` and `continuityMode: "fixed-acoustic-reference-v1"` for new Ming
runs. The benchmark records the same continuity mode in its stage metrics. Reference files live inside the
repository: narration uses its private temporary cache directory, removed after completion or failure; the
benchmark deletes its reference in a `finally` block.

Keep all performance segments in **one** `npm run video -- tts ... --narration --provider ming` invocation.
Do not generate segments separately or bypass the shared adapter. No sidecar changes or model reinstallation
are needed for this fix. Existing generated WAVs are not repaired automatically: explicitly regenerate affected
narration with its original reviewed script and sidecar, then rebuild its alignment and film through the normal
pipeline. Never regenerate a supplied human recording.

This prevents the known unconditioned resets; it does not prove that a generative voice can never vary in timbre.
Check the opening, internal fragment joins and performance-segment joins by listening before approval. If a
change remains, retain the script, sidecar, status and WAV for diagnosis; do not claim a pass from signal measurements.
Use `npm run video -- tts --benchmark --engine both --out outputs/tts-benchmarks/voice-continuity` for a fresh
comparison through the same fixed synthesis path. Historical benchmarks describe the earlier implementation.

Install once **in the checkout that runs the UI and jobs**:

```bash
npm run video -- tts --setup-ming
```

Requires git, Python 3.12 with venv support, and ffmpeg. `MING_SETUP_PYTHON` can select another compatible Python.
The CPU environment, pinned upstream source and roughly 3 GB of model files live in `.cache/video-gen/ming-benchmark/`.
Setup adapts three upstream autocast scopes for CPU without changing weights. Existing benchmark installations at that location are reused.
No API key is needed. Setup downloads code and weights; generation then runs offline. Check upstream LICENSE and LEGAL.md for deployment terms.
Ming is slower than Kokoro. Historical CPU timings predate acoustic-reference conditioning; new runs also generate and encode a reference. Measure current performance on the target host.
A separate worktree needs its own setup. Do not move shared model caches out of another checkout.

When **Ming is selected**, the orchestrator creates `ming-performance.json` beside the reviewed `SCRIPT.md`.
Keep the reviewed script free of delivery tags so captions, word counts and alignment remain clean. Put exact spoken words
and delivery cues only in this sidecar. Its segments, with supported cues removed, must match the reviewed narration exactly
(including punctuation; whitespace can differ). Changing a reviewed word requires the normal script review workflow.

This is intentional: `SCRIPT.md` is the clean source of spoken words, while the sidecar carries TTS-only performance
instructions. A vocal cue inside a sidecar segment is stripped before script matching and caption alignment. Do not move
those cues into `SCRIPT.md` unless the script and caption pipeline is explicitly updated to understand them.

Example for a reviewed script containing “Wait, the server is still running. Disconnect the network first. There. We caught it in time.”:

```json
{
  "segments": [
    {
      "text": "[Surprise-oh] Wait, the server is still running. Disconnect the network first.",
      "speed": 1.04,
      "pauseAfter": 0.45
    },
    {
      "text": "There. We caught it in time.",
      "speed": 0.96,
      "pauseAfter": 0
    }
  ]
}
```

Write natural thought groups of roughly 2–5 sentences (maximum 150 words per segment), not a separate request for every sentence or word.
Use subtle context-appropriate emotion, emphasis and cadence. Slow down for dense explanations or significant points;
slightly accelerate transitions. Do not prescribe an emotional effect for every line. Prefer clear punctuation and well-phrased
sentences. Avoid repetitive breaths, theatrical panic, laughter in serious material, or artificial filler words.

`instruction` and shared `voiceInstruction` fields are rejected. Remove them from existing sidecars before generation.
Every segment uses `US_James`; delivery comes from
punctuation, supported vocal cues, speed and pauses. Do not request FREEFORM instructions or categorical emotion
controls with this voice. `-v` remains a Kokoro option.
`speed` is a segment multiplier (0.9–1.15, default 1), combined with command-line `-s` and applied with pitch-preserving ffmpeg
atempo. `pauseAfter` inserts 0–2 seconds (default 0.25) after that segment, in addition to pauses generated by the model.
Use modest variation; do not force the target length by rushing every phrase. Internal pauses and emotional delivery are
model-guided, not exact timestamp controls.

### Complete Ming inline cue catalog

All 14 inline cues supported by our pinned Ming version are available to `US_James`. Choose from this full catalog;
the four cues in the server example are illustrations, not a restricted selection. Spelling and case must match exactly.

| Cue | Vocal event |
| --- | --- |
| `[Breathing]` | Audible breathing |
| `[Cough]` | A cough |
| `[Sigh]` | A sigh |
| `[Laughter]` | Laughing |
| `[Uhm]` | Hesitation sound |
| `[Surprise-ah]` | Surprised “ah” |
| `[Surprise-oh]` | Surprised “oh” |
| `[Dissatisfaction-hnn]` | Displeased “hnn” |
| `[Confirmation-en]` | Affirmative “en” |
| `[Question-ei]` | Questioning “ei” |
| `[Question-ah]` | Questioning “ah” |
| `[Question-en]` | Questioning “en” |
| `[Question-oh]` | Questioning “oh” |
| `[Question-huh]` | Questioning “huh” |

These generate vocal events; they are not generic emotion labels. Unsupported cues such as `<PANIC>` or `[Gasp]`
are rejected. The adapter's allowlist in `lib/ming.mjs` matches the complete upstream `PARALINGUISTIC_TAGS` list in
`ming_tiny/task_protocol.py`. Reference: [pinned Ming cue documentation](https://github.com/inclusionAI/Ming-3.0-tts/blob/028c1eace193e7acdb256453da89b6e9207e052b/cookbooks/instruction_en.md#paralinguistic-tags-new).

Every Ming delivery plan gets an explicit expressive-cue pass after script review. Use this bracketed-cue format in
segment text to shape natural breaths and reactions, as in the expressive US_James server example: surprise at the
running server, a breath before taking action, a sigh of relief, then laughter at the closing joke. Choose cues for the
meaning and the narrator’s attitude. Human-like conversational delivery is the goal; there is no cue quota, and a
serious explanation should not acquire forced laughter or repeated sighs. Keep all cues in the sidecar, out of SCRIPT.md.

```bash
npm run video -- tts jobs/scripts/<slug>/SCRIPT.md --narration --provider ming -s 1.0 -o jobs/scripts/<slug>/narration.wav
```

The sidecar is loaded automatically; `--performance <repository-file.json>` selects another path. Ming loads once, holds one acoustic reference for the
whole job and joins the segments into the normal 24 kHz mono narration WAV, with 1.5 seconds of trailing silence.
Missing installation, invalid plans and generation errors stop with an error; Ming does not silently switch providers.
Measure the duration and review pronunciation, transitions and cue fidelity before proceeding. Do not claim listening quality
from signal measurements alone. A supplied recording always takes priority.

Upstream reference: [Ming delivery controls](https://github.com/inclusionAI/Ming-3.0-tts/blob/main/cookbooks/instruction_en.md).

## Gemini setup

Set `GEMINI_API_KEY` in the server environment or the ignored repository `.env`, then restart the UI server
when no jobs are running. `GOOGLE_API_KEY` is also accepted. Never put a key in a job, prompt, command-line
argument or committed file. The standalone TTS command reads the same `.env`.

The default order is `gemini-3.8-flash-tts` → `gemini-3.8-flash-lite-tts` → Kokoro, using the `Charon`
voice for both Gemini models. Optional server settings are `GEMINI_TTS_MODEL`, `GEMINI_TTS_FALLBACK_MODEL`
and `GEMINI_TTS_VOICE`. Duplicate model IDs are tried only once. Requests use Google's Interactions REST API with the transcript
separate from delivery instructions. The script is sent to Google; billing, free-tier availability and quotas
belong to the API project. Selecting Gemini does not enforce a free billing plan.

Gemini requests use IPv4. On this server, Google accepts IPv4 but rejects IPv6 with
`User location is not supported for the API use.` This choice is confined to the TTS request and does not
change system networking or other providers. Other API errors include Google's message with the API key redacted.
Temporary HTTP 500/502/503/504 errors are retried up to three attempts on the same Gemini model. Quota exhaustion
or persistent service overload then tries the backup Gemini model. Authentication, location and invalid-request
errors stop immediately. If the backup also hits quota, generation switches to Kokoro; a persistent backup service
failure is surfaced instead of being labelled quota exhaustion.

Every model or provider switch regenerates **the entire narration** so one recording never mixes models or voices.
The wrapper records the requested and active model and fallback reason in `tts-status.json` beside the narration,
prints a notice, and the UI displays it in the conversation and Progress. Retries and resumes of that job keep the
selected fallback model or Kokoro. New jobs try the primary Gemini model again. Missing keys, authentication failures, invalid requests, network failures
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

1. Install Ming using `npm run video -- tts --setup-ming` for the default narrator, and create its delivery sidecar as described above. For Kokoro or Gemini, complete the Kokoro setup instead (Gemini needs it for fallback). Then choose a speed using the word count.
2. Run one command for the entire reviewed narration. Use the provider selected in the job; outside the UI,
   omitting `--provider` for `--narration` uses Ming unless `VIDEO_TTS_PROVIDER` explicitly selects another provider:

   ```bash
   npm run video -- tts jobs/scripts/<slug>/SCRIPT.md --narration --provider gemini -s 1.0 -o jobs/scripts/<slug>/narration.wav
   ```

   `-v` / `--voice` selects the Kokoro voice, including when used as fallback. `-s` / `--speed` sets Kokoro's
   speed and Gemini's requested speaking pace. Gemini's pace is an instruction, so measure the result.
   Gemini receives all paragraphs together in one request and controls the pauses naturally. Kokoro generates
   paragraphs separately and joins them with 0.6 s pauses. Both produce 24 kHz mono PCM WAV with 1.5 s of
   trailing silence. Retries or backup models may require additional requests. The output is replaced only after
   the full recording is ready.

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
