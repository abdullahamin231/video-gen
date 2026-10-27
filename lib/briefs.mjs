// Self-contained role briefs. The host agent hands one file to a fresh sub-agent ("Read <brief> and follow it").
// Briefs carry everything the role needs, so the sub-agent never has to explore the repository.
import path from 'node:path';
import {mkdir, writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {frameGuide, isVertical} from './format.mjs';
import {VISUALS_FILE, visualScenes} from './visuals.mjs';
import {readPersonality, personalityBrief} from './personalities.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CMD = 'npm run video --';
const rel = (job, p) => path.join(job, p);
// The script writer's visual plan, if the job has one: the creative direction everyone downstream carries out.
const visualPlan = job => { try { return readFileSync(path.join(job, VISUALS_FILE), 'utf8'); } catch { return ''; } };

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
- Every visible word must remain readable. Separate accidental text/figure collisions; remove redundant labels or redesign the layout. intentionalOverlaps is only for deliberate layering with a specific visual reason and textReadable:true, never to silence a build error or excuse unreadable secondary text.
- The recording is fixed. Timing comes from the spoken words; never change the narration.
- Show only numbers and claims the narration or script supports. An explanatory value that is not spoken (an axis
  scale, an illustrative count) is allowed when the object says why: "numbers": "<reason>".
- Deterministic and seek-safe: no randomness, clocks, timers or callbacks (use the kit's seeded rng and cue times).
- ONE design theme for the whole film, declared in film.json "theme" and used by every scene. When the job has a
  channel theme (inputs/channel-theme.json), the film uses it; a departure is allowed only with its reason in theme
  "channelDepartures". Every scene must visibly belong to the same film.`;

const designFor = job => readPersonality(job).files['DESIGN.md'];
const toolsFor = job => readPersonality(job).files['TOOLS.md'];
const profilePlan = (job, manifest) => `## Part 1 — personality-specific film plan
Follow the frozen personality's DESIGN.md, EDITORIAL.md and REVIEW.md. Its visual grammar is fixed;
choose implementations and story staging within it, not a different genre or visual style.
${visualPlan(job) ? `Read ${rel(job, VISUALS_FILE)} completely and preserve its scene IDs, boundaries, theme, events and prototype.` : 'Read the narration and write a specific visual state, instruction and consequence for each scene.'}
Write film.json using docs/SCENE_SPEC.md for schema, phrase-based timing and object APIs only.
Use its required title/concept/theme/prototype/scenes fields. For this genre the mechanism is the visible narrative
action or rule/consequence, and evidence distinguishes original fiction from factual assertions.
Record alternatives within this personality; explain why unrelated themes were excluded in theme.rejected.
Select a demanding 10–15 second prototype and assign it and earlier scenes to director; later scenes may use builder.
Use original permitted assets in the frozen style. Never import a reference creator's footage/audio or branding.
Keep recurring subjects stable. Record any necessary departure from the approved visual plan.
Use ${manifest.music ? `the supplied music ${manifest.music} only as authorised` : 'sparse original/cleared sound or no music when appropriate'}.
Run npm run video -- plan-check --job ${path.relative(ROOT, job)} and fix its errors.
`;

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

const sceneCard = (film, s, t, alignment, manifest, plan = '') => {
  const direction = plan ? visualScenes(plan).get(s.id) : '';
  const next = film.scenes[film.scenes.indexOf(s) + 1], opt = (label, v) => v ? `- ${label}: ${Array.isArray(v) ? v.join(' → ') : v}\n` : '';
  const camera = {center: [manifest.width / 2, manifest.height / 2], zoom: 1, rotate: 0, ...film.camera};
  return `### ${s.id} (${t.start.toFixed(2)}–${t.end.toFixed(2)} s)${s.kind === 'html' ? ` — HTML scene, file \`${s.file}\`` : ''}
- Idea: ${s.idea}
${opt('Mechanism', s.mechanism)}${opt('Layout', s.layout)}${opt('Hero', s.hero)}${opt('Evidence', s.evidence)}${opt('Assets', s.assets)}${opt('Visible states', s.states)}${opt('Payoff', s.payoff)}${opt('Camera purpose', s.camera)}${opt('Handoff', s.handoff)}${opt('Why a basic drawing/flow is not enough', s.why_not_basic)}- World region: ${s.region ? JSON.stringify(s.region) : s.inheritCamera ? 'explicitly inherits the preceding camera pose' : `free (default view centre [${camera.center}], zoom ${camera.zoom}, rotation ${camera.rotate}; reset at scene start unless your camera action owns the boundary)`}
- Carried in from earlier scenes: ${(s.carry || []).join(', ') || '(none)'}
${next ? `- The next scene ("${next.id}") keeps: ${(next.carry || []).join(', ') || '(nothing)'}. Everything else fades out automatically at the handoff.` : '- Final scene: complete the film\'s continuous visual connection.'}
${direction ? `
The script writer's visual direction for this scene (verbatim from \`${VISUALS_FILE}\`; build this):

${direction}
` : ''}
Spoken words (seconds; cue phrases must be copied from here):
\`\`\`
${wordTable(alignment, t.start, t.end)}
\`\`\`
`;
};

export function newsDirectorBrief(job) {
  return `# Role: news director and editor
Read docs/news.md completely. Follow the frozen news editorial/design/review instructions.
Write news-sources.json (dated factual claims and separate media-rights evidence) and news.json
(actual stills/article views and cleared video in/out, commentary ranges, retained source speech).
Use only owned, supplied/cleared, licensed or public-domain originals; do not download or record
commercial references. Ingest with npm run video -- news-ingest --job ${path.relative(ROOT,job)} --source <id> --file <repository-local file>.
A precise missing-rights/source blocker is a valid result; never fabricate media or substitute cartoons.
All commentary words and retained source speech require reviewed word times. Build derives mandatory
subtitles and validates coverage, clipping, speech overlap and source offsets. Keep supplied audio intact.
For politics retain the bottom-left circular presenter only when an actual authorised recording is available.
Run npm run video -- news-check --job ${path.relative(ROOT,job)} and fix actionable errors.
Reply with files written, cleared source evidence, unresolved source prerequisites and validation result.
`;
}

export function directorBrief(job, manifest, alignment, {repair = null, planErrors = null} = {}) {
  if (readPersonality(job).profile.workflow === 'news-edit') return newsDirectorBrief(job) + (repair ? `\n## Repair findings\n${repair}\n` : '') + (planErrors ? `\n## Plan errors\n${planErrors.join('\n')}\n` : '');
  const plan = visualPlan(job);
  return `# Role: director and lead animator

${plan ? `You turn the script writer's visual plan into the film plan (film.json) and build the film's most important
scenes yourself. The creative decisions are already made in the visual plan: the concept, the design theme, every
scene's stage, events and payoff. Your job is to carry them out faithfully and well, not to replace them.` : `You conceive the film, write the plan, and build its most important scenes yourself: you have the clearest picture of
what the film should look like, so you do not hand that picture to someone else to guess.`} Work only inside \`${job}\`.

## Inputs
- Recording: ${manifest.duration.toFixed(2)} s, ${manifest.width}×${manifest.height}. Narration is fixed; never change it.
- Script: \`${rel(job, 'inputs/source-script.md')}\`${plan ? '.' : ' (may contain visual notes; you are free to ignore them).'}${plan ? `
- Visual plan: \`${rel(job, VISUALS_FILE)}\`, written by the script writer. It is the creative direction for the
  whole film. Read all of it before anything else.` : ''}
- Spoken words with start times (seconds) — the timing authority:

\`\`\`
${wordTable(alignment)}
\`\`\`

${frameGuide(manifest)}

${QUALITY}

${designFor(job)}

${toolsFor(job)}

${repair ? `## Director revision required\nThe current concept or scene ownership failed review. Resolve these findings:\n${repair}\nYou may revise anything in film.json: mechanisms, scene boundaries, ownership, carry, the prototype. Rename any scene whose mechanism or ownership changes, so its old shot cannot silently be reused. Then rebuild the scenes you own that the revision touches (part 2). Do not edit reviewer reports.${plan ? ' Keep the visual plan\'s concept and theme unless a finding shows they cannot work; fix the failing scenes within its intent, and list each change in "departures".' : ''}\n` : ''}
${planErrors?.length ? `## film.json already exists but fails plan-check\nKeep what works and fix these (shots that already exist keep working when their scene ids stay):\n${planErrors.map(e => '- ' + e).join('\n')}\n\n` : ''}${plan ? transcribePlan(job, manifest) : inventPlan(job, manifest)}
${filmExample(job, manifest)}

## Part 2 — build your scenes
Build every scene you own, in order, up to and including the prototype. Stop there: do not build scenes after the
prototype yet, and do not build "builder" scenes (other agents do; if a builder scene comes before your prototype,
stop at it and reply — you will be called back after it is built). You own film.json: if building shows the plan
should change, change it and run plan-check again.

${buildLoop(job, [])}
Reply with one line: "film.json ready; built <scene ids>" plus anything you could not fix.
`;
}

// Part 1 when the script writer left a visual plan: carry its decisions into film.json.
const transcribePlan = (job, manifest) => {
  if (readPersonality(job).profile.id !== 'explainer') return profilePlan(job, manifest);
  const J = path.relative(ROOT, job);
  return `## Part 1 — the plan: \`${rel(job, 'film.json')}\`, from the visual plan
0. Read \`${rel(job, VISUALS_FILE)}\` completely, then \`${path.join(ROOT, 'docs/quality.md')}\` (the standard the reviewers apply).
1. Copy the plan into film.json, field by field:
   | visual plan | film.json |
   |---|---|
   | "# Visual plan: <title>" | "title" |
   | "## Concept" | "concept" |
   | "## Alternatives considered" | "alternatives": [{"concept", "rejected"}] |
   | "## Theme" JSON block | "theme", exactly as written (fix only what plan-check rejects) |
   | "## Recurring subjects" | "subjects": [{"id", "what"}] |
   | "## Prototype" | "prototype" |
   | each "### <scene-id>" | one entry in "scenes", with that same "id" (builders receive the plan's section by id) |
   | Starts at | "start": {"phrase": "<those words>"} ({"boundary": "start"} for the first scene) |
   | Idea | "idea" |
   | Stage + Events | "mechanism" (keep the quoted words and the order) |
   | Layout / Hero / Evidence | "layout" / "hero" / "evidence" (where things sit in the frame, the beat's big number, the source cards) |
   | Events, one per item | "states" (a short name for each visible state) |
   | Payoff / Camera / Handoff / Carry / Why not basic | "payoff" / "camera" / "handoff" / "carry" / "why_not_basic" |
   | Assets | "assets" (the files you bring in for it, step 2) |
   Keep the plan's wording; do not summarise it into something vaguer.
2. Bring in each asset the plan names: search the library first (\`${CMD} library-search --query "<thing>"\`, then
   \`${CMD} library-use --item <id@version> --job ${J}\`). Logos: an SVG with \`${CMD} asset --job ${J}
   --src <svg url|file> --name <name>.svg --note "<what it shows>" --tags "<search words>"\`. Everything else the plan
   names you draw as an SVG in the theme's style (true silhouette, identifying details) and save with \`${CMD} save\`.
   No photos. Look at each drawing at phone size; it must be recognisable without its label.
3. Music: ${manifest.music ? `the person supplied ${manifest.music}: use it` : `follow the plan's "## Music" section (Mixkit free licence, https://mixkit.co/free-stock-music/), or none if it says none`}.
   Bring it in with \`${CMD} music --job ${J} --src <mp3 url or file> --name music/<name>.mp3 --title "<title (artist)>" --source "<its page>" --license "<licence named there>"\`,
   LOOK at the beat plot it writes (the red grid must sit on the low-end hits), and set film.json "music".
4. Ownership ("owner"): "director" (you) for the prototype and every scene before it; "builder" for later scenes.
5. Run \`cd ${ROOT} && ${CMD} plan-check --job ${J}\` and fix every error. A start phrase that is not in the recording:
   pick the nearest words from the word table above. Warnings are advice.
Where the plan cannot be built as written (a phrase is not spoken, the toolset cannot do it, an asset cannot be
found), make the smallest change that keeps its intent and list each one in film.json "departures": ["<scene>: <what
and why>"]. Do not invent a different concept, theme or scene design.
`;
};

