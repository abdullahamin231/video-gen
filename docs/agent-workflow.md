# Pipeline stages (maintainer reference)

Agents follow the root [AGENTS.md](../AGENTS.md) loop (`start`, then `next` until done). This file explains what
each stage does and where its rules are enforced, for people changing the pipeline.

| Stage | Command | Inputs → outputs | Enforced by |
|---|---|---|---|
| Prepare | `start` (wraps `prepare`) | audio + script → `jobs/<slug>/` with clipped WAV, ASR words, `alignment.json`, kit copy, `briefs/director.md` | `scripts/video.mjs` |
| Plan | director sub-agent, `plan-check`, `asset` | → `film.json` (design theme, per-scene `owner`), `assets/` + `assets/SOURCES.json`; generated `STORYBOARD.md`, `briefs/build-<scene>.md` for delegated scenes | `lib/spec.mjs validateFilm` |
| Build | director (owned scenes) and builder sub-agents, `build [--scene]` | `shots/*.json` (+ hooks, components, Manim) → `compositions/world.html`, `index.html`, `timing.json`, `assets/cues.js`, `review/motion.md`, `review/inspect.json`, `review/build.json` | `lib/spec.mjs compileFilm`, `lib/inspect.mjs` |
| Render | `render` | → `renders/video.mp4`, `review/render-verification.json`, `review/pixels.json`, `review/render-source.json` | HyperFrames lint/render, `lib/pixels.mjs`, `verify` |
| Review | `review-pack`, reviewer sub-agents, `review-template`, `review-submit` | → frozen pack, briefs, reports | `lib/review.mjs` |
| Deliver | `deliver` | → `review/delivery.json`, `review/REPORT.md`, `job.status: complete` | `qualifyDelivery` + film audit + pixel checks |

`next` (`lib/film.mjs nextStep`) derives the state from these files: missing/invalid plan → director; missing
prerequisite context and prototype shots → their owners in scene order (consecutive director-owned scenes share one
`direct-<scene>.md` brief); stale build → build; build errors → repair briefs (one `repair-director.md` for director-owned
scenes, one per delegated scene, in parallel); pixel and style findings are warnings for reviewers; stale render → render;
no current pack → review-pack; missing reviews → reviewers; failed reviews → repair briefs from blocking findings
(at most 4 distinct failed packs per stage, then `blocked`); plan defects or repeated visual failures → director revision;
unsaved assets (before any review pack) → save-all; prototype accepted → build the remaining scenes; final pass → deliver. Querying the same failed pack does not consume another round.
Review counters are excluded from render fingerprints. Persisted completion is requalified before `next` reports done.

## Timing

ASR word times (faster-whisper, or supplied `--words`) are reconciled with the script (`lib/timing.mjs reconcile`);
this is not forced alignment. Below 85% exact matches, `alignment-approve --note` records the review. Scene starts in
film.json and cues in shots are phrases resolved against the measured words, searched inside the scene's interval
(`lib/spec.mjs resolveSceneCue`). Shots can only reference cues (`at: "cue+0.3"`, `@prev`, `@after`); literal times
are rejected in specs, hooks and components.

## The world

The film's `theme` (film.json) is merged over the kit's fallback tokens and applied to every object: background,
named colours, default ink, fonts (bundled families in `lib/world.mjs FONT_FAMILIES`, or the theme's `fontFiles`),
stroke, corner, fill opacity, shadow filter, label/text/value type, named eases and per-type defaults.

All shot scenes compile into one composition (`compositions/world.html`, id `world`) driven by `lib/kit/kit.js`:
one SVG world, one camera, one paused GSAP timeline built from tracked state (every tween is an explicit fromTo), so
any seek order renders the same frame. Objects persist across scenes; the compiler adds fade-outs at handoffs for
objects that are not carried, and a camera move to each scene's `region`. HTML scenes (`kind: html`) are layered above
the world on their own tracks. Manim objects render to transparent WebM (`lib/manim.mjs`) with cue times relative to
the clip, then play inside the world.

## Checks

- Spec (compile time): schema, the film's design theme (required: name, description, bg, colours; bundled or shipped
  fonts), ids, targets, cue phrases (with suggestions), durations inside the scene, asset files present under
  `assets/`, colours and fonts outside the theme (warning), objects that appear with no motion (warning), font sizes, numbers not in the narration/script, overlong
  text, entrance-only choreography, determinism and literal-time lint for hooks/components.
- Browser (`build`): legibility on screen (≥28 px labels, ≥40 px values), text collisions and cut-off text, frame use
  (content box ≥20%), centring, subject stillness (>3 s without development outside a declared hold), diagnostic activity
  counts in world coordinates (camera movement excluded), overlapping tweens on the same property, and seek-order consistency.
- Pixels (`render`): content box, frozen picture and blank frames measured on the encoded MP4.
- Media (`verify`): streams, duration, size, fps, audible narration, gain-fitted waveform match with the source.

Checks prove absence of known defects, not creative quality; independent review remains mandatory.
Every passing reviewer must declare actual image/video inspection and list inspected frozen visual evidence.
The blind visual pass sees pictures before action logs. Missing visual capability is incomplete, never a transcript-only pass.
Final review and delivery reject any missing scenes. Objects marked visible start in their owning scene rather than leaking into earlier scenes.

## Library

`library/` stores reusable versioned bundles (`library-search`, `library-info`, `library-use`, `library-add`).
Every film adds to it: `asset` saves what it imports, `save` saves a file an agent made (drawing, component, Manim
scene) with title and tags, and before any review pack `next` requires that every non-pipeline file in `assets/`,
`components/` and `manim/` is in the library (`save-all` saves leftovers with metadata derived from
`assets/SOURCES.json`, a file's first comment and the film title). Saving is content-addressed: identical files are
saved once, changed files become a new patch version (`lib/library.mjs saveToLibrary`).

## Legacy jobs

Jobs without `film.json` still use the earlier `beats.json` + hand-written compositions path (`compile`, `assemble`,
`audit`, `check`, `render`).
