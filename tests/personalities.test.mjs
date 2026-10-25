import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, cp} from 'node:fs/promises';
import path from 'node:path';
import {PERSONALITIES, PROFILE_FILE, inferPersonality, loadPersonality, freezePersonality, readPersonality, personalityBrief, assertRenderReady, preparationPersonality} from '../lib/personalities.mjs';
import {createProject, loadProject, projectStep, closeDelegation, updateProject} from '../lib/project.mjs';
import {directorBrief, builderBrief, writeBrief} from '../lib/briefs.mjs';
import {sourceFingerprint} from '../lib/review.mjs';
import {nextStep, renderFilm} from '../lib/film.mjs';

async function fixture(t) {
  const base = path.resolve('.cache/tests');
  await mkdir(base, {recursive: true});
  const root = await mkdtemp(path.join(base, 'personalities-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  return root;
}

test('normal requests route by treatment, with storytelling fixed and ambiguous news unresolved', () => {
  for (const [prompt, id] of [
    ['Explain quantum tunnelling', 'explainer'],
    ['Explain how elections work', 'explainer'],
    ['Explain the latest scientific discovery', 'explainer'],
    ['Create a story about an elevator stopping on an impossible floor', 'rules-story'],
    ['Make a Bradikinin-style video', 'rules-story'],
    ['Cover today\'s stock market and earnings news', 'news-financial'],
    ['Cover the latest election results', 'news-political'],
    ['Review T3 Code entirely', 'app-review'],
    ['Test and review this finance app', 'app-review'],
  ]) assert.equal(inferPersonality(prompt).id, id, prompt);
  assert.equal(inferPersonality('Make a news video').id, null);
  assert.equal(inferPersonality('Cover today\'s election and stock market news').id, null);
  assert.equal(inferPersonality('Explain atoms', 'rules-story').id, 'rules-story');
  assert.throws(() => inferPersonality('x', '../../other'), /Unknown personality/);
});

test('each personality has its own complete package, with truthful renderer readiness', () => {
  for (const id of PERSONALITIES) {
    const snapshot = loadPersonality(id);
    assert.match(snapshot.files['ORCHESTRATOR.md'], new RegExp(`--profile ${id}`));
    assert.match(snapshot.sha256, /^[a-f0-9]{64}$/);
    if (['explainer', 'rules-story'].includes(id)) assert.doesNotThrow(() => assertRenderReady(snapshot));
    else assert.throws(() => assertRenderReady(snapshot), /not implemented/);
  }
});

test('frozen instructions survive catalog edits and reject missing, changed or mismatched snapshots', async t => {
  const dir = await fixture(t), catalog = path.join(dir, 'catalog');
  await cp(path.resolve('personalities/rules-story'), path.join(catalog, 'rules-story'), {recursive: true});
  const snapshot = loadPersonality('rules-story', catalog);
  const metadata = await freezePersonality(dir, snapshot);
  await writeFile(path.join(dir, 'project.json'), JSON.stringify({productionProfile: metadata}));
  await writeFile(path.join(catalog, 'rules-story/DESIGN.md'), 'Future catalog design');
  assert.notEqual(loadPersonality('rules-story', catalog).sha256, snapshot.sha256);
  const catalogEdit = structuredClone(snapshot);
  catalogEdit.files['DESIGN.md'] = 'A different future design';
  assert.equal(readPersonality(dir).files['DESIGN.md'], snapshot.files['DESIGN.md']);
  await assert.rejects(freezePersonality(dir, loadPersonality('explainer')), /frozen/);
  const brief = personalityBrief(dir, '# Writer\nOriginal task.');
  assert.match(brief, /Production personality: rules-story v1/);
  assert.ok(!brief.includes(loadPersonality('explainer').files['DESIGN.md']));
  const before = await sourceFingerprint(dir);
  await writeFile(path.join(dir, PROFILE_FILE), JSON.stringify(catalogEdit));
  assert.throws(() => readPersonality(dir), /changed or are invalid/);
  assert.notEqual(await sourceFingerprint(dir), before, 'profile changes invalidate review source fingerprints');
  await writeFile(path.join(dir, PROFILE_FILE), JSON.stringify(snapshot));
  await writeFile(path.join(dir, 'project.json'), JSON.stringify({productionProfile: {...metadata, id: 'explainer'}}));
  assert.throws(() => readPersonality(dir), /does not match/);
  await rm(path.join(dir, PROFILE_FILE));
  assert.throws(() => readPersonality(dir), /Missing frozen/);
});

test('automatic project routing persists through research and revision without asking for an ID', async t => {
  const root = await fixture(t);
  const p = await createProject(root, {name: 'story', brief: 'Make a horror story about an elevator.'});
  assert.equal(p.productionProfile.id, 'rules-story');
  const dir = path.join(root, 'jobs/scripts/story');
  assert.equal((await loadProject(root, 'story')).productionProfile.sha256, readPersonality(dir).sha256);
  await projectStep(root, 'story');
  const research = await readFile(path.join(dir, 'briefs/research.md'), 'utf8');
  assert.match(research, /rules-story v1/);
  assert.match(research, /seven numbered rules/);
  await closeDelegation(root, 'story');
  await writeFile(path.join(dir, 'SOURCES.md'), '# Original premise and factual background');
  await projectStep(root, 'story');
  const writer = await readFile(path.join(dir, 'briefs/write.md'), 'utf8');
  assert.match(writer, /rules-story v1/);
  await assert.rejects(updateProject(root, 'story', {profile: 'explainer'}), /frozen/);
});

test('story direction/build briefs exclude explainer design and retain the fixed narrative grammar', async t => {
  const dir = await fixture(t);
  await freezePersonality(dir, loadPersonality('rules-story'));
  const manifest = {duration: 12, width: 1920, height: 1080};
  const alignment = {words: [{text: 'Listen', start: 0, end: 1}]};
  const director = directorBrief(dir, manifest, alignment);
  assert.match(director, /fixed Bradikinin-style visual grammar/);
  assert.doesNotMatch(director, /Show the real thing, drawn|Everything else you draw as SVG|Invent at least 2 genuinely different whole-film concepts/);
  const film = {concept: 'Rules', scenes: [{id: 'opening', idea: 'Rule one', carry: [], start: {boundary: 'start'}}]};
  const builder = builderBrief(dir, manifest, film, {id: 'opening', start: 0, end: 12}, alignment);
  assert.match(builder, /A figure can hold/);
  assert.doesNotMatch(builder, /every object arrives with motion/);
  const file = await writeBrief(dir, 'build-opening.md', builder);
  assert.match(await readFile(file, 'utf8'), /Frozen rules-story\/REVIEW.md/);
});

test('news uses its own source rubric and app review stops before inventing a script', async t => {
  const root = await fixture(t);
  await createProject(root, {name: 'news', brief: 'Cover today\'s financial news.'});
  await projectStep(root, 'news');
  const news = await readFile(path.join(root, 'jobs/scripts/news/briefs/research.md'), 'utf8');
  assert.match(news, /verify ownership\/public-domain/);
  assert.doesNotMatch(news, /Show the real thing, drawn/);
  await createProject(root, {name: 'app', brief: 'Review T3 Code entirely.'});
  const step = await projectStep(root, 'app');
  assert.equal(step.state, 'blocked');
  assert.match(step.text, /Actual app use and capture evidence must precede the script/);
});

test('legacy jobs retain the explainer while unknown explicit and ambiguous new choices fail', async t => {
  const root = await fixture(t);
  assert.equal(readPersonality(root).profile.id, 'explainer');
  await assert.rejects(createProject(root, {name: 'bad', brief: 'Explain atoms', profile: 'unknown'}), /Unknown personality/);
  await assert.rejects(createProject(root, {name: 'ambiguous', brief: 'Make a news video'}), /routing question/);
});

test('preparation inherits the frozen personality rather than reclassifying the script or accepting an override', async t => {
  const dir = await fixture(t), prepared = path.join(dir, 'film');
  const metadata = await freezePersonality(dir, loadPersonality('rules-story'));
  await writeFile(path.join(dir, 'project.json'), JSON.stringify({productionProfile: metadata}));
  const snapshot = preparationPersonality(dir, 'Today\'s election news.');
  assert.equal(snapshot.profile.id, 'rules-story');
  assert.throws(() => preparationPersonality(dir, 'Story', 'explainer'), /differs from/);
  await freezePersonality(prepared, snapshot);
  assert.deepEqual(readPersonality(prepared), readPersonality(dir));
  await rm(path.join(dir, PROFILE_FILE));
  assert.throws(() => preparationPersonality(dir, 'Explain atoms'), /Missing frozen/);
});

test('unsupported film workflows stop as blocked and cannot bypass readiness through render reuse', async t => {
  const dir = await fixture(t);
  const metadata = await freezePersonality(dir, loadPersonality('news-political'));
  await writeFile(path.join(dir, 'job.json'), JSON.stringify({productionProfile: metadata, duration: 10}));
  const step = await nextStep(dir);
  assert.equal(step.state, 'blocked');
  assert.match(step.text, /Source-clip audio/);
  await assert.rejects(renderFilm(dir, {reuseBuild: true}), /not implemented/);
});
