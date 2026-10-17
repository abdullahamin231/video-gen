// Self-contained role briefs. The host agent hands one file to a fresh sub-agent ("Read <brief> and follow it").
// Briefs carry everything the role needs, so the sub-agent never has to explore the repository.
import path from 'node:path';
import {mkdir, writeFile} from 'node:fs/promises';
import {frameGuide, isVertical} from './format.mjs';

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

const QUALITY = `## Fixed (the pipeline enforces these)
- The recording is fixed. Timing comes from the spoken words; never change the narration.
- Show only numbers and claims the narration or script supports. An explanatory value that is not spoken (an axis
  scale, an illustrative count) is allowed when the object says why: "numbers": "<reason>".
- Deterministic and seek-safe: no randomness, clocks, timers or callbacks (use the kit's seeded rng and cue times).
- ONE design theme for the whole film, declared in film.json "theme" and used by every scene. The director chooses
  which; nothing about the look is prescribed, but every scene must visibly belong to the same film.

## What makes the picture work (guidance, whatever the theme)
Break a guideline only when that makes the film better, and say why in the shot's "notes".
- Show the real thing. When the narration names something concrete (a product, company, device, place, website),
  show it so it is recognised in under a second without its label: a cut-out photo, a logo, or a drawing with its true
  silhouette. Anonymous rectangles with labels are a last resort. Abstract ideas become familiar physical metaphors
  (a shelf with price tags for cost, a SOLD OUT stamp for scarcity, a strike-through for "no longer", a search box
  being typed into for "look it up") and the metaphor acts.
- Big, bold, readable. Few objects, each large (the main subject often a quarter to half of the frame width). Key
  numbers large (64 px+, often 80–140 px); labels ≥ 28 px, values ≥ 40 px on screen; strong contrast; readable at
  480 px wide. On-screen text is prices, names, short labels, verdicts; never the narrated sentence.
- One stage per idea, built up in front of the viewer: the first product lands, then its tag, then the rival, then the
  verdict. Keep the stage framed: clear it, transform it or cut to a new one instead of zooming out to fit more.
  Generous empty space, one focal point, supporting things smaller or dimmed.
- Dynamic: every spoken beat lands as a visible event at its words (arrive, drop, stamp, strike, count, grow, swap,
  transform), one clear event at a time in quick succession. Holds are short (a payoff registers for 1–2 s, then the
  picture moves on). Nothing appears before it is said, and nothing simply appears: every object arrives with motion
  (draws on, drops, pops, slides, types, grows, transforms). Things the narration describes being set up assemble
  part by part on their cues, in the theme's motion language; do not start a scene with them already on screen.
- Motion has one personality, set in the theme (theme.eases) and used everywhere: drops that land, pops that settle,
  swings, stamps, crisp slides, or smooth precise moves. A fade alone says nothing about what happened.
- Explain, do not decorate: each important idea has a visible cause → consequence → payoff. Comparisons stand side
  by side under the same conditions and the difference is visible at a glance. If the same animation would explain an
  unrelated topic by changing labels, it is too generic. Do not explain later passages early.
- Continuity: recurring subjects keep their identity across scenes ("carry"); every transition has a handoff or a
  deliberate clean break.`;

