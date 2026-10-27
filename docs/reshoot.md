# reshoot: the browser recorder

[reshoot](https://github.com/mumit/reshoot) (MIT) is the recorder for this personality. It records a storyboard of
beats in headless Chrome and writes a run folder: per-beat result checks with the text it actually saw, evidence frames,
and a clean take with the cursor composited. `capture-ingest` reads that folder into the `capture/<task>/` contract, so
`capture-scene` compiles it unchanged.

It gives us:

- **Result checks per beat**, recorded with the text the page really showed, that stay in the manifest even when they
  fail.
- **An `accepted/` baseline and `compare`** between runs, so a re-record after a UI change can be diffed beat by beat.
- **A 2× capture** (`size = "1280x720@2"`), which raises the compiler's push-in budget from 1.5× to 3×.
- **A privacy scan** of the exports (needs `tesseract` on Linux).

## Install

```
uv tool install 'reshoot[browser]'      # or: pipx install 'reshoot[browser]'
reshoot --version                        # this repo is written against 0.3.9
reshoot doctor --config <project>/reshoot.toml --probe
```

`doctor` tests encoding, a TOML browser capture and the configured text scan on synthetic data. `--probe` does not
operate your app and does not approve media. On a server without a desktop session it should still pass everything
except the scan when `tesseract` is missing. If `RESHOOT_CHROME` is set it must name an executable browser.

## Where a project lives

Keep the reshoot project **outside `capture/`**:

```
jobs/scripts/<slug>/
  reshoot/                 reshoot.toml, storyboard.toml, edit.toml, BRIEF.md, takes/runs/<id>/
  capture/<task>/          recording.mp4, actions.jsonl, shots/, manifest.json, edits.json
```

`start` copies all of `capture/` into the film job (`carryCaptures`), so a reshoot project inside it would drag every
run folder's footage along. The trial project used while this was written is `.cache/reshoot-trial/ui-demo/`.

`reshoot init reshoot --url <url>` writes a project, or `reshoot init reshoot` for the notes example. For an app this
repo starts itself, add an `[app]` block instead of running the server by hand:

```toml
schema_version = 1

[app]
run = "node ui/server.mjs --port 4311"
url = "http://127.0.0.1:4311/"
timeout = 60

[[take]]
web = "storyboard.toml"
out = "takes/demo.mp4"

[edit]
file = "edit.toml"
args = ["takes/demo.mp4"]

[check]
sources = ["takes/demo-final.mp4"]
review = "review"
scan = false            # true needs tesseract; never claim a privacy scan you did not run
```

## The storyboard

```toml
schema_version = 1
id = "video-workspace"
url = "http://127.0.0.1:4311/login"
size = "1280x720@2"          # CSS viewport @ device pixel ratio; @2 doubles the frames
theme = "dark"
zoom = 1.6                   # reshoot's own push-in, baked into the footage
timeout = 180

[[beat]]
id = "open"                  # stable across releases: `compare` matches on it
purpose = "Open the delivered video thread"
caption = "Open the delivered video"
hold = 1.5
[[beat.action]]
type = "click"               # click, type, select, key, scroll, navigate, wait, upload
target = {css = "[data-id='315ab56a-d6ee-43eb-8604-ac98c7d3b55c']"}
[[beat.action]]
type = "wait"
target = {css = "nav.content-tabs [data-tab=outputs]"}
[[beat.expect]]
type = "text"                # text, visible, count, value, url, checked
target = {css = "body"}
contains = "Delivered"
```

Every beat is one caption, one hold and a set of actions, then its result checks. `expect` failing fails the take and
saves the evidence — keep the failing beat, it is the verdict.

Two habits that decide whether the evidence means anything:

- **Scope selectors.** `[data-tab=progress]` matched both the tab and a right-panel heading in the trial and failed as
  ambiguous; `nav.content-tabs [data-tab=progress]` is the one control.
- **Assert identity, not a word.** `contains = "Delivered"` passes whenever that word is anywhere on the page, including
  when the wrong item is open. Prefer an id, a heading or a `count` that only one state can satisfy.

## Run it

```
reshoot preview reshoot/reshoot.toml     # same actions, smaller and quicker: look first
reshoot run reshoot/reshoot.toml         # the final: record, edit, scan, review page
reshoot runs reshoot/reshoot.toml        # newest first, with result and review status
```

`run` starts the app, records each take, edits, scans the exports and writes `takes/runs/<id>/` with `run.json`,
`review.html`, `events.jsonl` and the takes. It exits 0 when the run worked even though nothing is accepted yet, and
non-zero with the failed step and a failure image when it did not.

Next, in the run folder:

```
reshoot accept reshoot/takes/runs/<id>    # after watching: exports, beats and scan items in one step
reshoot compare reshoot/latest reshoot/takes/runs/<id>   # beat-by-beat diff against a baseline
```

`accept` binds its verdict to the run's exact files and scan policy. `compare` reports matched beat IDs, definition,
duration, evidence frame and result changes — a matched ID does not mean equal pixels.

**A failed run cannot be re-cut.** `reshoot recut` refuses with "run … failed, so there is nothing to re-cut", so fixing
`edit.toml` after a failed edit means recording again. Check the edit config with `reshoot preview` before a long final.

## Ingest into the pipeline

```
npm run video -- capture-ingest --job jobs/scripts/<slug> \
  --run jobs/scripts/<slug>/reshoot/takes/runs/<id> --task <task>
```

`--run` is the run folder, never `latest`. Optional: `--feature "…" --claim "…" --build "…" --url <starting url>`,
`--dir capture/<task>` to write elsewhere, `--notes "…"`.

It writes the `capture/<task>/` contract and refuses to treat any of these as evidence: a preview take, a run reshoot
marked failed, a `schema_version` it does not know, or a take with no logged action.

| reshoot | our contract |
| --- | --- |
| `takes/<name>.clean.mp4` | `recording.mp4` (copied, never modified) |
| `events.json` `act` starts | `actions.jsonl` `click`, at the centre of the control, `source: "reshoot-act"` |
| `beats[].expectations[]` | `actions.jsonl` `assert` + `manifest.results`, failures included |
| `takes/<name>.evidence/*.png` | `shots/<beat>.png` + `results` evidence entries |
| `capture.css_width/height` | `manifest.viewport` |
| recording probe | `manifest.frameSize`, `manifest.scale` (true frame-to-CSS ratio) |
| `capture.pixel_ratio` | `manifest.recorder.pixelRatio` (page DPR × zoom, provenance only) |
| `run.json`, take, storyboard | `manifest.source` (run id, take path, take sha256, story id/sha256) |
| — | `recorder.pointer` is `"composited"`; no cursor asset or pointer path is written |

The starting URL is read from the storyboard that `reshoot.toml`'s `[[take]] web` names. Then write
`capture/<task>/edits.json` and run `capture-scene` exactly as described in [capture.md](capture.md); the compiler draws
no synthetic cursor, writes no cursor asset, and reads `frameSize` for its magnification budget.

## What the log cannot say

- **No pointer path.** reshoot draws the cursor into the page, so it is in the footage. There are no `move` samples; a
  second cursor over the footage is a duplicate pointer.
- **No typing or keypresses.** Its event stream marks the control an action touched, not what the action was, so ingest
  records one click per act. The log understates the session: do not narrate a keystroke it does not carry.
- **No console errors** and no `goto`/`shot` steps of our own; the evidence is the beats and their checks.
- **reshoot's captions, narration, privacy scan and final cut are not our evidence.** Ingest the clean take and let the
  film draw its own captions from the narration.

## Headless and servers

- Recording is `pw.chromium.launch(headless=True)` — no X display, no `xdg-desktop-portal` picker, so it works over SSH
  and in CI. `capture-ingest` is pure Node and does not need reshoot installed at all.
- **Native windows are macOS-only** (`reshoot window`). A Linux or CI host records browser takes and VHS terminal takes
  only; report that boundary instead of faking the surface.
- **The privacy scan needs `tesseract`** (text) on Linux. Without it set `scan = false` and make no privacy claim.
- **Cost**: a 19 s take at `@2` with `zoom` took 405 s of wall time here, about 19 minutes of CPU across recording,
  encoding and the check. Budget minutes, not seconds, and use `preview` while iterating.

## Pitfalls seen in practice

- **Duplicated captions in the final cut.** reshoot burns captions into `demo-final.mp4` *and* writes a same-name
  `demo-final.srt` beside it. Any player that auto-loads subtitles shows each caption twice, once burned and once as a
  subtitle. Watch the clean take (`takes/<name>.clean.mp4`), which is also the file we ingest, or move the `.srt` out of
  the way before reviewing. Our films never use reshoot's captioned cut.
- **A loose `contains` passes on the wrong state.** See the selector habits above; the trial's `contains = "Delivered"`
  would have passed with any thread open.
- **An ambiguous selector** fails the take rather than clicking something arbitrary — good, but it costs a full run.
  Scope it and `preview` first.
- **`recut` needs a successful run.** A failed edit means re-record, not repair.

## Skills

reshoot ships three skills, installed here so the repo's agents load them like any other:

| skill | use |
| --- | --- |
| `reshoot-demo` | write a new demo from an app: story, storyboard, readability, GIF/README exports |
| `reshoot-refresh` | re-record an existing demo after the app or a release changed |
| `reshoot-review` | inspect a recording and its check report before sharing: failed actions, privacy, coverage, readability |

They live in `.opencode/skills/reshoot-{demo,refresh,review}/` and are symlinked from `.claude/skills/`, matching how
every other skill in this repo is shared. They are third-party files matched to the installed reshoot version, so do not
hand-edit them; refresh them after an upgrade:

```
reshoot skills claude --directory .cache/reshoot-skills --replace
cp -r .cache/reshoot-skills/.claude/skills/reshoot-* .opencode/skills/
```

## Files

- `lib/reshoot.mjs` — reads a run folder and writes the capture contract (`capture-ingest`).
- `lib/capture-scene.mjs` — the compiler: click rings, the `frameSize`-based zoom budget, scene writing.
- `tests/reshoot-ingest.test.mjs` — ingest mapping, refused runs, and a composited capture compiled with no cursor.
- [capture.md](capture.md) — the capture contract, cuts, compile and review gates.
- `personalities/app-review/TOOLS.md` — the evidence contract the recording must satisfy.
