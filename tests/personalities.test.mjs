import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, cp} from 'node:fs/promises';
import path from 'node:path';
import {PERSONALITIES, PROFILE_FILE, requirePersonality, loadPersonality, freezePersonality, readPersonality, assertRenderReady, preparationPersonality} from '../lib/personalities.mjs';
import {createProject, loadProject, projectStep, closeDelegation, updateProject, inspect, projectStatus, listProjects} from '../lib/project.mjs';
import {sourceFingerprint} from '../lib/review.mjs';
import {nextStep, renderFilm} from '../lib/film.mjs';

async function fixture(t) {
  const base = path.resolve('.cache/tests');
  await mkdir(base, {recursive: true});
  const root = await mkdtemp(path.join(base, 'personalities-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  return root;
}

test('new production requires an explicit profile', () => {
  assert.throws(() => requirePersonality(), /pass --profile/);
  assert.throws(() => requirePersonality('auto'), /pass --profile/);
  assert.equal(requirePersonality('rules-story'), 'rules-story');
});

test('each personality has its own complete package, with truthful renderer readiness', () => {
  for (const id of PERSONALITIES) {
    const snapshot = loadPersonality(id);
    assert.match(snapshot.files['PROFILE.md'], new RegExp(`--profile ${id}`));
    assert.match(snapshot.sha256, /^[a-f0-9]{64}$/);
    assert.doesNotThrow(() => assertRenderReady(snapshot));
  }
});

test('frozen instructions survive catalog edits and reject missing, changed or mismatched snapshots', async t => {
  const dir = await fixture(t), catalog = path.join(dir, 'catalog');
  await cp(path.resolve('personalities/rules-story'), path.join(catalog, 'rules-story'), {recursive: true});
  const snapshot = loadPersonality('rules-story', catalog);
  const metadata = await freezePersonality(dir, snapshot);
  await writeFile(path.join(dir, 'project.json'), JSON.stringify({productionProfile: metadata}));
  await writeFile(path.join(catalog, 'rules-story/PROFILE.md'), 'Future catalog design');
  assert.notEqual(loadPersonality('rules-story', catalog).sha256, snapshot.sha256);
  const catalogEdit = structuredClone(snapshot);
  catalogEdit.files['PROFILE.md'] = 'A different future design';
  assert.equal(readPersonality(dir).files['PROFILE.md'], snapshot.files['PROFILE.md']);
  await assert.rejects(freezePersonality(dir, loadPersonality('explainer')), /frozen/);
  const brief = '# Writer\nOriginal task.';
  assert.equal(brief, '# Writer\nOriginal task.');

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
  const p = await createProject(root, {name: 'story', profile: 'rules-story', brief: 'Make a horror story about an elevator.'});
  assert.equal(p.productionProfile.id, 'rules-story');
  const dir = path.join(root, 'jobs/scripts/story');
  assert.equal((await loadProject(root, 'story')).productionProfile.sha256, readPersonality(dir).sha256);
  await projectStep(root, 'story');
  const research = JSON.stringify((await loadProject(root, 'story')).delegation.tasks[0].assignment);
  assert.match(research, /production-profile.json/);
  await closeDelegation(root, 'story');
  await writeFile(path.join(dir, 'SOURCES.md'), '# Original premise and factual background');
  await projectStep(root, 'story');
  const writer = JSON.stringify((await loadProject(root, 'story')).delegation.tasks[0].assignment);
  assert.match(writer, /production-profile.json/);
  await assert.rejects(updateProject(root, 'story', {profile: 'explainer'}), /frozen/);
});

test('news uses its own source rubric and app review records the session before it writes', async t => {
  const root = await fixture(t);
  await createProject(root, {name: 'news', profile: 'news-financial', brief: 'Cover today\'s financial news.'});
  await projectStep(root, 'news');
  const news = JSON.stringify((await loadProject(root, 'news')).delegation.tasks[0].assignment);
  assert.match(news, /production-profile.json/);
  assert.doesNotMatch(news, /Show the real thing, drawn/);

  await createProject(root, {name: 'app', profile: 'app-review', brief: 'Review T3 Code entirely.'});
  const S = path.join(root, 'jobs/scripts/app');
  let step = await projectStep(root, 'app');
  assert.equal(step.state, 'record the session');
  assert.match(step.text, /capture-ingest --job jobs\/scripts\/app/);
  assert.match(step.text, /reshoot run/);
  assert.match(step.text, /native window/);
  assert.equal((await projectStatus(root, 'app')).phase, 'recording the session');

  // The manifest is the evidence. A stray folder without one leaves the gate closed.
  await mkdir(path.join(S, 'capture/F1'), {recursive: true});
  assert.equal((await projectStep(root, 'app')).state, 'record the session');
  await writeFile(path.join(S, 'capture/F1/manifest.json'), JSON.stringify({task: 'F1', viewport: [2560, 1600]}));
  step = await projectStep(root, 'app');
  assert.equal(step.state, 'gather the sources');
  await closeDelegation(root, 'app');

  await mkdir(path.join(S, 'sources'), {recursive: true});
  await writeFile(path.join(S, 'SOURCES.md'), '# Sources');
  step = await projectStep(root, 'app');
  assert.equal(step.state, 'write the script and its visual plan');
  const brief = JSON.stringify((await loadProject(root, 'app')).delegation.tasks[0].assignment);
  assert.match(brief, /capture\/F1\/manifest.json/);
  assert.match(brief, /capture\/F1\/manifest\.json/);

});

test('legacy jobs retain the explainer while unknown explicit and ambiguous new choices fail', async t => {
  const root = await fixture(t);
  assert.equal(readPersonality(root).profile.id, 'explainer');
  await assert.rejects(createProject(root, {name: 'bad', brief: 'Explain atoms', profile: 'unknown'}), /Unknown personality/);
  await assert.rejects(createProject(root, {name: 'ambiguous', brief: 'Make a news video'}), /pass --profile/);
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

test('prepared personality projects support inspection, status and listing while rejecting a mismatched film', async t => {
  const root = await fixture(t);
  const project = await createProject(root, {name: 'story', profile: 'rules-story', brief: 'Create a horror story about an intercom.'});
  const scriptDir = path.join(root, 'jobs/scripts/story'), job = path.join(root, 'jobs/story');
  await freezePersonality(job, readPersonality(scriptDir));
  await writeFile(path.join(job, 'job.json'), JSON.stringify({
    name: 'story', duration: 60, status: 'prepared', productionProfile: project.productionProfile,
  }));
  assert.equal((await inspect(root, project)).phase, 'film: prepared');
  const status = await projectStatus(root, 'story');
  assert.equal(status.phase, 'film: prepared');
  assert.ok(status.stages.groups.length, 'the stage bar can obtain its complete status model');
  assert.equal((await listProjects(root))[0].phase, 'film: prepared');
  await rm(path.join(job, PROFILE_FILE));
  const different = loadPersonality('explainer');
  const metadata = await freezePersonality(job, different);
  await writeFile(path.join(job, 'job.json'), JSON.stringify({status: 'prepared', productionProfile: metadata}));
  await assert.rejects(inspect(root, project), /personality differs from its script project/);
});


