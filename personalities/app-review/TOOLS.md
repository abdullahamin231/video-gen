# Capture and overlay tools

For browser apps use `npm run video -- app-capture`, which drives a scripted task in headless Chrome and writes the
recording, the action log and the evidence into the job. It is the browser path; the recorder never composites the
operating-system pointer, and the pointer you see in the film is drawn from the log afterwards. These are our authorised
hands-on sessions only, never recordings of commercial reference videos.

`app-capture --job jobs/scripts/<slug> --plan capture/<task>/plan.json` writes `capture/<task>/` beside the script, before
narration and before the film job exists (`start` copies it into the job). The pipeline's `next` refuses to write the
script until a capture manifest exists, because the verdict follows the session:

- `recording.mp4` — the session at the plan's viewport, no cursor baked in.
- `actions.jsonl` — `goto`, `move`, `click`, `type`, `press`, `scroll`, `wait`, `shot`, `assert` with timestamps, target
  selectors, clicked bounds and observed results.
- `pointer.json` — pointer samples from the page, on the same clock as the actions.
- `shots/*.png` — stills for each `shot` step; `assert` results say whether the expectation held.
- `manifest.json` — task/feature id, build, viewport and scale, starting URL and title, frame count, durations, results,
  console errors and SHA-256 of every file.

Plan the capture as one continuous hands-on task. Keep the actual click, typing, keypress and scroll sequence in the
recording and in the source ranges used by `edits.json`; PNG `shot` steps are supporting evidence and cannot replace
the interaction that establishes a claim. Use a short, natural pointer approach and type with a human-readable delay.
Wait for the real UI condition where possible. `wait` records its elapsed time: preserve the whole wait in the cut when
loading behavior matters. If the wait exceeds the narration, let the recording run through the outcome and use a
legitimate held result frame for the remaining narration; never speed it up, imply an earlier result, or describe the
held frame as ongoing motion. Static age gates and necessary result states may remain on screen when clearly presented
as a hold.

Evidence must name the feature/task id, the installed version or build, viewport and scale, the starting state, each
action with its observed result, the file hashes and the source time range — the manifest and action log carry all of
them. Keep failed assertions: a flow that did not work is part of the verdict, and deleting it is falsification.

Write `capture/<task>/edits.json` to choose what each cut shows: `id`, the narration `phrase` the moment belongs to,
`source` seconds in the recording, and `feature`/`result`. Then `capture-scene --capture capture/<task> --scene <id>`
cuts derived clips under `assets/app-capture/` (the source recording is never modified) and compiles `shots/<id>.json`
with the giant pointer, click rings and camera push-ins. Build that scene with `build` as usual.

The compiled scene keeps cue-relative timing and the personality's `DESIGN.md` look. Adjust it like any other scene: fix
framing, add callouts, cut a misleading pause. Do not redraw the application, do not invent interaction states, and do
not replace the recording with a diagram.

Capture cannot show what a headless browser cannot reach: native desktop windows, OS dialogs, system permissions and
anything behind a hardware key are outside this adapter. Report that boundary instead of faking the missing surface.
Recordings are captured at CSS resolution, so a push-in stops at about 1.5× magnification; raise the viewport for a
closer look rather than accepting a soft one.

Pixel checks flag sustained near-black output, while capture visibility checks compare sampled regions of supported,
untransformed capture layers with the corresponding recorded footage. This comparison also works for white or colored
backgrounds and accepts a genuine black source frame when the rendered region matches it. Source duration proves only
that media exists; it does not establish that the layer was visible. A failed comparison blocks the final review pack.
Scenes with transforms, animated geometry or overlapping composition layers are reported as `unverified` in
`review/pixels.json`; the report must not claim complete playback verification for them. These scenes still need
human inspection in the encoded review evidence. A `blackScreenReason` note is descriptive only and never exempts
rendered frames from verification.
