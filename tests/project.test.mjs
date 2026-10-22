import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, utimes, readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createProject, projectStep, closeDelegation, assertNoDelegation, recordScriptReview, adaptStep, roleTarget, updateProject,
  loadProject, DEFAULT_CHAT_CONFIG, scriptDisposition, listProjects, deleteProject} from '../lib/project.mjs';

async function root(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'project-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await mkdir(path.join(dir, 'jobs/scripts'), {recursive: true});
  return dir;
}
const S = (r, ...f) => path.join(r, 'jobs/scripts/demo', ...f);
let clock = Date.now() / 1000;
async function put(r, name, body) { // each write is visibly newer than the last
  await mkdir(path.dirname(S(r, name)), {recursive: true});
  await writeFile(S(r, name), body);
  clock += 10; await utimes(S(r, name), clock, clock);
}
async function step(r) { const s = await projectStep(r, 'demo'); await closeDelegation(r, 'demo'); return s; }

test('a project needs an agreed brief and a free name', async t => {
  const r = await root(t);
  await assert.rejects(createProject(r, {name: 'demo'}), /BRIEF\.md/);
  await assert.rejects(createProject(r, {name: 'Bad Name'}), /lowercase/);
  const p = await createProject(r, {name: 'demo', brief: 'Why SSDs slow down when full.', format: 'vertical', duration: '60'});
  assert.deepEqual(p.review, ['script', 'prototype', 'final', 'thumbnail']);
  assert.equal(p.duration, 60);
  await assert.rejects(createProject(r, {name: 'demo', brief: 'x'}), /exists/);
});

