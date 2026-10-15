// Self-contained role briefs. The host agent hands one file to a fresh sub-agent ("Read <brief> and follow it").
// Briefs carry everything the role needs, so the sub-agent never has to explore the repository.
import path from 'node:path';
import {mkdir, writeFile} from 'node:fs/promises';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CMD = 'npm run video --';
const rel = (job, p) => path.join(job, p);

export function wordTable(alignment, from = 0, to = Infinity) {
  const rows = alignment.words.filter(w => w.start >= from - 0.01 && w.start < to);
  const lines = []; let line = '';
  for (const w of rows) {
    const cell = `${w.start.toFixed(2)} ${w.text}`;
    if ((line + '  ' + cell).length > 110) { lines.push(line); line = cell; } else line = line ? line + '  ' + cell : cell;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

const QUALITY = `## What a good film looks like (house style: 3Blue1Brown / Manim)
- It explains through MOTION. Each narrated idea gets a mechanism: initial condition → operation → consequence → payoff.
  Parts interact; one action causes the next; the viewer sees WHY the result happens.
- Not a slideshow: no big sentence above a picture, no icon cards with prices, no rows of labelled boxes.
  Text is for labels, key terms, numbers and equations only (the narration already says the sentences).
- Prefer transformations: a quantity becomes a shape, an equation morphs term by term, a diagram opens into a bigger one,
  a graph retargets to a new function, particles gather into a structure. Keep subjects on screen and change them.
- One continuous visual world: recurring subjects keep their identity across scenes; the camera moves between regions
  of one world instead of cutting between unrelated layouts.
- The SUBJECT develops in every active passage, around ONE clear focus (dim the rest with "focus"). Camera motion
  does not count as subject development. Coordinate parts when the explanation needs them; do not add filler to hit a count. No stillness over 2.5 s
  except a declared hold just before/after a payoff.
- Look: near-black background, off-white strokes 2–4 px, at most 2–3 muted accent colours each with ONE meaning,
  low-opacity fills, smooth easing (no bounce/elastic/overshoot), labels ≥ 28 px, values ≥ 40 px, generous space,
  subject large in frame (it must fill well over a fifth of the frame).
- Only show numbers that the narration or script states (axis ticks may be declared as explanatory scale).
  Never invent technical claims or equate subscription payments with an unpriced machine. Preserve qualifiers such as "over".
- Draw recognisable subjects with internal structure; an anonymous rectangle is not a GPU, a computer or a person.
  Labels support the pictures. They must not carry the whole explanation. A price comparison can use real scale change
  or a coherent comparison; it does not need an invented causal metaphor. Essential labels should stay readable at 480 px.
- Do not explain later passages early. Make the specific idea of THIS passage visible — if the same animation would
  work for an unrelated topic by changing labels, it is too generic.`;

export function directorBrief(job, manifest, alignment, {repair = null} = {}) {
  return `# Role: director

You plan the film. You do not write animation code. Work only inside \`${job}\`.

## Inputs
- Recording: ${manifest.duration.toFixed(2)} s, ${manifest.width}×${manifest.height}. Narration is fixed; never change it.
- Script: \`${rel(job, 'inputs/source-script.md')}\` (may contain visual notes; you are free to ignore them).
- Spoken words with start times (seconds) — the timing authority:

\`\`\`
${wordTable(alignment)}
\`\`\`

${QUALITY}

${repair ? `## Director revision required\nThe current concept or scene ownership failed review. Resolve these findings in film.json:\n${repair}\nYou may revise mechanisms, scene boundaries, ownership and carry. Rename any scene whose mechanism or ownership changes, so its old shot cannot silently be reused. Update prototype accordingly. Preserve unaffected scenes where appropriate. Do not edit shots or reviewer reports.\n` : ''}

## What to write: \`${rel(job, 'film.json')}\`
1. Read the narration. Find the argument, the surprises, and the ideas that need a visible mechanism.
2. Invent at least 2 genuinely different whole-film concepts (different mechanisms/worlds, not colour changes). Pick the
   most inventive one the house style can do well. Record the others in "alternatives".
3. Split the recording into scenes by idea (typically 6–20 s each). A scene starts at a phrase spoken in the recording.
4. For every scene describe the mechanism precisely enough that a builder can animate it without guessing.
5. Pick the most demanding 10–15 s scene as "prototype". Required earlier introduction/context is built in order before
   it, so carried objects have real owners. Scenes after the prototype wait for prototype acceptance.
6. Name recurring subjects with ids; list in each scene's "carry" which earlier subjects stay on screen.
7. Optionally give each scene a "region" of the world (camera centre/zoom) so scenes live in one continuous space.

The building blocks available to builders (choose mechanisms they can make): geometry (circle, rect, line, arrow,
path, polygon, arc, brace), text, TeX equations with term-by-term transforms, counters, axes/number lines/graphs/areas,
coordinate planes with linear transformations, vectors, bar sets that change value, networks, deterministic particle
systems (drift/brownian/attract/orbit/fall, arrange into shapes), images, Manim clips, custom components with their own
verbs, and a free camera (pan/zoom/focus). Verbs: create, write, fadeIn/Out, move (straight/arc/along a path), scale,
grow, rotate, color, count, transform/morph, trace, retarget, applyMatrix, flow, arrange, simulate, focus, indicate,
circumscribe, flash, pulse, camera.

\`\`\`json
{
  "version": 2,
  "title": "Short film title",
  "concept": "The continuous visual world and through-line, e.g. 'a single memory bus seen at three scales...'",
  "alternatives": [
    {"concept": "A different whole-film mechanism", "rejected": "why it explains less"},
    {"concept": "Another", "rejected": "why"}
  ],
  "palette": {"blue": "what blue means", "yellow": "what yellow means"},
  "subjects": [{"id": "pipe", "what": "the water pipe that stands for bandwidth"}],
  "prototype": "bottleneck",
  "scenes": [
    {
      "id": "opening",
      "start": {"boundary": "start"},
      "idea": "What the narration says here, in one sentence",
      "mechanism": "The exact visible operation: what parts exist, what acts on what, what changes",
      "states": ["initial condition", "operation", "consequence", "payoff"],
      "payoff": "The visible result that completes the explanation",
      "camera": "Why the camera moves (reveal a hidden layer, follow a cause, show a limit, change scale) or 'static: reason'",
      "handoff": "Which object/relationship carries into the next scene and how",
      "carry": [],
      "region": {"center": [960, 540], "zoom": 1},
      "why_not_basic": "What a plain drawing / reveal / flow would fail to show",
      "alternatives": ["another mechanism considered for this scene and why not"]
    },
    {"id": "bottleneck", "start": {"phrase": "exact words spoken here"}, "...": "..."}
  ]
}
\`\`\`

"start" of every scene after the first is {"phrase": "<words copied exactly from the word table>"} (add
"occurrence": 2 if those words were already spoken earlier). Scenes are ordered by time and cover the whole recording.

## Check and finish
Run \`${CMD} plan-check --job ${path.relative(ROOT, job)}\` from \`${ROOT}\`. Fix every error it prints and run it again
until it says the plan is valid. Then stop and reply with one line: "film.json ready". Do not build scenes.
`;
}

export function builderBrief(job, manifest, film, timingScene, alignment, {repair = null, prior = []} = {}) {
  const s = film.scenes.find(x => x.id === timingScene.id), idx = film.scenes.indexOf(s), next = film.scenes[idx + 1];
  const carried = (s.carry || []).map(id => { const p = prior.find(o => o.id === id); return `- \`${id}\`${p ? ` — defined in ${p.file}: ${JSON.stringify(p.spec).slice(0, 400)}` : ' — defined in an earlier scene'}`; }).join('\n') || '- (none)';
  const jobRel = path.relative(ROOT, job);
  return `# Role: scene builder — scene "${s.id}"

You build ONE scene of the film as a JSON shot spec. Work only inside \`${job}\`. Other agents build other scenes:
never edit files of other scenes, film.json, or anything outside \`shots/${s.id}.json\`, \`shots/${s.id}.hook.js\`
and new files in \`components/\`.

## Your scene (${timingScene.start.toFixed(2)}–${timingScene.end.toFixed(2)} s of the recording)
- Idea: ${s.idea}
- Mechanism: ${s.mechanism}
- Visible states: ${s.states.join(' → ')}
- Payoff: ${s.payoff}
- Camera purpose: ${s.camera}
- Handoff to next scene${next ? ` ("${next.id}")` : ''}: ${s.handoff}
- Why a basic drawing/flow is not enough: ${s.why_not_basic}
- World region: ${s.region ? JSON.stringify(s.region) : 'free (the default view is centre [960,540], zoom 1)'}
- Film concept: ${film.concept}
- Palette meanings: ${JSON.stringify(film.palette || {})}
- Subjects still on screen from earlier scenes (reuse these ids; do not redefine them):
${carried}
${next ? `- The next scene keeps: ${(next.carry || []).join(', ') || '(nothing)'}. Everything else you create fades out automatically at the handoff.` : '- This is the final scene: complete the film\'s continuous visual connection.'}

## Spoken words in your scene (seconds; cue phrases must be copied from here)
\`\`\`
${wordTable(alignment, timingScene.start, timingScene.end)}
\`\`\`

${QUALITY}

## How to write it
Read \`${path.join(ROOT, 'docs/SCENE_SPEC.md')}\` completely before writing: it is the full reference with examples
(objects, verbs, cues, camera, hooks, components, Manim). Then write \`${rel(job, `shots/${s.id}.json`)}\`.
Plan many short coordinated actions (0.2–2 s) that make the mechanism operate, consequences follow causes, and the
payoff land. Start major actions at their spoken cue; supporting actions can anticipate or finish after.
You have full creative freedom: invent geometry, write custom components, use hooks or Manim when built-ins are not enough.

## Check, look, fix
1. \`cd ${ROOT} && ${CMD} build --job ${jobRel} --scene ${s.id}\`
   It validates the spec, runs the scene in a browser and prints errors and a motion transcript of what is actually on
   screen. Fix every error and rebuild until it reports 0 errors.
2. Read the motion transcript it prints. Check that the events tell the mechanism of the plan, in the right order,
   at the right words, with the subject large and central.
3. If you can view images: \`${CMD} snapshot --job ${jobRel} --scene ${s.id}\` writes frames to
   \`${rel(job, 'review/snapshots/')}\`. Look at them and fix layout, scale and clutter.
${repair ? `\n## Repair findings to fix (from independent reviewers and checks)\n${repair}\n` : ''}
Finish with a one-line reply: "scene ${s.id} built" plus anything you could not fix.
`;
}

export function reviewerBrief(job, role, pack, packPath, packSha256, briefDirections) {
  const jobRel = path.relative(ROOT, job), incoming = rel(job, `review/${pack.stage}/incoming`);
  return `# Role: independent reviewer — ${role}

You did not make this film and you must not change it. You only write your own report.
Job: \`${job}\` · stage: ${pack.stage} · interval: ${pack.interval.start}–${pack.interval.end} s (inspect all of it).

## Evidence (frozen)
- Pack: \`${packPath}\` (lists every evidence file with timestamps)
- Frames, contact sheets and short clips in the pack directory: VIEW these for the whole assigned interval.
- Motion transcript and automated checks are supporting diagnostics. The visual-mechanism role reads them only AFTER
  saving its blind observations of the images. A transcript-only review cannot pass.

${pack.stage === 'prototype' ? 'This is a prototype review, not final delivery. Evaluate the built prototype and its available incoming context. Do not reject missing scenes strictly outside the assigned interval; outgoing continuity into unbuilt scenes must be checked in final review. A missing prerequisite within the interval is blocking.' : 'This is final review: every scene and all handoffs must be present and covered.'}

${briefDirections}

## Requirements you judge against
${QUALITY.replace('## What a good film looks like (house style: 3Blue1Brown / Manim)\n', '')}

Blocking: a central idea without a visible operation/consequence/payoff; unsupported numbers or claims; picture
contradicts the narration; unreadable essential labels; collisions over essential text; competing focus hiding the
mechanism; inactive passages; broken transformation or handoff; evidence that does not cover the interval.
Advisory: improvements that do not prevent understanding. Do not block on mere taste.

## Write the report
1. Run: \`cd ${ROOT} && ${CMD} review-template --job ${jobRel} --stage ${pack.stage} --role ${role}\`
   It writes \`${incoming}/${role}.json\` with the hashes already filled in.
2. Edit that file: set reviewer.agentId to your own agent/session identifier (any unique name if your harness gives none,
   e.g. "${role}-reviewer-1"); fill inspection, coverage, findings and verdict ("pass" only with no blocking findings).
   Set inspection.visual to "viewed" only after opening images/video; list the actual frozen image/clip paths you
   inspected in inspection.evidence. Record the actual inspection mode and limitations; do not claim playback or
   listening from still frames or transcripts. If you cannot view images, use visual "unavailable" and verdict "incomplete".
   Coverage must describe what you actually inspected, including intermediate states and the ending.
   Every finding needs id, severity, start, end, subject, requirement, observed, repair, and evidence paths copied from the pack.
   For a blocking finding add scope: "scene" for an implementation defect, "plan" for an incorrect/inadequate mechanism
   or ownership contract, or "evidence" for missing inspection capability/evidence. You may name responsible sceneIds
   (including an earlier scene) so a boundary defect is routed to its cause rather than just its timestamp.
3. Run: \`${CMD} review-submit --job ${jobRel} --file ${incoming}/${role}.json\` and fix any schema error it reports.
Reply with the verdict and the list of blocking findings (timestamp + one line each).
`;
}

export async function writeBrief(job, name, text) {
  await mkdir(path.join(job, 'briefs'), {recursive: true});
  const file = path.join(job, 'briefs', name);
  await writeFile(file, text);
  return file;
}
