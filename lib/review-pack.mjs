import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, readFile, realpath, writeFile, rename, rm} from 'node:fs/promises';
import path from 'node:path';
import {sourceFingerprint, localFile, reviewPolicy} from './review.mjs';
import {readPersonality} from './personalities.mjs';
import {verifyCaptureVisibility} from './capture-visibility.mjs';
import {preflightReviewPack} from './preflight.mjs';

const json = async file => JSON.parse(await readFile(file, 'utf8'));
const hash = file => new Promise((resolve, reject) => {
  const digest = createHash('sha256'), stream = createReadStream(file);
  stream.on('error', reject).on('data', chunk => digest.update(chunk))
    .on('end', () => resolve(digest.digest('hex')));
});
const closeTime = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.001;

export async function assertIndependentCaptureReviewer(job, reviewer, authenticated = null) {
  if (!reviewer?.independent || typeof reviewer.agentId !== 'string' || !reviewer.agentId.trim())
    throw new Error('Reviewer report must identify an independent reviewer agent.');
  const review = (await json(path.join(job, 'job.json'))).review || {};
  const producers = review.producerAgentIds;
  if (review.producerIdentityStatus === 'incomplete' || (review.producerIdentityStatus === 'unrecorded' && !review.producerAgentRecords?.length) || !Array.isArray(producers) || !producers.length ||
      (producers.length === 1 && producers[0] === '/root' && !review.producerAgentRecords?.length))
    throw new Error('Producer identities are incomplete for this existing job; independence cannot be established.');
  if (producers.includes(reviewer.agentId)) throw new Error(`Producer agent ${reviewer.agentId} cannot submit an independent capture verdict.`);
  const appReview = readPersonality(job).profile.id === 'app-review';
  if (appReview && (!authenticated || typeof authenticated.agentId !== 'string' || !authenticated.agentId.trim() ||
      authenticated.role !== 'reviewer' || authenticated.agentId !== reviewer.agentId))
    throw new Error('Capture verdict reviewer identity must be authenticated by the runner with matching VIDEO_AGENT_ID and VIDEO_AGENT_ROLE=reviewer.');
  if (!appReview && authenticated && (authenticated.role !== 'reviewer' || authenticated.agentId !== reviewer.agentId))
    throw new Error('Capture verdict reviewer identity must match VIDEO_AGENT_ID and VIDEO_AGENT_ROLE=reviewer.');
}

// A disposition is an independent visual-inspection record, never a rewrite of
// the pixel verifier's status. Its frame evidence must remain local and hashable.
async function decodedFrame(file, at) {
  const args = ['-nostdin','-hide_banner','-loglevel','error'];
  args.push('-i', file);
  if (at !== undefined) args.push('-ss', String(at));
  args.push('-frames:v','1','-vf','scale=96:54:flags=area,format=rgb24','-f','rawvideo','pipe:1');
  return new Promise((resolve,reject)=>{
    const child=spawn('ffmpeg',args,{stdio:['ignore','pipe','pipe']}), chunks=[]; let error='';
    child.stdout.on('data',chunk=>chunks.push(chunk)); child.stderr.on('data',chunk=>error+=chunk);
    child.on('error',reject); child.on('close',code=>code===0?resolve(Buffer.concat(chunks)):reject(new Error(error.trim())));
  });
}
function framesMatch(a,b) {
  if (a.length !== 96*54*3 || b.length !== a.length) return false;
  let err=0;
  for(let i=0;i<a.length;i++) err += Math.abs(a[i]-b[i]);
  // PNG round trips and codec chroma reconstruction can shift a few RGB values;
  // this tight mean error still rejects a different screen/frame content.
  return err/a.length <= 8;
}

