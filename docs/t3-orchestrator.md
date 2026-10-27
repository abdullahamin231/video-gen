# Making videos from a T3 Code chat

This is the shared production/state-machine runbook. First follow [AGENTS.md](../AGENTS.md) to infer the personality and read `personalities/<id>/ORCHESTRATOR.md`. That folder owns editorial, design, tools and review instructions; this file does not impose the explainer style on every genre. Resume with the saved `productionProfile`. New projects freeze the selected instructions and propagate them to delegated briefs. Never ask the user to type a personality ID.

You are reading this because you are a chat agent in T3 Code (you have T3 tools such as `delegate_task` and
`preview_open`) and the user wants to brainstorm, make a video, write a script or make a thumbnail. T3 is the primary
production workspace; the existing web UI remains available as an alternative. The chat is the workspace,
T3 delegated tasks are the roles, and the review page
(https://ip-208-84-101-178.tailc5adba.ts.net:8443/) is where the user reads the script, watches the film and picks the
thumbnail. Sub-agents following a brief never use this file.

The pipeline knows the state of every video and prints the single next step. You do what it prints, ask the user at
their checkpoints, and record exactly what they say. You never write, build, review or judge anything yourself.

## 1. Brainstorm first

Until the user says to make the video ("make it", "go", "start production"), only talk. Help them find the angle,
audience, length and sources. You may run:

- `npm run -s video -- ideas [--focus "<topic>"]`: fresh video ideas (never repeats one). Mark one the user rejects
  with `ideas --set <id> --status rejected --reason "<their reason>"`.
- `npm run -s video -- projects`: every video made from a chat and where it is.
- `npm run -s video -- profile-route --prompt "<request>"` and `profiles`: read-only personality routing/catalog.

Do not research the topic yourself or draft the script: that is the researcher's and writer's job, from sources.

## 2. Start the video

When they say to make it, settle only what is still open, in one short message if anything is: format (landscape
long-form or vertical short), a length if they want one (otherwise the writer chooses), narration (Ming, expressive and local, the
default; or Kokoro or Gemini), and whether they supplied a script or recording. Defaults keep every checkpoint on: script,
final film, thumbnail.

1. Choose a short lowercase slug (`ssd-slowdown`). Write the agreed brief to `jobs/scripts/<slug>/BRIEF.md`: what the
   video is, for whom, the angle you agreed, every link and file they gave, their own notes and opinions. Use their
   words wherever you can; add nothing they did not say.
2. Create the project:

   ```bash
   npm run -s video -- project-new --name <slug> --profile <inferred-id> [--format vertical] [--duration 90] [--tts ming|kokoro|gemini] \
     [--script <file> --audio <file>] [--music <file>] [--review script,final,thumbnail|none] [--thumbnails 3] [--idea <id>]
   ```

   A supplied script is used as written (and its `VISUALS.md` if one sits beside it); a supplied recording is kept
   unchanged and never replaced by TTS.
   Omitting `--tts` selects Ming. Before narration, follow the printed instruction to create `ming-performance.json`
   from the approved script with natural pacing, pauses and an explicit expressive-cue pass. Choose from the full 14-cue catalog in [docs/tts.md](tts.md#complete-ming-inline-cue-catalog), not only these examples. Add supported inline bracketed cues such as `[Breathing]`, `[Surprise-oh]`, `[Sigh]` and `[Laughter] to segment text where they fit the meaning and sound conversational; keep `SCRIPT.md` clean. Use `US_James` through the adapter, with no free-form instruction fields (see [docs/tts.md](tts.md)).
   Generate the whole narration in one TTS invocation. The shared adapter holds one neutral `US_James` acoustic reference across all internal fragments and performance segments; never synthesize segments separately. See [voice continuity and regeneration](tts.md#voice-continuity-and-the-former-voice-change-bug) for existing affected WAVs and listening checks.
   Install its runtime once with `npm run video -- tts --setup-ming`. Explicit `--tts kokoro` or `--tts gemini` is preserved.
3. Tell the user the video has started and that you will come back at each checkpoint.

## 3. The loop

```bash
npm run -s video -- next --project <slug> 2>&1 | tail -60
```

Do exactly what it prints, then run it again. Repeat until it prints `STATE: done`. It prints four kinds of step:

- **`DO: run <command>`**: run it in one shell call (narration, `start`, build, render and deliver can take minutes;
  wait with a long timeout rather than polling). Trim output with `| tail -40`.
- **`DO: start ... task(s) with the T3 delegate_task tool`**: call `delegate_task` once per JSON line, passing that
  object as the arguments (title, role, clientRequestId, mode, target, task). When a MODEL SELECTION policy is printed, resolve target using the live orchestrator_capabilities catalog as described below; preserve the task text and clientRequestId. Start them all, then end your
  turn: each finished task wakes you. When one wakes you and others are still running (`task_status`), end your turn
  again. When all have finished, run `npm run video -- delegated --project <slug>`, then `next`. Never do their work,
  never edit their files, never add your opinions to a task, never reuse a task for a different brief. If a task fails,
  run `delegated` and `next`: unfinished work is issued again.
- **`STATE: your review of the script / final` or `you pick the thumbnail`**: a checkpoint (section 4).
- **`STATE: blocked` / `pipeline bug`**: report the reason to the user word for word and stop.

Whenever you tell the user where the video stands (the start, each checkpoint, each time a delegated round finishes, and
delivery), show the stage bar: run `npm run -s video -- stage-bar --project <slug>` and pass its whole output, unchanged,
as the `html` of `html_render` (title "<slug> progress", height 170). Do not edit it or draw your own. The bar shows every
stage and step and where the video is, so your reply adds only what it does not say.

While tasks are open, `next` prints "waiting for delegated work" and commands that advance the pipeline refuse. That
protects the pipeline from a sub-agent that wanders off its brief; it is not a reason to close the delegation early.

## 4. Checkpoints: the user decides

At each checkpoint `next` tells you what to open and what to record. The pattern is always:

1. Run `npm run -s video -- watch --project <slug>`. It is read-only and runs in the background. It prints an overview
   address (`http://127.0.0.1:<port>/`). Make sure that port is served on the user's tailnet at
   **https://ip-208-84-101-178.tailc5adba.ts.net:8443/**: run `tailscale serve --bg --https=8443 http://127.0.0.1:<port>`
   (`watch` prints the exact command; if 8443 already serves a different port, run `tailscale serve --https=8443 off` first).
   Keep the existing web UI and its separate Tailscale route running. Check that
   `tailscale serve status` shows the port. Do not open the panel or any preview tab; the user reviews in their own
   browser.
2. In two or three lines, tell the user what is ready, give them **https://ip-208-84-101-178.tailc5adba.ts.net:8443/**
   to review it, and say what you need from them: approve, or say what to change
   (for the film: at which moment, e.g. "12.5: make the chart bigger").
   When the user or supervisor requests Discord notifications for this run, send one concise ping with the project,
   decision needed, and review/supervisor link:

   ```bash
   node scripts/discord-notify.mjs --request-id <stable-request-id> --message "<project, decision needed, review/supervisor link>"
   ```

   Use a stable ID for this checkpoint so the shared `.cache/discord-approval-notified.json` ledger suppresses duplicate
   sends. The helper reads `DISCORD_WEBHOOK_URL` from `.env` without displaying it and reports delivery status. A
   delegated agent assigned to notify may run the same helper; the main orchestrator can also send on its behalf.
   Never expose the URL or treat a ping as approval. Report missing configuration or delivery failures without credentials.

3. **End your turn and wait.** Never decide for them, never approve on their behalf, never treat silence as approval.
4. When they reply, record it word for word with the command `next` printed, always with
   `--quote "<their whole message>"`. Each film note is `"<seconds>: <their words>"`; a note without a time covers the
   whole stretch. If their reply neither clearly approves nor asks for changes, ask; record nothing.
5. Run `next`.

Their notes go, unchanged, to a fresh writer (script) or to the scene at that moment (film), are independently reviewed
again, and come back to them. Only they can stop review early: `review-waive --stage final --reason ".." --quote ".."`
only when they explicitly ask, after you have told them the unresolved findings.

If they send direction between checkpoints, say it will be applied at the next checkpoint and record it there, word
for word. If they change a setting ("don't make me approve the script", "five thumbnails", "use Codex for builders"):
`npm run video -- project-set --project <slug> [--review final] [--thumbnails 5] [--model builder=codex:gpt-6-luna]`.

## 5. Delivery

`STATE: done` prints the MP4 and thumbnail paths, the review disposition, unresolved findings, limitations, the
soundtrack measurements and the headphone checks. After thumbnail selection, upload the finished MP4 as unlisted:

```bash
npm run -s video -- youtube-upload --file jobs/<slug>/renders/video.mp4 \
  --title "<approved video title>" --description "<approved short description>" --privacy unlisted
```

At the thumbnail checkpoint, present the selected variant's title, headline and short description together, following
[video-click-psychology.md](video-click-psychology.md). Retain an already approved title unless the person explicitly
chooses a proposed change; thumbnail selection alone does not approve a changed title. Obtain their decision on the
short description at that checkpoint and use the approved copy for upload. Do not invent copy at upload time.
Every thumbnail variant and the selected/archived image must match the video's orientation: vertical videos require
1080×1920 (9:16) thumbnails with 180×320 previews; landscape videos use 1920×1080 (16:9) with 320×180 previews.
Require a portrait composition and phone-size review for vertical jobs. The exporter and validator enforce the exact
saved video dimensions for all personalities, including square and custom frames.
If the upload command reports that authorization expired, follow
[docs/youtube-upload.md](youtube-upload.md) to reauthorize; for server auth from a laptop, it explains the temporary
Tailscale SSH tunnel. Include the YouTube link alongside the local MP4 and thumbnail paths. If upload fails, report
that separately and do not claim the video was uploaded. Nobody in this pipeline can hear: never say the film sounds
good, only what was measured. Never describe a waived or budget-exhausted review as passed. Run `watch` and verify
its Tailscale route as in section 4, then give the user the review address
(https://ip-208-84-101-178.tailc5adba.ts.net:8443/) to play the MP4 in their own browser. Stop the watch server
when they are done (`watch --project <slug> --stop true`).

## Resuming, a new chat, more than one video

Everything lives on disk, nothing in the conversation. When the user says "continue" (in this chat or a new one), run
`npm run -s video -- projects`, pick their project (ask if unclear), then `npm run -s video -- status --project <slug>`
and `next`. If `next` says delegated work is open and you did not start it in this chat, check with the user, then run
`delegated` and `next`: anything unfinished is issued again and finished work is kept. Several videos can run in one
chat or in separate chats; always pass `--project`.

To stop a video: cancel its open tasks (`task_cancel`), run `delegated`. To delete one, only when the user asks:
`project-delete --project <slug> --confirm <slug>` (removes the job, its script folder and archived thumbnails).

## Rules

- Keep your own context small. Act on what `next` prints and what tasks reply. Do not read briefs, docs, `film.json`,
  `shots/`, review reports, evidence or the script yourself (the review page shows the user the script; `next` gives
  you its length and verdict).
- Use only `npm run video -- ...`. Never `npx hyperframes`, never `preview` (Studio rewrites job files), never edit
  `video.config.json`, `node_modules`, `film.json`, `shots/`, reviews or evidence.
- Roles and models: `chat.config.json` is optional. Its default `provider: auto` chooses the profile of the
  **current chat's provider**, using `inheritedProviderInstanceId` and that instance's `driverKind` from
  `orchestrator_capabilities`. Match a profile by instance ID first, driver kind second. This supports custom instances.
  Script writer and reviewer use strong; all other roles use weak. Defaults:
  - Codex: strong `gpt-6.1-sol`, weak `gpt-6-luna`.
  - Claude: strong `claude-opus-5-5`, weak `claude-haiku-5-5`.
  - OpenCode: choose an appropriate available **free** model from the live catalog. Prefer DeepSeek V4.1 Flash
    or GLM 5.3 Flash only when listed and demonstrably free; otherwise choose another explicitly free model.
    A Flash name alone is not evidence of free pricing. Do not guess IDs or fall back to paid models.
  Before delegation, resolve the printed MODEL SELECTION policy into `target.providerInstanceId` and `target.model`.
  Preserve explicit project/role overrides (`project-set --model`) ahead of profile defaults. If an override only
  supplies a provider, use that provider's profile; if it only supplies a model, use the current provider instance.
  `inherit` explicitly keeps the chat's current provider/model. Legacy fixed provider and tier settings remain supported.
  Validate availability, canRunChildTask and model option descriptors. A disabled requested provider or missing pinned
  model blocks delegation: report the problem instead of silently switching. For OpenCode quota/unavailability,
  another available verified-free model may be selected and the switch disclosed.
  Model options inherit only for the same provider instance AND model; otherwise use supported explicit options or
  defaults. Put options in `target.options`. Check returned provider/model/options match the selection.
  An unknown provider with no profile inherits the current model. Do not change task text or clientRequestId.
  The shell pipeline cannot inspect the live T3 catalog; resolving the printed policy is the orchestrator's job.
- Every asset stays inside the repository, never in `/tmp`.
- Never show the preview panel or the player in chat. Point the user to https://ip-208-84-101-178.tailc5adba.ts.net:8443/ for every review, and do not call `preview_open` for the film.
- If a command fails with an error you cannot act on, run `npm run video -- help` once, then report the error.