// Part 1 without a visual plan: the director conceives the film.
const inventPlan = (job, manifest) => readPersonality(job).profile.id !== 'explainer' ? profilePlan(job, manifest) : `## Part 1 — the plan: \`${rel(job, 'film.json')}\`
0. Read \`${path.join(ROOT, 'docs/quality.md')}\` completely: it is the standard the reviewers apply.
1. Read the narration. Find the argument, the surprises, the concrete things it names (products, companies, places)
   and the ideas that need a visible event or metaphor.
2. Choose the film's ONE design theme. If \`${rel(job, 'inputs/channel-theme.json')}\` exists, that is the theme: copy
   it into film.json "theme" and change a token only when this film truly needs it, saying why in
   "channelDepartures". Otherwise any look is allowed; pick what best fits this topic, audience and narrator's
   voice. Consider at least two genuinely different themes; record the loser in theme.rejected. Write "theme" with
   a description a builder could follow without seeing anything (imagery language, surfaces, line weight, shapes, type,
   colour meanings, motion personality, composition) and the tokens the kit applies (see "The design theme" in
   \`${path.join(ROOT, 'docs/SCENE_SPEC.md')}\`). Shared choices go into tokens and "defaults" so builders inherit them.
   Design the theme for THIS film: the placeholders below and the examples in the docs show the format, not a look.
3. Collect the assets the theme needs: drawings of the real things the narration names, logos, font files. For each
   one, search the library first (\`${CMD} library-search --query "<thing>"\`, then \`${CMD} library-use --item <id@version>
   --job ${path.relative(ROOT, job)}\`). Logos come in as SVG with \`${CMD} asset --job ${path.relative(ROOT, job)}
   --src <svg url|file> --name <name>.svg --note "<what it shows>" --tags "<search words>"\` (saved to the library too).
   Everything else you draw as SVG in the theme's style and save with \`${CMD} save\` (see "Assets" above). No photos.
   Look at each drawing at phone size. Note in each scene which assets it uses, where its hero number sits and which
   source it shows (layout, hero, evidence).
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

`;

