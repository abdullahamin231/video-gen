import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {nextStep, buildFilm, reviewTemplate} from '../lib/film.mjs';
import {sourceFingerprint, fileHash, loadReviewPack, submitReview, REVIEW_ROLES} from '../lib/review.mjs';
import {createReviewPack} from '../lib/review-pack.mjs';
import {readFile} from 'node:fs/promises';
import {compileFilm} from '../lib/spec.mjs';
import {installKit, writeWorld} from '../lib/world.mjs';
import {inspectFilm, chromePath, openInspector} from '../lib/inspect.mjs';

const put = (job, file, value) => writeFile(path.join(job,file),JSON.stringify(value));
async function fixture(t, {owners={}}={}) {
  const job=await mkdtemp(path.join(os.tmpdir(),'film-workflow-'));
  t.after(()=>rm(job,{recursive:true,force:true}));
  for(const dir of ['shots','inputs','review','assets']) await mkdir(path.join(job,dir));
  const words=['opening','comparison','ending'].map((text,i)=>({id:`w${i}`,text,start:i*6,end:i*6+1}));
  const alignment={matchRatio:1,words},manifest={duration:18,width:1920,height:1080,status:'prepared'};
  const film={version:2,title:'Fixture',concept:'A comparison',alternatives:[{concept:'A',rejected:'B'},{concept:'C',rejected:'D'}],subjects:[{id:'subject',what:'Recurring subject'}],prototype:'comparison',
    scenes:words.map((w,i)=>({id:w.text,start:i?{phrase:w.text}:{boundary:'start'},idea:'Idea',mechanism:'Operation',states:['initial','operation','consequence'],payoff:'Result',camera:'Static',handoff:'Same subject',why_not_basic:'Meaning',alternatives:['Other'],carry:i?['subject']:[],...(owners[w.text]?{owner:owners[w.text]}:{})}))};
  await put(job,'job.json',manifest);await put(job,'alignment.json',alignment);await put(job,'film.json',film);
  return {job,film,manifest,alignment};
}

