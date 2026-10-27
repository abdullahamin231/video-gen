# Capture and overlay tools

App-review has one recorder: [reshoot](https://github.com/mumit/reshoot). It drives a storyboard in headless Chrome,
composites the cursor into the footage and writes a run folder with per-beat result checks and evidence frames.
`capture-ingest` reads that run folder and turns it into the `capture/<task>/` contract this pipeline compiles; the
pipeline never invokes reshoot itself. These are our authorised hands-on sessions only, never recordings of commercial
reference videos.

```
reshoot run jobs/scripts/<slug>/reshoot/reshoot.toml
reshoot accept jobs/scripts/<slug>/reshoot/takes/runs/<id>     # when the run is right
npm run video -- capture-ingest --job jobs/scripts/<slug> --run <run folder> --task <task>
```

Keep the reshoot project in `<script>/reshoot/`, never inside `capture/`: `start` copies all of `capture/` into the film
job, and a reshoot project holds takes, runs and an `accepted/` baseline that must not travel as capture evidence.
`--run` is the run folder (`takes/runs/<id>`), never `latest`. `capture-ingest` refuses preview takes, failed runs,
unknown take schemas and takes that logged no action, rather than treating them as evidence.

The pipeline's `next` refuses to write the script until a capture manifest exists, because the verdict follows the
session. `capture-ingest` writes:

- `recording.mp4` — reshoot's clean take. **The cursor is composited into the footage.**
- `actions.jsonl` — one `click` per control a storyboard action touched, at that control's centre, plus one `assert` per
  result check. reshoot does not distinguish typing, clicking and keypresses, so the log understates the session rather
  than inventing actions: do not describe a keystroke the log does not carry.
- `shots/<beat>.png` — the evidence frame for each beat.
- `manifest.json` — task/feature id, build, viewport, real frame size and scale, starting URL, durations, result checks,
  the recorder and source run, and SHA-256 of every file.

Evidence must name the feature/task id, the installed version or build, viewport and frame size, the starting state, each
action with its observed result, the file hashes and the source time range — the manifest and action log carry all of
them. Keep failed result checks: a flow that did not work is part of the verdict, and deleting it is falsification.

## What the recording carries, and what it cannot

- The cursor is already in the footage. The manifest records `recorder.pointer: "composited"`, the compiler draws no
  second pointer and writes no cursor asset, and click rings and camera moves still come from the logged control bounds.
  Never add a pointer of your own on top of it.
- There is no pointer path to replay; the real path exists only inside the footage. The compiler therefore never emits a
  `move` action for a capture.
- The storyboard's `expect` is only as strong as the text it matches. A check that a page merely contains a string still
  passes when the wrong item was opened, so assert on identity (an id, a heading, a count), not on a word that appears in
  several states.
- reshoot's own captions, narration, privacy scan and final cut are not evidence for this personality: ingest the clean
  take and compile the scene here, so the film keeps our theme, cues and review record. The scan also needs `tesseract`
  on Linux; without it, `scan = false` and no privacy claim may be made. Review the clean take, not reshoot's captioned
  cut: that cut ships beside a same-name `.srt`, so a player that auto-loads subtitles shows every caption twice.

The full guide — project layout, storyboard fields, `accept`/`compare`, headless requirements, the shipped skills and the
ingest mapping — is [docs/reshoot.md](../../docs/reshoot.md).

## Compiling the cut

Write `capture/<task>/edits.json` to choose what each cut shows: `id`, the narration `phrase` the moment belongs to,
`source` seconds in the recording, and `feature`/`result`. Then `capture-scene --capture capture/<task> --scene <id>`
cuts derived clips under `assets/app-review/` (the source recording is never modified) and compiles `shots/<id>.json`
with click rings and camera push-ins over the recorded cursor. Build that scene with `build` as usual.

The compiled scene keeps cue-relative timing and the personality's `DESIGN.md` look. Adjust it like any other scene: fix
framing, add callouts, cut a misleading pause. Do not redraw the application, do not invent interaction states, and do
not replace the recording with a diagram.

## Boundaries

Capture cannot show what a headless browser cannot reach: native desktop windows, OS dialogs, system permissions and
anything behind a hardware key are outside this recorder. Report that boundary instead of faking the missing surface.

A reshoot take recorded at 2× carries two source pixels per CSS pixel, so `capture-scene` allows it up to 3× before it
warns; a CSS-resolution take stops at about 1.5×. Raise the take's `scale` for a closer look rather than accepting a soft
one.

Pixel checks flag sustained near-black output, while capture visibility checks compare sampled regions of supported,
untransformed capture layers with the corresponding recorded footage. This comparison also works for white or colored
backgrounds and accepts a genuine black source frame when the rendered region matches it. Source duration proves only
that media exists; it does not establish that the layer was visible. A failed comparison blocks the final review pack.
Scenes with transforms, animated geometry or overlapping composition layers are reported as `unverified` in
`review/pixels.json`; the report must not claim complete playback verification for them. These scenes still need human
inspection in the encoded review evidence. A `blackScreenReason` note is descriptive only and never exempts rendered
frames from verification.