// The film.json format, for both ways of writing it.
const filmExample = (job, manifest) => `Required: version, title, concept, theme (name, description, bg, colors), prototype, scenes[].id, scenes[].start,
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
      "layout": "Where things sit: main subject in the left third, hero number top right, source card bottom right",
      "hero": "The one element that dominates this beat, e.g. '$3,999' hero, 180 px, yellow",
      "evidence": "Source cards or sheets with their exact words and source chip, or 'none'",
      "assets": ["assets/dgx-spark.svg"],
      "alternatives": ["another mechanism considered for this scene and why not"]
    },
    {"id": "bottleneck", "start": {"phrase": "exact words spoken here"}, "...": "..."},
    {"id": "recap", "start": {"phrase": "..."}, "kind": "html", "file": "compositions/recap.html", "...": "..."}
  ]
}
\`\`\`

"start" of every scene after the first is {"phrase": "<words copied exactly from the word table>"} (add
"occurrence": 2 if those words were already spoken earlier). Scenes are ordered by time and cover the whole recording.
Run \`cd ${ROOT} && ${CMD} plan-check --job ${path.relative(ROOT, job)}\`. Fix every error; warnings are advice.`;

/** A director builds or repairs the scenes it owns (later scenes, unfinished prototype work, or review repairs). */
export function directorSceneBrief(job, manifest, film, timingScenes, alignment, {repair = null} = {}) {
  const plan = visualPlan(job), ids = timingScenes.map(t => t.id), cards = timingScenes.map(t => sceneCard(film, film.scenes.find(s => s.id === t.id), t, alignment, manifest, plan)).join('\n');
  return `# Role: director and lead animator — ${repair ? 'repair' : 'build'} ${ids.join(', ')}

You are the director of this film. The plan in \`${rel(job, 'film.json')}\` is yours (concept: ${film.concept}).
${repair ? 'Fix the findings below in the scenes you own.' : plan ? 'Build the scenes below, following the script writer\'s visual direction for each.' : 'Build the scenes below, which you kept for yourself because their look is hard to put into words.'}
Work only inside \`${job}\`. Read film.json and \`${rel(job, 'STORYBOARD.md')}\` first, and look at the shots of
earlier scenes your scenes continue from. Every scene you build stays inside the film's design theme (film.json
"theme"); if the theme itself needs to change, change it in film.json so all scenes move together.

You may edit your scenes' files (\`shots/<scene>.json\`, \`.hook.js\`, components, Manim files, HTML scenes) and
film.json${repair ? ', except scene boundaries and ownership of scenes you do not own (other agents may be repairing them right now)' : ''}. If a change to film.json moves
scene boundaries, run plan-check; scenes built by others that break are sent back to them automatically.

${frameGuide(manifest)}

${QUALITY}

${designFor(job)}

${toolsFor(job)}

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
  const jobRel = path.relative(ROOT, job), plan = visualPlan(job), direction = plan && visualScenes(plan).has(s.id);
  const files = html ? `\`${s.file}\`` : `\`shots/${s.id}.json\`, \`shots/${s.id}.hook.js\`, \`manim/${s.id}*.py\` and new files in \`components/\``;
  return `# Role: scene builder — scene "${s.id}"

${readPersonality(job).profile.id === 'explainer' ? 'You build ONE scene of the film and you have complete creative authority over it.' : "You build ONE scene of the film. Your implementation choices must stay within the frozen personality's design and approved visual plan."} Work only inside \`${job}\`.
Other agents build other scenes: edit only ${files}.

## Your authority
${direction ? `The script writer's visual direction below is the creative design of this scene: build what it describes, at
the words it names. Departing from it is allowed only where it cannot be built as written or a check or reviewer shows
it does not work; then make the smallest change that keeps its intent. You choose the implementation details: exact
positions, sizes, tools and timing offsets. Keep three things:` : `The director's plan below is intent, not a contract. You decide how this scene looks and moves: the mechanism, layout,
states, camera and tools are yours to change if you find a better way to make the viewer see the idea. Keep three
things:`} the narrated idea, the spoken timing, and the subjects the next scene keeps (define or keep them under those
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

${sceneCard(film, s, timingScene, alignment, manifest, plan)}
${frameGuide(manifest)}

${QUALITY}

${designFor(job)}

${toolsFor(job)}

## How to build
${html ? `This is a hand-written HyperFrames composition: write \`${rel(job, s.file)}\` following the hyperframes-core skill and the "HTML scenes" section of \`${path.join(ROOT, 'docs/SCENE_SPEC.md')}\`. It is layered over the world for ${timingScene.start.toFixed(2)}–${timingScene.end.toFixed(2)} s. Then run \`cd ${ROOT} && ${CMD} build --job ${jobRel}\` and fix every error it prints.\n` : buildLoop(job, [s.id])}${repair ? `\n## Repair findings to fix (from independent reviewers and checks)\n${repair}\n` : ''}
Finish with a one-line reply: "scene ${s.id} built" plus anything you could not fix.
`;
}

/** A supplied script arrived without a visual plan: the script writer (the strong model) writes one. */
export function visualsBrief(job, manifest, alignment, {errors = []} = {}) {
  const skill = path.join(ROOT, '.claude/skills/script-writing');
  return `# Role: script writer — the visual plan for an existing script