const TOOLS = `Tools (for you and for builders): shapes and paths, text, counters, images (photo cut-outs, logos), TeX,
axes/graphs/bars, coordinate planes, networks, deterministic particles, a free camera, and verbs with physical
character (drop, pop, stamp, swing, strike, type, shake) next to create/write/move/transform/count/grow/focus — all in
docs/SCENE_SPEC.md. The film's theme tokens (colours, fonts, stroke, corners, shadow, label style, eases, per-type
defaults) are applied by the kit automatically. Beyond the built-ins, and just as valid: custom components with their
own verbs, per-scene hooks (arbitrary GSAP choreography), ManimCE scenes, and whole hand-written HTML scenes (3D, other
runtimes).

Assets (images, logos, fonts, drawings, components) — every film adds to a shared library that later films reuse.
Run these commands from \`${ROOT}\`:
- Look in the library FIRST: \`${CMD} library-search --query "<what you need>"\` (e.g. "gpu", "price tag", "server
  rack"). If a match fits, \`${CMD} library-use --item <id@version> --job <job>\` copies it into
  assets/library/... and prints how to use it. Restyle it through the theme rather than redrawing it.
- Otherwise bring it in: \`${CMD} asset --job <job> --src <url|file> --name <name>.png --note "<what it shows>" --tags "<search words>"\`.
  It lands in the job's assets/ with its source recorded AND is saved to the library automatically. Never keep
  downloads in /tmp or another scratch folder. Web URLs are SVG-only by default (a raster png/jpg/webp/gif from a URL
  is refused unless the person enabled VG_ALLOW_WEB_IMAGES=1); a local raster file is always accepted.
- Anything you MAKE that could be shown again — a drawn illustration (save SVG drawings as files in assets/ and show them
  with an image object), a component (components/<type>.js), a Manim scene — save it as soon as it works:
  \`${CMD} save --job <job> --file <path in the job> --title "<what it is>" --tags "<search words>"\`. Good titles and
  tags are what let the next film find it. (Anything left unsaved is saved automatically before review, with weaker
  descriptions.)
- Backgrounds: prefer images that already have none (press-kit PNGs, product renders); key out a plain white or black
  studio background with the image's "knockout"; or present the photo deliberately with "frame". If you can browse the
  web, find a direct SVG URL (raster URLs are refused unless the person enabled them); otherwise draw the object in the
  theme's style (and save the drawing).

Sound (read \`${path.join(ROOT, 'docs/sound.md')}\`) — nobody here can hear, so every sound decision rests on a measurement:
- Every cut and big move (camera move, drop, stamp, transformation, a title appearing) gets ONE ready-made sound
  effect in its shot's "sounds": whoosh for movement and cuts, pop for things appearing, click for clicks and stamps,
  typing for typing. Take them from the library (\`${CMD} library-search --query "sfx whoosh"\`, then library-use;
  each bundle's sounds.json lists its variants with length and loudest moment). Never make sounds in code. If no variant
  fits, leave the move silent and explain why in the shot's notes.
- The voice is the loudest thing. The build measures every sound against the narration and prints the "volume"
  that keeps it 6 dB under the voice: use it, or move the sound into a pause. With music, it also prints which
  moves miss the beat: nudge an action's "at" offset onto the beat where the narration allows.
- Report measured levels and timing; never say something "sounds good".`;

const buildLoop = (job, ids) => {
  const jobRel = path.relative(ROOT, job);
  return `Read \`${path.join(ROOT, 'docs/SCENE_SPEC.md')}\` completely before writing your first scene. Then, for each scene in order:
1. Write \`${rel(job, 'shots/<scene>.json')}\` (plus any hook, components or Manim file it needs). Give every spoken
   beat its visible event at its cue (an arrival, a verdict, a count, a transformation), so consequences follow causes
   and the payoff lands; then let the picture hold while the narrator explains it. Supporting actions can anticipate
   or finish after the cue. Use the theme's colour and font names and let its defaults do the styling.
2. \`cd ${ROOT} && ${CMD} build --job ${jobRel} --scene <scene>\` validates, runs the scene in a browser, and prints
   errors, warnings and a motion transcript of what is actually on screen. Errors mean the film is broken: fix them all.
   Warnings are style advice: fix them, or keep the choice deliberately and explain it in "notes".
3. Read the motion transcript: do the events tell the mechanism, in order, at the right words?
4. Add the scene's "sounds" (one per cut and big move, see "Sound") and rebuild until no sound warns about the voice.
   Read \`${rel(job, 'review/sounds.md')}\`: every effect has a visible cause at its moment.
5. Save anything reusable you made for this scene (a drawing, a component, a Manim scene) with \`${CMD} save --job ${jobRel}
   --file <path> --title "..." --tags "..."\`.
6. If you can view images: \`${CMD} snapshot --job ${jobRel} --scene <scene>\` writes frames to
   \`${rel(job, 'review/snapshots/')}\`. Look at them as a viewer would: is every subject recognisable, large and
   readable at phone size, does each frame look like the same film (the theme), is there one focal point? Fix it.
${ids.length > 1 ? `Scenes, in order: ${ids.join(', ')}. Finish each before starting the next; later scenes reuse earlier objects.\n` : ''}`;
};

