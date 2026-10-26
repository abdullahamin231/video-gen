# video-gen

Narration-synchronised explainer films, built by a pipeline (`npm run video -- ...`) and a few agent roles.

## Which agent are you?

- **Your prompt names a brief file, or starts you as a script writer, script reviewer, director, builder, reviewer or
  thumbnail agent.** Follow only that prompt and brief. Do not run `npm run video -- next`, `render`, `review-pack`,
  `deliver` or `save-all`, and never start sub-agents or delegate (Task, spawn_agent or similar). Do the work
  yourself, then reply with its result. You do not need anything else in this file.
- **The user asked you to set up the repository (on this machine or a server).** Follow the Setup section of
  [README.md](README.md) step by step.
- **The user wants to brainstorm, make or continue a video, write a script, or make a thumbnail.** You are the orchestrator. Select the personality below and read **that folder's `ORCHESTRATOR.md` completely** before the shared runbook it names. This applies in T3 Code and other harnesses. Brainstorm freely; begin production only when the user asks. A request to implement pipeline features is software work, not permission to start a film.

## Select the personality automatically

The user describes the video in ordinary language; never make them memorise or type a personality ID.

1. **Resuming an existing project:** recover `productionProfile` with `npm run video -- status --project <slug> --json`. Read that personality's orchestrator. Its frozen `production-profile.json` is the creative authority for the job. A new follow-up message does not reclassify the project. Jobs without profile metadata are legacy explainers.
2. **New work:** infer the requested treatment from the prompt, using the table below. An explicit user preference wins. Format and intent beat topic: reviewing a real finance app is computer use; teaching how elections work can be an educational explainer.
3. **If genuinely ambiguous:** ask one concise routing question. Do not ask when the request already identifies the treatment. “Make a news video” alone needs financial/political context; an elevator horror story does not.
4. At project creation pass the inferred `--profile <id>` yourself. The CLI also provides conservative automatic inference from BRIEF.md when omitted. `npm run video -- profile-route --prompt "<request>"` checks the fallback without starting production; `npm run video -- profiles` lists the catalog. These read-only commands are allowed during brainstorming.

| Prompt intent | Personality | Orchestrator to read |
| --- | --- | --- |
| Scientific, educational or technical concept explanation; default explanatory film | `explainer` | [personalities/explainer/ORCHESTRATOR.md](personalities/explainer/ORCHESTRATOR.md) |
| Fictional story, uncanny situation, horror/survival rules, Bradikinin-style video | `rules-story` (fixed default storytelling style) | [personalities/rules-story/ORCHESTRATOR.md](personalities/rules-story/ORCHESTRATOR.md) |
| Financial news, earnings, markets, investment commentary | `news-financial` | [personalities/news-financial/ORCHESTRATOR.md](personalities/news-financial/ORCHESTRATOR.md) |
| Political news, elections, government events and commentary | `news-political` | [personalities/news-political/ORCHESTRATOR.md](personalities/news-political/ORCHESTRATOR.md) |
| Actually use, test, demonstrate or review an app, including T3 Code | `app-review` | [personalities/app-review/ORCHESTRATOR.md](personalities/app-review/ORCHESTRATOR.md) |

Each folder owns `EDITORIAL.md`, `DESIGN.md`, `TOOLS.md` and `REVIEW.md`; read only the selected package. Shared runbooks own transport, delegation and checkpoints, not a universal design style. Do not append the explainer's drawing/motion rules to other personalities. Profiles are frozen per project and cannot be switched by `project-set`; start a new project for an explicit change of genre. The provider/model profiles in `chat.config.json` are unrelated to these editorial personalities.

News and computer-use instructions are selectable, but their media adapters are not implemented yet. Their descriptors set `renderReady: false`; respect the pipeline's precise blocked message. Do not present instruction routing as a completed news editor/capture system, bypass readiness checks, record commercial footage, or substitute an animated explainer.

## Rules for everyone

- Thumbnails inherit the video's orientation across every personality: vertical videos require 9:16 portrait thumbnails (1080×1920), landscape videos use 16:9 thumbnails (1280×720). Apply this to every variant, preview, chosen thumbnail and archive. Never stretch or letterbox a landscape design into portrait; compose for the target frame. See docs/video-click-psychology.md.
- Use only `npm run video -- ...`; never run `npx hyperframes` (except the setup steps in README.md), `hyperframes upgrade`, or edit `node_modules`.
- Generate TTS with `npm run video -- tts` (see docs/tts.md), never direct `npx hyperframes tts`. All caches must stay inside the repository `.cache/`.
- Generate each Ming narration in one TTS invocation. Production and benchmarks must use `scripts/ming_continuity.py` to reuse one acoustic reference across all fragments and performance segments; never restart unconditioned IP generation per segment. See [voice continuity](docs/tts.md#voice-continuity-and-the-former-voice-change-bug).
- Keep every asset inside the repository, never in `/tmp`. Never edit `video.config.json` unless the user asks.
- Keep a supplied recording unchanged; never replace it with TTS.
- After local delivery and thumbnail selection, the orchestrator uploads each completed video to the abdupdates YouTube channel as unlisted, unless the user explicitly opts out. Only the orchestrator uploads; see [docs/youtube-upload.md](docs/youtube-upload.md).

## Discord approval notifications

When a user or supervisor requests Discord notifications for approval/question checkpoints, the orchestrator or any delegated agent assigned to send one must use [`scripts/discord-notify.mjs`](scripts/discord-notify.mjs):

```bash
node scripts/discord-notify.mjs --request-id <stable-request-id> --message "<project, decision needed, review/supervisor link>"
```

Use one stable request ID per pending checkpoint; the helper records successful deliveries in `.cache/discord-approval-notified.json` and skips duplicate IDs. It loads `DISCORD_WEBHOOK_URL` from `.env` without printing it and reports the HTTP delivery result. Never expose the webhook URL or count a notification as approval. Keep decisions in the normal T3/review workflow. If configuration is missing or delivery fails, report that without credentials.