This film's narration already exists and is fixed. Write its visual plan: the creative direction every later agent
carries out. They run on a weaker model and build what you describe, so the plan holds the film's creative thinking.

## Inputs
- Script: \`${rel(job, 'inputs/source-script.md')}\`. Never change it, and never write narration.
- Recording: ${manifest.duration.toFixed(2)} s, ${manifest.width}×${manifest.height}${manifest.music ? `; the person supplied the music ${manifest.music}` : ''}.${manifest.channelTheme ? `
- Channel theme: \`${rel(job, manifest.channelTheme.path)}\`. Copy it into the plan's "## Theme" JSON block; change a
  token only when this film truly needs it, and say why in "channelDepartures".` : ''}
- Spoken words with start times (seconds). Copy scene starts and event phrases from here, because the recording is what
  the film is timed to:

\`\`\`
${wordTable(alignment)}
\`\`\`

${frameGuide(manifest)}

## What to do
1. Read \`${path.join(skill, 'references/visuals.md')}\` completely, including "For a supplied script", then the files it
   names for file structure and technical schema. The frozen personality's DESIGN.md and REVIEW.md own visual direction;
   docs/quality.md and the explainer examples apply as design instructions only to explainer projects.
2. Write the plan to \`${rel(job, VISUALS_FILE)}\` in exactly the structure that reference gives.
${errors.length ? `3. The existing plan there is incomplete. Fix these and keep what works:\n${errors.map(e => '   - ' + e).join('\n')}\n` : ''}
Work only in that one file. Do not create film.json or shots; the director does. Show no number or claim the narration
does not support. Reply with one line: "visual plan ready: <n> scenes, prototype <id>".
`;
}

