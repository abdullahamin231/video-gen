import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createReviewPack, generateCaptureInspection, assertIndependentCaptureReviewer} from '../lib/review-pack.mjs';
import {verifyCaptureVisibility} from '../lib/capture-visibility.mjs';
import {sourceFingerprint, loadReviewPack} from '../lib/review.mjs';
import {loadPersonality, personalityMetadata, freezePersonality} from '../lib/personalities.mjs';

const exec = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let available = true;
try { await exec('ffmpeg', ['-version']); await exec('ffprobe', ['-version']); }
catch { available = false; }
async function fixture(t, {videoDuration = 3, videoFps = 30} = {}) {
  const cache = path.join(ROOT, '.cache');
  await mkdir(cache, {recursive: true});
  const job = await mkdtemp(path.join(cache, 'review-pack-'));
  t.after(() => rm(job, {recursive: true, force: true}));
  for (const folder of ['assets', 'renders', 'review', 'compositions']) await mkdir(path.join(job, folder));
  await writeFile(path.join(job, 'job.json'), JSON.stringify({duration: 3, width: 320, height: 180, fps: 30}));
  await writeFile(path.join(job, 'timing.json'), JSON.stringify({duration: 3, scenes: [
    {id: 'opening', start: 0, end: 1.5, beats: [{id: 'change', at: 0.8}]},
    {id: 'payoff', start: 1.5, end: 3, beats: [{id: 'effect', at: 2}]}]}));
  await writeFile(path.join(job, 'compositions/opening.html'), '<p>Operating subject</p>');
  await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=320x180:r=${videoFps}:d=${videoDuration}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${videoDuration}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', path.join(job, 'renders/video.mp4')]);
  await exec('ffmpeg', ['-v', 'error', '-i', path.join(job, 'renders/video.mp4'), '-vn', path.join(job, 'assets/narration.wav')]);
  const receipt = {version: 1, sourceHash: await sourceFingerprint(job), videoSha256: sha(await readFile(path.join(job, 'renders/video.mp4')))};
  await writeFile(path.join(job, 'review/render-source.json'), JSON.stringify(receipt));
  return job;
}

