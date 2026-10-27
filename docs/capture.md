# App capture: record with reshoot, compile the film

`app-review` films are built from a recording of the application under test. There is one recorder: reshoot records the
storyboard in headless Chrome and composites the cursor into the footage. `capture-ingest` turns its run folder into the
`capture/<task>/` contract, and `capture-scene` cuts that recording per `edits.json` and compiles click rings and camera
push-ins from the action log.

The former `app-capture` recorder — which left the pointer out of the footage and drew a synthetic pointer from a
`pointer.json` path — has been removed. `capture-scene` refuses a capture whose manifest does not say
`recorder.pointer: "composited"`, so old footage cannot be recompiled without a cursor by accident.

## 1. Record the session

Record with reshoot, accept the take, then ingest the run. The reshoot project lives in `<script>/reshoot/`, never inside
`capture/`: `start` copies all of `capture/` into the film job, and a reshoot project's takes, runs and `accepted/`
baseline are not capture evidence.

```
reshoot run jobs/scripts/<slug>/reshoot/reshoot.toml
reshoot accept jobs/scripts/<slug>/reshoot/takes/runs/<id>
npm run video -- capture-ingest --job jobs/scripts/<slug> --run <run folder> --task <task>
```

In a project, `npm run video -- next --project <slug>` keeps returning `STATE: record the authorised session before
anything is written` until a capture manifest exists. The session is recorded beside the script — before narration and
before the film job exists. In an existing film job the same `capture-ingest` works with `--job jobs/<slug>`.

`--run` names the run folder (`takes/runs/<id>`), never `latest`. `capture-ingest` only reads that folder, so reshoot
does not have to be installed on the machine that compiles the film, and the run stays exactly as reshoot wrote it. It
refuses a preview take, a run reshoot marked failed, a take whose `schema_version` it does not know, and a take that
logged no action — each is a different thing from evidence.

[reshoot.md](reshoot.md) is the full guide: install, project layout, storyboard fields, `accept`/`compare`, headless and
server requirements, the privacy-scan caveat, cost, pitfalls and the shipped skills.

## 2. The capture contract

`capture-ingest` writes into `capture/<task>/`:

| file | contents |
| --- | --- |
| `recording.mp4` | reshoot's clean take, H.264 at 30 fps, no audio. **The cursor is composited into the footage.** |
| `actions.jsonl` | one `click` per control a storyboard action touched, at the control's centre, plus one `assert` per result check, each with `t`, the target and its bounds |
| `shots/<beat>.png` | the evidence frame for each beat |
| `manifest.json` | task/feature/claim/build, URL, viewport and real frame size, scale, recorder and source run, duration, result checks, SHA-256 of every file |

The manifest records the recorder and the run it came from:

```json
{
  "recorder": {"app": "reshoot", "version": "0.3.9", "pointer": "composited", "pixelRatio": 2},
  "source": {"run": "45d0be0a…", "take": "demo.take.json", "storySha256": "…", "takeSha256": "…"},
  "viewport": [1280, 720],
  "frameSize": [2560, 1440],
  "scale": 2
}
```

`pointer` is always `composited`: the cursor is in the footage, so the compiler draws no second pointer and writes no
cursor asset. `frameSize` is the recording's real pixel size and `scale` its ratio to the CSS viewport; a take recorded at
2× therefore allows a closer push-in than a CSS-resolution one.

The action log understates the session rather than inventing it: reshoot does not distinguish clicking, typing and
keypresses, and it does not log scrolling, so the log carries clicks and result checks only. Do not describe a keystroke
or a scroll that the log does not carry.

Failed result checks stay in the manifest and in `actions.jsonl`. `capture-ingest` lists them and exits non-zero: a flow
that did not work is part of the verdict, and deleting it is falsification. Re-ingesting a task clears only the generated
artefacts (`recording.mp4`, `actions.jsonl`, `shots/`, `manifest.json`); `edits.json` stays, so a second take does not
throw away the cuts you wrote.

## 3. Choose the cuts

`capture/<task>/edits.json` maps narration moments onto source ranges:

```json
{
  "scene": "filter-save",
  "fit": 0.9,
  "edits": [
    {"id": "open-dialog", "phrase": "the new filter dialog", "source": [4.2, 7.6],
     "feature": "F3", "result": "the dialog opens over the list"},
    {"id": "name-it", "phrase": "name it Bikes", "source": [7.6, 10.4],
     "feature": "F3", "result": "the name field accepts text"}
  ]
}
```