export function reviewerBrief(job, role, pack, packPath, packSha256, briefDirections, manifest) {
  const jobRel = path.relative(ROOT, job), incoming = rel(job, `review/${pack.stage}/incoming`);
  const appReview = readPersonality(job).profile.id === 'app-review';
  return `# Role: independent reviewer — ${role}

You did not make this film and you must not change it. You only write your own report.
Job: \`${job}\` · stage: ${pack.stage} · interval: ${pack.interval.start}–${pack.interval.end} s (inspect all of it).

## Evidence (frozen)
- Pack: \`${packPath}\` (lists every evidence file with timestamps)
- Frames and contact sheets in the pack directory (taken from the built film, each stamped with its time; packs made from an MP4 also have short clips): VIEW these for the whole assigned interval.
- Motion transcript and automated checks are supporting diagnostics. The visual-mechanism role reads them only AFTER
  saving its blind observations of the images. A transcript-only review cannot pass.
${appReview ? `- This is an app review. Play the supplied encoded MP4 clips at normal speed when playback is available, and inspect whether real cursor, typing, scrolling, loading and result transitions remain continuous and visible. The clips must jointly cover every scene interval and handoff in the assigned interval; report \`coverage\` as the ranges actually inspected, and list clip paths proving the complete coverage. Do not pass if any scene or transition is missing. Contact sheets alone cannot establish motion or playback. The report records what you inspected; this workflow cannot authenticate that a human actually watched the clips. If playback is unavailable, inspect the sampled frames and explicitly record \`inspection.mode: "frame-sequence"\` with that limitation; do not describe motion as verified.
- Audio is not established by attached audio files or signal checks. Report \`inspection.audio: "listened"\` only if you actually listened to the encoded audio; otherwise use the truthful signal-verified or unavailable status and state the limitation. Never imply that audio was heard when it was not.
` : ''}

