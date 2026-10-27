import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sourceFingerprint, fileHash, loadReviewPack, validateReview, submitReview, reviewStatus,
  qualifyDelivery, REVIEW_ROLES, registerProducer} from '../lib/review.mjs';
import {loadPersonality} from '../lib/personalities.mjs';

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
  await writeFile(path.join(job,'review/REPORT.md'),'Reviewed the final film with documented limitations.');
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
  m.status='complete';m.completedAt='now';m.delivery={sha:'receipt'};m.reviewRounds={final:3};m.reviewRoundPacks={final:'pack-hash'};
  await put(job,'job.json',m);
  assert.equal(await sourceFingerprint(job),initial);
  await writeFile(path.join(job,'compositions/scene.html'),'changed operation');
  assert.notEqual(await sourceFingerprint(job),initial);
});

test('delivery requires all three independent final reviews of current output',async t=>{
  const job=await fixture(t);
  await assert.rejects(qualifyDelivery(job));
  const final=await freeze(job,'final');
  await submitReview(job,review(final));
  assert.equal((await reviewStatus(job,'final')).ok,false);
  await assert.rejects(qualifyDelivery(job),/Independent final review failed/);
  await accept(job,final);
  const qualification=await qualifyDelivery(job);
  assert.equal(qualification.ok,true);
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

test('runner-registered producer is rejected at submission and acceptance; producer identity is project-local',async t=>{
  const a=await fixture(t), b=await fixture(t);
  await Promise.all([registerProducer(a,{agentId:'t3/director-17',role:'director'}),
    registerProducer(a,{agentId:'t3/builder-22',role:'builder'}),
    registerProducer(b,{agentId:'t3/builder-other-project',role:'builder'})]);
  const context=await freeze(a,'final');
  const delegated=review(context);delegated.reviewer.agentId='t3/builder-22';
  await assert.rejects(submitReview(a,delegated),/independent/);
  const independent=review(context);independent.reviewer.agentId='t3/fresh-reviewer';
  await submitReview(a,independent);
  assert.equal((await reviewStatus(a,'final')).ok,false); // other two roles remain pending
  // A forged/stale on-disk report is rechecked during final acceptance.
  for(const role of REVIEW_ROLES) await put(a,`review/final/reviews/${role}.json`,review(context,role));
  const forged=review(context,REVIEW_ROLES[0]);forged.reviewer.agentId='t3/builder-22';
  await put(a,`review/final/reviews/${REVIEW_ROLES[0]}.json`,forged);
  assert.match((await reviewStatus(a,'final')).errors.join(' '),/independent/);
  assert.deepEqual(JSON.parse(await readFile(path.join(b,'job.json'))).review.producerAgentIds,
    ['/root','/root/builder','t3/builder-other-project']);
});

test('legacy non-app-review jobs without producer history retain their established review behavior',async t=>{
  const job=await fixture(t), manifest=JSON.parse(await readFile(path.join(job,'job.json')));
  delete manifest.review.producerAgentIds; await put(job,'job.json',manifest);
  const context=await freeze(job,'final');
  await assert.doesNotReject(submitReview(job,review(context)));
});

test('app-review legacy jobs without recorded provenance block review and reject spoofed reviewer IDs',async t=>{
  const job=await fixture(t), manifest=JSON.parse(await readFile(path.join(job,'job.json')));
  const profile=await loadPersonality('app-review');
  manifest.productionProfile={id:profile.profile.id,version:profile.profile.version,sha256:profile.sha256};
  await put(job,'production-profile.json',profile);
  manifest.review.producerAgentIds=['/root']; await put(job,'job.json',manifest);
  let context=await freeze(job,'final');
  await assert.rejects(submitReview(job,review(context),{agentId:'claimed-reviewer',role:'reviewer'}),/Producer identities are incomplete/);
  manifest.review.producerAgentIds=['producer-real']; manifest.review.producerAgentRecords=[{agentId:'producer-real',role:'builder'}]; await put(job,'job.json',manifest);
  context=await freeze(job,'final');
  const forged=review(context); forged.reviewer.agentId='invented';
  await assert.rejects(submitReview(job,forged,{agentId:'runner-reviewer',role:'reviewer'}),/match VIDEO_AGENT_ID/);
  const stillOnly=review(context); stillOnly.verdict='pass';
  assert.throws(()=>validateReview(stillOnly,context),/encoded MP4 clip in playback/);
  const valid=review(context); valid.reviewer.agentId='runner-reviewer';
  valid.inspection.mode='playback';
  valid.inspection.evidence=context.pack.evidence.filter(e=>e.kind==='clip').map(e=>e.path);
  valid.inspection.playbackAssertion='reviewer-asserted-not-authenticated';
  await assert.doesNotReject(submitReview(job,valid,{agentId:'runner-reviewer',role:'reviewer'}));
});

test('final app-review playback must cover all capture, scene and handoff intervals and disclose reviewer assertion', async t=>{
  const job=await fixture(t), context=await freeze(job,'final');
  context.personality='app-review';
  context.pack.appCaptureIntervals=[{id:'screen-result',scene:'scene',start:5,end:10}];
  const report=review(context); report.inspection.mode='playback';
  report.inspection.evidence=context.pack.evidence.filter(e=>e.kind==='clip').map(e=>e.path);
  assert.throws(()=>validateReview(report,context),/playbackAssertion.*cannot authenticate/i);
  report.inspection.playbackAssertion='reviewer-asserted-not-authenticated';
  const clip=context.pack.evidence.find(e=>e.kind==='clip'); clip.end=4;
  assert.throws(()=>validateReview(report,context),/covering every scene and handoff interval/);
  clip.end=12;
  assert.doesNotThrow(()=>validateReview(report,context));
  context.pack.appCaptureIntervals[0].end=13;
  assert.throws(()=>validateReview(report,context),/covering app capture screen-result/);
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

test('altered evidence and a pending report block delivery',async t=>{
  const job=await fixture(t),final=await freeze(job,'final');await accept(job,final);
  await writeFile(path.join(job,'review/REPORT.md'),'# Production review\n\nPending creative build and validation.');
  await assert.rejects(qualifyDelivery(job),/Complete the production report/);
  await writeFile(path.join(job,'review/final/frame.png'),'altered evidence');
  assert.equal((await reviewStatus(job,'final')).ok,false);
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

test('a report with several problems lists them all, each with its field', async t => {
  const job=await fixture(t), context=await freeze(job,'final');
  const r=review(context,'narration-fidelity');
  r.inspection.mode='watched'; delete r.inspection.audio; r.coverage=[{start:0,end:99}];
  r.findings=[{id:'F1',severity:'blocking',start:1,end:2,subject:'label',requirement:'',observed:'cut off',repair:'',evidence:['review/final/missing.png']}];
  const error=assert.throws(()=>validateReview(r,context),error=>{
    for (const field of ['inspection.mode','inspection.audio','coverage[0]','findings[0] (F1)','verdict']) assert(error.message.includes(field+':'),field);
    assert.match(error.message,/requirement, repair must be filled in/);
    assert.match(error.message,/evidence not in the pack: review\/final\/missing\.png/);
    assert.match(error.message,/^The report has \d+ problems/);
    return true;
  });
  void error;
});

function blockedReview(context, role) {
  const report = review(context, role);
  report.verdict = 'revise';
  report.findings = [{id:'F1', severity:'blocking', scope:'scene', start:1, end:2,
    subject:'Motion personality', requirement:'Expressive motion', observed:'The motion feels flat.',
    repair:'Give the movement more character.', evidence:[context.pack.evidence.find(e => e.kind === 'frames').path]}];
  return report;
}

test('three failed rounds continue with disclosed findings, never fabricated passing verdicts', async t => {
  const job = await fixture(t);
  const manifest = JSON.parse(await readFile(path.join(job,'job.json')));
  manifest.reviewRounds = {final:3};
  await put(job,'job.json',manifest);
  const final = await freeze(job,'final');
  for (const role of REVIEW_ROLES.slice(0,2)) await submitReview(job,blockedReview(final,role));
  assert.equal((await reviewStatus(job,'final')).ok,false, 'never skip pending reviewers');
  await submitReview(job,blockedReview(final,REVIEW_ROLES[2]));
  const status = await reviewStatus(job,'final');
  assert.equal(status.ok,true);
  assert.equal(status.independentPassed,false);
  assert(status.reports.every(r => r.verdict === 'revise'));
  const result = await qualifyDelivery(job);
  assert.equal(result.reviewDisposition,'review-limit-reached');
  assert.equal(result.independentReviewPassed,false);
  assert.equal(result.unresolvedFindings.length,3);
  await writeFile(path.join(job,'renders/video.mp4'),'tampered');
  await assert.rejects(qualifyDelivery(job));
});

test('review limit cannot bypass incomplete inspection or invalid evidence', async t => {
  const job = await fixture(t), manifest = JSON.parse(await readFile(path.join(job,'job.json')));
  manifest.reviewRounds = {final:3};await put(job,'job.json',manifest);
  const context = await freeze(job,'final');
  for (const role of REVIEW_ROLES) {
    const report = blockedReview(context,role);
    if (role === REVIEW_ROLES[2]) {report.verdict = 'incomplete';report.inspection.visual = 'unavailable';}
    await submitReview(job,report);
  }
  assert.equal((await reviewStatus(job,'final')).ok,false);
});

test('later review must resolve or dispute prior blockers explicitly', async t => {
  const job = await fixture(t), first = await freeze(job,'final');
  await submitReview(job,blockedReview(first,REVIEW_ROLES[0]));
  await writeFile(path.join(job,'index.html'),'<div>Repaired label</div>');
  const second = await freeze(job,'final'), report = review(second,REVIEW_ROLES[0]);
  await assert.rejects(submitReview(job,report),/Respond to prior blocking finding F1/);
  report.priorFindingResponses = [{sourceHash:first.pack.sourceHash,findingId:'F1',disposition:'resolved',reason:'Current frame shows the label separated from the card.'}];
  await submitReview(job,report);
});


test('readability blockers cannot be waived after three or more review rounds',async t=>{
  for(const legacy of [false,true]) {
    const job=await fixture(t), manifest=JSON.parse(await readFile(path.join(job,'job.json')));
    manifest.reviewRounds={final:9};await put(job,'job.json',manifest);
    const context=await freeze(job,'final');
    for(const role of REVIEW_ROLES) {
      const report=blockedReview(context,role);
      if(legacy) {report.findings[0].subject='Overlapping measurements';report.findings[0].observed='The figures obscure the exact values.';}
      else report.findings[0].category='readability';
      await submitReview(job,report);
    }
    const status=await reviewStatus(job,'final');
    assert.equal(status.ok,false);assert.equal(status.continued,false);
    assert.equal(status.nonWaivableFindings.length,3);
  }
});

test('only a waiver of the current film lets endless readability findings continue, disclosed and never as a pass',async t=>{
  const {waiveReview}=await import('../lib/review.mjs');
  const job=await fixture(t);
  const final=await freeze(job,'final');
  const m=JSON.parse(await readFile(path.join(job,'job.json')));m.reviewRounds={final:25};await put(job,'job.json',m);
  for (const role of REVIEW_ROLES.slice(1)) await submitReview(job,review(final,role));
  const blocked={...review(final,REVIEW_ROLES[0]),verdict:'revise',findings:[{id:'F1',severity:'blocking',start:1,end:2,subject:'Caption',
    requirement:'Readable at phone size',observed:'The caption is illegible at 480 px',repair:'Make it larger',evidence:[final.pack.evidence[0].path]}]};
  await submitReview(job,blocked);
  const before=await reviewStatus(job,'final');
  assert.equal(before.ok,false,'readability blocks even after the round budget');
  assert.equal(before.nonWaivableFindings.length,1);
  await assert.rejects(waiveReview(job,'final',''),/reason/);
  const waiver=await waiveReview(job,'final','The person stopped review after 25 rounds');
  assert.equal(waiver.unresolvedFindings.length,1);
  const after=await reviewStatus(job,'final');
  assert.equal(after.ok,true);assert.equal(after.disposition,'waived-by-user');assert.equal(after.independentPassed,false);
  const qualification=await qualifyDelivery(job);
  assert.equal(qualification.reviewDisposition,'waived-by-user');
  assert.equal(qualification.independentReviewPassed,false);
  assert.equal(qualification.reviewWaiver.rounds,25);
  assert(qualification.unresolvedFindings.some(f=>f.id==='F1'));
  // Any change to the film needs review again.
  await writeFile(path.join(job,'compositions/scene.html'),'edited after the waiver');
  assert.equal((await reviewStatus(job,'final')).ok,false);
});