const sceneCard = (film, s, t, alignment, manifest) => {
  const next = film.scenes[film.scenes.indexOf(s) + 1], opt = (label, v) => v ? `- ${label}: ${Array.isArray(v) ? v.join(' → ') : v}\n` : '';
  const camera = {center: [manifest.width / 2, manifest.height / 2], zoom: 1, rotate: 0, ...film.camera};
  return `### ${s.id} (${t.start.toFixed(2)}–${t.end.toFixed(2)} s)${s.kind === 'html' ? ` — HTML scene, file \`${s.file}\`` : ''}
- Idea: ${s.idea}
${opt('Mechanism', s.mechanism)}${opt('Assets', s.assets)}${opt('Visible states', s.states)}${opt('Payoff', s.payoff)}${opt('Camera purpose', s.camera)}${opt('Handoff', s.handoff)}${opt('Why a basic drawing/flow is not enough', s.why_not_basic)}- World region: ${s.region ? JSON.stringify(s.region) : s.inheritCamera ? 'explicitly inherits the preceding camera pose' : `free (default view centre [${camera.center}], zoom ${camera.zoom}, rotation ${camera.rotate}; reset at scene start unless your camera action owns the boundary)`}
- Carried in from earlier scenes: ${(s.carry || []).join(', ') || '(none)'}
${next ? `- The next scene ("${next.id}") keeps: ${(next.carry || []).join(', ') || '(nothing)'}. Everything else fades out automatically at the handoff.` : '- Final scene: complete the film\'s continuous visual connection.'}

Spoken words (seconds; cue phrases must be copied from here):
\`\`\`
${wordTable(alignment, t.start, t.end)}
\`\`\`
`;
};

