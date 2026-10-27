// The app-capture adapter: the headless recorder writes evidence, and the compiler turns that evidence into a scene
// whose pointer, click rings and camera push-ins are derived from what the task actually did.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, access} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {validatePlan, jpegSize, captureSession} from '../lib/capture.mjs';
import {validateEdits, clusterClicks, clusterFocus, compileCaptureScene} from '../lib/appcapture.mjs';
import {carryCaptures} from '../lib/project.mjs';
import {buildFilm} from '../lib/film.mjs';
import {reviewerBrief} from '../lib/briefs.mjs';
import {chromePath} from '../lib/inspect.mjs';
import {loadPersonality, personalityMetadata, freezePersonality} from '../lib/personalities.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const execFile = promisify(execFileCallback);
const exists = async file => { try { await access(file); return true; } catch { return false; } };
const tempRoot = async prefix => { const base = path.join(ROOT, '.cache', 'tests'); await mkdir(base, {recursive: true}); return mkdtemp(path.join(base, prefix)); };
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
    {t: 1.95, type: 'scroll', dy: 420, fromY: 0, scrollY: 320, dur: 0.38, why: 'view the new row'},
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
  assert.ok(validateEdits({scene: 'filters', edits: [{id: 'a', phrase: 'result', source: [0, 1], feature: 'F7', hold: 'yes'}]}, 4).some(e => /hold.*true or false/.test(e)));
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
  const root = await tempRoot('appcapture-');
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
  assert.equal(compiled.report[0].interactionCounts.type, 1);
  assert.equal(compiled.report[0].interactionCounts.scroll, 1, 'the recorded scroll stays inside its continuous source cut');

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

test('a screenshot-only capture cannot compile into an app-review scene', async t => {
  const root = await tempRoot('appcapture-shot-only-'); t.after(() => rm(root, {recursive:true,force:true}));
  const capture = await fakeCapture(root);
  await writeFile(path.join(capture,'actions.jsonl'), JSON.stringify({t:1,type:'shot',src:'shots/result.png',state:'result'})+'\n');
  const {job} = await fixtureJob(root);
  await assert.rejects(compileCaptureScene(job,capture,{scene:'filters',edits:[{id:'result',phrase:'the result',source:[0.5,2.5],feature:'filter'}]}),/no recorded task interaction/);
});

