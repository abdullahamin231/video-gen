# Audio + script → animated video

An agent-assisted HyperFrames production repo. Give an AI agent a recording and
script: it consults the installed skills, designs the visuals with full creative
discretion, and delivers a narration-synchronized MP4. The pipeline makes timing,
assets, assembly, and rendering reproducible without forcing a visual template.

## Setup

This section is written so an agent can follow it top to bottom. Run every command from the repository root. Steps
marked **(person)** need a human (a password, a browser sign-in or `sudo`): stop and ask for them, then continue.
Skip any step whose check already passes. Keep every environment inside the repository's `.cache/` as shown, never
in `~/.cache` or `/tmp`, and never edit `video.config.json` while setting up.

### Requirements

| Need | Version | Used for | Check |
|---|---|---|---|
| Linux x86-64 (Ubuntu/Debian commands below) | | Manim and the render browser are installed for linux-64 | `uname -m` |
| 4+ CPU cores, 8 GB RAM, 20 GB free disk | recommended | rendering, Whisper, Chrome | `nproc; free -g; df -h .` |
| Node.js + npm | 22 or newer | pipeline, UI, HyperFrames | `node -v` |
| git, curl, bzip2 | any | clone, downloads, Manim's micromamba | `git --version; curl --version; bzip2 --help` |
| FFmpeg + FFprobe | any recent | audio, mixing, checks | `ffmpeg -version; ffprobe -version` |
| Python 3 with `venv` | 3.11–3.13 | TTS voice and music beat analysis environments | `python3 -m venv --help` |
| [uv](https://docs.astral.sh/uv/) | any | runs the pinned faster-whisper transcriber (`scripts/transcribe.py.lock`) | `uv --version` |
| Chrome | any | frame checks and thumbnails (`CHROME_PATH`, `google-chrome`, `chromium`, or HyperFrames' cache) | `google-chrome --version` |
| HyperFrames render browser | pinned by HyperFrames | rendering | `npx --no-install hyperframes doctor` shows `✓ Chrome` |
| An agent CLI, signed in | current | does the creative work: [Claude Code](https://code.claude.com) (`claude`), Codex (`codex`), OpenCode (`opencode`) or Pi (`pi`) | `claude --version` (or the one you use) |
| Network access | | npm, Whisper model, voice data, fonts, idea feeds, the agents' providers | |

No API keys are required. Optional: `YOUTUBE_API_KEY` (ideas use the official API instead of public pages),
`VG_ALLOW_WEB_IMAGES=1` (agents may download raster images). Put them in the ignored `.env` if wanted.

### Steps

1. **System packages (person: needs `sudo`).**

   ```bash
   sudo apt update && sudo apt install -y git curl bzip2 ffmpeg python3-venv
   # Node 22+, if `node -v` is older or missing:
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
   # Chrome (also pulls in the system libraries headless Chrome needs):
   mkdir -p .cache && curl -fsSLo .cache/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
     && sudo apt install -y ./.cache/chrome.deb && rm .cache/chrome.deb
   ```

2. **uv** (no sudo; installs to `~/.local/bin`, which must be on `PATH`):

   ```bash
   command -v uv || curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

3. **Node dependencies and the render browser.** `browser ensure` is the one setup-time exception to the rule
   against running `npx hyperframes` directly.

   ```bash
   npm ci
   npx --no-install hyperframes browser ensure
   ```

4. **Local tool environments** (all inside `.cache/video-gen/`):

   ```bash
   # Music beat analysis (librosa):
   npm run video -- setup-audio
   # Kokoro TTS voice, for films without a supplied recording (docs/tts.md):
   [ -x .cache/video-gen/tts-env/bin/python ] || { python3 -m venv .cache/video-gen/tts-env \
     && .cache/video-gen/tts-env/bin/pip install -q --no-cache-dir kokoro-onnx soundfile; }
   # Optional, only for scenes with Manim clips (a few minutes, ~1 GB):
   npm run video -- setup-manim
   ```

   The faster-whisper transcriber needs no step: `uv` installs its pinned packages and downloads the model on the
   first transcription.

5. **The shared library (person, if this is a new machine).** `library/` (sound effects, drawings, components, about
   140 MB) is not in git. Copy it from the machine that has it, for example from that machine:

   ```bash
   rsync -a library/ <server>:<path-to-repo>/library/
   ```

   Without it, films still build, but have no ready-made sound effects or reusable parts. Check: `ls library | wc -l`
   shows far more than one entry.

6. **Agent CLI login (person).** Install at least one agent CLI and sign in on this machine, as the user that will
   run the workspace: for example `npm install -g @anthropic-ai/claude-code` then run `claude` once and sign in, or
   `codex login`. The workspace uses these existing logins; it never asks for keys.

7. **Verify.**

   ```bash
   npm test && npm run test:ui
   npx --no-install hyperframes doctor   # Node, FFmpeg, FFprobe and Chrome must show ✓; Kokoro/MusicGen lines may show ✗
   npm run video -- help
   ```

8. **Run the workspace UI.** On a desktop: `npm run ui` and open http://127.0.0.1:4310. On a server, to use it from
   a phone or laptop: install [Tailscale](https://tailscale.com/download/linux) and sign in **(person)**
   (`sudo tailscale up`, and once `sudo tailscale set --operator=$USER`), then run `scripts/server-setup.sh tailscale`
   (or `scripts/server-setup.sh lan` on a trusted network without Tailscale). It installs a systemd user service and
   prints the address and a generated password; give both to the person. Details:
   [ui/README.md](ui/README.md#running-on-a-server-phone-or-laptop-access).

Without the UI, give an agent a job directly (below).

## Give the agent a job

> Create a video given the audio `inputs/audio/source.mp3` and script `inputs/scripts/<your-script>.md`.

Works in any harness that reads `AGENTS.md` (Codex, OpenCode) or `CLAUDE.md` (Claude Code). That short file sends the
orchestrator to [docs/orchestrator.md](docs/orchestrator.md) and keeps sub-agents on their briefs. The orchestrator runs
`npm run video -- start ...` and then repeats `npm run video -- next` until it prints `STATE: done`. `next` derives the
job state from files and prints exactly one step: a command to run, or briefs to hand to fresh sub-agents (director,
one builder per scene, three independent reviewers, repair builders).

Each film has one design theme, declared in `film.json` and applied by the kit to every object. By default it is the
channel theme ([channel/theme.json](channel/theme.json)), so every film looks like the same channel; a film may depart
from it with a stated reason. Real things are drawn as SVG; the channel uses no photos. Scenes are written as JSON shot
specs ([docs/SCENE_SPEC.md](docs/SCENE_SPEC.md)): the explainer vocabulary (hero numbers, source cards, spec sheets,
hanging tags, verdict stamps, gauges, chips), shapes, text, SVG drawings and logos, counters, TeX, graphs, planes,
particles, networks, a camera, verbs with physical character (drop, pop, stamp, swing, strike, type), custom
components, hooks, and Manim clips. They compile into one seek-safe world (`lib/kit/kit.js`). Every build runs the
scene in Chrome, fails on concrete defects (no design theme, missing assets, overlapping tweens, seek inconsistency,
unsourced numbers), warns on style risks (tiny text, collisions, empty frame, stillness, colours or fonts outside the
theme, narrow or hero-less frames, empty boxes, washed-out frames) and prints a motion transcript that reviewers can
read without vision. `npm run video -- frame-stats --video <mp4>` measures how much of the frame any film uses
([docs/kaiexplains-frame-study.md](docs/kaiexplains-frame-study.md)).

Optional: `npm run video -- setup-manim` installs ManimCE 0.19 locally (conda-forge via micromamba; no sudo).

## Configuration

### Video settings: `video.config.json`

Defaults for new jobs. Flags on `start` override them per job.

| Setting | Default | Flag | Effect |
|---|---|---|---|
| `format` | `"landscape"` | `--format landscape\|vertical` | `landscape` is 1920×1080 long-form; `vertical` is 1080×1920 for reels and shorts (briefs, checks and review add phone guidance and a safe area). |
| `length` | `null` | `--length <s>` (alias `--duration`) | With a supplied recording, keep only the first N seconds (`--start` moves the window). A config length trims only longer recordings; a flag must fit the recording. When a script is written from sources, this is the target duration if the request names none; left at `null`, the script writer chooses a length that fits the material. |
| `verticalMaxSeconds` | `90` | | A vertical job longer than this gets a warning (it still runs). |
| `fps` | `30` | `--fps` | 24, 30 or 60. |
| `channelTheme` | `null` (the repository sets `"channel/theme.json"`) | | The design theme every film starts from, copied into each new job (`inputs/channel-theme.json`). A film that changes it says why in `theme.channelDepartures`. `null` lets each film choose its own look. |

Ask the agent for a "reel", "short" or "vertical video" and it adds `--format vertical`; "the first 30 seconds"
becomes `--length 30`. Keys starting with `_` are comments; unknown keys are rejected so typos do not pass silently.

### Environment variables

| Variable | Default | Effect |
|---|---|---|
| `VG_ALLOW_WEB_IMAGES` | unset | Unset: `asset --src <url>` accepts only `.svg` files from the web. Set to `1` (or `true`/`yes`) to also let agents download `.png`, `.jpg`, `.jpeg`, `.webp` and `.gif` images from URLs. Local files and fonts are unaffected. |
| `VG_LIBRARY` | `library/` | Shared library location. |
| `VG_CACHE` | `.cache/video-gen` (in the repository) | Where the TTS, audio and Manim environments live. Overrides must stay inside the repository `.cache/`. TTS uses `npm run video -- tts` to keep model downloads there too. |
| `GEMINI_API_KEY` | unset | API key for optional Gemini narration; server environment or ignored `.env`. `GOOGLE_API_KEY` is also accepted. See [docs/tts.md](docs/tts.md). |
| `GEMINI_TTS_MODEL` / `GEMINI_TTS_VOICE` | `gemini-3.8-flash-tts` / `Charon` | Primary Gemini narration model and voice. Each new UI job chooses Kokoro or Gemini. |
| `GEMINI_TTS_FALLBACK_MODEL` | `gemini-3.8-flash-lite-tts` | Backup Gemini model for quota exhaustion or persistent service overload. If the backup also hits quota, use Kokoro. |
| `VG_MANIM_ENV` | `.cache/video-gen/manim-env` | ManimCE environment. |

Agents run in the same shell as you, so setting the variable in your environment is what enables raster downloads for
their `asset` calls. Leave it unset to keep web imports to SVG.

## Job artifacts

```text
jobs/<name>/
  inputs/                 original script and extracted narration (local)
  job.json                input provenance, hashes, duration, format and frame size, canvas
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