- `scene` is the scene id already declared in `film.json`; `build` will not invent one.
- `phrase` is the narration words at that moment, copied from the script. The compiler defines one cue per edit, named
  after its `id`, so every action it emits is `at: "<id>+1.32"` — cue-relative, never absolute seconds.
- `source` is `[in, out]` in the recording. Cuts must not overlap: an overlapping range puts the same click in two
  shots, and the compiler warns.
- `feature` and/or `result` say what the cut proves; at least one is required.
- Preserve each real logged action that establishes the narrated claim inside the chosen source ranges. The compiler
  rejects a cut that shows no recorded interaction at all. A meaningful logged action omitted from all cuts needs an
  `omissions` entry with its `actionIndex`, a specific reason, and an `evidence` record
  `{kind:"action-log",path:"actions.jsonl",sha256:"<current hash>",actionIndex}`. The compiler writes a frozen
  `capture/<task>/omissions.json` record containing the action and matching action-log hash; stale or unsupported
  references fail compilation.
- Omission evidence is scoped to the requested scene and records the source ranges plus every meaningful action expected
  outside them, including the verified-empty case. Final app-review packs freeze the scene ledger with the project source
  hash, action-log hash and capture-manifest hash, and direct independent reviewers to inspect every omission. Missing,
  stale, malformed or incomplete ledgers block the pack. Legacy omission records without `scene` cannot be assigned
  safely: migrate them only when the matching scene is established by its edits and action log, or record that scene
  again; compilation preserves the ambiguous file and fails with guidance. The per-capture omissions ledger uses the
  `flock` command from Linux util-linux to hold an OS-managed exclusive lock through the complete read/modify/atomic-
  replace transaction; the same child process owns the lock and writes. The kernel releases it automatically on process
  exit, with no stale-lock recovery protocol. Contenders wait at most five seconds. This currently requires Linux with
  util-linux `flock` on `PATH`.
- `fit` is how much of the frame the recording fills (0.9 leaves a margin); `zoom` on a single edit overrides the derived
  push-in.
- A cut holds its exact final recorded frame after the trimmed video ends, so a short media slot cannot expose a blank
  composition background. Set `"hold": false` only when the shot is meant to disappear at the end of its source range.
  Later footage layers remain above earlier held frames.

Keep the complete recorded moment when loading behavior matters. If it lasts longer than the narration, retain the full
source range and show its real completion; a held final result can then carry the remaining narration. Never cut into a
recorded wait and imply a faster completion. Label or narrate that as a result hold, not continuing motion. A necessary
static age gate or saved-result state is valid footage when it is the actual outcome. Do not replace the task with a list
of stills or imply a result happened sooner than the recording shows.

## 4. Compile

```
npm run video -- capture-scene --job jobs/<slug> --capture capture/F3 --scene filter-save
```

This cuts derived clips into `assets/app-review/<task>/<edit-id>.mp4` — the source recording is never modified, so the
manifest hashes still describe the evidence — and emits `shots/<scene>.json`. No cursor asset is written.

What is derived from the log, per cut:

- **Click rings**: one ring per click, sized from the clicked target's bounds, expanding and fading. A click too late
  in a cut gets a shorter fade instead of one that runs past the end. The recorded cursor already marks the action; the
  ring only emphasises where it landed.
- **Camera**: a click cluster (clicks less than 1.8 s apart) pushes in on the union of the clicked targets. The zoom is
  `0.58 × frame width / target width`, clamped 1.15×–3.2× and further clamped so the capture is never magnified past
  `1.5 × (frameSize / viewport)`. The camera is clamped inside the recording so a control near an edge never opens a gap
  of background beside it. Every cut comes back out wide, and a cluster followed closely by another is not pulled out
  between them.

Then build the scene like any other:

```
npm run video -- build --job jobs/<slug> --scene filter-save
```

For the final app-review pass, render before freezing reviewer evidence and use the encoded output:

```bash
npm run video -- render --job jobs/<slug> --reuse-build true
npm run video -- review-pack --job jobs/<slug> --stage final --from render
```

The pipeline's `next` command routes app-review finals through this order automatically. The review pack includes
frames decoded from the MP4 and normal-speed clips from the same verified file; HTML-seek frames are not accepted as
final app-review evidence because a browser seek can retain a cached video frame that real playback has already lost.

### Unverified capture coverage