## Inspect efficiently
Every image you open stays in your context for the rest of the review, so open few and choose them well:
- ${appReview ? 'Play the normal-speed encoded clips first; then use contact sheets to locate moments that need a closer frame check.' : 'Start with the contact sheets: together they cover the whole interval.'}
- Then open single frames only where a sheet shows something to check (a handoff, small text, a collision): at most
  8 per pass, one pass at a time, at low or default detail. Use full resolution only to judge whether small text is legible.
- Read the pack and any text file once; quote what you need into your notes instead of opening it again.

${pack.stage === 'prototype' ? 'This is a prototype review, not final delivery. Evaluate the built prototype and its available incoming context. Do not reject missing scenes strictly outside the assigned interval; outgoing continuity into unbuilt scenes must be checked in final review. A missing prerequisite within the interval is blocking.' : 'This is final review: every scene and all handoffs must be present and covered.'}

${briefDirections}

## What you judge against
${frameGuide(manifest)}${isVertical(manifest) ? `
Judge it as a phone viewer: essential text or the key subject outside the safe area (hidden behind app chrome), or
an opening second where nothing happens, is blocking when it hurts understanding.` : ''}

${QUALITY}

${designFor(job)}

Builders have implementation authority within the frozen personality: STORYBOARD.md records the director's intent and each scene's notes record deliberate
departures. Judge whether the film makes the narration understood, not whether it matches the plan or every guideline.
A broken guideline is blocking only when it hurts understanding or truth; otherwise it is at most advisory.
Automated-check warnings are leads to inspect, not verdicts.

The film's design theme (film.json "theme", summarised at the top of STORYBOARD.md) must match the frozen personality.
Do block a departure from that personality or the film's own theme; do not block because of an unrelated taste preference.

