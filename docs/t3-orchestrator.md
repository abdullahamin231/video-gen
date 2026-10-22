# Making videos from a T3 Code chat

You are reading this because you are a chat agent in T3 Code (you have T3 tools such as `delegate_task` and
`preview_open`) and the user wants to brainstorm, make a video, write a script or make a thumbnail. This replaces the
web UI: the chat is the workspace, T3 delegated tasks are the roles, and the preview panel is where the user reads the
script, watches the film and picks the thumbnail. Sub-agents following a brief never use this file.

The pipeline knows the state of every video and prints the single next step. You do what it prints, ask the user at
their checkpoints, and record exactly what they say. You never write, build, review or judge anything yourself.

## 1. Brainstorm first

Until the user says to make the video ("make it", "go", "start production"), only talk. Help them find the angle,
audience, length and sources. You may run:

- `npm run -s video -- ideas [--focus "<topic>"]`: fresh video ideas (never repeats one). Mark one the user rejects
  with `ideas --set <id> --status rejected --reason "<their reason>"`.
- `npm run -s video -- projects`: every video made from a chat and where it is.

Do not research the topic yourself or draft the script: that is the researcher's and writer's job, from sources.

## 2. Start the video

When they say to make it, settle only what is still open, in one short message if anything is: format (landscape
long-form or vertical short), a length if they want one (otherwise the writer chooses), narration (Kokoro, local, the
default; or Gemini), and whether they supplied a script or recording. Defaults keep every checkpoint on: script,
prototype, final film, thumbnail.

1. Choose a short lowercase slug (`ssd-slowdown`). Write the agreed brief to `jobs/scripts/<slug>/BRIEF.md`: what the
   video is, for whom, the angle you agreed, every link and file they gave, their own notes and opinions. Use their
   words wherever you can; add nothing they did not say.
2. Create the project:

   ```bash
   npm run -s video -- project-new --name <slug> [--format vertical] [--duration 90] [--tts gemini] \
     [--script <file> --audio <file>] [--music <file>] [--review script,prototype,final,thumbnail|none] [--thumbnails 3] [--idea <id>]
   ```

   A supplied script is used as written (and its `VISUALS.md` if one sits beside it); a supplied recording is kept
   unchanged and never replaced by TTS.
3. Tell the user the video has started and that you will come back at each checkpoint.

## 3. The loop

```bash
npm run -s video -- next --project <slug> 2>&1 | tail -60
```

Do exactly what it prints, then run it again. Repeat until it prints `STATE: done`. It prints four kinds of step:

- **`DO: run <command>`**: run it in one shell call (narration, `start`, build, render and deliver can take minutes;
  wait with a long timeout rather than polling). Trim output with `| tail -40`.
- **`DO: start ... task(s) with the T3 delegate_task tool`**: call `delegate_task` once per JSON line, passing that
  object as the arguments unchanged (title, role, clientRequestId, mode, target, task). Start them all, then end your
  turn: each finished task wakes you. When one wakes you and others are still running (`task_status`), end your turn
  again. When all have finished, run `npm run video -- delegated --project <slug>`, then `next`. Never do their work,
  never edit their files, never add your opinions to a task, never reuse a task for a different brief. If a task fails,
  run `delegated` and `next`: unfinished work is issued again.
- **`STATE: your review of the script / prototype / final` or `you pick the thumbnail`**: a checkpoint (section 4).
- **`STATE: blocked` / `pipeline bug`**: report the reason to the user word for word and stop.

Whenever you tell the user where the video stands (the start, each checkpoint, each time a delegated round finishes, and
delivery), show the stage bar: run `npm run -s video -- stage-bar --project <slug>` and pass its whole output, unchanged,
as the `html` of `html_render` (title "<slug> progress", height 170). Do not edit it or draw your own. The bar shows every
stage and step and where the video is, so your reply adds only what it does not say.

While tasks are open, `next` prints "waiting for delegated work" and commands that advance the pipeline refuse. That
protects the pipeline from a sub-agent that wanders off its brief; it is not a reason to close the delegation early.

## 4. Checkpoints: the user decides

At each checkpoint `next` tells you what to open and what to record. The pattern is always:

1. Run `npm run -s video -- watch --project <slug>` and open the overview address it prints (the root address, never
   `/player/`) with `preview_open`, using `show: true`, `open: true` and `reuseExistingTab: true`. The panel must be
   visible: check `preview_status` and, if `visible` is false, call `preview_open` again with the returned `tabId` and
   `show: true`. `watch` is read-only and runs in the background.
2. In two or three lines, tell the user what is ready and what you need from them: approve, or say what to change
   (for the film: at which moment, e.g. "12.5: make the chart bigger").
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
`npm run video -- project-set --project <slug> [--review prototype,final] [--thumbnails 5] [--model builder=codex:gpt-6-luna]`.

## 5. Delivery

`STATE: done` prints the MP4 and thumbnail paths, the review disposition, unresolved findings, limitations, the
soundtrack measurements and the headphone checks. Give the user exactly that. Nobody in this pipeline can hear: never
say the film sounds good, only what was measured. Never describe a waived or budget-exhausted review as passed. Open
the overview in the panel (`preview_open` with `show: true`) so they can play the MP4, and stop the watch server when they are done
(`watch --project <slug> --stop true`).

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
  `shots/`, review reports, evidence or the script yourself (the preview page shows the user the script; `next` gives
  you its length and verdict).
- Use only `npm run video -- ...`. Never `npx hyperframes`, never `preview` (Studio rewrites job files), never edit
  `video.config.json`, `node_modules`, `film.json`, `shots/`, reviews or evidence.
- Roles and models: each task line already carries its model (from `chat.config.json`: script writer and reviewer on
  the strong model, every other role on the weak one). Do not change them unless the user asks (`project-set --model`).
- Every asset stays inside the repository, never in `/tmp`.
- Always show the preview panel: every `preview_open` call passes `show: true`, and the panel stays visible while the user is reviewing. Never open the `/player/` address in T3; use the overview address from `watch`.
- If a command fails with an error you cannot act on, run `npm run video -- help` once, then report the error.
