import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {visualScenes, visualPlanErrors, findVisualPlan, VISUALS_FILE} from '../lib/visuals.mjs';
import {nextStep, jobProgress} from '../lib/film.mjs';
import {builderBrief} from '../lib/briefs.mjs';

const PLAN = `# Visual plan: Fixture

## Concept
One shelf where every product is compared.

## Theme
Sticker graphics on near-black.

\`\`\`json
{"name": "Stickers", "description": "Sticker graphics", "bg": "#101010", "colors": {"white": "#f0f0f0"}}
\`\`\`

## Scenes

### opening — the shelf appears
- Starts at: "start"
- Idea: The shelf.
- Layout: the shelf spans the lower third; the price hero sits top right.
- Hero: the shelf itself, the full frame width.
- Events:
  1. "opening" → the white shelf draws on across the lower third
- Payoff: The shelf holds for one second.

### \`comparison\`
- **Starts at:** "comparison"
- **Idea**: Two products.
- **Layout**: one box in each third, tags above them.
- Hero: "$3,999" hero, 180 px, yellow, top right.
- Events:
  1. "comparison" → a yellow tag reading $3,999 swings onto the left box
- Payoff: The tags sit side by side.

## Thumbnail
- Headline: ONE SHELF
`;

const put = (job, file, value) => writeFile(path.join(job, file), typeof value === 'string' ? value : JSON.stringify(value));
async function job(t, {plan = PLAN, film = null} = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'visuals-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  for (const d of ['shots', 'inputs', 'review', 'assets']) await mkdir(path.join(dir, d));
  const words = ['opening', 'comparison', 'ending'].map((text, i) => ({id: `w${i}`, text, start: i * 6, end: i * 6 + 1}));
  await put(dir, 'job.json', {duration: 18, width: 1920, height: 1080, status: 'prepared'});
  await put(dir, 'alignment.json', {matchRatio: 1, words});
  if (plan != null) await put(dir, VISUALS_FILE, plan);
  if (film) await put(dir, 'film.json', film);
  return dir;
}

test('the visual plan is read by scene id and checked for its required sections', () => {
  const scenes = visualScenes(PLAN);
  assert.deepEqual([...scenes.keys()], ['opening', 'comparison']);
  assert.match(scenes.get('comparison'), /\$3,999 swings onto the left box/);
  assert.deepEqual(visualPlanErrors(PLAN), []);
  const errors = visualPlanErrors('# Visual plan: X\n\n## Concept\nA.\n\n## Scenes\n\n### opening\n- Idea: x\n');
  assert.ok(errors.some(e => /## Theme/.test(e)));
  assert.ok(errors.some(e => /opening.*Starts at/.test(e)));
  assert.ok(errors.some(e => /opening.*Layout/.test(e)) && errors.some(e => /opening.*Hero/.test(e)));
  const bad = visualPlanErrors(PLAN.replace('"bg": "#101010",', '"bg": #101010,').replace('### opening — the shelf appears', '### Opening: the shelf'));
  assert.ok(bad.some(e => /Theme.*JSON does not parse/.test(e)));
  assert.ok(bad.some(e => /"Opening".*kebab-case/.test(e)));
});

test('a VISUALS.md beside the script is found', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'visuals-find-')); t.after(() => rm(dir, {recursive: true, force: true}));
  await writeFile(path.join(dir, 'SCRIPT.md'), 'Words.');
  assert.equal(await findVisualPlan(path.join(dir, 'SCRIPT.md')), null);
  await writeFile(path.join(dir, 'VISUALS.md'), PLAN);
  assert.equal(await findVisualPlan(path.join(dir, 'SCRIPT.md')), path.join(dir, 'VISUALS.md'));
});

test('a job without a visual plan asks the script writer for one before planning', async t => {
  const dir = await job(t, {plan: null});
  const step = await nextStep(dir);
  assert.equal(step.state, 'visuals');
  assert.match(step.text, /script-writer: "Read .*briefs\/visuals\.md/);
  const brief = await readFile(path.join(dir, 'briefs/visuals.md'), 'utf8');
  assert.match(brief, /Never change it/); assert.match(brief, /0\.00 opening/);
  assert.equal((await jobProgress(dir)).current, 'visuals');
  await put(dir, VISUALS_FILE, '## Concept\nOnly a concept.');
  assert.match((await nextStep(dir)).text, /has \d+ problem/);
});

test('with a visual plan the director transcribes it and builders get their scene verbatim', async t => {
  const dir = await job(t);
  const step = await nextStep(dir);
  assert.equal(step.state, 'plan'); assert.match(step.text, /video-director: "Read .*director\.md/);
  const brief = await readFile(path.join(dir, 'briefs/director.md'), 'utf8');
  assert.match(brief, /Copy the plan into film\.json/); assert.doesNotMatch(brief, /Invent at least 2/);
  const film = {version: 2, title: 'Fixture', concept: 'Shelf', theme: {},
    scenes: [{id: 'opening', start: {boundary: 'start'}, idea: 'Shelf'}, {id: 'comparison', start: {phrase: 'comparison'}, idea: 'Two', owner: 'builder'}]};
  const card = builderBrief(dir, {duration: 18, width: 1920, height: 1080}, film, {id: 'comparison', start: 6, end: 18}, JSON.parse(await readFile(path.join(dir, 'alignment.json'), 'utf8')));
  assert.match(card, /visual direction for this scene/); assert.match(card, /\$3,999 swings onto the left box/);
  assert.match(card, /build what it describes/);
});

test('jobs planned before visual plans existed keep going', async t => {
  const dir = await job(t, {plan: null, film: {version: 2}});
  assert.equal((await nextStep(dir)).state, 'plan');
  await writeFile(path.join(dir, 'film.json'), '{ not json');
  assert.equal((await nextStep(dir)).state, 'plan');
});

test('the activity feed recognises the script writer spawn', async () => {
  const {parseNext} = await import('../ui/backend/events.mjs');
  const parsed = parseNext('STATE: visuals\n      script-writer: "Read /r/jobs/x/briefs/visuals.md and follow it exactly."\n      video-builder: "Read /r/jobs/x/briefs/build-a.md and follow it exactly."');
  assert.deepEqual(parsed.spawns, [{role: 'script-writer', brief: 'jobs/x/briefs/visuals.md'}, {role: 'builder', brief: 'jobs/x/briefs/build-a.md'}]);
});