test('the director builds the prototype and its context in one brief; later scenes wait',async t=>{
  const {job}=await fixture(t);
  const first=await nextStep(job);
  assert.equal(first.state,'build prototype');assert.match(first.text,/video-director: "Read .*direct-opening\.md/);
  assert.match(first.text,/"opening", "comparison"/);assert.doesNotMatch(first.text,/ending/);
  const brief=await readFile(path.join(job,'briefs/direct-opening.md'),'utf8');
  assert.match(brief,/### opening/);assert.match(brief,/### comparison/);assert.doesNotMatch(brief,/### ending/);
});

test('delegated scenes go to builders in order, before a dependent prototype',async t=>{
  const {job}=await fixture(t,{owners:{opening:'builder',comparison:'builder'}});
  const first=await nextStep(job);
  assert.match(first.text,/video-builder: "Read .*build-opening\.md/);assert.doesNotMatch(first.text,/build-ending\.md/);
  assert.match(await readFile(path.join(job,'briefs/build-opening.md'),'utf8'),/complete creative authority/);
  await put(job,'shots/opening.json',{scene:'opening',objects:[{id:'subject',type:'circle',at:[960,540],r:100}],actions:[]});
  const second=await nextStep(job);
  assert.match(second.text,/build-comparison\.md/);assert.doesNotMatch(second.text,/build-ending\.md/);
});

test('a passing build with builder notes stays fresh across next',async t=>{
  const {job}=await fixture(t);
  await put(job,'shots/opening.json',{scene:'opening',notes:'Kept a long hold on purpose.',objects:[{id:'subject',type:'circle',at:[960,540],r:100}],actions:[]});
  await put(job,'shots/comparison.json',{scene:'comparison',objects:[],actions:[]});
  await nextStep(job);
  const built=await buildFilm(job,{inspect:false,print:false});
  assert.ok(built.ok);
  await nextStep(job);
  assert.equal(JSON.parse(await readFile(path.join(job,'review/build.json'))).sourceHash,await sourceFingerprint(job));
  assert.match(await readFile(path.join(job,'STORYBOARD.md'),'utf8'),/Kept a long hold on purpose/);
});

test('persisted complete status without current delivery evidence cannot report done',async t=>{
  const {job,manifest}=await fixture(t);await put(job,'job.json',{...manifest,status:'complete'});
  assert.notEqual((await nextStep(job)).state,'done');
});

async function failedReviewFixture(t, {scope='scene',sceneIds,owners}={}) {
  const f=await fixture(t,{owners}),{job}=f;
  await put(job,'shots/opening.json',{scene:'opening',objects:[{id:'subject',type:'circle',at:[960,540],r:100}],actions:[]});
  await put(job,'shots/comparison.json',{scene:'comparison',objects:[],actions:[]});
  await buildFilm(job,{inspect:false,print:false});
  await mkdir(path.join(job,'renders'));await mkdir(path.join(job,'review/prototype'));
  await writeFile(path.join(job,'renders/video.mp4'),'Synthetic state-machine fixture, not video.');
  const sourceHash=await sourceFingerprint(job),videoSha256=await fileHash(path.join(job,'renders/video.mp4'));
  await put(job,'review/render-source.json',{version:1,sourceHash,videoSha256});
  const evidence=[];
  for (const [name,kind] of [['frame.png','frames'],['sheet.png','contact-sheet'],['clip.mp4','clip'],['audio.wav','audio']]) {
    const file='review/prototype/'+name;await writeFile(path.join(job,file),'Synthetic evidence fixture');
    evidence.push({path:file,kind,start:6,end:kind==='frames'?6:16,sha256:await fileHash(path.join(job,file))});
  }
  await put(job,'review/prototype/pack.json',{version:1,stage:'prototype',sourceHash,videoSha256,duration:18,interval:{start:6,end:16},scenes:[{id:'comparison',start:6,end:16}],evidence});
  const context=await loadReviewPack(job,'prototype');
  for(const role of REVIEW_ROLES) await submitReview(job,{version:1,stage:'prototype',role,sourceHash,videoSha256,packSha256:context.packSha256,
    reviewer:{agentId:'/fixture/'+role,independent:true},inspection:{mode:'frame-sequence',visual:'viewed',evidence:[evidence[0].path],limitations:['Synthetic test judgment, not a production review.'],...(role==='narration-fidelity'?{audio:'listened'}:{})},
    initialObservation:'Synthetic fixture',coverage:[{start:6,end:16}],verdict:role==='visual-mechanism'?'revise':'pass',
    findings:role==='visual-mechanism'?[{id:'F1',severity:'blocking',scope,...(sceneIds?{sceneIds}:{}),start:6,end:7,subject:'subject',requirement:'Meaning',observed:'Result missing',repair:'Show the consequence',evidence:[evidence[0].path]}]:[]});
  return {...f,context};
}

test('querying one failed pack twice does not consume rounds or invalidate the render',async t=>{
  const {job}=await failedReviewFixture(t),before=await sourceFingerprint(job);
  assert.equal((await nextStep(job)).state,'repair');
  assert.equal((await nextStep(job)).state,'repair');
  assert.equal(await sourceFingerprint(job),before);
  assert.equal(JSON.parse(await readFile(path.join(job,'job.json'))).reviewRounds.prototype,1);
});

test('concept failures return to the director; boundary findings can target the earlier scene',async t=>{
  const plan=await failedReviewFixture(t,{scope:'plan'});
  assert.equal((await nextStep(plan.job)).state,'revise plan');
  assert.equal((await nextStep(plan.job)).state,'revise plan');
  const boundary=await failedReviewFixture(t,{sceneIds:['opening'],owners:{opening:'builder'}});
  assert.match((await nextStep(boundary.job)).text,/video-builder: "Read .*repair-opening\.md/);
});

test('repairs go to the owner: one director for its scenes, builders for delegated ones, in parallel',async t=>{
  const {job}=await failedReviewFixture(t,{sceneIds:['opening','comparison'],owners:{opening:'builder'}});
  const step=await nextStep(job);
  assert.equal(step.state,'repair');
  assert.match(step.text,/video-director: "Read .*repair-director\.md/);assert.match(step.text,/video-builder: "Read .*repair-opening\.md/);
  assert.match(await readFile(path.join(job,'briefs/repair-director.md'),'utf8'),/### comparison[\s\S]*Result missing/);
});

test('house style is advice: small text and bouncy eases warn, invented numbers still fail',async t=>{
  const {job,film,alignment,manifest}=await fixture(t);
  await put(job,'shots/opening.json',{scene:'opening',notes:'Tiny texture labels on purpose.',objects:[{id:'subject',type:'text',at:[960,540],text:'fine print',size:18}],
    actions:[{do:'fadeIn',target:'subject',at:'start',ease:'bounce.out'}]});
  const {warnings,timing}=await compileFilm(job,film,alignment,manifest,{allowMissing:true});
  assert.ok(warnings.some(w=>/text size 18/.test(w))&&warnings.some(w=>/bounce/.test(w)),warnings.join('\n'));
  assert.equal(timing.scenes[0].notes,'Tiny texture labels on purpose.');
  await put(job,'shots/opening.json',{scene:'opening',objects:[{id:'subject',type:'text',at:[960,540],text:'999 tokens'}],actions:[]});
  await assert.rejects(compileFilm(job,film,alignment,manifest,{allowMissing:true}),/displays 999/);
});

test('review templates leave inspection and coverage unclaimed; final review rejects missing scenes',async t=>{
  const {job}=await failedReviewFixture(t);
  const template=JSON.parse(await readFile(await reviewTemplate(job,{stage:'prototype',role:'visual-mechanism'})));
  assert.deepEqual(template.coverage,[]);assert.deepEqual(template.inspection.evidence,[]);assert.match(template.inspection.visual,/FILL-IN/);
  await assert.rejects(createReviewPack(job,{stage:'final'}),/cannot omit scenes/);
});

test('later visible subjects do not leak into the opening',async t=>{
  const {job,film,alignment,manifest}=await fixture(t);
  await put(job,'shots/comparison.json',{scene:'comparison',objects:[{id:'later',type:'circle',at:[960,540],r:100,visible:true}],actions:[]});
  const {world}=await compileFilm(job,film,alignment,manifest,{allowMissing:true});
  assert.equal(world.objects.find(o=>o.id==='later').visible,false);
  assert.ok(world.actions.some(a=>a.do==='show'&&a.target==='later'&&a.t===6));
});

test('real browser: a camera pan cannot disguise a static subject',async t=>{
  try{await chromePath();}catch{return t.skip('Chrome unavailable');}
  const {job,manifest}=await fixture(t);await installKit(job);
  const world={...manifest,duration:6,theme:{},camera:{center:[960,540],zoom:1},scenes:[{id:'camera',start:0,end:6,cues:{}}],
    objects:[{id:'left',type:'circle',at:[500,400],r:100,visible:true,scene:'camera'},
      {id:'right',type:'circle',at:[1420,400],r:100,visible:true,scene:'camera'},
      {id:'bottom',type:'circle',at:[960,800],r:100,visible:true,scene:'camera'}],
    actions:[{do:'camera',center:[1040,540],zoom:1,t:0,dur:6,scene:'camera',order:0}],hooks:[],componentSrc:[],media:[]};
  await writeWorld(job,world,{...manifest,duration:6});
  const result=await inspectFilm(job,manifest,{scenes:[{id:'camera',start:0,end:6,holds:[]}]});
  assert.ok(result.warnings.some(e=>/nothing develops/.test(e)),JSON.stringify(result));
  assert.deepEqual(result.report.scenes.camera.windows,[0,0,0,0]);
});

test('real browser: dash changes stay discrete and initial SVG attributes are set correctly',async t=>{
  try{await chromePath();}catch{return t.skip('Chrome unavailable');}
  const {job,manifest}=await fixture(t);await installKit(job);
  const world={...manifest,duration:3,theme:{},scenes:[{id:'dash',start:0,end:3,cues:{}}],
    objects:[{id:'subject',type:'rect',at:[960,540],size:[600,300],visible:true,scene:'dash'}],
    actions:[{do:'set',target:'subject',props:{'stroke-dasharray':'10 9',opacity:0.45},t:1,dur:0.7,scene:'dash',order:0}],
    hooks:[{file:'test-fixture',src:"VG.hook('dash', k => { const el = k.part('subject.shape'); k.setNow(el, {'attr.stroke-width': 7}); });"}],componentSrc:[],media:[]};
  await writeWorld(job,world,{...manifest,duration:3});
  const ins=await openInspector(job,{...manifest,duration:3});
  try {
    for(const time of [0,1,1.00001,1.01333,2,0,1.01333]) {
      await ins.seek(time);
      const values=await ins.page.evaluate(()=>({dash:document.querySelector('#vg-subject').getAttribute('stroke-dasharray'),width:document.querySelector('#vg-subject rect').getAttribute('stroke-width')}));
      assert.equal(values.width,'7');
      assert.ok(!values.dash||values.dash==='none'||values.dash==='0'||values.dash.split(/[ ,]+/).every(n=>Number(n)>=1),JSON.stringify({time,values}));
    }
    assert.equal(ins.consoleErrors.length,0);
  } finally {await ins.close();}
});
