// The capture compiler: an ingested reshoot capture becomes a scene whose click rings and camera push-ins are derived
// from what the task actually did. reshoot composites the cursor into the footage, so nothing here draws a second
// pointer, and a capture without that recorder is refused rather than compiled without one.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, access} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {updateOmissionEvidence, validateEdits, clusterClicks, clusterFocus, compileCaptureScene} from '../lib/capture-scene.mjs';
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

/** A synthetic ingested capture: a real 3 s video and a real action log, no reshoot or Chrome needed. */
async function fakeCapture(root, {duration = 3.2} = {}) {
  const dir = path.join(root, 'capture', 'F7-filters');
  await mkdir(dir, {recursive: true});
  await ffmpeg(['-y', '-f', 'lavfi', '-i', `testsrc=size=1600x1000:rate=30:duration=${duration}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', path.join(dir, 'recording.mp4')]);
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
    version: 1, task: 'F7-filters', feature: 'create a filter', claim: 'a filter appears in the list', build: '1.4.2',
    url: 'https://app.example.test/filters', viewport: [1600, 1000], scale: 2, frameSize: [1600, 1000],
    recorder: {app: 'reshoot', version: '0.3.9', pointer: 'composited', pixelRatio: 2},
    startedAt: new Date().toISOString(), duration, frames: 40,
    files: {recording: {path: 'recording.mp4', sha256: 'fixture'}},
    results: [{kind: 'assert', ok: true, target: '#filters', expected: 'Bikes'}],
  }, null, 2));
  const actions = [
    {t: 0.1, type: 'goto', url: 'https://app.example.test/filters', title: 'Filters'},
    {t: 0.8, type: 'click', x: 240, y: 160, target: '#new-filter', why: 'open the dialog', bounds: [140, 140, 200, 44]},
    {t: 1.2, type: 'type', startedAt: 1.05, dur: 0.15, target: '#name', text: 'Bikes', why: null},
    {t: 1.5, type: 'click', x: 420, y: 200, target: '#save', why: 'save it', bounds: [360, 180, 120, 40]},
    {t: 1.95, type: 'scroll', dy: 420, fromY: 0, scrollY: 320, dur: 0.38, why: 'view the new row'},
    {t: 2.6, type: 'click', x: 900, y: 620, target: '#row-3', why: 'the new row', bounds: [700, 600, 400, 40]},
    {t: 3.0, type: 'assert', target: '#filters', text: 'Bikes', ok: true, why: 'the filter is listed'},
    {t: 3.1, type: 'end'},
  ];
  const actionLog = actions.map(a => JSON.stringify(a)).join('\n') + '\n';
  await writeFile(path.join(dir, 'actions.jsonl'), actionLog);
  const actionHash = createHash('sha256').update(actionLog).digest('hex');
  const manifestFile = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  manifest.files.actions = {path: 'actions.jsonl', sha256: actionHash};
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
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
    scenes: [{
      id: 'filters', kind:'html',file:'compositions/filters.html', start: {boundary: 'start'}, idea: 'Show the filter being created', mechanism: 'Click the button, type a name, save',
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

test('capture adapter emits native HTML with local cuts and source evidence',async t=>{
  const root=await tempRoot('native-capture-');t.after(()=>rm(root,{recursive:true,force:true}));
  const capture=await fakeCapture(root),{job}=await fixtureJob(root);
  const result=await compileCaptureScene(job,capture,EDITS,{width:1920,height:1080});
  assert.ok(result.file.endsWith('compositions/filters.html'));
  assert.match(await readFile(result.file,'utf8'),/<video/);
  const metadata=JSON.parse(await readFile(result.file.replace(/\.html$/,'.capture.json'),'utf8'));
  assert.equal(metadata.objects.length,2);assert.equal(metadata.objects[0].type,'video');
  assert.ok(await exists(path.join(capture,'recording.mp4')));
});

test('a capture without a composited pointer is refused instead of compiled without one', async t => {
  const root = await tempRoot('capture-scene-legacy-recorder-'); t.after(() => rm(root, {recursive: true, force: true}));
  const capture = await fakeCapture(root);
  const manifestFile = path.join(capture, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  manifest.recorder = {pointer: 'not composited'};
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  const {job} = await fixtureJob(root);
  await assert.rejects(compileCaptureScene(job, capture, EDITS),
    /was not recorded with a composited pointer.*record the task again with reshoot/i);
});

test('a screenshot-only capture cannot compile into an app-review scene', async t => {
  const root = await tempRoot('capture-scene-shot-only-'); t.after(() => rm(root, {recursive:true,force:true}));
  const capture = await fakeCapture(root);
  const shotLog = JSON.stringify({t:1,type:'shot',src:'shots/result.png',state:'result'})+'\n';
  await writeFile(path.join(capture,'actions.jsonl'), shotLog);
  const manifestFile = path.join(capture, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  manifest.files.actions.sha256 = createHash('sha256').update(shotLog).digest('hex');
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  const {job} = await fixtureJob(root);
  await assert.rejects(compileCaptureScene(job,capture,{scene:'filters',edits:[{id:'result',phrase:'the result',source:[0.5,2.5],feature:'filter'}]}),/no recorded task interaction/);
});

test('meaningful actions with malformed timestamps cannot evade capture completeness', async t => {
  const root = await tempRoot('capture-scene-bad-time-'); t.after(() => rm(root, {recursive:true,force:true}));
  const capture = await fakeCapture(root);
  const actionsFile = path.join(capture, 'actions.jsonl'), manifestFile = path.join(capture, 'manifest.json');
  const actions = (await readFile(actionsFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  delete actions.find(action => action.type === 'click').t;
  const log = actions.map(action => JSON.stringify(action)).join('\n') + '\n';
  await writeFile(actionsFile, log);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  manifest.files.actions.sha256 = createHash('sha256').update(log).digest('hex');
  await writeFile(manifestFile, JSON.stringify(manifest));
  const {job} = await fixtureJob(root);
  await assert.rejects(compileCaptureScene(job, capture, EDITS), /action \d+ \(click\) has invalid timestamp/);
});

test('capture-scene refuses edits that do not match the recording', async t => {
  const root = await tempRoot('capture-scene-bad-');
  t.after(() => rm(root, {recursive: true, force: true}));
  const capture = await fakeCapture(root);
  const {job} = await fixtureJob(root);
  await assert.rejects(compileCaptureScene(job, capture, {scene: 'filters', edits: [
    {id: 'too-long', phrase: 'add a filter', source: [0.5, 9.5], feature: 'F7'},
  ]}), /outside the .* recording/);
});

test('capture-scene blocks screenshot-only edits and cuts through typing or waits', async t => {
  const root = await tempRoot('capture-scene-sequence-');
  t.after(() => rm(root, {recursive: true, force: true}));
  const capture = await fakeCapture(root);
  const {job} = await fixtureJob(root);
  await assert.rejects(compileCaptureScene(job, capture, {scene: 'filters', edits: [
    {id: 'still', phrase: 'the saved filter', source: [2.1, 2.55], feature: 'F7'},
  ]}), /no recorded task interaction.*screenshots cannot stand in/i);
  const actionsFile = path.join(capture, 'actions.jsonl');
  const refreshManifestActionHash = async () => {
    const manifestFile = path.join(capture, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    manifest.files.actions.sha256 = createHash('sha256').update(await readFile(actionsFile)).digest('hex');
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  };
  const actions = JSON.parse((await readFile(actionsFile, 'utf8')).split('\n').find(line => JSON.parse(line).type === 'type'));
  actions.startedAt = 0.95;
  actions.dur = 0.3;
  const lines = (await readFile(actionsFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const revised = lines.map(action => action.type === 'type' ? actions : action);
  await writeFile(actionsFile, revised.map(action => JSON.stringify(action)).join('\n') + '\n');
  await refreshManifestActionHash();
  await assert.rejects(compileCaptureScene(job, capture, {scene: 'filters', edits: [
    {id: 'partial', phrase: 'enter the name', source: [1.1, 1.55], feature: 'F7'},
  ]}), /cuts through a recorded type sequence/);
  await writeFile(actionsFile, revised.map(action => JSON.stringify(action.type === 'type' ? {...action, type: 'wait'} : action)).join('\n') + '\n');
  await refreshManifestActionHash();
  await assert.rejects(compileCaptureScene(job, capture, {scene: 'filters', edits: [
    {id: 'partial-wait', phrase: 'wait for the result', source: [1.1, 1.55], feature: 'F7'},
  ]}), /cuts through a recorded wait sequence/);
});

test('omitted task actions require action-log-bound omission records and preserve full wait semantics', async t => {
  const root = await tempRoot('capture-scene-omission-'), otherRoot = await tempRoot('capture-scene-omission-other-');
  t.after(() => Promise.all([rm(root, {recursive: true, force: true}), rm(otherRoot, {recursive: true, force: true})]));
  const capture = await fakeCapture(root), {job} = await fixtureJob(root);
  const edits = {scene: 'filters', edits: [{id: 'open', phrase: 'add a filter', source: [0.6, 1.05], feature: 'F7'}]};
  await assert.rejects(compileCaptureScene(job, capture, edits), /need evidence-backed omissions/);
  const log = await readFile(path.join(capture, 'actions.jsonl'));
  const digest = createHash('sha256').update(log).digest('hex');
  const actions = log.toString().trim().split('\n').map(JSON.parse);
  edits.omissions = actions.map((action, actionIndex) => ({action, actionIndex})).filter(({action}) =>
    ['click','type','press','scroll','wait'].includes(action.type) && (action.t < 0.6 || action.t > 1.05)).map(({actionIndex}) => ({
      actionIndex, reason: 'This action is outside the narrated moment selected for this cut.',
      evidence: [{kind: 'action-log', path: 'actions.jsonl', sha256: digest, actionIndex}],
    }));
  const compiled = await compileCaptureScene(job, capture, edits);
  assert.ok(compiled.omissions.length > 0);
  const saved = JSON.parse(await readFile(path.join(capture, 'omissions.json'), 'utf8'));
  assert.equal(saved.version, 2);
  assert.equal(saved.scenes[0].scene, 'filters');
  assert.equal(saved.scenes[0].actionsSha256, digest);
  assert.equal(saved.scenes[0].omissionCount, compiled.omissions.length);
  assert.equal(saved.records[0].evidence[0].sha256, digest);
  assert.equal(saved.actionsSha256, digest);
  const otherCapture = await fakeCapture(otherRoot);
  const otherEvidence = {version: 1, capture: 'other-task', actionsSha256: 'other-capture-hash', records: [{scene: 'other-capture-scene'}]};
  await writeFile(path.join(otherCapture, 'omissions.json'), JSON.stringify(otherEvidence));
  // Evidence for a different scene sharing this capture must survive its own scene's refresh.
  saved.records.push({scene: 'other-scene', actionIndex: 99, reason: 'kept', evidence: []});
  await writeFile(path.join(capture, 'omissions.json'), JSON.stringify(saved));
  await compileCaptureScene(job, capture, {scene: 'filters', edits: [
    {id: 'all-actions', phrase: 'add a filter', source: [0.7, 3.1], feature: 'F7'},
  ]});
  const refreshed = JSON.parse(await readFile(path.join(capture, 'omissions.json'), 'utf8'));
  assert.deepEqual(refreshed.records.map(record => record.scene), ['other-scene']);
  assert.deepEqual(JSON.parse(await readFile(path.join(otherCapture, 'omissions.json'), 'utf8')), otherEvidence,
    'compiling one capture must not alter another capture’s evidence');
  assert.equal(await exists(path.join(capture, 'omissions.json')), true,
    'other-scene evidence keeps the shared file present');
  await writeFile(path.join(capture, 'omissions.json'), JSON.stringify({version: 1, capture: 'F7-filters', actionsSha256: digest,
    records: [{scene: 'filters', actionIndex: 99, reason: 'stale', evidence: []}]}));
  await compileCaptureScene(job, capture, {scene: 'filters', edits: [
    {id: 'all-actions-again', phrase: 'add a filter', source: [0.7, 3.1], feature: 'F7'},
  ]});
  const emptied = JSON.parse(await readFile(path.join(capture, 'omissions.json'), 'utf8'));
  assert.deepEqual(emptied.scenes.map(({scene,omissionCount})=>({scene,omissionCount})),[{scene:'filters',omissionCount:0}],
    'a scene with no omitted actions keeps an explicit verified-empty ledger');
  edits.omissions[0].evidence[0].sha256 = '0'.repeat(64);
  await assert.rejects(compileCaptureScene(job, capture, edits), /matching action-log hash/);
});

test('omission ledger flock recovers process death, serializes contenders, and preserves a live owner', async t => {
  const root = await tempRoot('capture-scene-omission-lock-'); t.after(() => rm(root, {recursive:true,force:true}));
  const capture = await fakeCapture(root), {job} = await fixtureJob(root);
  const record=edit=>updateOmissionEvidence(capture,{scene:edit.scene,capture:'F7-filters',actionsSha256:'f'.repeat(64),records:[],ranges:[],expectedActionIndexes:[]});
  const edit = (scene, id, source) => ({scene, edits:[{id,phrase:'show the real task',source:[0.7,3.1],feature:'F7'}]});
  await Promise.all([
    record(edit('filters','first',[0.7,1.1])),
    record(edit('results','second',[1.4,2.1])),
  ]);
  let ledger = JSON.parse(await readFile(path.join(capture,'omissions.json'),'utf8'));
  assert.deepEqual(new Set(ledger.scenes.map(x=>x.scene)),new Set(['filters','results']));
  const lock=path.join(capture,'.omissions.lock');
  const acquire = () => new Promise((resolve,reject) => {
    const child=spawn('flock',['-F','-x',lock,process.execPath,'-e',"process.stdout.write('LOCKED\\n');process.stdin.resume()"],{stdio:['pipe','pipe','pipe']});
    let output=''; child.stdout.setEncoding('utf8'); child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('LOCKED\n'))resolve(child);});
    child.once('error',reject); child.once('close',code=>{if(!output.includes('LOCKED\n'))reject(new Error(`flock holder exited ${code}`));});
  });
  const crashed=await acquire();
  const crashedClosed=new Promise(resolve=>crashed.once('close',resolve));
  crashed.kill('SIGKILL');
  await crashedClosed;
  await Promise.all([
    record(edit('third','after-crash',[0.7,2.9])),
    record(edit('fourth','after-crash-two',[0.7,2.9])),
  ]);
  assert.equal(await exists(lock),true,'persistent lock inode remains available after owner death');
  assert.equal(await exists(path.join(capture,'.omissions.recovery')),false,'no separately crashable recovery lock exists');
  ledger = JSON.parse(await readFile(path.join(capture,'omissions.json'),'utf8'));
  assert.ok(['third','fourth'].every(scene=>ledger.scenes.some(item=>item.scene===scene)), 'competing stale-lock recoverers preserve both scene updates');
  const active=await acquire();
  await assert.rejects(record(edit('blocked-active','blocked-active',[0.7,3.1])),/Timed out waiting.*owner is active/);
  assert.equal(active.exitCode,null,'live owner remains alive while a contender times out');
  active.kill('SIGTERM'); await new Promise(resolve=>active.once('close',resolve));
});

test('killed ledger transaction owner cannot write after lock release while a compiler contends', async t => {
  const root=await tempRoot('capture-scene-omission-owner-death-'); t.after(()=>rm(root,{recursive:true,force:true}));
  const capture=await fakeCapture(root), {job}=await fixtureJob(root);
  const record=edit=>updateOmissionEvidence(capture,{scene:edit.scene,capture:'F7-filters',actionsSha256:'f'.repeat(64),records:[],ranges:[],expectedActionIndexes:[]});
  const edit=(scene,id)=>({scene,edits:[{id,phrase:'show the real task',source:[0.7,3.1],feature:'F7'}]});
  await record(edit('durable','durable'));
  const ledgerFile=path.join(capture,'omissions.json'), before=await readFile(ledgerFile,'utf8');
  const lock=path.join(capture,'.omissions.lock'), marker=path.join(root,'owner-paused');
  const helper=path.join(ROOT,'scripts/omission-lock-holder.mjs');
  const child=spawn('flock',['-F','-x',lock,process.execPath,helper],{env:{...process.env,APPREVIEW_OMISSION_TEST_PAUSE_FILE:marker},stdio:['pipe','pipe','pipe']});
  const ownerClosed=new Promise(resolve=>child.once('close',resolve));
  child.stdin.end(JSON.stringify({captureDir:capture,update:{scene:'crashing',capture:'F7-filters',actionsSha256:'f'.repeat(64),records:[],ranges:[],expectedActionIndexes:[]}}));
  for(let i=0;i<100&&!await exists(marker);i++) await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(await exists(marker),true,'transaction reached its read phase while holding flock');
  const contender=record(edit('contender','contender'));
  child.kill('SIGKILL'); await ownerClosed;
  await contender;
  const after=JSON.parse(await readFile(ledgerFile,'utf8'));
  assert.deepEqual(new Set(after.scenes.map(item=>item.scene)),new Set(['durable','contender']));
  assert.equal(await readFile(ledgerFile,'utf8')===before,false,'contender committed its update after the dead owner released the lock');
  assert.equal(after.scenes.some(item=>item.scene==='crashing'),false,'dead owner never completed or wrote its uncommitted transaction');
  const leftovers=(await (await import('node:fs/promises')).readdir(capture)).filter(name=>name.startsWith('.omissions.')&&name.endsWith('.tmp'));
  assert.deepEqual(leftovers,[],'atomic temporary files from a killed owner are absent');
});

test('scene-less legacy omission records fail closed with migration guidance', async t => {
  const root=await tempRoot('capture-scene-legacy-omissions-'); t.after(()=>rm(root,{recursive:true,force:true}));
  const capture=await fakeCapture(root), {job}=await fixtureJob(root);
  const log=await readFile(path.join(capture,'actions.jsonl'));
  await writeFile(path.join(capture,'omissions.json'),JSON.stringify({version:1,records:[{actionIndex:4,reason:'legacy'}]}));
  const actions=log.toString().trim().split('\n').map(JSON.parse), digest=createHash('sha256').update(log).digest('hex');
  const edits={scene:'filters',edits:[{id:'open',phrase:'open it',source:[0.6,1.05],feature:'F7'}],omissions:actions.map((action,actionIndex)=>({action,actionIndex})).filter(({action})=>['click','type','press','scroll','wait'].includes(action.type)&&(action.t<0.6||action.t>1.05)).map(({actionIndex})=>({actionIndex,reason:'outside this narrated cut',evidence:[{kind:'action-log',path:'actions.jsonl',sha256:digest,actionIndex}]}))};
  await assert.rejects(compileCaptureScene(job,capture,edits),/legacy or malformed scene-less records.*Migrate.*recapture/i);
  assert.match(await readFile(path.join(capture,'omissions.json'),'utf8'),/legacy/,'the ambiguous evidence is preserved for review');
});

test('capture-scene rejects a modified action log even when omission evidence is rehashed', async t => {
  const root = await tempRoot('capture-scene-tampered-actions-'); t.after(() => rm(root, {recursive: true, force: true}));
  const capture = await fakeCapture(root), {job} = await fixtureJob(root);
  const actionsFile = path.join(capture, 'actions.jsonl');
  const original = await readFile(actionsFile, 'utf8');
  const changedActions = original.trim().split('\n').map(JSON.parse);
  changedActions[1].x += 1;
  await writeFile(actionsFile, changedActions.map(action => JSON.stringify(action)).join('\n') + '\n');
  const changedLog = await readFile(actionsFile);
  const changedDigest = createHash('sha256').update(changedLog).digest('hex');
  const actions = changedActions;
  const edits = {scene: 'filters', edits: [{id: 'open', phrase: 'open the dialog', source: [0.7, 1.1], feature: 'F7'}]};
  edits.omissions = actions.map((action, actionIndex) => ({action, actionIndex})).filter(({action}) =>
    ['click', 'type', 'press', 'scroll', 'wait'].includes(action.type) && (action.t < 0.7 || action.t > 1.1)).map(({actionIndex}) => ({
      actionIndex, reason: 'This action is outside the narrated moment selected for this cut.',
      evidence: [{kind: 'action-log', path: 'actions.jsonl', sha256: changedDigest, actionIndex}],
    }));
  await assert.rejects(compileCaptureScene(job, capture, edits), /action log provenance mismatch/);
});

test('legacy captures without an action hash fail closed with recapture guidance', async t => {
  const root = await tempRoot('capture-scene-legacy-no-action-hash-'); t.after(() => rm(root, {recursive: true, force: true}));
  const capture = await fakeCapture(root), {job} = await fixtureJob(root);
  const manifestFile = path.join(capture, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  delete manifest.files.actions;
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  await assert.rejects(compileCaptureScene(job, capture, EDITS), /missing a valid files\.actions\.sha256.*legacy capture cannot be authenticated.*record the task again with reshoot/i);
});

test('captures travel from the script folder into the film job', async t => {
  const root = await tempRoot('capture-scene-carry-');
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
