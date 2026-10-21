# Orchestrator runbook: make the completed video

You are reading this because you are the orchestrator: the user asked you to make a video, write a script or make a
thumbnail. Sub-agents following a brief never use this file.

The user asks: **"Create a video given the audio `<audio path>` and script `<script path>`."**
You deliver a finished, independently reviewed MP4 **and a finished thumbnail**. The user never runs commands, writes JSON, or approves steps.

You are the **orchestrator**. The pipeline knows the state of the job and prints the single next step. Specialised
sub-agents do the creative work from self-contained brief files. This works the same in any harness.

## The loop

1. From the repository root, create the job (quote paths; near-miss filenames are resolved automatically):

   ```bash
   npm run video -- start --audio "<audio path>" --script "<script path>"
   ```

   Add `--length 30` (and `--start <s>`) only when the user asks for an excerpt ("first 30 seconds" → `--length 30`).
   Add `--format vertical` when the user asks for a reel, short, TikTok or vertical video, and `--format landscape` for
   long-form when the defaults say otherwise. Defaults come from `video.config.json`; never edit it unless asked.
   Add `--music "<track>"` when the user supplies a music track; otherwise the director brings in a licensed one
   matching the visual plan's music section.
   A `VISUALS.md` beside the script (the script writer's visual plan) is carried into the job automatically
   (`--visuals <file>` names another one). Without one, `next` first has a `script-writer` write it.

   The job is named after the script: its file name, else its `#` title, else its folder (`jobs/scripts/<slug>/SCRIPT.md`
   becomes `<slug>`). Generic names such as `script` or `SCRIPT` are never used alone. Pass `--name <slug>` only when the
   user asks for a particular name.

2. Run:

   ```bash
   npm run video -- next --job jobs/<slug>
   ```

3. Do exactly what it prints, then run `next` again. Repeat until it prints `STATE: done`.
4. Finish the thumbnail workflow below before delivering the video to the user. `STATE: done` qualifies the MP4;
   the user request is complete only when its thumbnail is also saved and checked.

`next` prints one of two kinds of step:

- **`DO: run <command>`** — run that command yourself (build, render, review-pack, deliver).
- **`DO: spawn ... sub-agent`** — start a fresh sub-agent with no conversation history whose entire prompt is the quoted
  line `Read <brief file> and follow it exactly.` Use whatever your harness provides (a Task/Agent/subagent tool,
  a new session). Several briefs may run in parallel. Wait for them to finish. Do not do their work yourself, do not edit
  their files, and do not pass them your own opinions.
  Reviewer sub-agents must be new agents that did not build anything.
  The step names a role (`script-researcher`, `script-writer`, `video-director`, `video-builder`, `video-reviewer`). If your harness has an agent type with
  that name, use it: it pins the role's model (see "Models per role" below). Otherwise use any fresh sub-agent.
- **`STATE: human review of the prototype/final`** — the user asked to watch the film at this stage (`start
  --human-review prototype,final`). In the video UI, call the runner's `checkpoint` tool with that kind; the user watches
  the built film there and the UI records their decision. Elsewhere, ask them to run `npm run video -- play --job <job>`
  (it plays the built HTML in the browser with a scene strip; nothing is rendered or changed), then record exactly what
  they said with `human-review --decision approve` or `--decision revise --note "12.5: <their words>"`. Never decide for
  them and never reword a note: `next` sends each note to the scene at its moment.

Nothing is rendered until final review completes (passing or reaching its three-round creative review budget), and the user approves if they asked for final review: reviewers judge
frames taken from the built HTML, and `next` then asks for one `render`.

When it prints `STATE: done`, complete the thumbnail workflow, then give the user the MP4 and thumbnail paths and a short verification note from `review/delivery.json`
(its reviewDisposition, unresolvedFindings, limitations and advisory findings), the soundtrack's measurements (`soundtrack`: integrated LUFS and peaks,
measured on the MP4) and the five `headphoneChecks` timestamps with what to listen for. Nobody in this pipeline can
hear: never say the film sounds good, only what was measured. Do not run `preview` or open HyperFrames Studio: it rewrites job files and
makes the delivered job look stale. The final MP4 is the deliverable.
Creative review has a three-round budget per stage. After the third complete failed round, continue to render and delivery with unresolved findings disclosed in `review/delivery.json`; never describe this outcome as independently passed. Missing inspection/evidence and failed technical checks still block. If it prints `STATE: blocked`, report the actual reason.

