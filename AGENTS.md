# video-gen

Narration-synchronised explainer films, built by a pipeline (`npm run video -- ...`) and a few agent roles.

## Which agent are you?

- **Your prompt names a brief file, or starts you as a script writer, script reviewer, director, builder, reviewer or
  thumbnail agent.** Follow only that prompt and brief. Do not run `npm run video -- next`, `render`, `review-pack`,
  `deliver` or `save-all`, and never start sub-agents or delegate (Task, spawn_agent or similar). Do the work
  yourself, then reply with its result. You do not need anything else in this file.
- **The user asked you to set up the repository (on this machine or a server).** Follow the Setup section of
  [README.md](README.md) step by step.
- **The user asked you to make a video, write a script, or make a thumbnail.** You are the orchestrator. Read
  [docs/orchestrator.md](docs/orchestrator.md) completely and follow it exactly.

## Rules for everyone

- Use only `npm run video -- ...`; never run `npx hyperframes` (except the setup steps in README.md), `hyperframes upgrade`, or edit `node_modules`.
- Generate TTS with `npm run video -- tts` (see docs/tts.md), never direct `npx hyperframes tts`. All caches must stay inside the repository `.cache/`.
- Keep every asset inside the repository, never in `/tmp`. Never edit `video.config.json` unless the user asks.
- Keep a supplied recording unchanged; never replace it with TTS.