Blocking: a scene that visibly breaks the film's one theme without a reason that serves the film; a central idea with
no visible event, consequence or payoff (a sentence or labelled box carrying it); a concrete subject the viewer cannot
recognise; unsupported numbers or claims; picture contradicts or runs ahead of the narration; unreadable essential
labels at 480 px; collisions over essential text; competing focus hiding the point; a crowded or shrinking stage that
hides the point; passages where the picture no longer matches what is said; broken transformation or handoff; evidence
that does not cover the interval. Advisory: improvements that do not prevent understanding. Do not block on taste.

## Scene boundaries are a technical check
Inspect the frozen frames immediately before and after EVERY scene handoff in the assigned interval.
Look for outgoing numbers, labels, gauges, cards and effects behind the new scene. Only deliberately reused
subjects may remain. Report any unexplained residue with its object ID and both scene names. Lifecycle build
errors must be fixed before review/render; the creative review budget cannot waive them.

## Consistent decisions across rounds
Use the same threshold in every round. Block only a demonstrated factual contradiction, unsupported claim,
missing central mechanism, unreadable visible text (including secondary labels), or broken evidence. Intentional layering is allowed only when every word stays clearly readable; record a specific reason.
Obscured, unreadable or unintentionally colliding text is always blocking, even after three review rounds.
Use category: "readability" for those findings. Aesthetic preference, exact frame timing, or supporting action anticipating/finishing around its spoken cue
is advisory. SSD loading copies selected rows into RAM; it need not delete the persistent SSD copy. A schematic
must distinguish a subset from the complete inventory, without inventing measured quantities.

After your initial visual inspection (and blind notes for visual-mechanism), read the prior decisions below.
Recheck every prior blocker against CURRENT evidence. Keep its ID if unresolved; do not reverse an accepted repair
without citing a concrete contradiction or regression. New blockers need current visual evidence and an explanation
of what materially prevents understanding. Inspect the whole interval in round one and report all blockers together.
In later rounds focus on prior blockers and regressions while checking coverage; avoid introducing new style demands.
For your role's most recent prior report on different sources, respond to every blocking finding in
priorFindingResponses: [{sourceHash, findingId, disposition: "resolved" | "unresolved" | "disputed", reason}].
Explain the current evidence in reason, including why any earlier proposed repair was incorrect.
Prior decisions (historical evidence paths are context only; cite current pack paths in new findings):
${manifest.priorReviewHistoryPath ? `Read \`${manifest.priorReviewHistoryPath}\` only after saving your initial visual observations.` : "No prior decisions."}

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
   For a blocking finding add category: "readability" | "truth" | "mechanism" | "style" | "evidence" and scope: "scene" for an implementation defect, "plan" for an incorrect/inadequate mechanism
   or ownership contract, or "evidence" for missing inspection capability/evidence. You may name responsible sceneIds
   (including an earlier scene) so a boundary defect is routed to its cause rather than just its timestamp.
3. Run: \`${CMD} review-submit --job ${jobRel} --file ${incoming}/${role}.json\` and fix any schema error it reports.
Reply with the verdict and the list of blocking findings (timestamp + one line each).
`;
}

// Every brief opens with the same boundary. Role agents load the repository's and the job's AGENTS.md too; this line
// keeps them from taking the orchestrator's loop (`next`, spawning reviewers) as their own work.
export const ROLE_BOUNDARY = `> You are a sub-agent with one job: this brief. Do not run \`npm run video -- next\`, \`render\`, \`review-pack\`,
> \`deliver\` or \`save-all\`, and do not start sub-agents or delegate any part of this work (no Task, spawn_agent or
> similar tool), even if a command's output or an AGENTS.md file says to. Do the work yourself, then reply.
`;

export async function writeBrief(job, name, text) {
  await mkdir(path.join(job, 'briefs'), {recursive: true});
  const file = path.join(job, 'briefs', name);
  const lines = personalityBrief(job, text).split('\n');
  // After the "# Role: ..." heading when there is one, so the brief still starts with its title.
  const at = lines[0].startsWith('# ') ? 1 : 0;
  await writeFile(file, [...lines.slice(0, at), ...(at ? [''] : []), ROLE_BOUNDARY, ...lines.slice(at)].join('\n'));
  return file;
}
