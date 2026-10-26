# Pipeline stages (maintainer reference)

The orchestrator follows the [orchestrator.md](orchestrator.md) loop (`start`, then `next` until done). This file explains what
each stage does and where its rules are enforced, for people changing the pipeline.


Before these stages, AGENTS.md infers a production personality and reads its `personalities/<id>/ORCHESTRATOR.md`.
`project-new` freezes the ID/version/hash and full instruction package; `start`/`prepare` inherit it from the script
folder. `lib/personalities.mjs` validates snapshots and readiness, and all generated role/thumbnail briefs carry the
selected instructions. Legacy jobs default to the existing explainer. Review fingerprints include the frozen
package. News packages cannot enter the current render pipeline until their declared media adapter is implemented;
app-review records browser sessions with `app-capture` and compiles the pointer and camera from its action log, while
native desktop surfaces stay outside that adapter. See [personality packages](../personalities/README.md) and
[app capture](app-capture.md).

| Stage | Command | Inputs → outputs | Enforced by |
|---|---|---|---|
| Prepare | `start` (wraps `prepare`) | audio + script (+ `--format`, `--length`, defaults from `video.config.json`) → `jobs/<slug>/`, named by `jobNameFor` in `lib/timing.mjs` (script file name, else its `#` title, else its folder, else its opening words; generic names like `script` are skipped; `--name` overrides) with clipped WAV, ASR words, `alignment.json`, kit copy, `briefs/director.md`; `job.json` records `format`, `width`, `height` | `scripts/video.mjs`, `lib/format.mjs resolveSettings` |
| Visual plan | script writer (with the script, or `briefs/visuals.md` when a supplied script has none) | `VISUALS.md` beside the script → `inputs/visuals.md` (copied by `prepare`; `--visuals` names another file): concept, theme JSON, `### <scene-id>` sections with start phrase, stage, events at exact words, payoff, assets; thumbnail | `lib/visuals.mjs visualPlanErrors` |
| Plan | director sub-agent, `plan-check`, `asset` | → `film.json` transcribed from the visual plan (design theme, per-scene `owner`), `assets/` + `assets/SOURCES.json`; generated `STORYBOARD.md`, `briefs/build-<scene>.md` for delegated scenes | `lib/spec.mjs validateFilm` |
| Music | director (from the plan's `## Music`), `music` (once per film, optional) | licensed track → `assets/music/<x>`, `assets/music/<x>.beats.json` (grid checked against the < 120 Hz kicks), `review/music/<x>-beats.png`; film.json `music` | `scripts/sfx/beats.py` (librosa, audio env from `setup-audio`) |
| Build | director (owned scenes) and builder sub-agents, `build [--scene]` | `shots/*.json` (+ hooks, components, Manim) → `compositions/world.html`, `index.html`, `timing.json`, `assets/cues.js`, `review/motion.md`, `review/sounds.md` (effects, big moves, beat offsets), `review/inspect.json`, `review/build.json` | `lib/spec.mjs compileFilm` (sounds: masking vs the voice, coverage of big moves, beat sync), `lib/sfx.mjs`, `lib/inspect.mjs` |
| Review | `review-pack` (frames from the built HTML; no render), reviewer sub-agents, `review-template`, `review-submit` | → frozen pack, briefs, reports | `lib/review-pack.mjs`, `lib/review.mjs` |
| Your review | `human-review` (or the UI's film checkpoint), `play` | → `review/human/<stage>.json`: approve, or notes at moments, bound to the pack | `lib/human.mjs`, `lib/player.mjs` |
| Render (once, after the final reviews) | `render` | → `renders/picture.mp4` (HyperFrames), `renders/mix.wav` + `renders/video.mp4` (pipeline mix: narration untouched, effects, ducked music, master gain until -16 LUFS / peaks ≤ -4 dB on the MP4), `review/mix.json`, `review/sound/` (cue sheets, `listen.md`), `review/render-verification.json`, `review/pixels.json`, `review/render-source.json` | HyperFrames lint/render, `lib/mix.mjs`, `lib/sound-check.mjs` + `scripts/sfx/cue_sheet.py`, `lib/pixels.mjs`, `verify` (MP4 audio vs the mix) |
| Deliver | `deliver` | → `review/delivery.json`, `review/REPORT.md`, `job.status: complete` | `qualifyDelivery` + film audit + pixel checks |
| YouTube upload (post-delivery) | orchestrator runs `youtube-upload` after thumbnail selection | qualified `renders/video.mp4` → unlisted YouTube video and link | `lib/youtube-upload.mjs`; see [youtube-upload.md](youtube-upload.md) |

`next` (`lib/film.mjs nextStep`) derives the state from these files: no film.json and no complete visual plan → script
writer (`briefs/visuals.md`; jobs that already have a film.json skip this); missing/invalid plan → director; missing
prerequisite context and prototype shots → their owners in scene order (consecutive director-owned scenes share one
`direct-<scene>.md` brief); stale build → build; build errors → repair briefs (one `repair-director.md` for director-owned
scenes, one per delegated scene, in parallel); style findings are warnings for reviewers; unsaved assets → save-all;
no current pack → review-pack (frames from the built HTML, nothing rendered); missing reviews → reviewers; failed reviews →
repair briefs from blocking findings (at most 4 distinct failed packs per stage, then `blocked`); plan defects or repeated
visual failures → director revision; all three pass and the job's `humanReview` lists the stage → wait for the person
(`human review <stage>`), whose notes go to the scenes they point at as repair findings, word for word; prototype accepted →
build the remaining scenes; final pass → render once (stale render → render; pixel errors → repair) → deliver. Querying the same failed pack does not consume another round.
Review counters are excluded from render fingerprints. Persisted completion is requalified before `next` reports done.

`next` and `deliver` qualify only the local MP4. After the thumbnail stage, the orchestrator uploads that MP4 as
unlisted and reports its YouTube link. `status [--json]` (`lib/film.mjs jobProgress`) is `next`'s read-only twin for the job UI: it applies the same checks in
the same order but writes nothing (no briefs, acceptance receipts or review-round counters). It reports every step as
done/current/repair/blocked/pending with its detail, every scene (owner, timing, built, check and review problems) and
each reviewer's verdict. A change to `nextStep`'s order must be mirrored in `jobProgress`.

## Frame and format

`lib/format.mjs` owns the frame: `landscape` 1920×1080 (default) or `vertical` 1080×1920 (`--resolution
portrait|square` from older commands still map onto it). Everything downstream reads `job.json` width and height:
the kit, world, render and `verify`. `frameGuide` writes the frame section of every director, builder and reviewer
brief, with phone guidance for vertical jobs. For vertical jobs `inspect` also warns when text stays outside
`safeArea` (the part of the frame phone app chrome leaves clear) for two consecutive samples, so entrance overshoot
does not trip it. Review-pack contact sheets tile tall frames four across instead of two. A vertical job longer than
`verticalMaxSeconds` gets a warning at `start`, never an error.

Thumbnail format must also follow the saved video orientation across all personalities: vertical requires
1080×1920 (9:16) plus a 180×320 preview; landscape uses 1920×1080 (16:9) plus a 320×180 preview. Apply this
to maker/reviewer briefs, export validation, selection and archives. See [video-click-psychology.md](video-click-psychology.md).
`lib/thumbnails.mjs` uses the exact saved video width and height for generated briefs, PNG validation and export.
Square and custom frames also retain their dimensions; previews scale the longest edge to 320 pixels.

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
objects that are not carried, and a camera move to each scene's `region`. Scenes without a region reset the camera to
the film's initial view (frame centre, zoom 1, rotation 0 by default), unless an authored camera owns the boundary or
`inheritCamera: true` deliberately preserves the preceding pose. This prevents one close-up from cropping every later
scene. HTML scenes (`kind: html`) are layered above
the world on their own tracks. Manim objects render to transparent WebM (`lib/manim.mjs`) with cue times relative to
the clip, then play inside the world.

## Checks

- Spec (compile time): schema, the film's design theme (required: name, description, bg, colours; bundled or shipped
  fonts), ids, targets, cue phrases (with suggestions), durations inside the scene, asset files present under
  `assets/`, colours and fonts outside the theme (warning), objects that appear with no motion (warning), font sizes, numbers not in the narration/script, overlong
  text, entrance-only choreography, determinism and literal-time lint for hooks/components.
- Browser (`build`): legibility on screen (≥28 px labels, ≥40 px values), text collisions and cut-off text, frame use
  (content spans ≥40% of the frame), a hero per scene (text ≥96 px or an object ≥10% of the frame), empty boxes (a
  hollow card-shaped rectangle with nothing inside for ≥1 s), washed-out frames (everything under 65% opacity for
  ≥1 s), centring, subject stillness (>3 s without development outside a declared hold), diagnostic activity
  counts in world coordinates (camera movement excluded), overlapping tweens on the same property, and seek-order consistency.
- Pixels (`render`): content box, frozen picture and blank frames measured on the encoded MP4.
- Media (`verify`): streams, duration, size, fps, audible narration, gain-fitted waveform match with the source.

Briefs quote each scene's `### <scene-id>` section of the visual plan verbatim (`lib/briefs.mjs sceneCard`), so the
director must keep the plan's scene ids; builders follow that direction and record departures in `notes`.

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

## Job format

Production uses `film.json` with shot specs or HTML scenes. The earlier `beats.json` workflow and its
`compile` / `assemble` commands have been retired. Recreate an older job from its saved script and recording
with `start`, then follow `next`; preserve the supplied recording.
