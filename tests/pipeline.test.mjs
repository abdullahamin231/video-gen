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
