import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sourceFingerprint, fileHash, loadReviewPack, validateReview, submitReview, reviewStatus,
  acceptedPrototype, qualifyDelivery, REVIEW_ROLES} from '../lib/review.mjs';

const put = (job,file,value) => writeFile(path.join(job,file),JSON.stringify(value,null,2)+'\n');
async function fixture(t) {
  const job = await mkdtemp(path.join(tmpdir(),'video-reviews-'));
  t.after(() => rm(job,{recursive:true,force:true}));
  for (const dir of ['assets','compositions','renders','review']) await mkdir(path.join(job,dir));
  await put(job,'job.json',{duration:12,name:'fixture',review:{producerAgentIds:['/root','/root/builder']},status:'prepared'});
  await writeFile(path.join(job,'index.html'),'<div>renderable source fixture</div>');
  await writeFile(path.join(job,'compositions/scene.html'),'<svg>subject</svg>');
  await writeFile(path.join(job,'assets/narration.wav'),'synthetic contract fixture, not measured audio');
  await writeFile(path.join(job,'renders/video.mp4'),'synthetic render hash fixture, not actual video');
  await writeFile(path.join(job,'STORYBOARD.md'),'Subject operates and produces a result.');
  await writeFile(path.join(job,'review/REPORT.md'),'Reviewed prototype and final film with documented limitations.');
  return job;
}

async function freeze(job,stage) {
  const dir=`review/${stage}`;
  await mkdir(path.join(job,dir),{recursive:true});
  const sourceHash=await sourceFingerprint(job),videoSha256=await fileHash(path.join(job,'renders/video.mp4'));
  await put(job,'review/render-source.json',{version:1,sourceHash,videoSha256});
  const technical={ok:true,sha256:videoSha256,narrationIntegrity:{ok:true}};
  await put(job,'review/render-verification.json',technical);
  await put(job,`${dir}/verification.json`,technical);
  for (const file of ['frame.png','sheet.png','clip.mp4']) await writeFile(path.join(job,dir,file),'synthetic evidence fixture');
  const evidence=[];
  for (const [file,kind] of [['frame.png','frames'],['sheet.png','contact-sheet'],['clip.mp4','clip'],['verification.json','verification']])
    evidence.push({path:`${dir}/${file}`,kind,start:0,end:kind==='frames'?0:12,sha256:await fileHash(path.join(job,dir,file))});
  evidence.push({path:'assets/narration.wav',kind:'audio',start:0,end:12,sha256:await fileHash(path.join(job,'assets/narration.wav'))});
  const pack={version:1,stage,sourceHash,videoSha256,duration:12,interval:{start:0,end:12},scenes:[{id:'scene',start:0,end:12}],evidence};
  await put(job,`${dir}/pack.json`,pack);
  return loadReviewPack(job,stage);
}

function review(context,role=REVIEW_ROLES[0]) {
  const {pack,packSha256}=context;
  return {version:1,stage:pack.stage,role,reviewer:{agentId:`/root/reviewer-${role}`,independent:true},
    sourceHash:pack.sourceHash,videoSha256:pack.videoSha256,packSha256,
    inspection:{mode:'frame-sequence',visual:'viewed',evidence:pack.evidence.filter(e=>e.kind==='frames').map(e=>e.path),limitations:['Frames inspected; normal-speed playback and listening were unavailable.'],
      ...(role==='narration-fidelity'?{audio:'signal-verified'}:{})},
    coverage:[pack.interval],initialObservation:'A constrained part changes the visible output.',findings:[],verdict:'pass'};
}
async function accept(job,context) {
  for(const role of REVIEW_ROLES) await submitReview(job,review(context,role));
}

test('source digest includes media, scene and storyboard edits but excludes render/review/status bookkeeping',async t=>{
  const job=await fixture(t), initial=await sourceFingerprint(job);
  await writeFile(path.join(job,'renders/video.mp4'),'new render');
  await writeFile(path.join(job,'review/REPORT.md'),'new review notes');
  const m=JSON.parse(await readFile(path.join(job,'job.json')));
  m.status='complete';m.completedAt='now';m.delivery={sha:'receipt'};m.reviewRounds={prototype:3};m.reviewRoundPacks={prototype:'pack-hash'};
  await put(job,'job.json',m);
  assert.equal(await sourceFingerprint(job),initial);
  await writeFile(path.join(job,'compositions/scene.html'),'changed operation');
  assert.notEqual(await sourceFingerprint(job),initial);
});

test('delivery requires accepted prototype and all three independent final reviews of current output',async t=>{
  const job=await fixture(t);
  await assert.rejects(qualifyDelivery(job));
  const prototype=await freeze(job,'prototype');await accept(job,prototype);
  await acceptedPrototype(job);
  // Full film development changes the source and render, not the accepted prototype evidence.
  await writeFile(path.join(job,'compositions/scene.html'),'developed full film');
  await writeFile(path.join(job,'renders/video.mp4'),'new full-film render');
  const final=await freeze(job,'final');
  await submitReview(job,review(final));
  assert.equal((await reviewStatus(job,'final')).ok,false);
  await assert.rejects(qualifyDelivery(job),/Independent final review failed/);
  await accept(job,final);
  const qualification=await qualifyDelivery(job);
  assert.equal(qualification.ok,true);
  assert.equal(qualification.prototypePackSha256,prototype.packSha256);
  assert.equal(qualification.videoSha256,final.pack.videoSha256);
  assert.equal(qualification.reviewerIds.length,3);
});

