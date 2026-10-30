# Video generation from a harness

Use this repository from T3 Code or another agent harness. Agents research, write and freely author native
HyperFrames scenes; the CLI handles measured timing, media operations, review evidence and delivery.
There is no supported application UI. Start with [AGENTS.md](AGENTS.md) and the three skills in `skills/`.

## Setup

Use Node.js 22+, npm, FFmpeg/FFprobe, Python 3.12 with venv support, git, uv and Chrome. Sign in to the
agent provider through your harness. Keep generated assets and tool environments inside this checkout.

```bash
npm ci
# Setup-time exception: install the browser pinned by HyperFrames.
npx --no-install hyperframes browser ensure
npm run video -- tts --setup-ming
# Optional music analysis environment:
npm run video -- setup-audio
npm test
npm run video -- help
```

The pinned transcription environment is installed by uv on first use. Ming downloads its model at setup
and then generates locally. No narration API key is needed. Optional existing library assets can be copied
into `library/`; they are not required. [Library reuse](library/README.md) describes versioned assets.

Open the repository in your harness, describe the audience/material and ask it to make a video. To create
an explicit project, save the agreed brief under `jobs/scripts/<slug>/BRIEF.md`, then use:

```bash
npm run video -- project-new --name <slug> --profile explainer --tts ming
npm run video -- next --project <slug>
```

Use `status --project <slug> --json` for saved state. `next` prints command or delegation tasks. The harness
handles agent work and requested decisions. `watch --project <slug>` provides a read-only browser review
surface, not another production UI. Only share the actual printed/configured review URL.

## References

Read the relevant contract, not the whole folder.

| Document | Needed for |
|---|---|
| [orchestrator](docs/orchestrator.md) | Harness handoffs, checkpoints, completion and the pipeline flowchart |
| [pipeline](docs/pipeline.html) | Standalone visual map of the whole production pipeline |
| [composition](docs/composition.md) | Native HyperFrames integration and build failures |
| [audio](docs/audio.md) | Ming generation, continuity, effects and verified mixing |
| [review](docs/review.md) | Evidence-bound independent/user review and concrete findings |
| [capture](docs/capture.md) | Actual browser recordings, native cuts and omission evidence |
| [news](docs/news.md) | Cleared real media, source speech and subtitle schemas |
| [publishing](docs/publishing.md) | Thumbnail contract and authorised unlisted YouTube upload |

Editorial intent lives in one [PROFILE.md per treatment](personalities/README.md). Profiles set purpose
and evidence boundaries, not a fixed visual recipe. Assignments contain paths and task data; there is no
prompt-file catalog or injected role-coaching package.

## Code responsibilities

The remaining modules own concrete operational contracts; their source is not required agent context.

| Modules | Responsibility |
|---|---|
| `project`, `film`, `briefs` | Project state, production lifecycle and data-only assignments |
| `personalities` | Treatment selection and retained project intent |
| `composition`, `timing` | Small scene manifest and measured narration cues |
| `native` | Actual HyperFrames assembly, browser inspection and lint attribution |
| `media`, `assets` | Media settings/probing, local caches, provenance and optional reuse |
| `narration`, `audio` | Ming worker safeguards, soundtrack mixing and encoded audio verification |
| `reshoot`, `capture-scene` | Browser evidence ingestion and authenticated native cuts |
| `news` | Actual-media edit, source speech and subtitles |
| `pixels` | Encoded frame and capture/source checks |
| `review`, `review-pack` | Independent/user decisions and frozen inspection evidence |
| `watch` | Read-only review overview, playback and media serving |
| `thumbnails`, `youtube-upload` | Packaging/selection and resumable authorised upload |
| `ideas` | Optional topic discovery from configured feeds |

## Local configuration and artifacts

`video.config.json` sets canvas/frame-rate defaults; `chat.config.json` holds harness/provider model choices.
Explicit user settings win. Generated jobs live in `jobs/<slug>/`; scripts/sources in `jobs/scripts/<slug>/`;
local tools and models in `.cache/`. These artifacts are ignored by Git. Never put credentials in briefs.

`VG_CACHE` may choose a cache under repository `.cache/`. `CHROME_PATH` selects an installed browser.
`VG_ALLOW_WEB_IMAGES=1` permits raster downloads. YouTube uses OAuth credentials under `.cache/`, described
in publishing.md. Generated narration is Ming only; a supplied recording always takes priority.

Tests exercise actual native/news rendering, media integrity, capture evidence, review and harness state.
They do not establish the creative quality of a finished film. Judge that through actual viewer evidence.
