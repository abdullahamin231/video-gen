// The app-capture adapter: the headless recorder writes evidence, and the compiler turns that evidence into a scene
// whose pointer, click rings and camera push-ins are derived from what the task actually did.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validatePlan, jpegSize, captureSession} from '../lib/capture.mjs';
import {validateEdits, clusterClicks, clusterFocus, compileCaptureScene} from '../lib/appcapture.mjs';
import {carryCaptures} from '../lib/project.mjs';
import {buildFilm} from '../lib/film.mjs';
import {chromePath} from '../lib/inspect.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const exists = async file => { try { await access(file); return true; } catch { return false; } };
const put = (dir, file, value) => writeFile(path.join(dir, file), JSON.stringify(value, null, 2));

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, {stdio: ['ignore', 'ignore', 'pipe']});
    let err = '';
    child.stderr.on('data', d => err += d);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(err.split('\n').slice(-3).join(' '))));
  });
}

/** A synthetic capture: a real 3 s video, a real action log and pointer path, no Chrome needed. */
async function fakeCapture(root, {duration = 3.2} = {}) {
  const dir = path.join(root, 'capture', 'F7-filters');
  await mkdir(dir, {recursive: true});
  await ffmpeg(['-y', '-f', 'lavfi', '-i', `testsrc=size=1600x1000:rate=30:duration=${duration}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', path.join(dir, 'recording.mp4')]);
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
    version: 1, task: 'F7-filters', feature: 'create a filter', claim: 'a filter appears in the list', build: '1.4.2',
    url: 'https://app.example.test/filters', viewport: [1600, 1000], scale: 2, frameSize: [1600, 1000],
    startedAt: new Date().toISOString(), duration, frames: 40,
    files: {recording: {path: 'recording.mp4', sha256: 'fixture'}},
    results: [{kind: 'assert', ok: true, target: '#filters', expected: 'Bikes'}],
  }, null, 2));
  const actions = [
    {t: 0.1, type: 'goto', url: 'https://app.example.test/filters', title: 'Filters'},
    {t: 0.6, type: 'move', x: 240, y: 160},
    {t: 0.8, type: 'click', x: 240, y: 160, target: '#new-filter', why: 'open the dialog', bounds: [140, 140, 200, 44]},
    {t: 1.2, type: 'type', target: '#name', text: 'Bikes', why: null},
    {t: 1.5, type: 'click', x: 420, y: 200, target: '#save', why: 'save it', bounds: [360, 180, 120, 40]},
    {t: 2.6, type: 'click', x: 900, y: 620, target: '#row-3', why: 'the new row', bounds: [700, 600, 400, 40]},
    {t: 3.0, type: 'assert', target: '#filters', text: 'Bikes', ok: true, why: 'the filter is listed'},
    {t: 3.1, type: 'end'},
  ];
  await writeFile(path.join(dir, 'actions.jsonl'), actions.map(a => JSON.stringify(a)).join('\n') + '\n');
  const pointer = [];
  for (let t = 0.4; t < 3.0; t += 0.05) pointer.push({t: Number(t.toFixed(3)), x: Math.round(200 + t * 260), y: Math.round(120 + t * 170)});
  await writeFile(path.join(dir, 'pointer.json'), JSON.stringify(pointer));
  return dir;
}

async function fixtureJob(root) {
  const job = path.join(root, 'job');
  for (const dir of ['shots', 'assets', 'inputs', 'review']) await mkdir(path.join(job, dir), {recursive: true});
  const words = [
    {id: 'w0', text: 'We', start: 0.2, end: 0.35}, {id: 'w1', text: 'add', start: 0.4, end: 0.6},
    {id: 'w2', text: 'a', start: 0.65, end: 0.75}, {id: 'w3', text: 'filter', start: 0.8, end: 1.2},
    {id: 'w4', text: 'then', start: 6.0, end: 6.2}, {id: 'w5', text: 'save', start: 6.3, end: 6.6},
    {id: 'w6', text: 'it', start: 6.7, end: 6.8},
  ];
  const alignment = {matchRatio: 1, words};
  const manifest = {duration: 13, width: 1920, height: 1080, status: 'prepared'};
  const film = {
    version: 2, title: 'Capture fixture', concept: 'A saved filter appears in a list',
    theme: {name: 'Test look', description: 'A near-black stage with cool grey lines and one acid-yellow accent for the pointer, flat fills, heavy sans type.',
      bg: '#0d0f12', colors: {white: '#eef1f4', grey: '#8b95a1', dim: '#3a424c', faint: '#1a1e24', blue: '#4d8dff', yellow: '#ffd83d', red: '#ef4a41', green: '#3ec97e'},
      meanings: {yellow: 'the pointer and what it touches'}},
    alternatives: [{concept: 'Screen on a light canvas', rejected: 'the app is light already'}, {concept: 'Stills only', rejected: 'the recording is the evidence'}],
    subjects: [{id: 'app', what: 'the application screen'}],
    prototype: 'filters',
    scenes: [{
      id: 'filters', start: {boundary: 'start'}, idea: 'Show the filter being created', mechanism: 'Click the button, type a name, save',
      states: ['empty form', 'filled form', 'filter listed'], payoff: 'The filter exists', camera: 'Push in on each control',
      handoff: 'Same app screen', why_not_basic: 'The evidence is the recording', alternatives: ['A slideshow of stills'], carry: [],
    }],
  };
  await put(job, 'job.json', manifest);
  await put(job, 'alignment.json', alignment);
  await put(job, 'film.json', film);
  return {job, film, alignment, manifest};
}

const EDITS = {
  scene: 'filters',
  edits: [
    {id: 'open-dialog', phrase: 'add a filter', source: [0.4, 2.0], feature: 'F7', result: 'the new-filter dialog opens'},
    {id: 'save-it', phrase: 'save it', source: [2.0, 3.1], feature: 'F7', result: 'the saved filter is listed'},
  ],
};

test('jpegSize reads the frame size from a JPEG header and rejects other data', () => {
  // SOI, minimal APP0, then a baseline SOF0 declaring 640×480.
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  assert.deepEqual(jpegSize(header), [640, 480]);
  assert.equal(jpegSize(Buffer.from('not a jpeg at all')), null);
});

test('a capture plan is checked before anything is recorded', () => {
  const errors = validatePlan({steps: [{do: 'teleport'}]});
  assert.ok(errors.some(e => /"task"/.test(e)));
  assert.ok(errors.some(e => /"url" or a goto step/.test(e)));
  assert.ok(errors.some(e => /"do" must be one of/.test(e)));
  const ok = validatePlan({task: 'F1', url: 'https://example.test', steps: [{do: 'wait', for: '#app', why: 'loaded'}]});
  assert.deepEqual(ok, []);
  const small = validatePlan({task: 'F1', url: 'https://example.test', viewport: [800, 600], steps: [{do: 'wait', for: '#app'}]});
  assert.ok(small.some(e => /too small/.test(e)));
  const traversal = validatePlan({task: '../../etc', url: 'https://example.test', steps: [{do: 'wait', seconds: 1}]});
  assert.ok(traversal.some(e => /short id/.test(e)), 'the task id becomes a folder and an asset path');
});

test('edits must name narration words, a source range inside the recording and what the cut shows', () => {
  const errors = validateEdits({scene: 'Not A Slug', edits: [{id: 'x'}]}, 4);
  assert.ok(errors.some(e => /kebab-case scene id/.test(e)));
  assert.ok(errors.some(e => /"phrase" is required/.test(e)));
  assert.ok(errors.some(e => /"source" must be/.test(e)));
  assert.ok(errors.some(e => /record what this cut shows/.test(e)));
  const outside = validateEdits({scene: 'filters', edits: [{id: 'a', phrase: 'add a filter', source: [3, 9], feature: 'F7'}]}, 4);
  assert.ok(outside.some(e => /outside the 4s recording/.test(e)));
  assert.deepEqual(validateEdits(EDITS, 3.2), []);
});

test('clicks far apart in time are separate things to look at, and their targets frame the shot', () => {
  const actions = [
    {t: 0.8, type: 'click', x: 10, y: 10, bounds: [0, 0, 100, 50]},
    {t: 1.2, type: 'click', x: 20, y: 20, bounds: [0, 0, 100, 50]},
    {t: 4.0, type: 'click', x: 300, y: 300, bounds: [250, 280, 100, 40]},
  ];
  const clusters = clusterClicks(actions);
  assert.equal(clusters.length, 2);
  assert.deepEqual(clusterFocus(clusters[0]).center, [50, 25]);
  assert.equal(clusterFocus(clusters[0]).width, 100);
  assert.deepEqual(clusterFocus([{x: 5, y: 6}]).center, [5, 6]);
});

test('a compiled scene cuts the source, follows the log and validates against the film schema', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'appcapture-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const capture = await fakeCapture(root);
  const {job, film, alignment, manifest} = await fixtureJob(root);

  const compiled = await compileCaptureScene(job, capture, EDITS, {width: 1920, height: 1080, cursorSize: 54});
  // A 1600 px capture cannot take a tight push-in without magnifying compression; the compiler says so instead of
  // silently shipping a soft zoom.
  assert.equal(compiled.warnings.length, 2);
  for (const warning of compiled.warnings) assert.match(warning, /would magnify a 1600px capture past 1\.5×/);
  assert.equal(compiled.report.length, 2);
  assert.equal(compiled.report[0].clicks, 2);

  for (const edit of EDITS.edits) {
    const clip = path.join(job, 'assets/app-capture/F7-filters', `${edit.id}.mp4`);
    assert.ok(await exists(clip), `${edit.id} was cut into assets/`);
  }
  assert.ok(await exists(path.join(job, 'assets/app-capture/cursor.svg')), 'the pointer asset is written once');
  assert.ok(await exists(path.join(capture, 'recording.mp4')), 'the source recording is kept unchanged');

  const scene = JSON.parse(await readFile(path.join(job, 'shots/filters.json'), 'utf8'));
  assert.equal(scene.scene, 'filters');
  assert.deepEqual(Object.keys(scene.cues).sort(), ['open-dialog', 'save-it']);
  assert.equal(scene.cues['open-dialog'].phrase, 'add a filter');

  const videos = scene.objects.filter(o => o.type === 'video');
  assert.equal(videos.length, 2);
  for (const video of videos) {
    assert.match(video.src, /^assets\/app-capture\/F7-filters\//);
    assert.ok(video.clipDuration > 0.4, 'the video carries its real length so it cannot play past the cut');
  }
  const cursors = scene.objects.filter(o => o.id.startsWith('cursor-'));
  assert.equal(cursors.length, 2);
  for (const cursor of cursors) assert.equal(cursor.layer, 'media', 'the pointer draws on top of the footage');
  const rings = scene.objects.filter(o => o.type === 'circle');
  assert.equal(rings.length, 3);
  for (const ring of rings) assert.equal(ring.layer, 'media');

  const times = scene.actions.map(a => String(a.at ?? ''));
  assert.ok(times.every(at => !/^\d/.test(at)), 'timing stays cue-relative, never absolute seconds');
  assert.ok(scene.actions.some(a => a.do === 'move' && a.target.startsWith('cursor-')), 'the pointer follows the logged path');
  const cameras = scene.actions.filter(a => a.do === 'camera');
  assert.ok(cameras.some(c => c.zoom > 1.1), 'a click cluster pushes the camera in');
  assert.ok(cameras.some(c => c.zoom === 1), 'and the shot comes back out');
  assert.ok(cameras.every(c => c.zoom <= 1.6), 'a 1600 px capture is not magnified past the sharpness budget');

  const built = await buildFilm(job, {inspect: false, print: false});
  assert.ok(built.ok, `the compiled scene must pass the shared schema: ${JSON.stringify(built.errors ?? [])}`);
});

test('capture-scene refuses edits that do not match the recording', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'appcapture-bad-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const capture = await fakeCapture(root);
  const {job} = await fixtureJob(root);
  await assert.rejects(compileCaptureScene(job, capture, {scene: 'filters', edits: [
    {id: 'too-long', phrase: 'add a filter', source: [0.5, 9.5], feature: 'F7'},
  ]}), /outside the .* recording/);
});

test('captures travel from the script folder into the film job', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'appcapture-carry-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const script = path.join(root, 'jobs/scripts/demo/SCRIPT.md');
  await mkdir(path.join(path.dirname(script), 'capture/F1'), {recursive: true});
  await writeFile(path.join(path.dirname(script), 'capture/F1/manifest.json'), '{"task":"F1"}');
  const job = path.join(root, 'jobs/demo');
  assert.equal(await carryCaptures(script, job), true);
  assert.equal(await readFile(path.join(job, 'capture/F1/manifest.json'), 'utf8'), '{"task":"F1"}');
  // A project without captures (every other personality) copies nothing and does not fail.
  assert.equal(await carryCaptures(path.join(root, 'elsewhere/SCRIPT.md'), job), false);
});

test('a headless capture records the session, the action log and the evidence', async t => {
  let chrome = null;
  try { chrome = await chromePath(); } catch {}
  if (!chrome) return t.skip('no Chrome on this machine');
  const root = await mkdtemp(path.join(os.tmpdir(), 'appcapture-run-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const dir = path.join(root, 'capture', 'F3');
  const page = path.join(ROOT, 'tests/fixtures/app-capture/app.html');
  const plan = {
    task: 'F3-new-filter', feature: 'create a filter', build: 'fixture-1.0', url: `file://${page}`,
    viewport: [1440, 900], scale: 1,
    steps: [
      {do: 'wait', for: '#new-filter', why: 'the Filters screen has loaded'},
      {do: 'shot', name: '01-start', state: 'two filters, before'},
      {do: 'click', target: '#new-filter', why: 'open the dialog'},
      {do: 'type', target: '#filter-name', text: 'Bikes'},
      {do: 'click', target: '#save-filter', why: 'save it'},
      {do: 'wait', seconds: 0.4, why: 'the row settles'},
      {do: 'assert', target: '#filters', text: 'Bikes', why: 'the filter is listed'},
      {do: 'assert', target: '#filters', text: 'Not a filter', why: 'a wrong claim is kept as evidence'},
    ],
  };
  const result = await captureSession(dir, plan);
  assert.match(result.manifest.recorder.pointer, /not composited/);
  assert.ok(result.manifest.duration >= 1);
  assert.deepEqual(result.manifest.frameSize, [1440, 900]);
  assert.ok(await exists(path.join(dir, 'recording.mp4')));
  assert.ok(await exists(path.join(dir, 'shots/01-start.png')));

  const clicks = result.actions.filter(a => a.type === 'click');
  assert.equal(clicks.length, 3, 'two button clicks plus the click that focuses the name field');
  for (const click of clicks) {
    assert.ok(click.bounds?.[2] > 0 && click.bounds?.[3] > 0, 'every click records the target bounds');
    assert.ok(click.t >= 0 && click.t <= result.manifest.duration + 0.1);
  }
  assert.ok(result.pointer.length > 5, 'the pointer path was sampled');
  assert.ok(result.pointer.every(sample => Number.isFinite(sample.x) && Number.isFinite(sample.y)));

  const asserts = result.manifest.results.filter(r => r.kind === 'assert');
  assert.deepEqual(asserts.map(a => a.ok), [true, false], 'a failed expectation is recorded, not thrown away');
  const raw = await readFile(path.join(dir, 'actions.jsonl'), 'utf8');
  assert.match(raw, /"type":"assert".*"ok":false/);
  assert.equal(result.manifest.files.recording.sha256.length, 64);
});

