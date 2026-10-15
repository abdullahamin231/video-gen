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

const QUALITY = `## Fixed (the pipeline enforces these; they keep the film true and renderable)
- The recording is fixed. Timing comes from the spoken words; never change the narration.
- Show only numbers and claims the narration or script supports. An explanatory value that is not spoken (an axis
  scale, an illustrative count) is allowed when the object says why: "numbers": "<reason>".
- Deterministic and seek-safe: no randomness, clocks, timers or callbacks (use the kit's seeded rng and cue times).

## House style (3Blue1Brown / Manim): guidelines, not laws
Follow these by default. Break one when breaking it explains the idea better, and say why in the shot's "notes".
The test is always the same: does the viewer SEE why the narrated idea is true?
- It explains through MOTION. Each narrated idea gets a mechanism: initial condition → operation → consequence → payoff.
  Parts interact; one action causes the next; the viewer sees WHY the result happens.
- Not a slideshow: no big sentence above a picture, no icon cards with prices, no rows of labelled boxes.
  Text is for labels, key terms, numbers and equations (the narration already says the sentences).
- Prefer transformations: a quantity becomes a shape, an equation morphs term by term, a diagram opens into a bigger one,
  a graph retargets to a new function, particles gather into a structure. Keep subjects on screen and change them.
- One continuous visual world: recurring subjects keep their identity across scenes; the camera moves between regions
  of one world instead of cutting between unrelated layouts.
- The subject develops through active passages around ONE clear focus. Camera motion alone is not development.
  Long stillness (over ~2.5 s) needs a reason, such as letting a payoff land.
- Look: near-black background, off-white strokes 2–4 px, 2–3 muted accent colours each with ONE meaning, low-opacity
  fills, smooth easing (no bounce/elastic/overshoot), labels ≥ 28 px and values ≥ 40 px on screen, generous space,
  the subject large in frame.
- Draw recognisable subjects with internal structure; an anonymous rectangle is not a GPU, a computer or a person.
  Labels support the pictures; they must not carry the whole explanation. Essential labels stay readable at 480 px.
- Do not explain later passages early. Make the specific idea of THIS passage visible — if the same animation would
  work for an unrelated topic by changing labels, it is too generic.`;

const TOOLS = `Tools (for you and for builders): geometry (circle, rect, line, arrow, path, polygon, arc, brace), text, TeX
equations with term-by-term transforms, counters, axes/number lines/graphs/areas, coordinate planes with linear
transformations, vectors, bars, networks, deterministic particle systems, images, a free camera, and the verbs in
docs/SCENE_SPEC.md. Beyond the built-ins, and just as valid: custom components with their own verbs, per-scene hooks
(arbitrary GSAP choreography), ManimCE scenes, and whole hand-written HTML scenes (3D, other runtimes). Nothing in the
plan has to be expressible with built-ins.`;

const buildLoop = (job, ids) => {
  const jobRel = path.relative(ROOT, job);
  return `Read \`${path.join(ROOT, 'docs/SCENE_SPEC.md')}\` completely before writing your first scene. Then, for each scene in order:
1. Write \`${rel(job, 'shots/<scene>.json')}\` (plus any hook, components or Manim file it needs). Plan many short
   coordinated actions (0.2–2 s) so the mechanism operates, consequences follow causes, and the payoff lands. Start
   major actions at their spoken cue; supporting actions can anticipate or finish after.
2. \`cd ${ROOT} && ${CMD} build --job ${jobRel} --scene <scene>\` validates, runs the scene in a browser, and prints
   errors, warnings and a motion transcript of what is actually on screen. Errors mean the film is broken: fix them all.
   Warnings are house-style advice: fix them, or keep the choice deliberately and explain it in "notes".
3. Read the motion transcript: do the events tell the mechanism, in order, at the right words?
4. If you can view images: \`${CMD} snapshot --job ${jobRel} --scene <scene>\` writes frames to
   \`${rel(job, 'review/snapshots/')}\`. Look at them and fix layout, scale and clutter.
${ids.length > 1 ? `Scenes, in order: ${ids.join(', ')}. Finish each before starting the next; later scenes reuse earlier objects.\n` : ''}`;
};

const sceneCard = (film, s, t, alignment) => {
  const next = film.scenes[film.scenes.indexOf(s) + 1], opt = (label, v) => v ? `- ${label}: ${Array.isArray(v) ? v.join(' → ') : v}\n` : '';
  return `### ${s.id} (${t.start.toFixed(2)}–${t.end.toFixed(2)} s)${s.kind === 'html' ? ` — HTML scene, file \`${s.file}\`` : ''}
