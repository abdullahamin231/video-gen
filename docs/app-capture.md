# App capture: record a session, compile the film

`app-review` films are built from a recording of the application under test. The adapter records in headless Chrome,
writes a timestamped action log beside the footage, and compiles that log into the scene: a giant pointer that follows
the path the task actually took, a ring on each click target, and camera push-ins and pull-outs.

The operating-system pointer is never composited into the recording. That is deliberate: the pointer in the film is
drawn from the log, so it can be restyled, resized, counter-scaled and mapped through camera moves, and there is never a
second pointer over a baked-in one.

## 1. Plan the session

`capture/<task>/plan.json`:

```json
{
  "task": "F3-new-filter",
  "feature": "create a filter",
  "claim": "a filter can be created from the Filters screen",
  "build": "Acme 1.4.2 (web)",
  "url": "https://app.example.test/filters",
  "viewport": [2560, 1600],
  "scale": 1,
  "steps": [
    {"do": "wait", "for": "#new-filter", "why": "the Filters screen has loaded"},
    {"do": "shot", "name": "01-start", "state": "two filters, before"},
    {"do": "click", "target": "#new-filter", "why": "open the new-filter dialog"},
    {"do": "type", "target": "#filter-name", "text": "Bikes"},
    {"do": "click", "target": "#save-filter", "why": "save it"},
    {"do": "wait", "seconds": 0.8, "why": "the row and toast settle"},
    {"do": "assert", "target": "#filters", "text": "Bikes", "why": "the new filter is listed"}
  ]
}
```

| step | fields | what it does |
| --- | --- | --- |
| `goto` | `url`, `until`, `timeout` | navigate; `url` on the plan does the first one |
| `wait` | `for` (selector), `seconds`, `timeout`, `why` | wait for an element, a duration, or both |
| `click` | `target`, `why` | move the pointer to the element, then click it |
| `type` | `target`, `text`, `masked`, `delay` | click the field and type; password fields are masked automatically |
| `press` | `key` | `Enter`, `Escape`, `Tab`, … |
| `scroll` | `dy`, `target`, `settle` | wheel over the middle of the viewport |
| `shot` | `name`, `state` | PNG evidence still, named for what it shows |
| `assert` | `target`, `text` (or `expect`), `why` | record whether the claim held |

`why` is not decoration: it becomes the action's observed intent in the log and the reviewer reads it. Record the
starting state with a `shot` before the first click. Keep assertions even when they fail — a flow that did not work
belongs in the verdict, and deleting it is falsification.

Default viewport is `[2560, 1600]`. The screencast records at CSS resolution, so the compiled camera will not magnify
more than about 1.5× (see sharpness below); a larger viewport buys a closer push-in. `scale` only affects the evidence
stills.

## 2. Record

In a project, `npm run video -- next --project <slug>` keeps returning `STATE: record the authorised session before
anything is written` until a capture manifest exists. The session is recorded beside the script — before narration and
before the film job exists:

```
npm run video -- app-capture --job jobs/scripts/<slug> --plan jobs/scripts/<slug>/capture/F3/plan.json
```

`start` copies `capture/` into the film job, so the cuts, the action log and the manifest stay beside the film that
cites them. In an existing film job the same command works with `--job jobs/<slug>`.

Writes into `capture/F3/`:

| file | contents |
| --- | --- |
| `recording.mp4` | H.264 at 30 fps, no cursor, no audio |
| `actions.jsonl` | `goto`, `move`, `click`, `type`, `press`, `scroll`, `wait`, `shot`, `assert`, `error`, `end`, each with `t` and, for clicks, the target's bounds |
| `pointer.json` | pointer samples `{t, x, y}` in CSS pixels on the same clock |
| `shots/*.png` | one still per `shot` step |
| `manifest.json` | task/feature/claim/build, URL and title, viewport and scale, frame size and count, duration, assertion results, console errors, SHA-256 of every file |

Frames arrive when the page changes, so a still stretch becomes one long frame instead of a guessed frame rate. Frames
that arrive before layout settles at a different size are dropped; the recording keeps one consistent size.

If an assertion fails the command exits non-zero and lists what it expected against what it saw. The recording is
complete either way. If a step cannot run at all — a missing selector, a failed navigation — the session stops at that
step and keeps the footage, the log and the stills up to it; `manifest.json` records the reason under `aborted`. That is
also evidence: the build did not have the control the task needed.

Re-recording a task clears only the generated artefacts and the stills. `plan.json` and `edits.json` stay, so a second
run does not throw away the cuts you wrote.

## 3. Choose the cuts

`capture/<task>/edits.json` maps narration moments onto source ranges:

```json
{
  "scene": "filter-save",
  "fit": 0.9,
  "cursorSize": 54,
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
- `fit` is how much of the frame the recording fills (0.9 leaves a margin); `cursorSize` is the pointer's height on
  screen in px; `zoom` on a single edit overrides the derived push-in.

## 4. Compile

```
npm run video -- capture-scene --job jobs/<slug> --capture capture/F3 --scene filter-save
```

This cuts derived clips into `assets/app-capture/<task>/<edit-id>.mp4` — the source recording is never modified, so the
manifest hashes still describe the evidence — writes the pointer asset once, and emits `shots/<scene>.json`.

What is derived from the log, per cut:

- **Pointer**: the logged pointer path, resampled to ~14 steps a second, moved in world space over the footage.
  Counter-scaled against every camera move, so it keeps one readable size instead of growing to several times its
  natural size inside a push-in. `cursorScreen: false` in the edits file lets it scale with the world instead.
- **Click rings**: one ring per click, sized from the clicked target's bounds, expanding and fading. A click too late
  in a cut gets a shorter fade instead of one that runs past the end.
- **Camera**: a click cluster (clicks less than 1.8 s apart) pushes in on the union of the clicked targets. The zoom is
  `0.58 × frame width / target width`, clamped 1.15×–3.2× and further clamped so the capture is never magnified past
  1.5×. The camera is clamped inside the recording so a control near an edge never opens a gap of background beside
  it. Every cut comes back out wide, and a cluster followed closely by another is not pulled out between them.

Then build the scene like any other:

```
npm run video -- build --job jobs/<slug> --scene filter-save
```

The compiled scene is a starting point, not a locked artefact: adjust framing, add callouts from the theme, cut a
misleading pause. Keep the footage, the pointer path and the click positions as recorded — those are the evidence.

## Limits

- **Browser only.** Native desktop windows, OS dialogs, system permission sheets and anything behind a hardware key are
  outside this adapter. Report that boundary; do not substitute a drawn interface.
- **Sharpness.** Chrome's screencast renders at CSS resolution even when the page uses a device pixel ratio above 1.
  The compiler therefore caps magnification at 1.5× and warns when a requested zoom would exceed it. To get closer,
  record a larger viewport, not a softer zoom.
- **No commercial footage.** Only our own authorised hands-on sessions. Never record a commercial product's UI because
  a reference video showed one.
- **Stills vs motion.** A cut with no pointer movement (a result on screen) is fine, but a whole film of stills is not a
  review. Show the action and the resulting state.

## Files

- `lib/capture.mjs` — the headless recorder, plan validation, action/pointer/manifest writer.
- `lib/appcapture.mjs` — cut selection, pointer path, click rings, camera derivation, scene writing.
- `tests/appcapture.test.mjs` — plan/edits validation, JPEG frame sizing, clustering, a full compile checked against
  the film schema, and a real headless recording.
- `tests/fixtures/app-capture/app.html` — a generic fixture page for those tests. It is not a recording of any product
  and must never stand in for one in a review.