test('a session that cannot run a step keeps its footage, its log and the hand-written files', async t => {
  let chrome = null;
  try { chrome = await chromePath(); } catch {}
  if (!chrome) return t.skip('no Chrome on this machine');
  const root = await mkdtemp(path.join(os.tmpdir(), 'appcapture-stop-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const dir = path.join(root, 'capture', 'F4');
  await mkdir(dir, {recursive: true});
  const page = path.join(ROOT, 'tests/fixtures/app-capture/app.html');
  const plan = {
    task: 'F4', feature: 'a control that is not there', url: `file://${page}`, viewport: [1440, 900], scale: 1,
    steps: [
      {do: 'wait', for: '#new-filter', why: 'the screen loaded'},
      {do: 'shot', name: '01-start', state: 'before'},
      {do: 'click', target: '#missing-control', why: 'a control this build does not have'},
      {do: 'click', target: '#save-filter', why: 'this step must not run'},
    ],
  };
  await writeFile(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2));
  await writeFile(path.join(dir, 'edits.json'), '{"scene":"filters","edits":[]}\n');

  const result = await captureSession(dir, plan);
  assert.match(result.manifest.aborted, /No element matches #missing-control/);
  assert.ok(result.actions.some(a => a.type === 'error'), 'the failure is in the action log');
  assert.ok(!result.actions.some(a => a.type === 'click' && a.target === '#save-filter'), 'the plan stops at the failure');
  assert.ok(await exists(path.join(dir, 'recording.mp4')), 'the footage up to the failure is kept');
  assert.ok(await exists(path.join(dir, 'shots/01-start.png')));
  assert.match(await readFile(path.join(dir, 'manifest.json'), 'utf8'), /"aborted"/);
  assert.equal(await readFile(path.join(dir, 'edits.json'), 'utf8'), '{"scene":"filters","edits":[]}\n');
  assert.ok(await exists(path.join(dir, 'plan.json')), 're-recording never deletes the plan or the edits');
});

test('typed secrets are masked in the action log', async t => {
  let chrome = null;
  try { chrome = await chromePath(); } catch {}
  if (!chrome) return t.skip('no Chrome on this machine');
  const root = await mkdtemp(path.join(os.tmpdir(), 'appcapture-secret-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const dir = path.join(root, 'capture', 'F9');
  await writeFile(path.join(root, 'secret.html'), '<label>Password <input id="pw" type="password"></label>');
  const result = await captureSession(dir, {
    task: 'F9', url: `file://${path.join(root, 'secret.html')}`, viewport: [1200, 800], scale: 1,
    steps: [{do: 'type', target: '#pw', text: 'hunter2', why: 'sign in'}],
  });
  const typed = result.actions.find(a => a.type === 'type');
  assert.equal(typed.text, '*******');
  assert.equal(typed.masked, true);
  assert.ok(!(await readFile(path.join(dir, 'actions.jsonl'), 'utf8')).includes('hunter2'));
  assert.ok(result.manifest.results.some(r => r.kind === 'privacy'));
});