## Thumbnail at the end of every video

Every request to create a video also includes a thumbnail unless the user explicitly opts out. When `next` prints
`STATE: done`, follow `npm run video -- thumbnails --job <job>` exactly as you follow `next` (the same DO and spawn
steps) until it prints `STATE: done`:

- It makes N variants in parallel (`thumbnails` in `video.config.json`, 3 by default; `start --thumbnails N`), one
  `thumbnail-maker` per brief, each from a different angle (the visual plan's thumbnail as written, a warning, an
  accusation, a big number, the surprising mechanism). The briefs carry the visual plan's "## Thumbnail" section and
  point at [docs/kaiexplains-thumbnail-study.md](kaiexplains-thumbnail-study.md). Makers export with
  `thumbnail-export`, which renders the SVG to `thumbnail.png` (1280×720) and `preview-320x180.png`.
- One fresh `thumbnail-reviewer` (never a maker) judges every new or changed variant at full and feed size and records
  `pass` or `blocked` with `thumbnail-verdict`, then ranks the passing ones. A blocked variant goes back to its maker
  with the findings, up to three times; the others stay.
- When the user asked to pick (`start --pick-thumbnail true`; the UI's "Let me pick the thumbnail"), it says "the
  person picks": call the runner's `checkpoint {kind: "thumbnail"}`, or show them the PNGs and record exactly what
  they say with `thumbnail-choose --variant <id> --by you` or `thumbnail-feedback --variant <id> --note "<their
  words>"`. Feedback sends only that variant back to a maker, then to review. Otherwise it prints the
  `thumbnail-choose` command for the reviewer's top-ranked variant.
- `thumbnail-choose` copies the pick into `thumbnail/` (with its review as `thumbnail/REVIEW.json`) and archives the
  whole folder, every variant included, to `library/thumbnails/<slug>/`; an earlier archive moves to `history/`.

Never pick for the user, never reword their feedback, and do not change a qualified film to make a still.

## Rules for the orchestrator

- Keep your own context small: every request re-sends all of it. Act on what `next` prints and what sub-agents reply;
  do not read briefs, other docs, `film.json`, `shots/`, review reports or evidence yourself. Trim long command output
  (`npm run -s video -- ... 2>&1 | tail -40`). Fetching sources belongs to the script researcher, not to you.
- Wait for a sub-agent or a long command with one blocking call. Do not check on it again and again from separate turns;
  each check costs a full request.
- Never run `npx hyperframes`, `hyperframes upgrade`, or edit files in `node_modules`. Use only `npm run video -- ...`.
  For generated narration use `npm run video -- tts`, following [docs/tts.md](tts.md); caches must stay in the repository `.cache/`.
- Sound runs through the pipeline too: `npm run video -- setup-audio` (ffmpeg check, librosa), `music` and
  `library-search` / `library-use` for existing sound effects. See [docs/sound.md](sound.md).
- Never read `scripts/` or `lib/` to work out what to do; `next`, the briefs and `docs/SCENE_SPEC.md` are the interface.
- Never edit `film.json`, `shots/`, reviewer reports, or evidence yourself. Repairs go through the briefs `next` writes.
- Keep the supplied recording unchanged. Never use TTS for a supplied recording. Music and sound effects go under it;
  the pipeline mixes them and never processes the narration beyond one master gain.
- Keep every asset inside the repository, never in `/tmp` or a scratch directory. Agents bring images and fonts in with
  `npm run video -- asset` (saved to the job's `assets/` and to `library/`) and save what they make with
  `npm run video -- save`. Finished thumbnail sets are archived separately under `library/thumbnails/<slug>/`.
  When `next` prints `save-all`, run it: it saves anything still missing from `library/`.
- If a command fails with an error you cannot act on, run `npm run video -- help` once, then report the error.
- If your harness truly cannot spawn sub-agents, you may follow director and builder briefs yourself in sequence,
  but reviews must come from sub-agents; without them the film cannot be delivered.

## What the roles produce

| Role | Brief | Writes | Checked by |
|---|---|---|---|
| Script researcher (new script) | the user's request | `jobs/scripts/<slug>/sources/`, `SOURCES.md` | the writer and script reviewer |
| Script writer (visual plan for a supplied script) | `briefs/visuals.md` | `inputs/visuals.md`: concept, theme, every scene's events at exact words, assets, thumbnail | `next` (required sections) |
| Director and lead animator | `briefs/director.md`, `briefs/direct-<scene>.md`, `briefs/repair-director.md` | `film.json` transcribed from the visual plan (its theme, concept, scenes, who builds each) and the assets it needs, then the scenes it owns: the prototype, its context, and any later scene it keeps | `plan-check`, `build --scene` |
| Scene builder (one per delegated scene) | `briefs/build-<scene>.md` | `shots/<scene>.json` (+ hook, components, Manim file) built from the visual plan's section for that scene (quoted in the brief); departures recorded in `notes` | `build --scene` (spec errors, browser checks, motion transcript) |
| Repair builder | `briefs/repair-<scene>.md` | fixes to a delegated scene | same |
| Reviewers ×3 | `briefs/review-<stage>-<role>.md` | `review/<stage>/incoming/<role>.json` | `review-submit` |

The prototype scene (the most demanding 10–15 s) and its prerequisite introduction/context are built in order,
reviewed (from the built HTML, without rendering) before later scenes are built. By default the director builds them itself, in the same context
that planned them; it delegates later scenes with `"owner": "builder"` in film.json.

Build errors mean the film is broken or untrue (invalid spec, no declared design theme, missing assets, unspoken cue
words, conflicting or non-seek-safe motion, nondeterminism, unsourced numbers). Every film has exactly one design theme,
chosen in the visual plan; no particular look is prescribed. Style guidance (sizes, colours or fonts outside the theme,
frame use, stillness, intentional readable layering) produces warnings: agents may break it on purpose, and reviewers judge whether that
served the film. Missing scenes never qualify for final review or delivery.

## Models per role

Only script writing and its review run on the strong model; gathering the sources does not. The script writer puts all of the film's creative thinking into the
script and its visual plan (`VISUALS.md`: concept, design theme, every scene's stage and events at exact words, assets,
thumbnail), so every later role carries out a written design instead of inventing one.

| Role | Tier | Why |
|---|---|---|
| orchestrator (main session) | weak | `next` decides every step |
| `script-researcher` | weak | fetches every source, follows it to primary evidence and saves the text; the writer reads only what it saved |
| `script-writer`, `script-reviewer` | strong | the script and the visual plan are where creative thinking pays off; the reviewer checks both |
| `video-director`, `video-builder`, thumbnail maker | weak | transcribe the visual plan into film.json and build it; `plan-check` and `build --scene` catch broken output |
| `video-reviewer`, thumbnail reviewer | weak | check frames of the built film against the plan and the quality standard; raise one to strong if weak reviews pass weak films |

Default models for each harness:

| Harness | Strong | Weak |
|---|---|---|
| Claude Code | `claude-opus-5-5` | `claude-haiku-5-5` |
| Pi | `anthropic/claude-opus-5-5` | `anthropic/claude-haiku-5-5` |
| Codex | `gpt-6.1-sol` | `gpt-6-luna` |
| OpenCode | `opencode/deepseek-v4.1-flash-free` | `opencode/glm-5.3-flash` |

In Claude Code the agent types in `.claude/agents/` pin these (Pi reads the same pins); to change a role's model, edit
`model:` in its file. Leave `CLAUDE_CODE_SUBAGENT_MODEL` unset; it overrides them. The job UI applies the table for
every harness and lets you choose a different model for any role (`ui/shared/routing.mjs` holds the defaults).

## Writing a script

When the user asks for a script ("Write a 5-minute script from these links", or just "a video about X"), it comes from
the sources they supply, at the duration they name if they name one. It takes two steps, in this order:

1. **Gather the sources (weak model).** Spawn a fresh `script-researcher` sub-agent whose prompt gives the user's
   request verbatim (links, files, topic, creator notes) and the folder `jobs/scripts/<slug>/`, and tells it to follow
   the `script-writing` skill's `references/sourcing.md`. It fetches every source, follows articles to their primary
   evidence, searches the web when the request names only a topic, and saves `sources/NN-*.md` and `SOURCES.md`.
   Do not fetch or search anything yourself.
2. **Write the script (strong model), only once the sources are saved.** Spawn a fresh `script-writer` sub-agent (or
   any strong-model sub-agent) whose prompt names the folder, the duration if there is one, the format and any creator
   notes, and tells it to follow the `script-writing` skill (`.opencode/skills/script-writing/SKILL.md`, linked into
   `.claude/skills` and `.agents/skills`). It reads only the saved sources, never the web, and writes `SCRIPT.md`,
   `research.md` and the visual plan `VISUALS.md` the film is built from. If it replies `NEEDS SOURCES` with a list,
   send that list to a fresh `script-researcher` for the same folder, then resume the writer (once; after that it
   works with what it has).

Give the user the script, its word count and estimated
duration and the speaking-rate assumption. Before delivery, commission a fresh `script-reviewer` (or strong-model reviewer)
with the brief, script, visual plan, saved sources and research notes, following the skill's `references/review.md`. Have the writer address blockers
and the reviewer check revisions (at most two rounds); unresolved work is a draft, never an independently passed script.
A review marked `incomplete` for a missing source goes to the researcher first, then back to the reviewer.
If the user names no duration, use a positive `length` from `video.config.json` (seconds); if it is null, do not ask:
tell the writer no length was requested, and it chooses one that fits the material (the skill's *Choosing the length*)
and records why. For a reel, short or vertical video (or `"format": "vertical"` in the config), tell the writer it is
vertical short-form; a chosen length then stays within `verticalMaxSeconds`. Explicit user duration takes priority.

## Generating narration (TTS)

When the user has a script but no recording (a script the `script-writer` wrote, or "make a video from this script"),
generate the narration with HyperFrames TTS (local Kokoro) by following [docs/tts.md](tts.md) exactly: one-time
Python setup, `am_michael` at a speed chosen from the word count, one paragraph per call, joined with short pauses and
1.5 s of trailing silence. Then run the loop above with `--audio jobs/scripts/<slug>/narration.wav` and the same
script. Never use TTS when the user supplied a recording.

## References

- [docs/SCENE_SPEC.md](SCENE_SPEC.md) — the scene language (objects, verbs, cues, camera, components, hooks, Manim).
- [docs/quality.md](quality.md) — the full creative and review standard (one design theme per film, chosen in the visual plan).
- [docs/independent-review.md](independent-review.md) — review roles, evidence and report schema.
- [docs/tts.md](tts.md) — generating narration with HyperFrames TTS when there is no recording.
- [docs/sound.md](sound.md) — music, sound effects, the mix and its measurements; the sound library.
- [docs/agent-workflow.md](agent-workflow.md) — what each pipeline stage does, for maintainers.
- [docs/kaiexplains-thumbnail-study.md](kaiexplains-thumbnail-study.md) — thumbnail/title reference and visual evidence.
- `npm run video -- help` — all commands. `npm test` — pipeline tests.

Jobs live in `jobs/<slug>/` and scripts in `jobs/scripts/<slug>/` (script, research, sources, narration), both ignored by Git. Reusable work belongs in `library/` and the kit (`lib/kit/kit.js`).

Readability is non-waivable: obscured, illegible or unintentionally overlapping text blocks delivery even after three creative review rounds. Intentional layering needs an explicit reason and clearly readable text.