test('the real renderer composites and holds app capture pixels on a colored background', async t => {
  let chrome = null;
  try { chrome = await chromePath(); } catch {}
  if (!chrome) return t.skip('no Chrome on this machine');
  const root = path.join(ROOT, '.cache', `appcapture-render-${process.pid}-${Date.now()}`);
  await mkdir(root, {recursive: true});
  t.after(() => rm(root, {recursive: true, force: true}));
  const capture = await fakeCapture(root, {duration: 3.2});
  const {job} = await fixtureJob(root);
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=13', '-c:a', 'pcm_s16le', path.join(job, 'assets/narration.wav')]);
  // Make the test a valid app-review production and visibly non-black canvas.
  const manifest = JSON.parse(await readFile(path.join(job, 'job.json'), 'utf8'));
  manifest.duration = 13;
  const filmFile = path.join(job, 'film.json');
  const film = JSON.parse(await readFile(filmFile, 'utf8'));
  film.theme.bg = '#d8b34a';
  await writeFile(filmFile, JSON.stringify(film, null, 2));
  const profile = loadPersonality('app-review');
  manifest.productionProfile = personalityMetadata(profile);
  await writeFile(path.join(job, 'job.json'), JSON.stringify(manifest));
  await freezePersonality(job, profile);
  const reviewInstructions = reviewerBrief(job, 'visual-mechanism', {stage: 'final', interval: {start: 0, end: 13}}, 'review/final/pack.json', '0'.repeat(64), 'Judge the app evidence.', manifest);
  assert.match(reviewInstructions, /Play the supplied encoded MP4 clips at normal speed/);
  assert.match(reviewInstructions, /Never imply that audio was heard when it was not/);
  const edits = {...EDITS, edits: EDITS.edits.map(edit => ({...edit, hold: true}))};
  await compileCaptureScene(job, capture, edits, {width: 1920, height: 1080});
  const built = await buildFilm(job, {inspect: false, print: false});
  assert.ok(built.ok, `build: ${(built.errors || []).join('; ')}`);
  const worldFile = path.join(job, 'assets/world.json');
  const world = JSON.parse(await readFile(worldFile, 'utf8'));
  const video = world.objects.find(object => object.type === 'video' && object.id === 'screen-open-dialog');
  assert.ok(video, 'compiled capture video exists in the renderer input');
  const start = video.mediaStart, end = start + video.mediaDuration;
  assert.ok(end + 0.4 < 5.5, 'test clip ends before the next narrated cut');
  const hf = path.join(ROOT, 'node_modules/hyperframes/bin/hyperframes.mjs');
  const render = async output => execFile(process.execPath, [hf, 'render', '--quality', 'draft', '--fps', '10', '--output', output, '--quiet'], {cwd: job, timeout: 180000});
  await render('renders/with-capture.mp4');
  // Counterfactual render through the same HyperFrames renderer, with only the capture layer absent.
  const shotFile = path.join(job, 'shots/filters.json');
  const shot = JSON.parse(await readFile(shotFile, 'utf8'));
  shot.objects = shot.objects.filter(object => object.id !== 'screen-open-dialog');
  shot.actions = shot.actions.filter(action => action.target !== 'screen-open-dialog');
  await writeFile(shotFile, JSON.stringify(shot, null, 2));
  const absentBuild = await buildFilm(job, {inspect: false, print: false});
  assert.ok(absentBuild.ok, `counterfactual build: ${(absentBuild.errors || []).join('; ')}`);
  await render('renders/without-capture.mp4');
  const frame = async (file, time) => {
    const {stdout} = await execFile('ffmpeg', ['-v', 'error', '-ss', time.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=96:54,format=rgb24', '-f', 'rawvideo', 'pipe:1'], {encoding: 'buffer'});
    return stdout;
  };
  const differs = (a, b) => {
    assert.equal(a.length, b.length);
    let sum = 0, changed = 0;
    for (let i = 0; i < a.length; i += 3) {
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      sum += d; if (d > 24) changed++;
    }
    return {mean: sum / a.length, changed: changed / (a.length / 3)};
  };
  const withFile = path.join(job, 'renders/with-capture.mp4'), withoutFile = path.join(job, 'renders/without-capture.mp4');
  const before = differs(await frame(withFile, Math.max(0.1, start - 0.2)), await frame(withoutFile, Math.max(0.1, start - 0.2)));
  assert.ok(before.mean < 2, `before playback should match the absent-layer render: ${JSON.stringify(before)}`);
  for (const time of [start + 0.4, end + 0.2]) {
    const delta = differs(await frame(withFile, time), await frame(withoutFile, time));
    assert.ok(delta.mean > 4 && delta.changed > 0.08,
      `captured frame/last-frame hold at ${time.toFixed(2)}s must appear in encoded MP4, delta ${JSON.stringify(delta)}`);
  }
});

test('capture-scene refuses edits that do not match the recording', async t => {
  const root = await tempRoot('appcapture-bad-');
  t.after(() => rm(root, {recursive: true, force: true}));
  const capture = await fakeCapture(root);
  const {job} = await fixtureJob(root);
  await assert.rejects(compileCaptureScene(job, capture, {scene: 'filters', edits: [
    {id: 'too-long', phrase: 'add a filter', source: [0.5, 9.5], feature: 'F7'},
  ]}), /outside the .* recording/);
});

test('capture-scene blocks screenshot-only edits and cuts through typing or waits', async t => {
  const root = await tempRoot('appcapture-sequence-');
  t.after(() => rm(root, {recursive: true, force: true}));
  const capture = await fakeCapture(root);
  const {job} = await fixtureJob(root);
  await assert.rejects(compileCaptureScene(job, capture, {scene: 'filters', edits: [
    {id: 'still', phrase: 'the saved filter', source: [2.1, 2.55], feature: 'F7'},
  ]}), /no recorded task interaction.*screenshots cannot stand in/i);
  const actionsFile = path.join(capture, 'actions.jsonl');
  const actions = JSON.parse((await readFile(actionsFile, 'utf8')).split('\n').find(line => JSON.parse(line).type === 'type'));
  actions.startedAt = 0.95;
  actions.dur = 0.3;
  const lines = (await readFile(actionsFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const revised = lines.map(action => action.type === 'type' ? actions : action);
  await writeFile(actionsFile, revised.map(action => JSON.stringify(action)).join('\n') + '\n');
  await assert.rejects(compileCaptureScene(job, capture, {scene: 'filters', edits: [
    {id: 'partial', phrase: 'enter the name', source: [1.1, 1.55], feature: 'F7'},
  ]}), /cuts through a recorded type sequence/);
  await writeFile(actionsFile, revised.map(action => JSON.stringify(action.type === 'type' ? {...action, type: 'wait'} : action)).join('\n') + '\n');
  await assert.rejects(compileCaptureScene(job, capture, {scene: 'filters', edits: [
    {id: 'partial-wait', phrase: 'wait for the result', source: [1.1, 1.55], feature: 'F7'},
  ]}), /cuts through a recorded wait sequence/);
});

test('captures travel from the script folder into the film job', async t => {
  const root = await tempRoot('appcapture-carry-');
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
  const root = await tempRoot('appcapture-run-');
  t.after(() => rm(root, {recursive: true, force: true}));
  const dir = path.join(root, 'capture', 'F3');
  const page = path.join(ROOT, 'tests/fixtures/app-capture/app.html');
  const plan = {
    task: 'F3-new-filter', feature: 'create a filter', build: 'fixture-1.0', url: `file://${page}`,
    viewport: [1440, 900], scale: 1,
    steps: [
      {do: 'wait', for: '#never-present', timeout: 120, why: 'record the failed loading wait'},
      {do: 'wait', for: '#new-filter', why: 'the Filters screen has loaded'},
      {do: 'scroll', dy: 360, settle: 120, why: 'move through the filters list'},
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
  const failedWait=result.actions.find(a=>a.type==='wait'&&a.for==='#never-present');
  assert.equal(failedWait.ok,false); assert.ok(failedWait.dur>=0.1); assert.match(failedWait.error,/timeout/i);
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
  const scroll = result.actions.find(a => a.type === 'scroll');
  assert.ok(scroll.dur >= 0.1 && Number.isFinite(scroll.fromY) && Number.isFinite(scroll.scrollY),
    'scroll is recorded as a paced gesture with observed before and after positions');
  const typed = result.actions.find(a => a.type === 'type');
  assert.ok(typed.dur >= 0.1 && typed.startedAt < typed.t, 'the log preserves the complete human-paced typing interval');

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
  const root = await tempRoot('appcapture-stop-');
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

test('concurrent capture attempts for one project fail without clearing its active artifacts', async t => {
  const root = await tempRoot('appcapture-lock-');
  t.after(() => rm(root, {recursive: true, force: true}));
  const dir = path.join(root, 'capture', 'F12');
  await mkdir(dir, {recursive: true});
  await writeFile(path.join(dir, 'recording.mp4'), 'active capture');
  await writeFile(path.join(dir, '.capture.lock'), JSON.stringify({pid: process.pid}));
  await assert.rejects(captureSession(dir, {
    task: 'F12', url: 'https://example.test', steps: [{do: 'wait', seconds: 1}],
  }), /already running.*generated files were left untouched/);
  assert.equal(await readFile(path.join(dir, 'recording.mp4'), 'utf8'), 'active capture');
});

test('a stale lock from an exited capture process is recovered safely', async t => {
  const root = await tempRoot('appcapture-stale-lock-');
  t.after(() => rm(root, {recursive: true, force: true}));
  const dir = path.join(root, 'capture', 'F13');
  await mkdir(dir, {recursive: true});
  const dead = spawn('true');
  await new Promise((resolve, reject) => { dead.once('error', reject); dead.once('close', resolve); });
  await writeFile(path.join(dir, '.capture.lock'), JSON.stringify({pid: dead.pid}));
  await assert.rejects(captureSession(dir, {task: 'bad id', url: 'https://example.test', steps: [{do: 'wait', seconds: 1}]}), /capture plan is invalid/);
  assert.equal(await exists(path.join(dir, '.capture.lock')), false, 'recovered lock is cleaned after validation fails');
});

test('an old malformed lock is recovered while a fresh empty lock is preserved', async t => {
  const root=await tempRoot('appcapture-malformed-lock-'); t.after(()=>rm(root,{recursive:true,force:true}));
  const dir=path.join(root,'capture','F14'); await mkdir(dir,{recursive:true});
  const lock=path.join(dir,'.capture.lock'); await writeFile(lock,'');
  const old=new Date(Date.now()-180000); await (await import('node:fs/promises')).utimes(lock,old,old);
  await assert.rejects(captureSession(dir,{task:'bad id',url:'https://example.test',steps:[{do:'wait',seconds:1}]}),/capture plan is invalid/);
  await writeFile(lock,'');
  await assert.rejects(captureSession(dir,{task:'F14',url:'https://example.test',steps:[{do:'wait',seconds:1}]}),/already running/);
  assert.equal(await readFile(lock,'utf8'),'');
});

test('typed secrets are masked in the action log', async t => {
  let chrome = null;
  try { chrome = await chromePath(); } catch {}
  if (!chrome) return t.skip('no Chrome on this machine');
  const root = await tempRoot('appcapture-secret-');
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