test('review pack freezes dense rendered evidence and normal speed clips', {skip: !available}, async t => {
  const job = await fixture(t);
  await writeFile(path.join(job, 'review/render-verification.json'), JSON.stringify({ok: true,
    sha256: sha(await readFile(path.join(job, 'renders/video.mp4'))), narrationIntegrity: {ok: true}}));
  const pack = await createReviewPack(job, {from: 'render'});
  assert.equal(pack.stage, 'final');
  assert.equal(pack.duration, 3);
  assert.deepEqual(pack.interval, {start: 0, end: 3});
  assert.deepEqual(pack.scenes.map(scene => scene.id), ['opening', 'payoff']);
  assert.equal(pack.sourceHash, await sourceFingerprint(job));
  assert.match(pack.packArchivePath, /^review\/final\/packs\/[a-f0-9]{64}\.json$/);
  assert.equal(pack.packSha256, sha(await readFile(path.join(job, pack.packArchivePath))));
  assert.equal(await readFile(path.join(job, pack.packArchivePath), 'utf8'), await readFile(path.join(job, pack.packPath), 'utf8'));
  assert.equal((await loadReviewPack(job, 'final')).pack.videoSha256, pack.videoSha256);
  const samples = pack.evidence.filter(item => item.kind === 'frames');
  for (const expected of [0, 0.8, 1, 1.5, 2])
    assert.ok(samples.some(sample => Math.abs(sample.start - expected) < 0.02), `Missing sample ${expected}`);
  for (const expected of [0.25, 0.55, 1.05, 1.25, 1.75, 2.25, 2.75])
    assert.ok(samples.some(sample => Math.abs(sample.start - expected) < 0.02), `Missing dense sample ${expected}`);
  const renderedSample = samples.find(sample => Math.abs(sample.start - 2) < 0.02);
  const directFrame = path.join(job, '.cache', 'direct-render-frame.png'), filter = path.join(job, '.cache', 'direct-render-filter.txt');
  await mkdir(path.dirname(directFrame), {recursive: true});
  await writeFile(filter, `fps=30,select='eq(n\\,60)',scale='min(960,iw)':-2,drawtext=text='%{pts\\:hms}':x=12:y=12:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.8`);
  await exec('ffmpeg', ['-v', 'error', '-i', path.join(job, 'renders/video.mp4'), '-filter_script:v', filter,
    '-fps_mode', 'vfr', '-start_number', '0', directFrame]);
  assert.equal(sha(await readFile(path.join(job, renderedSample.path))), sha(await readFile(directFrame)),
    'final review frames are decoded directly from the exact MP4 playback file');
  for (const evidence of pack.evidence) {
    assert.ok(!path.isAbsolute(evidence.path));
    assert.equal(sha(await readFile(path.join(job, evidence.path))), evidence.sha256);
  }
  const sheets = pack.evidence.filter(item => item.kind === 'contact-sheet');
  assert.ok(sheets.length);
  for (const sheet of sheets) { assert.equal(sheet.frameWidth, 480); assert.ok(sheet.samples.length <= 12); }
  const clips = pack.evidence.filter(item => item.kind === 'clip');
  assert.deepEqual(clips.map(clip => [clip.start, clip.end]), [[0, 1.75], [1.25, 3]]);
  for (const clip of clips) {
    const probe = JSON.parse((await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path.join(job, clip.path)])).stdout);
    assert.ok(Math.abs(Number(probe.format.duration) - (clip.end - clip.start)) < 0.1);
    assert.ok(probe.streams.some(stream => stream.codec_type === 'audio'));
    assert.equal(clip.playbackRate, 1);
  }
  const second = await createReviewPack(job, {from: 'render'});
  assert.notEqual(second.evidence.find(item => item.kind === 'frames').path, samples[0].path);
  assert.notEqual(second.packArchivePath, pack.packArchivePath);
  assert.equal(second.videoSha256, pack.videoSha256);
  assert.equal((await loadReviewPack(job, 'final')).pack.videoSha256, pack.videoSha256);
  const frozenVerification = second.evidence.find(item => item.kind === 'verification');
  await writeFile(path.join(job, 'review/render-verification.json'), '{}');
  assert.equal(JSON.parse(await readFile(path.join(job, frozenVerification.path), 'utf8')).narrationIntegrity.ok, true);
  assert.equal((await loadReviewPack(job, 'final')).pack.videoSha256, pack.videoSha256);
  await assert.rejects(createReviewPack(job, {from: 'render'}), /verification is stale/);
});

test('final app-review evidence must be sampled from the encoded MP4', {skip: !available}, async t => {
  const job = await fixture(t);
  const snapshot = loadPersonality('app-review');
  const jobFile = path.join(job, 'job.json'), metadata = personalityMetadata(snapshot);
  const manifest = JSON.parse(await readFile(jobFile, 'utf8'));
  manifest.productionProfile = metadata;
  await writeFile(jobFile, JSON.stringify(manifest));
  await freezePersonality(job, snapshot);
  await writeFile(path.join(job,'assets/media-plan.json'),JSON.stringify({objects:[],scenes:[]}));
  await writeFile(path.join(job, 'review/render-source.json'), JSON.stringify({version: 1,
    sourceHash: await sourceFingerprint(job), videoSha256: sha(await readFile(path.join(job, 'renders/video.mp4')))}));
  await writeFile(path.join(job, 'review/pixels.json'), JSON.stringify({ok: true, errors: [], captureVisibility: await verifyCaptureVisibility(job,path.join(job,'renders/video.mp4'),{objects:[],scenes:[]}),
    sourceHash: await sourceFingerprint(job), videoSha256: sha(await readFile(path.join(job, 'renders/video.mp4')))}));

  await assert.rejects(createReviewPack(job, {from: 'html'}), /Final app-review evidence must come from the encoded render/);
  const pack = await createReviewPack(job, {from: 'render'});
  assert.equal(pack.source, undefined, 'encoded packs identify their source through the current video hash');
  assert.equal(pack.videoSha256, sha(await readFile(path.join(job, 'renders/video.mp4'))));
  assert.ok(pack.evidence.some(item => item.kind === 'clip'), 'reviewers receive normal-speed playback from the encoded output');
  assert.equal((await loadReviewPack(job, 'final')).pack.videoSha256, pack.videoSha256);
});