The renderer's capture-visibility check marks transformed, animated, or overlapping capture layers `unverified`;
that status is never promoted to `verified`. A final pack blocks until each such capture has one disposition in
`review/capture-visibility-dispositions.json`, with the current `sourceHash` and `videoSha256` from
`review/pixels.json`. Each entry names the exact `captureId`, `sceneId`, and verifier-reported `interval.start` / `interval.end`,
uses `status: "visually-inspected"` and `decision: "acceptable"`, and includes hashed local PNG evidence frames.
Include source and encoded-render frames at 10%, 50%, and 90% of the interval (each item's `sceneAt` must be within
120 ms of those points); source frames also record `sourceAt`. The encoded-render frames must come from
`renders/video.mp4`; source frames must come from the current capture recording. Example shape:

```json
{
  "version": 1,
  "sourceHash": "<current review/pixels.json sourceHash>",
  "videoSha256": "<current review/pixels.json videoSha256>",
  "dispositions": [{
    "captureId": "screen-example",
    "sceneId": "example",
    "start": 4,
    "end": 8,
    "status": "visually-inspected",
    "decision": "acceptable",
    "reviewer": {"agentId":"<independent reviewer agent id>","independent":true},
    "evidence": [
      {"kind":"source-frame","sceneAt":4.4,"sourceAt":0.4,"path":"review/inspection/example-source-10.png","sha256":"<sha256>"},
      {"kind":"render-frame","sceneAt":4.4,"path":"review/inspection/example-render-10.png","sha256":"<sha256>"}
    ]
  }]
}
```

Repeat the paired frame records at 50% and 90%. The pack validates hashes, local PNG files, exact interval,
complete disposition count, and current source/render identity. Missing, stale, malformed, rejected, unrelated, or
inaccurate entries block. These records are a structured visual-inspection disposition, not a change to the underlying
capture status or a generic prose waiver. The independent inspection must confirm that the rendered capture still
shows the recorded app content across the interval; if it cannot, fix the composition or leave the pack blocked.

The gate decodes each supplied PNG and checks its pixels against the actual source recording or encoded render at
the declared timestamp. Source timestamps must match the source trim plus scene-relative time. PNG hashes alone do
not establish provenance.

After `render` and `verify` report unverified intervals, generate canonical pairs:

```bash
npm run video -- capture-visibility --job jobs/<slug> --generate
```

This writes six frames per interval directly from the current capture recording and `renders/video.mp4`, bound to the
current hashes and verifier interval, and leaves each disposition pending. Delegate those frames to an independent
reviewer using the project's existing `visual-mechanism` reviewer role/model policy. Request one `acceptable` or
`reject` verdict and a concrete observation for every capture, with the reviewer identity and both current hashes.
Save that response as local JSON and record it:

```bash
npm run video -- capture-visibility --job jobs/<slug> --record jobs/<slug>/review/independent-verdict.json
npm run video -- review-pack --job jobs/<slug> --stage final --from render
```

Missing, stale, malformed, wrong-time, or rejected reports keep final-pack creation blocked. A rejection requires a
scene repair and a fresh render/evidence round. Generation is not a visual judgment; only the independent reviewer's
recorded verdict marks an interval inspected. This workflow does not add a human-approval checkpoint or a bypass.

The compiled scene is a starting point, not a locked artefact: adjust framing, add callouts from the theme, cut a
misleading pause. Keep the footage, the recorded cursor and the click positions as recorded — those are the evidence.

## Limits

- **Browser only.** Native desktop windows, OS dialogs, system permission sheets and anything behind a hardware key are
  outside this recorder. Report that boundary; do not substitute a drawn interface.
- **Sharpness.** The magnification cap follows the recording's `frameSize`, not its viewport: `1.5 × (frameSize /
  viewport)`. A CSS-resolution take is capped at 1.5×; a reshoot take recorded at 2× is allowed 3×. To get closer than
  the cap, record at a higher `scale`, not a softer zoom.
- **No commercial footage.** Only our own authorised hands-on sessions. Never record a commercial product's UI because
  a reference video showed one.
- **Stills vs motion.** A cut with no cursor movement (a result on screen) is fine, but a whole film of stills is not a
  review. Show the action and the resulting state.

## Files

- `lib/reshoot.mjs` — reads a reshoot run folder and writes the capture contract (`capture-ingest`).
- `lib/capture-scene.mjs` — cut selection, click rings, camera derivation, scene writing, omissions ledger.
- `lib/media.mjs` — shared duration and frame-size probing.
- `tests/capture-scene.test.mjs` — edits validation, clustering, a full compile checked against the film schema, the
  omissions ledger, and the refusal of a non-composited capture.
- `tests/reshoot-ingest.test.mjs` — ingesting a run folder, refusing preview/failed/unknown takes, and compiling a
  composited-pointer capture with no second cursor.