test('source, render, evidence and receipt edits invalidate final reviews',async t=>{
  for (const changed of ['compositions/scene.html','renders/video.mp4','review/final/frame.png','review/render-source.json']) {
    const job=await fixture(t),context=await freeze(job,'final');await accept(job,context);
    await writeFile(path.join(job,changed),changed.endsWith('.json')?'{}':'changed bytes');
    assert.equal((await reviewStatus(job,'final')).ok,false,changed);
    await assert.rejects(submitReview(job,review(context)),undefined,changed);
  }
});

test('self review, reused agent identities, gaps and dishonest passes cannot qualify',async t=>{
  const job=await fixture(t),context=await freeze(job,'final');
  const producer=review(context);producer.reviewer.agentId='/root/builder';
  assert.throws(()=>validateReview(producer,context,['/root/builder']),/independent/);
  const gap=review(context);gap.coverage=[{start:0,end:4},{start:5,end:12}];
  assert.throws(()=>validateReview(gap,context),/full coverage/);
  const blind=review(context);delete blind.initialObservation;
  assert.throws(()=>validateReview(blind,context),/before reading/);
  const method=review(context);method.inspection.limitations=[];
  assert.throws(()=>validateReview(method,context),/playback limitation/);
  const textOnly=review(context);textOnly.inspection.visual='unavailable';
  assert.throws(()=>validateReview(textOnly,context),/viewed images/);
  const noEvidence=review(context);noEvidence.inspection.evidence=[];
  assert.throws(()=>validateReview(noEvidence,context),/inspected evidence/);
  const wrongEvidence=review(context);wrongEvidence.inspection.evidence=['assets/narration.wav'];
  assert.throws(()=>validateReview(wrongEvidence,context),/inspected evidence/);
  const stale=review(context);stale.packSha256='0'.repeat(64);
  assert.throws(()=>validateReview(stale,context),/different source/);
  for(const role of REVIEW_ROLES) {const r=review(context,role);r.reviewer.agentId='/root/same-agent';await submitReview(job,r);}
  assert.match((await reviewStatus(job,'final')).errors.join(' '),/different independent reviewer/);
});

test('timestamped blockers are retained, incomplete coverage never qualifies, corrected review is versioned',async t=>{
  const job=await fixture(t),context=await freeze(job,'final');
  const r=review(context);r.findings=[{id:'v1',severity:'blocking',start:2,end:5,subject:'queue',requirement:'show limit',
    observed:'Queue never fills',evidence:['review/final/frame.png'],repair:'Show input accumulate at the restricted outlet.'}];
  assert.throws(()=>validateReview(r,context),/no blocking/);
  r.verdict='revise';await submitReview(job,r);
  const incomplete=review(context,'continuity-legibility');incomplete.verdict='incomplete';incomplete.coverage=[];
  await submitReview(job,incomplete);
  assert.equal((await reviewStatus(job,'final')).ok,false);
  const unsupported=structuredClone(r);unsupported.findings[0].evidence=['../some-image.png'];
  assert.throws(()=>validateReview(unsupported,context),/finding/);
  await accept(job,context);
  assert.equal((await reviewStatus(job,'final')).ok,true);
  const {readdir}=await import('node:fs/promises');
  assert.equal((await readdir(path.join(job,'review/final/history'))).length,5);
});

test('signal-only narration reports require frozen measured integrity evidence',async t=>{
  const job=await fixture(t),context=await freeze(job,'final');
  const r=review(context,'narration-fidelity');
  context.pack.evidence=context.pack.evidence.filter(e=>e.kind!=='verification');
  await put(job,'review/final/pack.json',context.pack);
  const missing=await loadReviewPack(job,'final');
  await assert.rejects(submitReview(job,review(missing,'narration-fidelity')),/frozen technical evidence/);
  r.inspection.audio='unavailable';
  assert.throws(()=>validateReview(r,context),/audio evidence/);
});

test('altered accepted prototype evidence and pending report block delivery',async t=>{
  const job=await fixture(t),prototype=await freeze(job,'prototype');await accept(job,prototype);
  const final=await freeze(job,'final');await accept(job,final);
  await writeFile(path.join(job,'review/REPORT.md'),'# Production review\n\nPending creative build and validation.');
  await assert.rejects(qualifyDelivery(job),/Complete the production report/);
  await writeFile(path.join(job,'review/prototype/frame.png'),'altered historical evidence');
  await assert.rejects(acceptedPrototype(job),/evidence changed/);
});

test('review writes reject symlinked directories and report targets',async t=>{
  const outside=await mkdtemp(path.join(tmpdir(),'video-review-outside-'));
  t.after(()=>rm(outside,{recursive:true,force:true}));
  for(const targetFile of [false,true]) {
    const job=await fixture(t),context=await freeze(job,'final');
    if(targetFile) {
      await mkdir(path.join(job,'review/final/reviews'));
      await writeFile(path.join(outside,'report.json'),'unchanged');
      await symlink(path.join(outside,'report.json'),path.join(job,'review/final/reviews/visual-mechanism.json'));
    } else await symlink(outside,path.join(job,'review/final/reviews'));
    await assert.rejects(submitReview(job,review(context)),/Symlinked review output/);
    if(targetFile) assert.equal(await readFile(path.join(outside,'report.json'),'utf8'),'unchanged');
  }
});

test('external render symlink cannot be loaded as frozen local review media',async t=>{
  const job=await fixture(t);await freeze(job,'final');
  const other=await mkdtemp(path.join(tmpdir(),'video-review-render-'));
  t.after(()=>rm(other,{recursive:true,force:true}));
  const external=path.join(other,'external.mp4');
  await writeFile(external,await readFile(path.join(job,'renders/video.mp4')));
  await rm(path.join(job,'renders/video.mp4'));
  await symlink(external,path.join(job,'renders/video.mp4'));
  await assert.rejects(loadReviewPack(job,'final'),/local file/);
});