test('final app-review pack requires current passing playback pixels', {skip: !available}, async t => {
  const job = await fixture(t);
  const snapshot = loadPersonality('app-review');
  const jobFile = path.join(job, 'job.json'), manifest = JSON.parse(await readFile(jobFile, 'utf8'));
  manifest.productionProfile = personalityMetadata(snapshot);
  await writeFile(jobFile, JSON.stringify(manifest));
  await freezePersonality(job, snapshot);
  await writeFile(path.join(job,'assets/media-plan.json'),JSON.stringify({objects:[],scenes:[]}));
  const videoSha256 = sha(await readFile(path.join(job, 'renders/video.mp4'))); let sourceHash = await sourceFingerprint(job);
  await writeFile(path.join(job, 'review/render-source.json'), JSON.stringify({version: 1, sourceHash, videoSha256}));
  await rm(path.join(job, 'review/pixels.json'), {force: true});
  await assert.rejects(createReviewPack(job, {from: 'render'}), /requires a passing pixel playback report/);
  await writeFile(path.join(job, 'review/pixels.json'), JSON.stringify({ok: true, errors: [], sourceHash: 'stale', videoSha256}));
  await assert.rejects(createReviewPack(job, {from: 'render'}), /pixel playback report is stale/);
  await writeFile(path.join(job, 'review/pixels.json'), JSON.stringify({ok: false, errors: ['blackout'], sourceHash, videoSha256}));
  await assert.rejects(createReviewPack(job, {from: 'render'}), /report is failing/);
  await writeFile(path.join(job, 'review/pixels.json'), JSON.stringify({ok: true, errors: [], captureVisibility: await verifyCaptureVisibility(job,path.join(job,'renders/video.mp4'),{objects:[],scenes:[]}), sourceHash, videoSha256}));
  const pack = await createReviewPack(job, {from: 'render'});
  assert.equal(pack.videoSha256, videoSha256);
});