export function directorBrief(job, manifest, alignment, {repair = null, planErrors = null} = {}) {
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

${frameGuide(manifest)}

${QUALITY}

${TOOLS}

${repair ? `## Director revision required\nThe current concept or scene ownership failed review. Resolve these findings:\n${repair}\nYou may revise anything in film.json: mechanisms, scene boundaries, ownership, carry, the prototype. Rename any scene whose mechanism or ownership changes, so its old shot cannot silently be reused. Then rebuild the scenes you own that the revision touches (part 2). Do not edit reviewer reports.\n` : ''}
${planErrors?.length ? `## film.json already exists but fails plan-check\nKeep what works and fix these (shots that already exist keep working when their scene ids stay):\n${planErrors.map(e => '- ' + e).join('\n')}\n\n` : ''}## Part 1 — the plan: \`${rel(job, 'film.json')}\`
0. Read \`${path.join(ROOT, 'docs/quality.md')}\` completely: it is the standard the reviewers apply.
1. Read the narration. Find the argument, the surprises, the concrete things it names (products, companies, places)
   and the ideas that need a visible event or metaphor.
2. Choose the film's ONE design theme. Any look is allowed; pick what best fits this topic, audience and narrator's
   voice. Consider at least two genuinely different themes; record the loser in theme.rejected. Write "theme" with
   a description a builder could follow without seeing anything (imagery language, surfaces, line weight, shapes, type,
   colour meanings, motion personality, composition) and the tokens the kit applies (see "The design theme" in
   \`${path.join(ROOT, 'docs/SCENE_SPEC.md')}\`). Shared choices go into tokens and "defaults" so builders inherit them.
   Design the theme for THIS film: the placeholders below and the examples in the docs show the format, not a look.
3. Collect the assets the theme needs: images of the real things the narration names, logos, icons, font files. For each
   one, search the library first (\`${CMD} library-search --query "<thing>"\`, then \`${CMD} library-use --item <id@version>
   --job ${path.relative(ROOT, job)}\`); only if nothing fits, bring it in with \`${CMD} asset --job ${path.relative(ROOT, job)}
   --src <url|file> --name <name>.png --note "<what it shows>" --tags "<search words>"\` (saved to the library too).
   Whatever you draw or build yourself, save with \`${CMD} save\` (see "Assets" above). Prefer transparent PNGs or plain studio shots; decide per image whether it is shown cut out (transparent, or a
   plain background removed with "knockout") or as a framed photo ("frame"), and keep that choice consistent with the
   theme. Look at each one; reject watermarked, blurry or wrong images. Note in each scene which assets it uses.
3b. Choose the music (docs/sound.md): ${manifest.music ? `the person supplied ${manifest.music}: use it` : `a track under Mixkit's free licence (https://mixkit.co/free-stock-music/; pick by the film's mood and tempo) unless the film is better without music, then say why in "concept"`}.
   Bring it in with \`${CMD} music --job ${path.relative(ROOT, job)} --src <mp3 url or file> --name music/<name>.mp3 --title "<title (artist)>" --source "<its page>" --license "<licence named there>"\`,
   LOOK at the beat plot it writes (the red grid must sit on the low-end hits), and set film.json "music". The build
   tells you the "trackStart" that lands the most cuts on the beat.
4. Invent at least 2 genuinely different whole-film concepts (different worlds and metaphors, not colour changes).
   Pick the strongest one you can make well. Record the others in "alternatives".
5. Split the recording into scenes by idea (typically 6–20 s each). A scene starts at a phrase spoken in the recording.
6. Pick the most demanding 10–15 s scene as "prototype". It and the scenes before it are built and reviewed first;
   later scenes wait until the prototype is accepted.
7. Decide who builds each scene with "owner":
   - "director" (you): the prototype and every scene before it (this is the default), plus any later scene whose look
     you can see but would struggle to put into words. A fresh director with your film.json builds those later ones.
   - "builder": scenes a capable animator can make from a written intent, typically ones that reuse established subjects
     (the default after the prototype). Builders have full creative authority over their scenes: describe the idea
     and the effect you want; they choose how.
8. Name recurring subjects with ids; list in each scene's "carry" which earlier subjects stay on screen. Optionally give
   each scene a "region" of the world (camera centre/zoom).

Required: version, title, concept, theme (name, description, bg, colors), prototype, scenes[].id, scenes[].start,
scenes[].idea. Everything else is recommended; the more a builder must make your vision, the more you write down.

\`\`\`json
{
  "version": 2,
  "title": "Short film title",
  "concept": "The continuous visual world and through-line, e.g. 'a single memory bus seen at three scales...'",
  "alternatives": [
    {"concept": "A different whole-film mechanism", "rejected": "why it explains less"},
    {"concept": "Another", "rejected": "why"}
  ],
  "theme": {
    "name": "Short name of the look",
    "description": "Several sentences: how real things and abstract ideas are pictured, surfaces and shadows, line weight, shapes, typography, what each colour means, how things move, how frames are composed.",
    "rejected": "Another theme you considered and why it lost",
    "bg": "<background colour>",
    "colors": {"white": "<default ink>", "grey": "<hex>", "dim": "<hex>", "faint": "<hex>", "blue": "<hex>", "yellow": "<hex>", "red": "<hex>", "green": "<hex>", "<your own name>": "<hex>"},
    "meanings": {"<colour name>": "what this colour means everywhere in this film"},
    "fonts": {"sans": "<bundled family>", "mono": "<bundled family>", "display": "<bundled family>"},
    "stroke": "<px>", "corner": "<px>", "fillOpacity": "<0..1>",
    "shadow": {"dx": "<px>", "dy": "<px>", "blur": "<px>", "color": "<colour>", "opacity": "<0..1>"},
    "label": {"font": "<role>", "weight": "<100..900>", "size": "<px>", "upper": "<true|false>"},
    "eases": {"out": "<named or GSAP ease for every entrance>"},
    "defaults": {"<object type>": {"<field>": "<value every object of this type gets>"}}
  },
  "subjects": [{"id": "shelf", "what": "the store shelf every product is compared on"}],
  "prototype": "bottleneck",
  "scenes": [
    {
      "id": "opening",
      "start": {"boundary": "start"},
      "owner": "director",
      "idea": "What the narration says here, in one sentence",
      "mechanism": "The visible events: what is on the stage, what arrives or acts at which words, what changes",
      "states": ["initial condition", "operation", "consequence", "payoff"],
      "payoff": "The visible result that completes the explanation",
      "camera": "Why the camera moves (reveal a hidden layer, follow a cause, show a limit, change scale) or 'static: reason'",
      "handoff": "Which object/relationship carries into the next scene and how",
      "carry": [],
      "region": {"center": [${manifest.width / 2}, ${manifest.height / 2}], "zoom": 1},
      "why_not_basic": "What a labelled box, a sentence on screen or a plain fade would fail to show",
      "assets": ["assets/dgx-spark.png"],
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
  const ids = timingScenes.map(t => t.id), cards = timingScenes.map(t => sceneCard(film, film.scenes.find(s => s.id === t.id), t, alignment, manifest)).join('\n');
  return `# Role: director and lead animator — ${repair ? 'repair' : 'build'} ${ids.join(', ')}

