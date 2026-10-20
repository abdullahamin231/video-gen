import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {reconcile} from '../lib/timing.mjs';
import {useBundle} from '../lib/library.mjs';
import {sourceFingerprint, fileHash, loadReviewPack, REVIEW_ROLES} from '../lib/review.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (command, job) => spawnSync(process.execPath, [path.join(ROOT,'scripts/video.mjs'),command,'--job',job], {encoding:'utf8'});
async function fixture(t) {
  const job = await mkdtemp(path.join(tmpdir(),'video-pipeline-'));
  t.after(()=>rm(job,{recursive:true,force:true}));
  for (const dir of ['assets','compositions','review']) await mkdir(path.join(job,dir));
  // Synthetic test fixture only; production preparation obtains real ASR words.
  const audio = Buffer.from('test recording bytes');
  await writeFile(path.join(job,'assets/narration.wav'),audio);
  const manifest = {duration:2,width:1920,height:1080,name:'fixture',canvas:'#f0eadf',
    transcription:{language:'en'},audio:{sha256:createHash('sha256').update(audio).digest('hex')}};
  const a = reconcile([{id:'w0',text:'local',start:.1,end:.4},{id:'w1',text:'machine',start:.5,end:1}], 'local machine');
  const plan = {version:1,scenes:[{id:'opening',file:'compositions/opening.html',purpose:'Test cue-driven assembly',
    start:{boundary:'start'},end:{boundary:'end'},beats:[{id:'device',cue:{wordId:'w1'},duration:.5,
      action:'assemble',purpose:'Device appears',visual:'Build device',targets:['#opening-device']}]}]};
  for (const [name,data] of Object.entries({'job.json':manifest,'alignment.json':a,'beats.json':plan}))
    await writeFile(path.join(job,name),JSON.stringify(data));
  await writeFile(path.join(job,'compositions/opening.html'),'<template><div data-composition-id="opening"><div id="opening-device"></div></div><script>const cues = window.VideoCues;</script></template>');
  return {job,plan};
}
test('CLI assembles supplied audio, generated cues, local helpers and timed hosts', async t=>{
  const {job}=await fixture(t), result=run('assemble',job);
  assert.equal(result.status,0,result.stderr);
  const root=await readFile(path.join(job,'index.html'),'utf8');
  assert.ok(root.includes('data-composition-src="compositions/opening.html"'));
  assert.ok(root.includes('id="narration" src="assets/narration.wav"'));
  assert.ok(root.includes('background:#f0eadf'));
  const cues=await readFile(path.join(job,'assets/cues.js'),'utf8');
  assert.ok(cues.includes('"localAt": 0.5'));
  assert.equal(run('audit',job).status,0);
});
test('audit detects plan edits requiring root reassembly', async t=>{
  const {job,plan}=await fixture(t);
  assert.equal(run('assemble',job).status,0);
  plan.scenes[0].file='compositions/renamed.html';
  await writeFile(path.join(job,'compositions/renamed.html'),await readFile(path.join(job,'compositions/opening.html')));
  await writeFile(path.join(job,'beats.json'),JSON.stringify(plan));
  const result=run('audit',job);
  assert.equal(result.status,1);
  assert.match(result.stdout,/root host timing is stale/);
});
test('modified audio cannot silently reuse old word timings', async t=>{
  const {job}=await fixture(t);
  await writeFile(path.join(job,'assets/narration.wav'),'different recording');
  const result=run('compile',job);
  assert.equal(result.status,1);
  assert.match(result.stderr,/Narration changed/);
});
test('pipeline audit checks installed library files against frozen hashes', async t=>{
  const {job}=await fixture(t);
  const result = await useBundle(path.join(ROOT, 'library'), 'motion-primitives@1.0.0', job);
  assert.equal(run('assemble',job).status,0);
  assert.equal(run('audit',job).status,0);
  await writeFile(path.join(job,result.path,'motion.js'),'changed helper');
  const audit = run('audit',job);
  assert.equal(audit.status,1);
  assert.match(audit.stdout,/frozen file changed/);
});