test('unverified app-review captures require current exact-interval PNG inspection evidence', {skip: !available}, async t => {
  const job = await fixture(t), snapshot = loadPersonality('app-review');
  const manifestFile = path.join(job, 'job.json'), manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  manifest.productionProfile = personalityMetadata(snapshot); await writeFile(manifestFile, JSON.stringify(manifest)); await freezePersonality(job, snapshot);
  const videoSha256 = sha(await readFile(path.join(job, 'renders/video.mp4'))); let sourceHash = await sourceFingerprint(job);
  await writeFile(path.join(job, 'review/render-source.json'), JSON.stringify({version: 1, sourceHash, videoSha256}));
  const capture = {id: 'screen-opening', scene: 'opening', interval: {start: 0, end: 1.5}, status: 'unverified', reason: 'animated geometry'};
  const pixels = {ok: true, errors: [], sourceHash, videoSha256, captureVisibility: {coverage: {verified: 0, failed: 0, unverified: 1}, captures: [capture]}};
  await mkdir(path.join(job,'assets/app-review'),{recursive:true});
  const source=path.join(job,'assets/app-review/source.mp4');
  await exec('ffmpeg',['-v','error','-f','lavfi','-i','smptebars=s=320x180:r=30:d=3','-c:v','libx264','-pix_fmt','yuv420p',source]);
  const world={width:320,height:180,scenes:[{id:'opening',start:0,end:1.5}],objects:[{id:capture.id,type:'video',scene:'opening',src:'assets/app-review/source.mp4',at:[160,90],size:[320,180],sourceStart:0,mediaStart:0,mediaDuration:1.5,transform:{x:1}}]};
  await writeFile(path.join(job,'assets/media-plan.json'),JSON.stringify(world));
  pixels.captureVisibility=await verifyCaptureVisibility(job,path.join(job,'renders/video.mp4'),world);
  sourceHash=pixels.sourceHash=await sourceFingerprint(job); await writeFile(path.join(job,'review/pixels.json'),JSON.stringify(pixels));
  await writeFile(path.join(job,'review/render-source.json'),JSON.stringify({version:1,sourceHash:pixels.sourceHash,videoSha256}));
  await writeFile(path.join(job,'review/pixels.json'),JSON.stringify({...pixels,captureVisibility:{coverage:{verified:0,failed:0,unverified:0},captures:[]}}));
  await assert.rejects(createReviewPack(job,{from:'render'}),/visibility report is stale or altered/);
  await writeFile(path.join(job,'review/pixels.json'),JSON.stringify(pixels));
  await assert.rejects(createReviewPack(job, {from: 'render'}), /requires evidence-backed dispositions/);
  const frames = path.join(job, 'review/inspection'); await mkdir(frames);
  const makeFrame = async (name, seek, kind) => {
    const file = path.join(frames, name);
    await exec('ffmpeg', ['-v', 'error', '-i', path.join(job, 'renders/video.mp4'), '-ss', String(seek), '-frames:v', '1', file]);
    return {path: `review/inspection/${name}`, sha256: sha(await readFile(file)), sceneAt: seek, ...(kind === 'source-frame' ? {sourceAt: seek} : {}), kind};
  };
  const evidence = [];
  for (const [i, at] of [0.15, 0.75, 1.35].entries()) {
    evidence.push(await makeFrame(`source-${i}.png`, at, 'render-frame'));
    evidence.push(await makeFrame(`render-${i}.png`, at, 'render-frame'));
  }
  const disposition = {captureId: capture.id, sceneId: capture.scene, start: 0, end: 1.5, status: 'visually-inspected', decision: 'acceptable', reviewer:{agentId:'independent-reviewer',independent:true},
    authenticatedReviewer:{agentId:'independent-reviewer',role:'reviewer'},
    evidence};
  const saveDispositions = document => writeFile(path.join(job, 'review/capture-visibility-dispositions.json'), JSON.stringify(document));
  const jobManifest=JSON.parse(await readFile(path.join(job,'job.json'),'utf8')); jobManifest.review={producerAgentIds:['/root','/root/builder']}; await writeFile(path.join(job,'job.json'),JSON.stringify(jobManifest));
  sourceHash=await sourceFingerprint(job); pixels.sourceHash=sourceHash;
  await writeFile(path.join(job,'review/pixels.json'),JSON.stringify(pixels));
  await writeFile(path.join(job,'review/render-source.json'),JSON.stringify({version:1,sourceHash,videoSha256}));
  await assert.rejects(assertIndependentCaptureReviewer(job,{agentId:'/root',independent:true}),/cannot submit an independent/);
  await assert.rejects(assertIndependentCaptureReviewer(job,{agentId:'/root/builder',independent:true}),/cannot submit an independent/);
  await assert.rejects(assertIndependentCaptureReviewer(job,{agentId:'independent-reviewer',independent:true}),/authenticated by the runner/);
  await assert.rejects(assertIndependentCaptureReviewer(job,{agentId:'independent-reviewer',independent:true},{agentId:'forged-reviewer',role:'reviewer'}),/authenticated by the runner/);
  await assert.rejects(assertIndependentCaptureReviewer(job,{agentId:'/root/builder',independent:true},{agentId:'/root/builder',role:'reviewer'}),/cannot submit an independent/);
  await assertIndependentCaptureReviewer(job,{agentId:'independent-reviewer',independent:true},{agentId:'independent-reviewer',role:'reviewer'});
  await assert.rejects(assertIndependentCaptureReviewer(job,{agentId:'claimed-reviewer',independent:true},{agentId:'runner-reviewer',role:'reviewer'}),/authenticated by the runner/);
  await assert.rejects(assertIndependentCaptureReviewer(job,{agentId:'runner-reviewer',independent:true},{agentId:'runner-reviewer',role:'builder'}),/authenticated by the runner/);
  await saveDispositions({version: 1, sourceHash: 'stale', videoSha256, dispositions: [disposition]});
  await assert.rejects(createReviewPack(job, {from: 'render'}), /dispositions are stale/);
  await saveDispositions({version: 1, sourceHash, videoSha256, dispositions: [{...disposition, end: 1.4}]});
  await assert.rejects(createReviewPack(job, {from: 'render'}), /inaccurate visual-inspection disposition/);
  // A PNG copied from the rendered output cannot masquerade as source evidence.
  const copiedSource=[];
  for(const [i,at] of [0.15,0.75,1.35].entries()){
    copiedSource.push(await makeFrame(`copied-source-${i}.png`,at,'render-frame'));
    const render=evidence.find(e=>e.kind==='render-frame'&&Math.abs(e.sceneAt-at)<0.01);
    copiedSource.push({...render,kind:'source-frame',sourceAt:at});
  }
  await saveDispositions({version:1,sourceHash,videoSha256,dispositions:[{...disposition,evidence:copiedSource}]});
  await assert.rejects(createReviewPack(job,{from:'render'}),/not the decoded media frame/);
  await saveDispositions({version: 1, sourceHash, videoSha256, dispositions: [{...disposition, decision: 'reject'}]});
  await assert.rejects(createReviewPack(job, {from: 'render'}), /rejected/);
  // Correctly decoded source frames at their mapped source times are accepted.
  const valid=[];
  for(const [i,at] of [0.15,0.75,1.35].entries()){
    const sf=path.join(frames,`actual-source-${i}.png`); await exec('ffmpeg',['-v','error','-i',source,'-ss',String(at),'-frames:v','1',sf]);
    valid.push({kind:'source-frame',sceneAt:at,sourceAt:at,path:`review/inspection/actual-source-${i}.png`,sha256:sha(await readFile(sf))});
    valid.push(evidence.find(e=>e.kind==='render-frame'&&Math.abs(e.sceneAt-at)<0.01));
  }
  const wrongTime=structuredClone(valid); wrongTime[0].sourceAt=0.91;
  await saveDispositions({version:1,sourceHash,videoSha256,dispositions:[{...disposition,evidence:wrongTime}]});
  await assert.rejects(createReviewPack(job,{from:'render'}),/incorrect trim\/time mapping/);
  await saveDispositions({version:1,sourceHash,videoSha256,dispositions:[{...disposition,reviewer:{agentId:'/root',independent:true},evidence:valid}]});
  await assert.rejects(createReviewPack(job,{from:'render'}),/reviewer is not independent of the producers/);
  await saveDispositions({version:1,sourceHash,videoSha256,dispositions:[{...disposition,reviewer:{agentId:'/root/builder',independent:true},evidence:valid}]});
  await assert.rejects(createReviewPack(job,{from:'render'}),/reviewer is not independent of the producers/);
  await saveDispositions({version: 1, sourceHash, videoSha256, dispositions: [{...disposition,authenticatedReviewer:undefined,evidence:valid}]});
  await assert.rejects(createReviewPack(job,{from:'render'}),/reviewer is not independent of the producers/);
  await saveDispositions({version: 1, sourceHash, videoSha256, dispositions: [{...disposition,authenticatedReviewer:{agentId:'forged-reviewer',role:'reviewer'},evidence:valid}]});
  await assert.rejects(createReviewPack(job,{from:'render'}),/reviewer is not independent of the producers/);
  await saveDispositions({version: 1, sourceHash, videoSha256, dispositions: [{...disposition,authenticatedReviewer:{agentId:'independent-reviewer',role:'reviewer'},evidence:valid}]});
  const pack = await createReviewPack(job, {from: 'render'});
  assert.deepEqual(pack.captureVisibilityDisposition.map(item => item.disposition), ['visually-inspected-acceptable']);
  assert.equal(pack.captureVisibilityDisposition[0].interval.end, capture.interval.end);
  assert.ok((await loadReviewPack(job, 'final')).pack.evidence.some(item => item.kind === 'capture-visibility-frame'));
});

