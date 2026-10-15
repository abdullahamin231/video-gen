# Make the completed video

The user asks: **"Create a video given the audio `<audio path>` and script `<script path>`."**
You deliver a finished, independently reviewed MP4. The user never runs commands, writes JSON, or approves steps.

You are the **orchestrator**. The pipeline knows the state of the job and prints the single next step. Specialised
sub-agents do the creative work from self-contained brief files. This works the same in any harness.

## The loop

1. From the repository root, create the job (quote paths; near-miss filenames are resolved automatically):

   ```bash
   npm run video -- start --audio "<audio path>" --script "<script path>"
   ```

   Add `--duration 30` (and `--start <s>`) only when the user asks for an excerpt ("first 30 seconds" → `--duration 30`).

2. Run:

   ```bash
   npm run video -- next --job jobs/<slug>
   ```

3. Do exactly what it prints, then run `next` again. Repeat until it prints `STATE: done`.

`next` prints one of two kinds of step:

- **`DO: run <command>`** — run that command yourself (build, render, review-pack, deliver, preview).
- **`DO: spawn ... sub-agent`** — start a fresh sub-agent with no conversation history whose entire prompt is the quoted
  line `Read <brief file> and follow it exactly.` Use whatever your harness provides (a Task/Agent/subagent tool,
  a new session). Several briefs may run in parallel. Wait for them to finish. Do not do their work yourself, do not edit
  their files, and do not pass them your own opinions.
  Reviewer sub-agents must be new agents that did not build anything.
  The step names a role (`video-director`, `video-builder`, `video-reviewer`). If your harness has an agent type with
  that name, use it: it pins the role's model (see "Models per role" below). Otherwise use any fresh sub-agent.

When it prints `STATE: done`, give the user the MP4 path, the preview URL, and the short verification note from
`review/delivery.json`. If it prints `STATE: blocked`, report honestly; never call an unqualified draft complete.

## Rules for the orchestrator

- Never run `npx hyperframes`, `hyperframes upgrade`, or edit files in `node_modules`. Use only `npm run video -- ...`.
- Never read `scripts/` or `lib/` to work out what to do; `next`, the briefs and `docs/SCENE_SPEC.md` are the interface.
- Never edit `film.json`, `shots/`, reviewer reports, or evidence yourself. Repairs go through the briefs `next` writes.
- Keep the supplied recording unchanged. Never use TTS for a supplied recording.
- If a command fails with an error you cannot act on, run `npm run video -- help` once, then report the error.
- If your harness truly cannot spawn sub-agents, you may follow director and builder briefs yourself in sequence,
  but reviews must come from sub-agents; without them the film cannot be delivered.

## What the roles produce

| Role | Brief | Writes | Checked by |
|---|---|---|---|
| Director and lead animator | `briefs/director.md`, `briefs/direct-<scene>.md`, `briefs/repair-director.md` | `film.json` (concept, scenes, who builds each), then the scenes it owns: the prototype, its context, and any later scene it keeps | `plan-check`, `build --scene` |
| Scene builder (one per delegated scene) | `briefs/build-<scene>.md` | `shots/<scene>.json` (+ hook, components, Manim file); full creative authority, departures recorded in `notes` | `build --scene` (spec errors, browser checks, motion transcript) |
| Repair builder | `briefs/repair-<scene>.md` | fixes to a delegated scene | same |
| Reviewers ×3 | `briefs/review-<stage>-<role>.md` | `review/<stage>/incoming/<role>.json` | `review-submit` |

The prototype scene (the most demanding 10–15 s) and its prerequisite introduction/context are built in order,
rendered and reviewed before later scenes are built. By default the director builds them itself, in the same context
that planned them; it delegates later scenes with `"owner": "builder"` in film.json.

Build errors mean the film is broken or untrue (invalid spec, unspoken cue words, conflicting or non-seek-safe motion,
nondeterminism, unsourced numbers). House style (sizes, easing, frame use, stillness, overlaps) produces warnings:
agents may break it on purpose, and reviewers judge whether that served the explanation. Missing scenes never qualify for final review or delivery.

## Models per role

Creative and judgement roles need a strong model; following `next` and building scenes do not. In Claude Code the
agent types in `.claude/agents/` pin this:

| Agent type | Model | Why |
|---|---|---|
| orchestrator (main session) | any, e.g. `claude --model haiku` | `next` decides every step |
| `video-director` | `opus` | the concept, the plan, and the scenes whose look is hardest to put into words |
| `video-builder` | `haiku` | delegated scenes; `build --scene` checks catch broken output |
| `video-reviewer` | `opus` | a weak reviewer passes weak films |

To change a role's model, edit `model:` in its file. Leave `CLAUDE_CODE_SUBAGENT_MODEL` unset; it overrides these.

## References

- [docs/SCENE_SPEC.md](docs/SCENE_SPEC.md) — the scene language (objects, verbs, cues, camera, components, hooks, Manim).
- [docs/quality.md](docs/quality.md) — the full creative and review standard (house style: 3Blue1Brown / Manim).
- [docs/independent-review.md](docs/independent-review.md) — review roles, evidence and report schema.
- [docs/agent-workflow.md](docs/agent-workflow.md) — what each pipeline stage does, for maintainers.
- `npm run video -- help` — all commands. `npm test` — pipeline tests.

Jobs live in `jobs/<slug>/` (ignored by Git). Reusable work belongs in `library/` and the kit (`lib/kit/kit.js`).
