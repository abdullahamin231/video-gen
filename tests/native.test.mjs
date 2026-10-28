import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, access} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildFilm, filmAudit, nextStep} from '../lib/film.mjs';
import {openNativeInspector} from '../lib/native.mjs';
import {createReviewPack} from '../lib/review-pack.mjs';

async function fixture(t) {
  const base = path.resolve('.cache/tests'); await mkdir(base, {recursive:true});
  const job = await mkdtemp(path.join(base, 'native-'));
  t.after(() => rm(job, {recursive:true, force:true}));
  for (const dir of ['assets', 'inputs', 'review', 'compositions']) await mkdir(path.join(job, dir));
  const manifest = {name:'native-fixture', duration:4, width:320, height:180, fps:30, status:'prepared'};
  const put = (name, value) => writeFile(path.join(job, name), JSON.stringify(value));
  await put('job.json', manifest);
  await put('alignment.json', {matchRatio:1, words:[{id:'w0',text:'one',start:0,end:1},{id:'w1',text:'two',start:2,end:3}]});
  await put('film.json', {version:2,title:'Native',concept:'A direct composition',scenes:[
    {id:'one',idea:'First state',kind:'html',file:'compositions/one.html'},
    {id:'two',idea:'Second state',kind:'html',file:'compositions/two.html',start:{phrase:'two'}}]});
  const audio = spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=4','-ar','48000','-ac','1',path.join(job,'assets/narration.wav')]);
  assert.equal(audio.status,0,audio.stderr?.toString());
  for (const [id,color] of [['one','#ff0000'],['two','#00ffff']]) await writeFile(path.join(job,`compositions/${id}.html`),`<!doctype html><html><body><template id="${id}-template"><style>#${id}-root{position:absolute;inset:0;background:${color}}#${id}-mark{width:80px;height:80px;background:#ffffff}</style><div id="${id}-root" data-composition-id="${id}" data-width="320" data-height="180" data-duration="2"><div id="${id}-mark"></div></div><script>const ${id}Timeline=gsap.timeline({paused:true});${id}Timeline.fromTo('#${id}-mark',{x:0},{x:120,duration:1},0);window.__timelines['${id}']=${id}Timeline;</script></template></body></html>`);
  return {job,manifest};
}

test('native film builds without a world runtime and captures the actual second scene', async t => {
  const {job,manifest}=await fixture(t);
  const result=await buildFilm(job,{print:false});
  assert.equal(result.ok,true,JSON.stringify(result));
  await assert.rejects(access(path.join(job,'compositions/world.html')));
  await assert.rejects(access(path.join(job,'assets/kit/kit.js')));
  await filmAudit(job);
  const inspector=await openNativeInspector(job,manifest);
  try {
    await inspector.seek(1);
    const first=await inspector.page.evaluate(()=>getComputedStyle(document.elementFromPoint(280,150)).backgroundColor);
    await inspector.seek(3);
    const state=await inspector.page.evaluate(()=>({color:getComputedStyle(document.elementFromPoint(280,150)).backgroundColor,
      topColor:getComputedStyle(document.elementFromPoint(280,150)).backgroundColor}));
    assert.equal(first,'rgb(255, 0, 0)'); assert.equal(state.color,'rgb(0, 255, 255)'); assert.equal(state.topColor,'rgb(0, 255, 255)');
    await inspector.screenshot(3,path.join(job,'review/native-second.png'));
  } finally {await inspector.close();}
  const pack=await createReviewPack(job);
  assert.ok(pack);
  const saved=JSON.parse(await readFile(path.join(job,'review/final/pack.json')));
  assert.equal(saved.scenes.length,2);
  assert.ok(saved.evidence.some(e=>e.kind==='frames'&&e.start>=2));
  const run=promisify(execFile);
  await run(process.execPath,[path.resolve('scripts/video.mjs'),'render','--job',job,'--reuse-build','true','--workers','1'],{maxBuffer:2*1024*1024});
  for(const [time,expected] of [[1,[255,0,0]],[3,[0,255,255]]]) {
    const {stdout}=await run('ffmpeg',['-v','error','-ss',String(time),'-i',path.join(job,'renders/video.mp4'),'-frames:v','1','-vf','crop=2:2:280:150,scale=1:1,format=rgb24','-f','rawvideo','pipe:1'],{encoding:'buffer'});
    assert.equal(stdout.length,3);expected.forEach((channel,index)=>assert.ok(Math.abs(stdout[index]-channel)<15));
  }

});

test('native missing scene fails build and routes to its author rather than review', async t=>{
  const {job}=await fixture(t);
  await rm(path.join(job,'compositions/two.html'));
  const result=await buildFilm(job,{inspect:false,print:false});
  assert.equal(result.ok,false);assert.ok(result.errors.some(e=>e.includes('two.html')));
  assert.equal((await nextStep(job)).state,'build');
});