- Idea: ${s.idea}
${opt('Mechanism', s.mechanism)}${opt('Visible states', s.states)}${opt('Payoff', s.payoff)}${opt('Camera purpose', s.camera)}${opt('Handoff', s.handoff)}${opt('Why a basic drawing/flow is not enough', s.why_not_basic)}- World region: ${s.region ? JSON.stringify(s.region) : 'free (default view centre [960,540], zoom 1)'}
- Carried in from earlier scenes: ${(s.carry || []).join(', ') || '(none)'}
${next ? `- The next scene ("${next.id}") keeps: ${(next.carry || []).join(', ') || '(nothing)'}. Everything else fades out automatically at the handoff.` : '- Final scene: complete the film\'s continuous visual connection.'}

Spoken words (seconds; cue phrases must be copied from here):
\`\`\`
${wordTable(alignment, t.start, t.end)}
\`\`\`
`;
};

export function directorBrief(job, manifest, alignment, {repair = null} = {}) {
  return `# Role: director and lead animator

You conceive the film, write the plan, and build its most important scenes yourself: you have the clearest picture of
what the film should look like, so you do not hand that picture to someone else to guess. Work only inside \`${job}\`.

## Inputs
- Recording: ${manifest.duration.toFixed(2)} s, ${manifest.width}×${manifest.height}. Narration is fixed; never change it.
- Script: \`${rel(job, 'inputs/source-script.md')}\` (may contain visual notes; you are free to ignore them).
- Spoken words with start times (seconds) — the timing authority:

\`\`\`
${wordTable(alignment)}
\`\`\`

${QUALITY}

${TOOLS}

${repair ? `## Director revision required\nThe current concept or scene ownership failed review. Resolve these findings:\n${repair}\nYou may revise anything in film.json: mechanisms, scene boundaries, ownership, carry, the prototype. Rename any scene whose mechanism or ownership changes, so its old shot cannot silently be reused. Then rebuild the scenes you own that the revision touches (part 2). Do not edit reviewer reports.\n` : ''}
## Part 1 — the plan: \`${rel(job, 'film.json')}\`
1. Read the narration. Find the argument, the surprises, and the ideas that need a visible mechanism.
2. Invent at least 2 genuinely different whole-film concepts (different mechanisms/worlds, not colour changes). Pick the
   most inventive one you can make well. Record the others in "alternatives".
3. Split the recording into scenes by idea (typically 6–20 s each). A scene starts at a phrase spoken in the recording.
4. Pick the most demanding 10–15 s scene as "prototype". It and the scenes before it are built and reviewed first;
   later scenes wait until the prototype is accepted.
5. Decide who builds each scene with "owner":
   - "director" (you): the prototype and every scene before it (this is the default), plus any later scene whose look
     you can see but would struggle to put into words. A fresh director with your film.json builds those later ones.
   - "builder": scenes a capable animator can make from a written intent, typically ones that reuse established subjects
     (the default after the prototype). Builders have full creative authority over their scenes: describe the idea
     and the effect you want; they choose how.
6. Name recurring subjects with ids; list in each scene's "carry" which earlier subjects stay on screen. Optionally give
   each scene a "region" of the world (camera centre/zoom) so scenes live in one continuous space.

Required: version, title, concept, prototype, scenes[].id, scenes[].start, scenes[].idea. Everything else is
recommended; the more a builder must make your vision, the more of it you should write down.

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
      "owner": "director",
      "idea": "What the narration says here, in one sentence",
      "mechanism": "The visible operation: what parts exist, what acts on what, what changes",
      "states": ["initial condition", "operation", "consequence", "payoff"],
      "payoff": "The visible result that completes the explanation",
      "camera": "Why the camera moves (reveal a hidden layer, follow a cause, show a limit, change scale) or 'static: reason'",
      "handoff": "Which object/relationship carries into the next scene and how",
      "carry": [],
      "region": {"center": [960, 540], "zoom": 1},
      "why_not_basic": "What a plain drawing / reveal / flow would fail to show",
      "alternatives": ["another mechanism considered for this scene and why not"]
    },
    {"id": "bottleneck", "start": {"phrase": "exact words spoken here"}, "...": "..."},
    {"id": "recap", "start": {"phrase": "..."}, "kind": "html", "file": "compositions/recap.html", "...": "..."}
  ]
}
\`\`\`

"start" of every scene after the first is {"phrase": "<words copied exactly from the word table>"} (add
"occurrence": 2 if those words were already spoken earlier). Scenes are ordered by time and cover the whole recording.
Run \`cd ${ROOT} && ${CMD} plan-check --job ${path.relative(ROOT, job)}\`. Fix every error; warnings are advice.

## Part 2 — build your scenes
Build every scene you own, in order, up to and including the prototype. Stop there: do not build scenes after the
prototype yet, and do not build "builder" scenes (other agents do; if a builder scene comes before your prototype,
stop at it and reply — you will be called back after it is built). You own film.json: if building shows the plan
should change, change it and run plan-check again.

${buildLoop(job, [])}
Reply with one line: "film.json ready; built <scene ids>" plus anything you could not fix.
`;
}