test('capture inspection generation creates interval scoped paired media frames', {skip: !available}, async t=>{
  const job=await fixture(t); await mkdir(path.join(job,'assets/app-review'),{recursive:true});
  const source='assets/app-review/recording.mp4';
  await exec('ffmpeg',['-v','error','-f','lavfi','-i','smptebars=s=320x180:r=30:d=3','-c:v','libx264','-pix_fmt','yuv420p',path.join(job,source)]);
  const videoSha256=sha(await readFile(path.join(job,'renders/video.mp4')));
  await writeFile(path.join(job,'assets/media-plan.json'),JSON.stringify({scenes:[{id:'opening',start:0,end:1.5}],objects:[{id:'screen',type:'video',scene:'opening',src:source,sourceStart:0}]}));
  const sourceHash=await sourceFingerprint(job);
  await writeFile(path.join(job,'review/pixels.json'),JSON.stringify({sourceHash,videoSha256,captureVisibility:{captures:[{id:'screen',scene:'opening',status:'unverified',interval:{start:0,end:1.5}}]}}));
  const doc=await generateCaptureInspection(job); assert.equal(doc.dispositions[0].status,'pending-independent-inspection');
  assert.equal(doc.dispositions[0].evidence.length,6);
  assert.ok(doc.dispositions.every(d=>d.status!=='visually-inspected'));
});

