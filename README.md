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

> Create a video given the audio `inputs/audio/source.mp3` and script
> `inputs/scripts/<your-script>.md`.

For an excerpt, add: “Use just the first 30 seconds.”

The user only needs to say: **Create a video given the audio `<audio path>` and
script `<script path>`.** The agent handles creative direction, assets, animated
shots, timing, independent sub-agent review, repairs, and final delivery. It must meet the dynamic
YouTube-film quality gate in [AGENTS.md](AGENTS.md); technical validity alone is
insufficient. The following commands are internal tools, not required user steps.

The agent follows [the production workflow](docs/agent-workflow.md). Preparation:

```bash
npm run video -- prepare --name my-video --audio inputs/audio/source.mp3 \
  --script 'inputs/scripts/your-script.md' --start 0 --duration 30
```

After creative planning and scene authoring:

```bash
npm run video -- compile --job jobs/my-video
npm run video -- assemble --job jobs/my-video
npm run check -- --job jobs/my-video
npm run dev -- --job jobs/my-video
npm run render -- --job jobs/my-video
npm run video -- review-pack --job jobs/my-video --stage final
# Independently spawned reviewers inspect evidence and write separate reports.
npm run video -- review-submit --job jobs/my-video --file /path/to/reviewer-report.json
npm run video -- review-status --job jobs/my-video --stage final
npm run video -- deliver --job jobs/my-video
```

Root commands use the latest prepared job when `--job` is omitted. `render`
audits the plan, runs HyperFrames checks, encodes, and verifies audio, dimensions,
fps, and duration. It creates a draft. Before expanding the film, the agent
renders and independently reviews a demanding 10–15-second prototype. Final
review covers the whole film with three independent roles: visual mechanism,
narration fidelity, and continuity/legibility. Failed reviews trigger autonomous
repairs and fresh evidence. `deliver` marks completion only after current reports
and technical checks pass. No user review or approval is needed. See the
[independent review contract](docs/independent-review.md); report validation
checks mechanics, not taste or whether a sub-agent actually executed.

## Job artifacts

```text
jobs/<name>/
  inputs/                 original script and extracted narration (local)
  job.json                input provenance, hashes, duration, canvas
  transcript.json         measured ASR words
  alignment.json          script reconciliation and discrepancies
  SCRIPT.md               actual recorded excerpt
  BRIEF.md                scope and creative authority
  frame.md                agent's visual direction
  STORYBOARD.md           agent's evolving scene plan
  beats.json              spoken cues and planned visual actions
  timing.json             resolved absolute and scene-local times
  assets/                 frozen media, generated cues, local helpers
  compositions/           agent-authored HyperFrames scenes
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