You are the director of this film. The plan in \`${rel(job, 'film.json')}\` is yours (concept: ${film.concept}).
${repair ? 'Fix the findings below in the scenes you own.' : 'Build the scenes below, which you kept for yourself because their look is hard to put into words.'}
Work only inside \`${job}\`. Read film.json and \`${rel(job, 'STORYBOARD.md')}\` first, and look at the shots of
earlier scenes your scenes continue from. Every scene you build stays inside the film's design theme (film.json
"theme"); if the theme itself needs to change, change it in film.json so all scenes move together.

You may edit your scenes' files (\`shots/<scene>.json\`, \`.hook.js\`, components, Manim files, HTML scenes) and
film.json${repair ? ', except scene boundaries and ownership of scenes you do not own (other agents may be repairing them right now)' : ''}. If a change to film.json moves
scene boundaries, run plan-check; scenes built by others that break are sent back to them automatically.

${frameGuide(manifest)}

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
Your scene must look like the rest of the film: stay inside the design theme below. Record any deliberate departure from the plan or the guidance in ${html ? 'an HTML comment at the top of your file' : 'the shot\'s "notes" field'} (one or two sentences),
so reviewers judge your choice rather than the old plan.

## The director's plan
- Film concept: ${film.concept}
- Design theme (applied by the kit; use its colour and font names, never new hex values or typefaces):
\`\`\`json
${JSON.stringify(film.theme || {}, null, 1)}
\`\`\`
- Subjects still on screen from earlier scenes (reuse these ids; do not redefine them):
${carried}

${sceneCard(film, s, timingScene, alignment, manifest)}
${frameGuide(manifest)}

${QUALITY}

${TOOLS}

## How to build
${html ? `This is a hand-written HyperFrames composition: write \`${rel(job, s.file)}\` following the hyperframes-core skill and the "HTML scenes" section of \`${path.join(ROOT, 'docs/SCENE_SPEC.md')}\`. It is layered over the world for ${timingScene.start.toFixed(2)}–${timingScene.end.toFixed(2)} s. Then run \`cd ${ROOT} && ${CMD} build --job ${jobRel}\` and fix every error it prints.\n` : buildLoop(job, [s.id])}${repair ? `\n## Repair findings to fix (from independent reviewers and checks)\n${repair}\n` : ''}
Finish with a one-line reply: "scene ${s.id} built" plus anything you could not fix.
`;
}

export function reviewerBrief(job, role, pack, packPath, packSha256, briefDirections, manifest) {
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
${frameGuide(manifest)}${isVertical(manifest) ? `
Judge it as a phone viewer: essential text or the key subject outside the safe area (hidden behind app chrome), or
an opening second where nothing happens, is blocking when it hurts understanding.` : ''}

${QUALITY}

Builders have creative authority: STORYBOARD.md records the director's intent and each scene's notes record deliberate
departures. Judge whether the film makes the narration understood, not whether it matches the plan or every guideline.
A broken guideline is blocking only when it hurts understanding or truth; otherwise it is at most advisory.
Automated-check warnings are leads to inspect, not verdicts.

The film's design theme (film.json "theme", summarised at the top of STORYBOARD.md) is the director's choice: never
block because you would have chosen another look. Do block when the film does not hold to its own theme.

Blocking: a scene that visibly breaks the film's one theme without a reason that serves the film; a central idea with
no visible event, consequence or payoff (a sentence or labelled box carrying it); a concrete subject the viewer cannot
recognise; unsupported numbers or claims; picture contradicts or runs ahead of the narration; unreadable essential
labels at 480 px; collisions over essential text; competing focus hiding the point; a crowded or shrinking stage that
hides the point; passages where the picture no longer matches what is said; broken transformation or handoff; evidence
that does not cover the interval. Advisory: improvements that do not prevent understanding. Do not block on taste.

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
