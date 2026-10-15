# Audio + script → animated video

An agent-assisted HyperFrames production repo. Give an AI agent a recording and
script: it consults the installed skills, designs the visuals with full creative
discretion, and delivers a narration-synchronized MP4. The pipeline makes timing,
assets, assembly, and rendering reproducible without forcing a visual template.

## Setup

Requires Node 22+, FFmpeg/FFprobe, [uv](https://docs.astral.sh/uv/), and a Chromium-compatible browser (HyperFrames
can install its render browser). First transcription downloads pinned local
faster-whisper dependencies and a model. No TTS or hosted model credentials are required for supplied
audio.

```bash
npm ci
npm test
npm run video -- help
```

## Give the agent a job

> Create a video given the audio `inputs/audio/source.mp3` and script `inputs/scripts/<your-script>.md`.

Works in any harness that reads `AGENTS.md` (Codex, OpenCode) or `CLAUDE.md` (Claude Code). The agent runs
`npm run video -- start ...` and then repeats `npm run video -- next` until it prints `STATE: done`. `next` derives the
job state from files and prints exactly one step: a command to run, or briefs to hand to fresh sub-agents (director,
one builder per scene, three independent reviewers, repair builders).

Each film has one design theme chosen by the director agent (any look: sticker graphics, photo collage, blueprint,
chalkboard, ...), declared in `film.json` and applied by the kit to every object. Scenes are written as JSON shot specs
([docs/SCENE_SPEC.md](docs/SCENE_SPEC.md)): shapes, text, images and photo cut-outs, counters, TeX, graphs, planes,
particles, networks, a camera, verbs with physical character (drop, pop, stamp, swing, strike, type), custom
components, hooks, and Manim clips. They compile into one seek-safe world (`lib/kit/kit.js`). Every build runs the
scene in Chrome, fails on concrete defects (no design theme, missing assets, overlapping tweens, seek inconsistency,
unsourced numbers), warns on style risks (tiny text, collisions, empty frame, stillness, colours or fonts outside the
theme) and prints a motion transcript that reviewers can read without vision.

Optional: `npm run video -- setup-manim` installs ManimCE 0.19 locally (conda-forge via micromamba; no sudo).

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `VG_ALLOW_WEB_IMAGES` | unset | Unset: `asset --src <url>` accepts only `.svg` files from the web. Set to `1` (or `true`/`yes`) to also let agents download `.png`, `.jpg`, `.jpeg`, `.webp` and `.gif` images from URLs. Local files and fonts are unaffected. |
| `VG_LIBRARY` | `library/` | Shared library location. |
| `VG_MANIM_ENV` | `~/.cache/video-gen/manim-env` | ManimCE environment. |

Agents run in the same shell as you, so setting the variable in your environment is what enables raster downloads for
their `asset` calls. Leave it unset to keep web imports to SVG.

## Job artifacts

```text
jobs/<name>/
  inputs/                 original script and extracted narration (local)
  job.json                input provenance, hashes, duration, canvas
  transcript.json         measured ASR words
  alignment.json          script reconciliation and discrepancies
  SCRIPT.md               actual recorded excerpt
  BRIEF.md                scope and creative authority
  film.json               director's plan (concept, subjects, scenes, mechanisms)
  STORYBOARD.md           generated from film.json
  shots/<scene>.json      builders' scene specs (+ hooks, components/, manim/)
  briefs/                 role briefs written by the pipeline
  timing.json             resolved absolute and scene-local times
  assets/                 frozen media, generated cues, local helpers
  compositions/world.html compiled world composition
  index.html              assembled root with original narration
  review/                 audit, frozen evidence, independent reports, verification
  renders/video.mp4       rendered draft; qualified by deliver (local)
```

ASR timings are estimates, not guaranteed forced alignment. Important reveals
need listening/visual spot checks. Pacing findings are advisory and can be
overridden by a documented creative decision. Source inputs and the entire
`jobs/` directory are ignored by Git; job artifacts stay local. Freeze extra media
locally and record its origin for reproducibility.

Production uses isolated per-job HyperFrames projects.

Reusable animation mechanisms and media live in the tracked [shared library](library/README.md).
Agents search metadata, freeze explicit versions into each job, and contribute
useful new components and short sequences after production review. Job audits
check installed files against their recorded hashes.
