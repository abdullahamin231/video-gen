// Ingesting a reshoot run into the capture contract: the run folder is read as evidence, never re-recorded, and the
// compiler must not draw a second pointer over footage whose cursor reshoot already composited.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, access} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readReshootRun, ingestReshootRun} from '../lib/reshoot.mjs';
import {compileCaptureScene} from '../lib/capture-scene.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
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

/**
 * A reshoot project laid out the way reshoot writes one: reshoot.toml naming a storyboard, and a run folder holding the
 * take, its event stream, its beats, evidence frames and the clean recording (cursor composited, captions off).
 */
async function fakeReshootRun(root, {mode = 'final', ok = true, status = 'completed'} = {}) {
  const project = path.join(root, 'demo');
  const run = path.join(project, 'takes', 'runs', 'abc123');
  const takes = path.join(run, 'takes');
  await mkdir(path.join(takes, 'demo.evidence'), {recursive: true});
  await writeFile(path.join(project, 'reshoot.toml'), '[take]\nweb = "storyboard.toml"\n');
  await writeFile(path.join(project, 'storyboard.toml'), '[[beat]]\nurl = "https://app.example.test/jobs"\n');
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=2560x1440:rate=30:duration=3.2',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', path.join(takes, 'demo.clean.mp4')]);
  await writeFile(path.join(takes, 'demo.evidence', 'signin.png'), 'signin frame');
  await writeFile(path.join(takes, 'demo.evidence', 'open.png'), 'open frame');
  await put(run, 'run.json', {ok, id: 'abc123', finished_at: '2026-10-27T21:00:00.000Z', errors: ok ? [] : ['check failed'],
    inputs: {reshoot: '0.3.9'}});
  await put(run, 'takes/demo.take.json', {
    schema_version: 1, status, mode, story_id: 'video-workspace', story_sha256: 'a'.repeat(64), browser: '149.0',
    capture: {css_width: 1280, css_height: 720, pixel_ratio: 2, frames: 96},
    beats: [
      {id: 'signin', purpose: null, start: 0.01, end: 1.6, screenshot: 'demo.evidence/signin.png',
        expectations: [{type: 'text', status: 'passed', actual: 'New video\nIdeas', at: 1.2}]},
      {id: 'open', purpose: 'Open the delivered video thread', start: 1.6, end: 3.0, screenshot: 'demo.evidence/open.png',
        expectations: [{type: 'text', status: 'failed', actual: 'MemT-1.0 selected instead', at: 2.5}]},
    ],
  });
  await put(run, 'takes/demo.beats.json', {signin: 0.01, open: 1.6});
  await put(run, 'takes/demo.events.json', [
    {t: 0.2, kind: 'act', phase: 'start', rect: [470, 329.19, 340, 49.75]},
    {t: 0.45, kind: 'act', phase: 'end', rect: [470, 329.19, 340, 49.75]},
    {t: 1.9, kind: 'act', phase: 'start', rect: [10, 194.03, 215.06, 67.17]},
    {t: 2.1, kind: 'caption', phase: 'start'},
  ]);
  return run;
}

const EDITS = {scene: 'ui-review', edits: [
  {id: 'sign-in', phrase: 'sign in to the workspace', source: [0.1, 1.5], feature: 'F1', result: 'the workspace opens'},
  {id: 'open-thread', phrase: 'open the delivered video', source: [1.7, 2.9], feature: 'F2', result: 'a delivered thread opens'},
]};

test('a reshoot run becomes a capture whose manifest names the recorder, the take and the composited pointer', async t => {
  const root = await tempRoot('reshoot-');
  t.after(() => rm(root, {recursive: true, force: true}));
  const run = await fakeReshootRun(root);
  const out = path.join(root, 'job', 'capture', 'ui-workspace');

  const result = await ingestReshootRun(run, out, {task: 'ui-workspace', feature: 'review a delivered video'});
  assert.equal(result.clicks, 2);
  assert.equal(result.manifest.frameSize[0], 2560, 'the real frame size is read from the recording, not the CSS viewport');
  assert.deepEqual(result.manifest.viewport, [1280, 720]);
  assert.equal(result.manifest.recorder.app, 'reshoot');
  assert.equal(result.manifest.recorder.pointer, 'composited');
  assert.equal(result.manifest.recorder.version, '0.3.9');
  assert.equal(result.manifest.source.run, 'abc123');
  assert.equal(result.manifest.url, 'https://app.example.test/jobs', 'the URL comes from the project storyboard');
  assert.equal(result.manifest.files.actions.sha256.length, 64);

  const actions = (await readFile(path.join(out, 'actions.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const click = actions.find(action => action.type === 'click');
  assert.deepEqual([click.x, click.y], [640, 354], 'a click is the centre of the control the action touched');
  assert.equal(click.source, 'reshoot-act');
  const failed = actions.filter(action => action.type === 'assert' && !action.ok);
  assert.equal(failed.length, 1, 'a result check that did not pass stays in the log as evidence');
  assert.match(failed[0].detail, /MemT-1\.0/);
  assert.ok(await exists(path.join(out, 'shots/signin.png')), 'the beat evidence frame is copied');
  assert.ok(await exists(path.join(out, 'recording.mp4')));
});

test('a preview, a failed run or an unsupported take schema is refused rather than ingested as evidence', async t => {
  const root = await tempRoot('reshoot-refuse-');
  t.after(() => rm(root, {recursive: true, force: true}));

  const preview = await fakeReshootRun(path.join(root, 'preview'), {mode: 'preview'});
  await assert.rejects(readReshootRun(preview), /preview/);

  const failed = await fakeReshootRun(path.join(root, 'failed'), {ok: false});
  await assert.rejects(readReshootRun(failed), /failed/);

  const partial = await fakeReshootRun(path.join(root, 'partial'), {status: 'running'});
  await assert.rejects(readReshootRun(partial), /not completed/);

  const run = await fakeReshootRun(path.join(root, 'schema'));
  await put(run, 'takes/demo.take.json', {...JSON.parse(await readFile(path.join(run, 'takes/demo.take.json'), 'utf8')), schema_version: 2});
  await assert.rejects(readReshootRun(run), /schema_version 2 is not supported/);
});

test('ingested capture compiles to native HTML with its recorded pointer intact',async t=>{
  const root=await tempRoot('reshoot-native-');t.after(()=>rm(root,{recursive:true,force:true}));
  const run=await fakeReshootRun(root),job=path.join(root,'job'),capture=path.join(job,'capture','ui-workspace');
  await ingestReshootRun(run,capture,{task:'ui-workspace'});
  await put(job,'job.json',{duration:6,width:1920,height:1080});
  const words='sign in to the workspace open the delivered video'.split(' ').map((text,index)=>({text,start:index*.5,end:index*.5+.3}));
  await put(job,'alignment.json',{words});
  await put(job,'film.json',{version:2,title:'Capture',concept:'Actual task',scenes:[{id:'ui-review',idea:'Recorded task',kind:'html',file:'compositions/ui-review.html'}]});
  const result=await compileCaptureScene(job,capture,EDITS);
  assert.match(await readFile(result.file,'utf8'),/<video/);
  assert.ok(!(await exists(path.join(job,'assets/app-review/cursor.svg'))));
  assert.ok(await exists(path.join(capture,'recording.mp4')));
});