test('the script stage: sources, writer, review rounds, the person approves, narration, start', async t => {
  const r = await root(t);
  await createProject(r, {name: 'demo', brief: 'Why SSDs slow down when full.', duration: '90'});
  let s = await projectStep(r, 'demo');
  assert.equal(s.state, 'gather the sources');
  assert.match(s.text, /"role":"research"/);
  assert.match(s.text, /"model":"anthropic\/claude-haiku-5-5"/);
  assert.match(await readFile(S(r, 'briefs/research.md'), 'utf8'), /> Why SSDs slow down when full\./);
  // While the task runs, next waits and pipeline commands refuse.
  assert.equal((await projectStep(r, 'demo')).state, 'delegated');
  await assert.rejects(assertNoDelegation(r, 'demo', 'render'), /delegated work is open/);
  await closeDelegation(r, 'demo');
  await assertNoDelegation(r, 'demo', 'render');

  await put(r, 'SOURCES.md', '# Sources');
  s = await step(r);
  assert.equal(s.state, 'write the script and its visual plan');
  assert.match(s.text, /"model":"anthropic\/claude-opus-5-5"/);
  await put(r, 'research.md', '## Evidence requests\n- the paper');
  assert.equal((await step(r)).state, 'the writer asked for more evidence');
  await put(r, 'SOURCES.md', '# Sources\n## Follow-up');
  s = await step(r);
  assert.equal(s.state, 'write the script and its visual plan');
  assert.match(await readFile(S(r, 'briefs/write.md'), 'utf8'), /evidence round is done/);

  await put(r, 'SCRIPT.md', '# SSDs\n\nWhen an SSD fills up, it slows down.');
  await put(r, 'VISUALS.md', '# Visuals');
  assert.equal((await step(r)).state, 'independent script review');
  await put(r, 'review.md', 'Findings...\nDisposition: revise');
  assert.match((await step(r)).state, /revise the script/);
  await put(r, 'SCRIPT.md', '# SSDs\n\nWhen an SSD fills up, it slows down. Here is why.');
  s = await step(r);
  assert.equal(s.state, 'independent script review (round 2)');
  assert.deepEqual(await readdir(S(r, 'review-history')), ['round-1.md']);
  await put(r, 'review.md', 'Disposition: pass');
  s = await step(r);
  assert.equal(s.state, 'script approval');
  assert.match(s.text, /watch --project demo/);
  assert.match(s.text, /--quote "<their message>"/);

  // The person asks for a change: their words go to a writer, then a fresh review, then back to them.
  await recordScriptReview(r, 'demo', {decision: 'revise', notes: ['Open with the benchmark.'], quote: 'open with the benchmark'});
  s = await step(r);
  assert.equal(s.state, 'revise the script with your notes');
  const brief = (await readdir(S(r, 'briefs'))).find(f => f.endsWith('-you.md'));
  assert.match(await readFile(S(r, 'briefs', brief), 'utf8'), /> Open with the benchmark\./);
  await put(r, 'SCRIPT.md', '# SSDs\n\nThe benchmark first. When an SSD fills up, it slows down.');
  assert.match((await step(r)).state, /independent script review/);
  await put(r, 'review.md', 'Disposition: pass');
  assert.equal((await step(r)).state, 'script approval');
  await recordScriptReview(r, 'demo', {decision: 'approve', quote: 'yes, go'});

  s = await step(r);
  assert.equal(s.state, 'narration');
  assert.match(s.text, /tts jobs\/scripts\/demo\/SCRIPT\.md --narration --provider kokoro .* -o jobs\/scripts\/demo\/narration\.wav/);
  await put(r, 'narration.wav', 'RIFF');
  s = await step(r);
  assert.equal(s.state, 'start');
  assert.match(s.text, /start --name demo --audio "jobs\/scripts\/demo\/narration\.wav" --script jobs\/scripts\/demo\/SCRIPT\.md --human-review prototype,final --pick-thumbnail true/);
  const log = (await readFile(S(r, 'human/decisions.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(log.map(d => [d.decision, d.quote]), [['revise', 'open with the benchmark'], ['approve', 'yes, go']]);
});

test('an approval belongs to the script the person read', async t => {
  const r = await root(t);
  await createProject(r, {name: 'demo', brief: 'b', review: 'script'});
  await put(r, 'SOURCES.md', 's'); await put(r, 'SCRIPT.md', 'one'); await put(r, 'VISUALS.md', 'v'); await put(r, 'review.md', 'Disposition: pass');
  await recordScriptReview(r, 'demo', {decision: 'approve', quote: 'ok'});
  await put(r, 'SCRIPT.md', 'two');
  assert.match((await step(r)).state, /independent script review/);
});

test('three failed reviews go to the person; without a script checkpoint a pass goes straight on', async t => {
  const r = await root(t);
  await createProject(r, {name: 'demo', brief: 'b', review: 'none'});
  await put(r, 'SOURCES.md', 's'); await put(r, 'SCRIPT.md', 'one'); await put(r, 'VISUALS.md', 'v');
  for (let i = 0; i < 2; i++) { await put(r, 'review.md', 'Disposition: revise'); await step(r); await put(r, 'SCRIPT.md', `v${i}`); await step(r); }
  await put(r, 'review.md', 'Disposition: revise');
  const s = await step(r);
  assert.equal(s.state, 'script approval');
  assert.match(s.text, /review budget used: 3 rounds/);
  await put(r, 'SCRIPT.md', 'v9'); await step(r); await put(r, 'review.md', 'Disposition: pass');
  assert.equal((await step(r)).state, 'narration');
});

test('a supplied script and recording skip writing and narration', async t => {
  const r = await root(t);
  await mkdir(path.join(r, 'in'));
  await writeFile(path.join(r, 'in/my.md'), 'My words.'); await writeFile(path.join(r, 'in/VISUALS.md'), 'plan'); await writeFile(path.join(r, 'in/take.wav'), 'RIFF');
  await createProject(r, {name: 'demo', script: 'in/my.md', audio: 'in/take.wav', review: 'final'});
  assert.equal(await readFile(S(r, 'VISUALS.md'), 'utf8'), 'plan');
  const s = await step(r);
  assert.equal(s.state, 'start');
  assert.match(s.text, /--audio "in\/take\.wav" .*--human-review final --pick-thumbnail false/);
});

test('film steps become T3 tasks and preview-panel reviews', async t => {
  const r = await root(t);
  await createProject(r, {name: 'demo', brief: 'b'});
  const project = await loadProject(r, 'demo');
  const spawn = {state: 'review final', text: [`STATE: independent final review (a, b)`, `DO: spawn 2 fresh sub-agents...`,
    `      video-reviewer: "Read jobs/demo/briefs/review-final-a.md and follow it exactly."`,
    `      video-reviewer: "Read jobs/demo/briefs/review-final-b.md and follow it exactly."`, `THEN: npm run video -- next --job jobs/demo`,
    `    Reviewers must be new sub-agents that did not build any scene.`].join('\n')};
  const text = await adaptStep(r, project, spawn, DEFAULT_CHAT_CONFIG);
  assert.equal(text.split('\n').filter(l => l.startsWith('  {')).length, 2);
  assert.match(text, /\.claude\/agents\/video-reviewer\.md/);
  assert.match(text, /VIDEO_AGENT_ROLE=reviewer VIDEO_AGENT_ID=t3-reviewer-/);
  assert.match(text, /delegated --project demo/);
  assert.match(text, /Reviewers must be new/);
  assert.equal((await loadProject(r, 'demo')).delegation.tasks.length, 2);
  await closeDelegation(r, 'demo');
  const gate = await adaptStep(r, project, {state: 'human review', text: 'STATE: human review of the prototype (x)\nDO: ...'}, DEFAULT_CHAT_CONFIG);
  assert.match(gate, /player\/\) with T3 `preview_open`/);
  assert.match(gate, /human-review --job jobs\/demo --stage prototype --decision approve --quote/);
  const thumbs = await adaptStep(r, project, {state: 'choose thumbnail', text: 'STATE: the person picks the thumbnail (2 passed review: v1 "A", v2 "B")\nDO: ...'}, DEFAULT_CHAT_CONFIG);
  assert.match(thumbs, /STATE: you pick the thumbnail \(2 passed/);
  assert.match(thumbs, /thumbnail-choose --job jobs\/demo --variant <id> --by you --quote/);
  const run = await adaptStep(r, project, {state: 'render', text: 'STATE: render\nDO: run `npm run video -- render --job jobs/demo`\nTHEN: npm run video -- next --job jobs/demo'}, DEFAULT_CHAT_CONFIG);
  assert.match(run, /THEN: npm run video -- next --project demo/);
});

test('models: tier defaults, chat.config roles and project overrides', async t => {
  const r = await root(t);
  await createProject(r, {name: 'demo', brief: 'b'});
  const config = {...DEFAULT_CHAT_CONFIG, roles: {builder: {providerInstanceId: 'codex', model: 'gpt-6-luna', options: {reasoningEffort: 'high'}}}};
  assert.deepEqual(roleTarget(config, {}, 'script-writer'), {providerInstanceId: 'pi', model: 'anthropic/claude-opus-5-5'});
  assert.deepEqual(roleTarget(config, {}, 'builder'), {providerInstanceId: 'codex', model: 'gpt-6-luna', options: {reasoningEffort: 'high'}});
  const {project} = await updateProject(r, 'demo', {model: ['reviewer=codex:gpt-6.1-sol', 'director=inherit']});
  assert.deepEqual(roleTarget(config, project, 'reviewer'), {providerInstanceId: 'codex', model: 'gpt-6.1-sol'});
  assert.equal(roleTarget(config, project, 'director'), null);
  assert.equal(roleTarget({...DEFAULT_CHAT_CONFIG, provider: 'inherit'}, {}, 'builder'), null);
});

test('listing and deleting projects', async t => {
  const r = await root(t);
  await createProject(r, {name: 'demo', brief: 'b'});
  assert.deepEqual((await listProjects(r)).map(p => [p.slug, p.phase]), [['demo', 'gathering sources']]);
  await assert.rejects(deleteProject(r, 'demo', 'nope'), /--confirm demo/);
  await deleteProject(r, 'demo', 'demo');
  assert.deepEqual(await listProjects(r), []);
});

test('script review verdicts', () => {
  assert.equal(scriptDisposition('Lots of text\n**Disposition:** PASS — fine'), 'pass');
  assert.equal(scriptDisposition('Pass the salt.\nVerdict: revise'), 'revise');
  assert.equal(scriptDisposition('nothing'), '');
});