test('review pack rejects partial final, invalid intervals and escaped output', {skip: !available}, async t => {
  const job = await fixture(t);
  for (const options of [{start: -1}, {end: 4}, {start: 2, end: 1}, {start: NaN}, {start: '0'}, {end: 2}])
    await assert.rejects(createReviewPack(job, {from: 'render', ...options}), /interval|full video/);
  await assert.rejects(createReviewPack(job, {from: 'render', stage: 'prototype', start: 1}), /must be final/);
  await assert.rejects(createReviewPack(job, {from: 'render', stage: 'other'}), /stage/);
  await assert.rejects(createReviewPack(job, {from: 'render', output: '../escape.json'}), /review directory/);
  await assert.rejects(createReviewPack(job, {from: 'render', output: 'review/../../escape.json'}), /review directory/);
  const outside = await mkdtemp(path.join(ROOT, '.cache/review-outside-'));
  t.after(() => rm(outside, {recursive: true, force: true}));
  await symlink(outside, path.join(job, 'review/linked'));
  await assert.rejects(createReviewPack(job, {from: 'render', output: 'review/linked/pack.json'}), /Symlinked/);
});

test('review pack cannot bind an old render to edited sources', {skip: !available}, async t => {
  const job = await fixture(t);
  await writeFile(path.join(job, 'compositions/opening.html'), '<p>Changed subject</p>');
  await assert.rejects(createReviewPack(job, {from: 'render'}), /receipt is stale/);
  await rm(path.join(job, 'review/render-source.json'));
  await assert.rejects(createReviewPack(job, {from: 'render'}), /Missing render source receipt/);
});

test('review pack rejects symlinked render and receipt outside the job', {skip: !available}, async t => {
  const job = await fixture(t), outside = await mkdtemp(path.join(ROOT, '.cache/review-external-'));
  t.after(() => rm(outside, {recursive: true, force: true}));
  for (const relative of ['renders/video.mp4', 'review/render-source.json']) {
    const original = await readFile(path.join(job, relative)), external = path.join(outside, path.basename(relative));
    await writeFile(external, original);
    await rm(path.join(job, relative));
    await symlink(external, path.join(job, relative));
    await assert.rejects(createReviewPack(job, {from: 'render'}), /must be a local file/);
    await rm(path.join(job, relative));
    await writeFile(path.join(job, relative), original);
  }
});

test('review covers accepted encoded padding without hiding content gaps', {skip: !available}, async t => {
  const job = await fixture(t, {videoDuration: 3.08, videoFps: 25}), pack = await createReviewPack(job, {from: 'render'});
  assert.ok(Math.abs(pack.duration - 3.08) < 0.005);
  assert.equal(pack.interval.end, pack.duration);
  assert.equal(pack.scenes[1].end, pack.duration);
  assert.equal(pack.scenes[1].contentEnd, 3);
  assert.ok(Math.abs(pack.scenes[1].trailingMuxPadding - 0.08) < 0.005);
  assert.equal((await loadReviewPack(job, 'final')).pack.duration, pack.duration);
  const timingFile = path.join(job, 'timing.json'), timing = JSON.parse(await readFile(timingFile, 'utf8'));
  timing.scenes[1].end = 2.9;
  await writeFile(timingFile, JSON.stringify(timing));
  await writeFile(path.join(job, 'review/render-source.json'), JSON.stringify({version: 1,
    sourceHash: await sourceFingerprint(job), videoSha256: pack.videoSha256}));
  const gapPack = await createReviewPack(job, {from: 'render'});
  assert.equal(gapPack.scenes[1].end, 2.9);
  assert.equal(gapPack.scenes[1].trailingMuxPadding, undefined);
  await assert.rejects(loadReviewPack(job, 'final'), /scene coverage is incomplete/);
});

test('shorter accepted encoded duration clips scene evidence at the render end', {skip: !available}, async t => {
  const job = await fixture(t, {videoDuration: 2.92, videoFps: 25}), pack = await createReviewPack(job, {from: 'render'});
  assert.ok(Math.abs(pack.duration - 2.92) < 0.005);
  assert.equal(pack.scenes[1].end, pack.duration);
  assert.equal(pack.scenes[1].trailingMuxPadding, undefined);
  assert.equal((await loadReviewPack(job, 'final')).pack.duration, pack.duration);
});