test('CLI qualifies real encoded media only after prototype and final independent review records',async t=>{
  const {job}=await fixture(t);
  await mkdir(path.join(job,'renders'));
  const ffmpeg = args => {
    const result=spawnSync('ffmpeg',['-nostdin','-v','error','-y','-threads','1','-filter_threads','1',...args],{encoding:'utf8'});
    assert.equal(result.status,0,result.error?.message || result.stderr);
  };
  ffmpeg(['-f','lavfi','-i','aevalsrc=0.2*sin(2*PI*(180*t+130*t*t)):s=48000:d=2',
    '-c:a','pcm_s16le',path.join(job,'assets/narration.wav')]);
  ffmpeg(['-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=2',
    '-i',path.join(job,'assets/narration.wav'),'-c:v','libx264','-preset','ultrafast',
    '-c:a','aac','-b:a','192k','-shortest',path.join(job,'renders/video.mp4')]);
  const manifest=JSON.parse(await readFile(path.join(job,'job.json')));
  manifest.width=320;manifest.height=180;manifest.fps=30;
  manifest.audio.sha256=await fileHash(path.join(job,'assets/narration.wav'));
  await writeFile(path.join(job,'job.json'),JSON.stringify(manifest));
  assert.equal(run('assemble',job).status,0);
  assert.equal(run('verify',job).status,0);
  const before=run('deliver',job);
  assert.equal(before.status,1);
  assert.notEqual(JSON.parse(await readFile(path.join(job,'job.json'))).status,'complete');
  await writeFile(path.join(job,'review/REPORT.md'),'Synthetic integration fixture: reviewer judgments below are test data, not real agent reviews.');
  // A test fixture simulates the receipt written by render. Real production must
  // render through the pipeline and commission actual independent agents.
  await writeFile(path.join(job,'review/render-source.json'),JSON.stringify({version:1,
    sourceHash:await sourceFingerprint(job),videoSha256:await fileHash(path.join(job,'renders/video.mp4'))}));
  for(const stage of ['prototype','final']) {
    const packResult=spawnSync(process.execPath,[path.join(ROOT,'scripts/video.mjs'),'review-pack','--job',job,'--stage',stage],{encoding:'utf8'});
    assert.equal(packResult.status,0,packResult.error?.message || packResult.stderr);
    const dispatch=JSON.parse(packResult.stdout);
    assert.equal(dispatch.briefs.length,3);
    assert.equal(dispatch.packSha256,await fileHash(path.join(job,`review/${stage}/pack.json`)));
    assert.match(await readFile(dispatch.briefs[0].path,'utf8'),/Blind first pass: BEFORE reading/);
    const context=await loadReviewPack(job,stage);
    for(const role of REVIEW_ROLES) {
      const report={version:1,stage,role,reviewer:{agentId:`/fixture/${role}`,independent:true},
        sourceHash:context.pack.sourceHash,videoSha256:context.pack.videoSha256,packSha256:context.packSha256,
        inspection:{mode:'frame-sequence',visual:'viewed',evidence:context.pack.evidence.filter(e=>e.kind==='frames').map(e=>e.path),limitations:['Synthetic reviewer test fixture, not a production judgment.'],
          ...(role==='narration-fidelity'?{audio:'signal-verified'}:{})},
        coverage:[context.pack.interval],initialObservation:'Test pattern changes.',findings:[],verdict:'pass'};
      const input=path.join(job,`review/${stage}-${role}-input.json`);
      await writeFile(input,JSON.stringify(report));
      const submit=spawnSync(process.execPath,[path.join(ROOT,'scripts/video.mjs'),'review-submit','--job',job,'--file',input],{encoding:'utf8'});
      assert.equal(submit.status,0,submit.error?.message || submit.stderr);
    }
    const status=spawnSync(process.execPath,[path.join(ROOT,'scripts/video.mjs'),'review-status','--job',job,'--stage',stage],{encoding:'utf8'});
    assert.equal(status.status,0,status.stderr);
  }
  const delivery=run('deliver',job);
  assert.equal(delivery.status,0,delivery.stderr);
  assert.equal(JSON.parse(await readFile(path.join(job,'job.json'))).status,'complete');
  const qualified=JSON.parse(await readFile(path.join(job,'review/delivery.json')));
  assert.equal(qualified.reviewerIds.length,3);
  await writeFile(path.join(job,'compositions/opening.html'),(await readFile(path.join(job,'compositions/opening.html'),'utf8'))+'\n<!-- revised -->');
  const stale=run('deliver',job);
  assert.equal(stale.status,1);
  assert.match(stale.stderr,/stale/);
  assert.notEqual(JSON.parse(await readFile(path.join(job,'job.json'))).status,'complete');
});

test('role agents cannot advance the pipeline, and every brief opens with the sub-agent boundary', async () => {
  const {writeBrief, ROLE_BOUNDARY} = await import('../lib/briefs.mjs');
  const {mkdtemp, readFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  for (const [command, extra] of [['next', []], ['render', []], ['review-pack', []], ['deliver', []], ['save-all', []], ['build', []]]) {
    const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/video.mjs'), command, '--job', 'jobs/none', ...extra], {encoding: 'utf8', env: {...process.env, VIDEO_AGENT_ROLE: 'reviewer'}});
    assert.equal(result.status, 1, command);
    assert.match(result.stderr, /orchestrator's job\. You are the reviewer/, command);
  }
  // A scene build is the builder's own work; it fails here only because the job does not exist.
  const scene = spawnSync(process.execPath, [path.join(ROOT, 'scripts/video.mjs'), 'build', '--job', 'jobs/none', '--scene', 'a'], {encoding: 'utf8', env: {...process.env, VIDEO_AGENT_ROLE: 'builder'}});
  assert.doesNotMatch(scene.stderr, /orchestrator's job/);
  const job = await mkdtemp(path.join(tmpdir(), 'video-brief-'));
  try {
    const text = await readFile(await writeBrief(job, 'review-x.md', '# Role: reviewer\n\nBody.\n'), 'utf8');
    assert(text.startsWith('# Role: reviewer\n\n' + ROLE_BOUNDARY));
    assert.match(text, /Body\.\n$/);
  } finally { await rm(job, {recursive: true, force: true}); }
});