/** A director builds or repairs the scenes it owns (later scenes, unfinished prototype work, or review repairs). */
export function directorSceneBrief(job, manifest, film, timingScenes, alignment, {repair = null} = {}) {
  const ids = timingScenes.map(t => t.id), cards = timingScenes.map(t => sceneCard(film, film.scenes.find(s => s.id === t.id), t, alignment)).join('\n');
  return `# Role: director and lead animator — ${repair ? 'repair' : 'build'} ${ids.join(', ')}

You are the director of this film. The plan in \`${rel(job, 'film.json')}\` is yours (concept: ${film.concept}).
${repair ? 'Fix the findings below in the scenes you own.' : 'Build the scenes below, which you kept for yourself because their look is hard to put into words.'}
Work only inside \`${job}\`. Read film.json and \`${rel(job, 'STORYBOARD.md')}\` first, and look at the shots of
earlier scenes your scenes continue from.

You may edit your scenes' files (\`shots/<scene>.json\`, \`.hook.js\`, components, Manim files, HTML scenes) and
film.json${repair ? ', except scene boundaries and ownership of scenes you do not own (other agents may be repairing them right now)' : ''}. If a change to film.json moves
scene boundaries, run plan-check; scenes built by others that break are sent back to them automatically.

${QUALITY}

${TOOLS}

## Your scenes
${cards}
${repair ? `## Findings to fix (from independent reviewers and checks)\n${repair}\nFix the cause, not the symptom: if a finding shows your plan for the scene does not work, change the plan.\n\n` : ''}## How to build
${buildLoop(job, ids)}
Reply with one line: "${repair ? 'repaired' : 'built'} ${ids.join(', ')}" plus anything you could not fix.
`;
}

export function builderBrief(job, manifest, film, timingScene, alignment, {repair = null, prior = []} = {}) {
  const s = film.scenes.find(x => x.id === timingScene.id), html = s.kind === 'html';
  const carried = (s.carry || []).map(id => { const p = prior.find(o => o.id === id); return `- \`${id}\`${p ? ` — defined in ${p.file}: ${JSON.stringify(p.spec).slice(0, 400)}` : ' — defined in an earlier scene'}`; }).join('\n') || '- (none)';
  const jobRel = path.relative(ROOT, job);
  const files = html ? `\`${s.file}\`` : `\`shots/${s.id}.json\`, \`shots/${s.id}.hook.js\`, \`manim/${s.id}*.py\` and new files in \`components/\``;
  return `# Role: scene builder — scene "${s.id}"

You build ONE scene of the film and you have complete creative authority over it. Work only inside \`${job}\`.
Other agents build other scenes: edit only ${files}.

## Your authority
The director's plan below is intent, not a contract. You decide how this scene looks and moves: the mechanism, layout,
states, camera and tools are yours to change if you find a better way to make the viewer see the idea. Keep three
things: the narrated idea, the spoken timing, and the subjects the next scene keeps (define or keep them under those
ids). Built-ins, hooks, custom components and Manim are equally valid; use whatever shows the idea best. (Turning
the scene into a hand-written HTML scene changes film.json, which only the director edits: say so in "notes" and reviewers can send it to the director.)
Record any deliberate departure from the plan or the house style in ${html ? 'an HTML comment at the top of your file' : 'the shot\'s "notes" field'} (one or two sentences),
so reviewers judge your choice rather than the old plan.

## The director's plan
- Film concept: ${film.concept}
- Palette meanings: ${JSON.stringify(film.palette || {})}
- Subjects still on screen from earlier scenes (reuse these ids; do not redefine them):
${carried}

${sceneCard(film, s, timingScene, alignment)}
${QUALITY}

${TOOLS}

## How to build
${html ? `This is a hand-written HyperFrames composition: write \`${rel(job, s.file)}\` following the hyperframes-core skill and the "HTML scenes" section of \`${path.join(ROOT, 'docs/SCENE_SPEC.md')}\`. It is layered over the world for ${timingScene.start.toFixed(2)}–${timingScene.end.toFixed(2)} s. Then run \`cd ${ROOT} && ${CMD} build --job ${jobRel}\` and fix every error it prints.\n` : buildLoop(job, [s.id])}${repair ? `\n## Repair findings to fix (from independent reviewers and checks)\n${repair}\n` : ''}
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

## What you judge against
${QUALITY}

Builders have creative authority: STORYBOARD.md records the director's intent and each scene's notes record deliberate
departures. Judge whether the film makes the narration understood, not whether it matches the plan or every guideline.
A broken guideline is blocking only when it hurts understanding or truth; otherwise it is at most advisory.
Automated-check warnings are leads to inspect, not verdicts.

Blocking: a central idea without a visible operation/consequence/payoff; unsupported numbers or claims; picture
contradicts the narration; unreadable essential labels; collisions over essential text; competing focus hiding the
mechanism; passages where nothing advances the explanation; broken transformation or handoff; evidence that does not
cover the interval. Advisory: improvements that do not prevent understanding. Do not block on taste.

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