async function validateCaptureDispositions(job, visibility, sourceHash, videoSha256, world, video) {
  const captures = visibility.captures;
  const unverified = captures.filter(capture => capture.status === 'unverified');
  if (!unverified.length) return [];
  let document;
  try { document = await json(await localFile(job, 'review/capture-visibility-dispositions.json')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Unverified app-review capture coverage requires evidence-backed dispositions; create review/capture-visibility-dispositions.json for the current render.');
    throw error;
  }
  if (document.version !== 1 || document.sourceHash !== sourceHash || document.videoSha256 !== videoSha256 || !Array.isArray(document.dispositions))
    throw new Error('Capture visibility dispositions are stale or malformed for this render.');
  const accepted = [];
  if (document.dispositions.length !== unverified.length || document.dispositions.some(item =>
    !unverified.some(capture => capture.id === item.captureId && capture.scene === item.sceneId)))
    throw new Error('Capture visibility dispositions contain stale or unrelated capture entries.');
  for (const capture of unverified) {
    const matches = document.dispositions.filter(item => item.captureId === capture.id && item.sceneId === capture.scene);
    if (matches.length !== 1) throw new Error(`Capture ${capture.id} has a missing or duplicate visual-inspection disposition.`);
    const item = matches[0];
    if (item.status !== 'visually-inspected' || !['acceptable','reject'].includes(item.decision) ||
        !closeTime(item.start, capture.interval?.start) || !closeTime(item.end, capture.interval?.end) ||
        !Array.isArray(item.evidence) || item.evidence.length < 6)
      throw new Error(`Capture ${capture.id} has a rejected or inaccurate visual-inspection disposition.`);
    try { await assertIndependentCaptureReviewer(job, item.reviewer, item.authenticatedReviewer); }
    catch { throw new Error(`Capture ${capture.id} reviewer is not independent of the producers.`); }
    if (item.decision === 'reject') throw new Error(`Independent reviewer rejected capture ${capture.id}; repair the scene and render again.`);
    const layer = (world.objects || []).find(o => o.id === capture.id && o.type === 'video' && /app-capture\//.test(o.src || ''));
    const scene = (world.scenes || []).find(s => s.id === capture.scene);
    if (!layer || !scene) throw new Error(`Capture ${capture.id} has no current source layer/time mapping.`);
    const sourceFile = await localFile(job, layer.src);
    for (const evidence of item.evidence) {
      if (!['source-frame', 'render-frame'].includes(evidence.kind) || !Number.isFinite(evidence.sceneAt) ||
          evidence.sceneAt < item.start || evidence.sceneAt >= item.end || typeof evidence.path !== 'string' ||
          (evidence.kind === 'source-frame' && (!Number.isFinite(evidence.sourceAt) || evidence.sourceAt < 0)) ||
          !/^[a-f0-9]{64}$/.test(evidence.sha256))
        throw new Error(`Capture ${capture.id} disposition has invalid frame evidence.`);
      const file = await localFile(job, evidence.path);
      const bytes = await readFile(file);
      if (await hash(file) !== evidence.sha256 || path.extname(file).toLowerCase() !== '.png' ||
          !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw new Error(`Capture ${capture.id} disposition evidence is stale or is not a PNG frame.`);
      const ratio = (evidence.sceneAt - item.start) / (item.end - item.start);
      const expectedSceneAt = item.start + (item.end-item.start) * ([0.1,0.5,0.9].sort((a,b)=>Math.abs(a-ratio)-Math.abs(b-ratio))[0]);
      if (Math.abs(evidence.sceneAt-expectedSceneAt) > 0.12) throw new Error(`Capture ${capture.id} has a frame at the wrong inspection time.`);
      const localTime = Number(layer.sourceStart ?? layer.trimStart ?? 0) + evidence.sceneAt - scene.start;
      if (evidence.kind === 'source-frame' && (!closeTime(evidence.sourceAt, localTime) || localTime < 0))
        throw new Error(`Capture ${capture.id} source frame has an incorrect trim/time mapping.`);
      const expected = await decodedFrame(evidence.kind === 'source-frame' ? sourceFile : video, evidence.kind === 'source-frame' ? localTime : evidence.sceneAt);
      const supplied = await decodedFrame(file);
      if (!framesMatch(expected, supplied)) throw new Error(`Capture ${capture.id} ${evidence.kind} is not the decoded media frame at its declared time.`);
    }
    for (const kind of ['source-frame', 'render-frame']) for (const ratio of [0.1, 0.5, 0.9]) {
      const target = item.start + (item.end - item.start) * ratio;
      if (!item.evidence.some(evidence => evidence.kind === kind && Math.abs(evidence.sceneAt - target) <= 0.12))
        throw new Error(`Capture ${capture.id} disposition must include paired source and encoded-render frames across its interval.`);
    }
    accepted.push({captureId: capture.id, sceneId: capture.scene, interval: capture.interval,
      disposition: 'visually-inspected-acceptable', evidence: item.evidence});
  }
  return accepted;
}

// Create reproducible paired evidence from the current recorded source and encoded render.
export async function generateCaptureInspection(job) {
  const pixels = await json(path.join(job, 'review/pixels.json'));
  const sourceHash = await sourceFingerprint(job), video = await localFile(job, 'renders/video.mp4'), videoSha256 = await hash(video);
  if (pixels.sourceHash !== sourceHash || pixels.videoSha256 !== videoSha256) throw new Error('Playback report is stale; render and verify current sources first.');
  const world = await json(path.join(job, 'assets/world.json'));
  const unverified = pixels.captureVisibility?.captures?.filter(c => c.status === 'unverified') || [];
  if (!unverified.length) throw new Error('There are no unverified capture intervals to inspect.');
  const dispositions=[];
  for (const capture of unverified) {
    const layer=(world.objects||[]).find(o=>o.id===capture.id && o.type==='video' && /app-capture\//.test(o.src||''));
    const scene=(world.scenes||[]).find(s=>s.id===capture.scene);
    if(!layer||!scene||!capture.interval) throw new Error(`Missing source mapping for ${capture.id}.`);
    const source=await localFile(job,layer.src), evidence=[];
    for(const ratio of [0.1,0.5,0.9]) {
      const sceneAt=capture.interval.start+(capture.interval.end-capture.interval.start)*ratio;
      const sourceAt=Number(layer.sourceStart??layer.trimStart??0)+sceneAt-scene.start;
      for(const [kind,file,time] of [['source-frame',source,sourceAt],['render-frame',video,sceneAt]]) {
        const output=path.join(job,'review/inspection',capture.id,`${Math.round(ratio*100)}-${kind}.png`);
        await mkdir(path.dirname(output),{recursive:true});
        await command('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-i',file,'-ss',String(time),'-frames:v','1','-y',output]);
        evidence.push({kind,sceneAt,...(kind==='source-frame'?{sourceAt}:{}),path:path.relative(job,output).split(path.sep).join('/'),sha256:await hash(output)});
      }
    }
    dispositions.push({captureId:capture.id,sceneId:capture.scene,start:capture.interval.start,end:capture.interval.end,status:'pending-independent-inspection',decision:'pending',evidence});
  }
  const result={version:1,sourceHash,videoSha256,dispositions};
  await writeFile(path.join(job,'review/capture-visibility-dispositions.json'),JSON.stringify(result,null,2)+'\n');
  return result;
}
function command(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${binary} failed (${code}): ${stderr}`)));
  });
}
const ffmpeg = args => command('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1', ...args]);
function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative))
    throw new Error('Review output must be a JSON file inside the job review directory.');
}
// Check each existing parent before mkdir: a lexical containment check alone permits symlink escapes.
async function safeOutput(job, output) {
  const review = path.join(job, 'review');
  contained(review, output);
  const parts = path.relative(job, path.dirname(output)).split(path.sep);
  let current = job;
  for (const part of parts) {
    current = path.join(current, part);
    try { await mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (await realpath(current) !== current) throw new Error('Symlinked review directories are not allowed.');
  }
}

// Frame indices on a 30 fps review clock: one a second, plus each side of every scene boundary and beat.
function sampleIndices(timing, start, end, last, step = 1) {
  const times = new Set();
  const add = at => {
    if (at >= start && at < end) times.add(Math.max(Math.ceil(start * 30), Math.min(Math.floor(last * 30), Math.round(at * 30))));
  };
  for (let at = start; at < end; at += step) add(at);
  add(last);
  for (const scene of timing.scenes) {
    for (const boundary of [scene.start, scene.end]) for (const delta of [-0.25, -1/30, 0, 1/30, 0.25]) add(boundary + delta);
    add(scene.end - 1 / 30);
    for (const beat of scene.beats ?? []) for (const delta of [-0.25, 0, 0.25]) add(beat.at + delta);
  }
  return [...times].sort((a, b) => a - b);
}

// Twelve phone-scale (480 px) frames per sheet; tall frames go 4 across so a sheet stays viewable as one image.
async function contactSheets(run, framesDir, indices, manifest, record) {
  const columns = manifest.height > manifest.width ? 4 : 2;
  for (let i = 0; i < indices.length; i += 12) {
    const count = Math.min(12, indices.length - i), sheet = path.join(run, `sheet-${String(i / 12).padStart(4, '0')}.png`);
    await ffmpeg(['-framerate', '1', '-start_number', String(i), '-i', path.join(framesDir, '%06d.png'),
      '-vf', `scale=480:-2,tile=${columns}x${Math.ceil(count / columns)}:nb_frames=${count}:padding=8:color=0x111820`, '-frames:v', '1', sheet]);
    await record(sheet, 'contact-sheet', indices[i] / 30, indices[i + count - 1] / 30,
      {samples: indices.slice(i, i + count).map(index => index / 30), frameWidth: 480});
  }
}

// The automated check results and motion transcript, as text evidence for every reviewer.
async function textEvidence(job, run, start, end, record, names) {
  for (const [name, kind] of names) {
    let bytes; try { bytes = await readFile(path.join(job, 'review', name)); } catch (error) { if (error.code !== 'ENOENT') throw error; continue; }
    const frozen = path.join(run, name); await writeFile(frozen, bytes); await record(frozen, kind, start, end);
  }
}

function checkInterval(start, end, duration) {
  if (![start, end].every(Number.isFinite) || start < 0 || end <= start || end > duration)
    throw new Error('Invalid review interval: require 0 <= start < end <= video duration.');
  if (start !== 0 || end !== duration) throw new Error('Final review must cover the full video.');
}

/** Freeze review evidence. By default the frames come straight from the built HTML (no render): the
 * browser seeks the same timeline the renderer captures. `from: 'render'` reads renders/video.mp4 instead.
 * output is an optional job-relative pack JSON path underneath review/.
 * Samples are rounded to the nearest frame on a 30 fps review clock.
 */
export async function createReviewPack(job, {stage = 'final', start = 0, end, output, from = 'html'} = {}) {
  if (stage !== 'final') throw new Error('Review stage must be final.');
  job = await realpath(path.resolve(job));
  if (readPersonality(job).profile.id === 'app-review' && from !== 'render')
    throw new Error('Final app-review evidence must come from the encoded render. Render and verify the film, then run review-pack --stage final --from render.');
  if (from === 'html') return htmlReviewPack(job, {stage, start, end, output});
  if (from !== 'render') throw new Error('Review evidence comes from html or render.');
  const packFile = path.resolve(job, output ?? `review/${stage}/pack.json`);
  if (path.extname(packFile) !== '.json') throw new Error('Review output must be a JSON file.');
  contained(path.join(job, 'review'), packFile);
  const [manifest, timing] = await Promise.all([json(path.join(job, 'job.json')), json(path.join(job, 'timing.json'))]);
  if (timing.missing?.length)
    throw new Error(`Final review cannot omit scenes: ${timing.missing.join(', ')}. Build the complete film first.`);
  const video = await localFile(job, 'renders/video.mp4');
  const probe = JSON.parse(await command('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video]));
  const duration = Number(probe.format?.duration);
  if (!probe.streams?.some(stream => stream.codec_type === 'video') || !Number.isFinite(duration) || duration <= 0)
    throw new Error('Review requires a valid rendered video.');
  if (!Number.isFinite(manifest.duration) || Math.abs(duration - manifest.duration) > 0.12)
    throw new Error('Rendered duration differs from the job.');
  end ??= duration;
  checkInterval(start, end, duration);
  const padding = duration - manifest.duration;
  const scenes = timing.scenes.filter(scene => scene.start < end && scene.end > start)
    .map(scene => {
      const range = {id: scene.id, start: Math.max(start, scene.start), end: Math.min(end, scene.end)};
      // Include verified mux padding in the final scene's evidence coverage, while
      // retaining the actual content boundary. Never bridge a missing content scene.
      if (Math.abs(scene.end - manifest.duration) < 0.000001 && padding > 0 && padding <= 0.120001 && end > scene.end) {
        range.contentEnd = scene.end;
        range.end = end;
        range.trailingMuxPadding = end - scene.end;
      }
      return range;
    });
  if (!scenes.length) throw new Error('Review interval has no compiled scenes.');
  const sourceHash = await sourceFingerprint(job), videoSha256 = await hash(video);
  let captureVisibilityDisposition = [], appCaptureIntervals = [], appCaptureOmissions = [], pendingCaptureOmissions = [];
  if (readPersonality(job).profile.id === 'app-review') {
    let pixels;
    try { pixels = await json(await localFile(job, 'review/pixels.json')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new Error('Final app-review pack requires a passing pixel playback report for the current render. Render and verify first.');
    }
    if (pixels.sourceHash !== sourceHash || pixels.videoSha256 !== videoSha256)
      throw new Error('App-review pixel playback report is stale for this render or its sources. Render and verify again.');
    if (pixels.ok !== true || !Array.isArray(pixels.errors) || pixels.errors.length)
      throw new Error('App-review pixel playback report is failing; repair the render before creating a final pack.');
    if (!pixels.captureVisibility?.coverage || !Array.isArray(pixels.captureVisibility.captures))
      throw new Error('App-review pixel playback report lacks capture visibility coverage; render and verify again.');
    if (pixels.captureVisibility.coverage.failed > 0)
      throw new Error('App-review capture visibility report is failing; repair the render before creating a final pack.');
    let world;
    try { world = await json(path.join(job, 'assets/world.json')); }
    catch (error) { if (error.code === 'ENOENT') world = {objects: [], scenes: []}; else throw error; }
    const visibility = pixels.captureVisibility;
    const recomputed = await verifyCaptureVisibility(job, video, world);
    if (JSON.stringify(visibility) !== JSON.stringify(recomputed))
      throw new Error('App-review capture visibility report is stale or altered; rerun render verification.');
    const dispositions = await validateCaptureDispositions(job, visibility, sourceHash, videoSha256, world, video);
    if ((visibility.coverage.unverified ?? 0) !== visibility.captures.filter(capture => capture.status === 'unverified').length ||
        (visibility.coverage.verified ?? 0) !== visibility.captures.filter(capture => capture.status === 'verified').length ||
        (visibility.coverage.failed ?? 0) !== visibility.captures.filter(capture => capture.status === 'failed').length ||
        visibility.captures.some(capture => !['verified', 'failed', 'unverified'].includes(capture.status)))
      throw new Error('App-review capture visibility coverage counts are inaccurate.');
    captureVisibilityDisposition = dispositions;
    const worldForCaptureSources = await json(path.join(job, 'assets/world.json'));
    appCaptureIntervals = visibility.captures.filter(capture => capture.interval && Number.isFinite(capture.interval.start) && Number.isFinite(capture.interval.end))
      .flatMap(capture => {
        const layer = (worldForCaptureSources.objects || []).find(item => item.id === capture.id && item.scene === capture.scene);
        if (!layer) throw new Error(`Cannot identify the video layer for ${capture.id}/${capture.scene}.`);
        // Only captures compiled from an app-capture task carry an omissions ledger.
        const task = layer.src?.match(/^assets\/app-capture\/([^/]+)\//)?.[1];
        return task ? [{id: capture.id, task, scene: capture.scene, start: capture.interval.start, end: capture.interval.end}] : [];
      });
    for (const capture of appCaptureIntervals) {
      const file = path.join(job, 'capture', capture.task, 'omissions.json');
      let ledger;
      try { ledger = await json(file); }
      catch (error) {
        if (error.code === 'ENOENT') throw new Error(`App-review capture ${capture.task} is missing capture/${capture.task}/omissions.json. Recompile its scene with capture-scene before freezing final review evidence.`);
        throw new Error(`App-review capture ${capture.id} has invalid omissions.json: ${error.message}`);
      }
      const actionFile = path.join(job, 'capture', capture.task, 'actions.jsonl');
      const manifestFile = path.join(job, 'capture', capture.task, 'manifest.json');
      const editsFile = path.join(job, 'capture', capture.task, 'edits.json');
      const [actionsSha256, captureManifest, actionsText, currentEdits] = await Promise.all([hash(actionFile), json(manifestFile), readFile(actionFile, 'utf8'), json(editsFile)]);
      if (ledger.version !== 2 || ledger.capture !== capture.task || ledger.actionsSha256 !== actionsSha256 ||
          captureManifest.files?.actions?.sha256 !== actionsSha256 || !Array.isArray(ledger.scenes) || !Array.isArray(ledger.records))
        throw new Error(`App-review capture ${capture.id} omissions.json is stale or malformed; recompile the affected scene from its current capture evidence.`);
      const sceneEntry = ledger.scenes.filter(item => item.scene === capture.scene);
      const records = ledger.records.filter(item => item.scene === capture.scene);
      const actions = actionsText.split('\n').filter(Boolean).map(line => JSON.parse(line));
      const captureDuration = Number(captureManifest.duration);
      if (!Number.isFinite(captureDuration) || captureDuration <= 0)
        throw new Error(`App-review capture ${capture.id} has invalid recording duration metadata in manifest.json.`);
      for (let index = 0; index < actions.length; index++) {
        const action = actions[index];
        if (!['click', 'type', 'press', 'scroll', 'wait'].includes(action?.type)) continue;
        if (typeof action.t !== 'number' || !Number.isFinite(action.t) || action.t < 0 || action.t > captureDuration)
          throw new Error(`App-review capture ${capture.id} action ${index} (${action.type}) has invalid timestamp "t"; require a finite number from 0 through the ${captureDuration}s recording duration.`);
        if (['type', 'wait'].includes(action.type) &&
            (typeof action.startedAt !== 'number' || !Number.isFinite(action.startedAt) || action.startedAt < 0 ||
             typeof action.dur !== 'number' || !Number.isFinite(action.dur) || action.dur < 0 ||
             action.startedAt > action.t || action.startedAt + action.dur > captureDuration + 0.001 || action.startedAt + action.dur > action.t + 0.05))
          throw new Error(`App-review capture ${capture.id} action ${index} (${action.type}) has invalid timed-interval metadata; require finite non-negative startedAt/dur within the recording and ending no later than its event timestamp.`);
        if (action.type === 'scroll' &&
            (typeof action.dur !== 'number' || !Number.isFinite(action.dur) || action.dur < 0 || action.t - action.dur < 0))
          throw new Error(`App-review capture ${capture.id} action ${index} (scroll) has invalid duration metadata; require a finite non-negative dur whose interval stays within the recording.`);
      }
      const ranges = sceneEntry[0]?.ranges;
      const expected = sceneEntry[0]?.expectedActionIndexes;
      const actualRanges = Array.isArray(currentEdits.edits) ? currentEdits.edits.map(edit => [Number(edit.source?.[0]), Number(edit.source?.[1])]).sort((a,b)=>a[0]-b[0]) : null;
      const actualExpected = actualRanges ? actions.map((action,index)=>({action,index})).filter(({action}) =>
        ['click','type','press','scroll','wait'].includes(action.type) &&
        !actualRanges.some(([start,end]) => action.t >= start && action.t <= end)).map(({index})=>index) : null;
      if (sceneEntry.length !== 1 || sceneEntry[0].actionsSha256 !== actionsSha256 || sceneEntry[0].omissionCount !== records.length ||
          currentEdits.scene !== capture.scene || !actualRanges || !actualExpected ||
          JSON.stringify(ranges) !== JSON.stringify(actualRanges) || JSON.stringify(expected) !== JSON.stringify(actualExpected) ||
          !Array.isArray(ranges) || !Array.isArray(expected) || ranges.some(range => !Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite)) ||
          expected.some(index => !Number.isInteger(index) || index < 0 || index >= actions.length || !['click','type','press','scroll','wait'].includes(actions[index].type) ||
            ranges.some(([start,end]) => actions[index].t >= start && actions[index].t <= end)) ||
          expected.length !== records.length || expected.some(index => records.filter(item => item.actionIndex === index).length !== 1) ||
          records.some(item => !Number.isInteger(item.actionIndex) || typeof item.reason !== 'string' || !item.reason.trim() ||
            !Array.isArray(item.evidence) || item.evidence.length !== 1 || item.evidence[0].kind !== 'action-log' ||
            item.evidence[0].path !== 'actions.jsonl' || item.evidence[0].sha256 !== actionsSha256 || item.evidence[0].actionIndex !== item.actionIndex))
        throw new Error(`App-review capture ${capture.id}/${capture.scene} has missing or invalid scene-bound omission records; recompile with capture-scene after correcting edits.json.`);
      const manifestSha256 = await hash(manifestFile);
      const frozenLedger = {...ledger, sourceHash, manifestSha256, scene: capture.scene, records};
      pendingCaptureOmissions.push({capture, frozenLedger, actionsSha256, manifestSha256});
      appCaptureOmissions.push({captureId: capture.task, layerId: capture.id, sceneId: capture.scene, actionsSha256,
        manifestSha256, recordCount: records.length});
    }
  }
  let receipt;
  try { receipt = await json(await localFile(job, 'review/render-source.json')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error('Missing render source receipt; render and verify before review-pack.');
  }
  if (receipt.version !== 1 || receipt.sourceHash !== sourceHash || receipt.videoSha256 !== videoSha256)
    throw new Error('Render source receipt is stale; render and verify current sources before review-pack.');
  await safeOutput(job, packFile);
  const run = path.join(path.dirname(packFile), `evidence-${randomUUID()}`);
  await mkdir(run);
  const framesDir = path.join(run, 'frames');
  await mkdir(framesDir);
  const last = Math.max(start, Math.min(end, duration) - 1 / 30);
  const indices = sampleIndices(timing, start, end, last, reviewPolicy(manifest).frameStep);
  const select = indices.map(index => `eq(n\\,${index})`).join('+');
  const filterFile = path.join(run, 'frame-filter.txt');
  await writeFile(filterFile, `fps=30,select='${select}',scale='min(960,iw)':-2,drawtext=text='%{pts\\:hms}':x=12:y=12:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.8`);
  await ffmpeg(['-i', video, '-filter_script:v', filterFile,
    '-fps_mode', 'vfr', '-start_number', '0', path.join(framesDir, '%06d.png')]);
  const evidence = [];
  const record = async (file, kind, first, final, extra = {}) => evidence.push({path: path.relative(job, file).split(path.sep).join('/'),
    sha256: await hash(file), kind, start: first, end: final, ...extra});
  for (const {capture, frozenLedger, actionsSha256, manifestSha256} of pendingCaptureOmissions) {
    const frozen = path.join(run, 'capture-omissions', `${capture.task}-${capture.scene}.json`);
    await mkdir(path.dirname(frozen), {recursive: true});
    await writeFile(frozen, `${JSON.stringify(frozenLedger, null, 2)}\n`);
    await record(frozen, 'capture-omissions', capture.start, capture.end, {captureId: capture.task, layerId: capture.id, sceneId: capture.scene,
      actionsSha256, manifestSha256});
  }
  for (const disposition of captureVisibilityDisposition) {
    const frozenEvidence = [];
    for (const [index, item] of disposition.evidence.entries()) {
      const source = await localFile(job, item.path);
      const frozen = path.join(run, 'capture-visibility', disposition.captureId, `${String(index).padStart(2, '0')}-${item.kind}.png`);
      await mkdir(path.dirname(frozen), {recursive: true});
      await writeFile(frozen, await readFile(source));
      await record(frozen, 'capture-visibility-frame', item.sceneAt, item.sceneAt,
        {captureId: disposition.captureId, sceneId: disposition.sceneId, frameType: item.kind, ...(item.sourceAt == null ? {} : {sourceAt: item.sourceAt})});
      frozenEvidence.push({...item, path: path.relative(job, frozen).split(path.sep).join('/')});
    }
    disposition.evidence = frozenEvidence;
  }
  await record(await localFile(job, manifest.workflow === 'news-edit' ? 'assets/news-mix.wav' : 'assets/narration.wav'), 'audio', 0, duration);
  let verificationBytes;
  try { verificationBytes = await readFile(await localFile(job, 'review/render-verification.json')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (verificationBytes) {
    const verification = JSON.parse(verificationBytes);
    if (verification.ok !== true || verification.sha256 !== videoSha256)
      throw new Error('Render verification is stale; verify the current render before review-pack.');
    const frozen = path.join(run, 'verification.json');
    await writeFile(frozen, verificationBytes);
    await record(frozen, 'verification', 0, duration);
  }
  // Text evidence for reviewers without image input, plus the automated check results.
  await textEvidence(job, run, start, end, record, [['motion.md', 'motion'], ['inspect.json', 'checks'], ['pixels.json', 'checks']]);
  // Sound evidence (the reviewers cannot hear): the sound list, the mix measurements, cue sheets from the MP4.
  const soundFiles = ['review/sounds.md', 'review/mix.json', 'review/sound/listen.md'];
  try { soundFiles.push(...(JSON.parse(await readFile(path.join(job, 'review/sound/listen.json'), 'utf8')).sheets || [])); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const rel of soundFiles) {
    let bytes; try { bytes = await readFile(path.join(job, rel)); } catch (error) { if (error.code !== 'ENOENT') throw error; continue; }
    const frozen = path.join(run, 'sound', path.basename(rel)); await mkdir(path.dirname(frozen), {recursive: true}); await writeFile(frozen, bytes);
    await record(frozen, 'sound', start, end);
  }
  for (let i = 0; i < indices.length; i++)
    await record(path.join(framesDir, `${String(i).padStart(6, '0')}.png`), 'frames', indices[i] / 30, indices[i] / 30);
  await contactSheets(run, framesDir, indices, manifest, record);
  let clipIndex = 0;
  for (const scene of scenes) for (let at = scene.start; at < scene.end - 0.001; at += 11.5) {
    const clipStart = Math.max(start, at - 0.25), until = Math.min(end, Math.min(scene.end, at + 11.5) + 0.25);
    const clip = path.join(run, `clip-${String(clipIndex++).padStart(4, '0')}.mp4`);
    // Re-encode after input seek so clips start accurately rather than at the previous keyframe.
    await ffmpeg(['-ss', String(clipStart), '-i', video, '-t', String(until - clipStart), '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', "scale='min(960,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', clip]);
    await record(clip, 'clip', clipStart, until, {sceneId: scene.id, playbackRate: 1});
  }
  if (sourceHash !== await sourceFingerprint(job) || videoSha256 !== await hash(await localFile(job, 'renders/video.mp4')))
    throw new Error('Production source or video changed while generating review evidence; rerun review-pack.');
  const pack = {version: 1, stage, sourceHash, videoSha256, duration, interval: {start, end}, scenes, evidence,
    ...(readPersonality(job).profile.id === 'app-review' ? {captureVisibilityDisposition, appCaptureIntervals, appCaptureOmissions} : {}),
    generatedAt: new Date().toISOString()};
  return freezePack(job, stage, packFile, run, pack);
}

async function freezePack(job, stage, packFile, run, pack) {
  // Preflight before the pack becomes visible: a failed check must not leave a pack that can spawn reviewers.
  const preflight = preflightReviewPack(pack);
  const bytes = `${JSON.stringify(pack, null, 2)}\n`;
  const temporary = path.join(run, 'pack.json');
  await writeFile(temporary, bytes);
  await rename(temporary, packFile);
  const packSha256 = createHash('sha256').update(bytes).digest('hex');
  const report = path.join(job, 'review', stage, 'preflight.json');
  await mkdir(path.dirname(report), {recursive: true});
  await writeFile(report, `${JSON.stringify({...preflight, packSha256}, null, 2)}\n`);
  return {...pack, packPath: path.relative(job, packFile).split(path.sep).join('/'), packSha256};
}

// Review evidence straight from the built HTML: the same seek-safe timeline the renderer captures, without encoding a
// video. Frames, contact sheets, the narration and the build's own checks; no clips (no reviewer agent plays video).
async function htmlReviewPack(job, {stage, start = 0, end, output}) {
  job = await realpath(path.resolve(job));
  const packFile = path.resolve(job, output ?? `review/${stage}/pack.json`);
  if (path.extname(packFile) !== '.json') throw new Error('Review output must be a JSON file.');
  contained(path.join(job, 'review'), packFile);
  const [manifest, timing] = await Promise.all([json(path.join(job, 'job.json')), json(path.join(job, 'timing.json'))]);
  if (timing.missing?.length)
    throw new Error(`Final review cannot omit scenes: ${timing.missing.join(', ')}. Build the complete film first.`);
  const sourceHash = await sourceFingerprint(job);
  const build = await json(path.join(job, 'review/build.json')).catch(() => null);
  if (!build?.ok || build.scope !== 'all' || build.sourceHash !== sourceHash)
    throw new Error('Review evidence comes from the current successful build. Run build first.');
  const duration = manifest.duration;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The job has no valid duration.');
  end ??= duration;
  checkInterval(start, end, duration);
  const built = new Set(timing.scenes.filter(s => !(timing.missing || []).includes(s.id)).map(s => s.id));
  const scenes = timing.scenes.filter(scene => built.has(scene.id) && scene.start < end && scene.end > start)
    .map(scene => ({id: scene.id, start: Math.max(start, scene.start), end: Math.min(end, scene.end)}));
  if (!scenes.length) throw new Error('Review interval has no built scenes.');
  await safeOutput(job, packFile);
  const run = path.join(path.dirname(packFile), `evidence-${randomUUID()}`), framesDir = path.join(run, 'frames'), rawDir = path.join(run, 'raw');
  await mkdir(framesDir, {recursive: true}); await mkdir(rawDir);
  const last = Math.max(start, end - 1 / 30), indices = sampleIndices(timing, start, end, last, reviewPolicy(manifest).frameStep);
  const {openInspector} = await import('./inspect.mjs');
  const inspector = await openInspector(job, manifest);
  try {
    for (const [i, index] of indices.entries()) {
      const raw = path.join(rawDir, `${String(i).padStart(6, '0')}.png`), t = index / 30;
      await inspector.screenshot(t, raw);
      await ffmpeg(['-i', raw, '-vf', `scale='min(960,iw)':-2,drawtext=text='t=${t.toFixed(2)}s':x=12:y=12:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.8`,
        '-frames:v', '1', path.join(framesDir, `${String(i).padStart(6, '0')}.png`)]);
    }
  } finally { await inspector.close(); }
  await rm(rawDir, {recursive: true, force: true});
  const evidence = [];
  const record = async (file, kind, first, final, extra = {}) => evidence.push({path: path.relative(job, file).split(path.sep).join('/'),
    sha256: await hash(file), kind, start: first, end: final, ...extra});
  await record(await localFile(job, manifest.workflow === 'news-edit' ? 'assets/news-mix.wav' : 'assets/narration.wav'), 'audio', 0, duration);
  await textEvidence(job, run, start, end, record, [['motion.md', 'motion'], ['inspect.json', 'checks'], ['sounds.md', 'sound'], ['news-verification.json','checks']]);
  for (let i = 0; i < indices.length; i++)
    await record(path.join(framesDir, `${String(i).padStart(6, '0')}.png`), 'frames', indices[i] / 30, indices[i] / 30);
  await contactSheets(run, framesDir, indices, manifest, record);
  if (sourceHash !== await sourceFingerprint(job)) throw new Error('Production sources changed while generating review evidence; rerun review-pack.');
  const pack = {version: 1, stage, source: 'html', sourceHash, videoSha256: null, duration, interval: {start, end}, scenes, evidence, generatedAt: new Date().toISOString()};
  return freezePack(job, stage, packFile, run, pack);
}
