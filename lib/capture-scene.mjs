import {resolveSceneCue, validateFilm} from './composition.mjs';
// Authenticated source cuts become native HTML and an auditable media sidecar.
import path from 'node:path';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {probeDuration} from './media.mjs';

const round = (n, p = 3) => Number(n.toFixed(p));
const ID = /^[a-z][a-z0-9-]*$/;
const kebab = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '') || 'edit';

// The lock owner performs the entire ledger transaction. The parent never writes
// omissions.json, so a helper exit cannot leave it continuing without the lock.
export async function updateOmissionEvidence(captureDir, update) {
  const lockFile = path.join(captureDir, '.omissions.lock');
  const holder = new URL('../scripts/omission-lock-holder.mjs', import.meta.url);
  const child = spawn('flock', ['-F', '-x', '-w', '5', lockFile, process.execPath, holder.pathname], {stdio: ['pipe', 'pipe', 'pipe']});
  let stderr = '', stdout = '';
  child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => stdout += chunk);
  child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => stderr += chunk);
  child.stdin.end(JSON.stringify({captureDir, update}));
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(code === 1 && !stderr.trim()
      ? `Timed out waiting for ${lockFile}; its owner is active.`
      : `Could not update capture omission ledger (flock exited ${code}): ${stderr.trim() || stdout.trim()}`)));
  });
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, {stdio: ['ignore', 'ignore', 'pipe']});
    let err = '';
    child.stderr.on('data', d => err += d);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${err.trim().split('\n').slice(-3).join(' ')}`)));
  });
}

export function validateEdits(edits, captureDuration) {
  const errors = [];
  if (!edits || typeof edits !== 'object') return ['the edits file must be a JSON object'];
  if (!ID.test(edits.scene || '')) errors.push('"scene" must be a kebab-case scene id (it becomes shots/<scene>.json)');
  if (!Array.isArray(edits.edits) || !edits.edits.length) errors.push('"edits" must be a non-empty list');
  const seen = new Set();
  (edits.edits || []).forEach((edit, i) => {
    const at = `edits[${i}]`;
    if (!edit?.id) return errors.push(`${at}: "id" is required (kebab-case; it names the cue and the cut)`);
    const id = kebab(edit.id);
    if (seen.has(id)) errors.push(`${at}: duplicate id "${id}"`);
    seen.add(id);
    if (!edit.phrase) errors.push(`${at} (${id}): "phrase" is required — words the narration says at this moment, copied from the script`);
    const range = edit.source;
    if (!Array.isArray(range) || range.length !== 2 || !(Number(range[1]) > Number(range[0]))) errors.push(`${at} (${id}): "source" must be [start, end] seconds in the recording`);
    if (captureDuration != null && Array.isArray(range)) {
      if (Number(range[0]) < 0 || Number(range[1]) > captureDuration + 0.05) errors.push(`${at} (${id}): source ${range.join('–')}s is outside the ${round(captureDuration)}s recording`);
      if (Number(range[1]) - Number(range[0]) < 0.4) errors.push(`${at} (${id}): the cut is ${round(Number(range[1]) - Number(range[0]))}s; a shot needs at least 0.4s`);
    }
    if (edit.zoom != null && !(Number(edit.zoom) >= 1 && Number(edit.zoom) <= 5)) errors.push(`${at} (${id}): "zoom" must be between 1 and 5`);
    if (edit.hold != null && typeof edit.hold !== 'boolean') errors.push(`${at} (${id}): "hold" must be true or false`);
    if (edit.result == null && edit.feature == null) errors.push(`${at} (${id}): record what this cut shows with "feature" and/or "result"`);
  });
  return errors;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Click clusters: actions far apart in time are different things to look at, so the camera stays put between them. */
export function clusterClicks(actions, {gap = 1.8} = {}) {
  const clicks = actions.filter(action => action.type === 'click');
  const clusters = [];
  for (const click of clicks) {
    const last = clusters[clusters.length - 1];
    if (last && click.t - last.at(-1).t <= gap) last.push(click);
    else clusters.push([click]);
  }
  return clusters;
}

/** Union of the clicked targets' bounds, so the camera frames the control rather than the last pixel touched. */
export function clusterFocus(cluster) {
  const boxes = cluster.map(click => click.bounds).filter(box => Array.isArray(box) && box[2] > 0 && box[3] > 0);
  if (!boxes.length) return {center: [cluster[0].x, cluster[0].y], width: 0, height: 0};
  const x = Math.min(...boxes.map(b => b[0])), y = Math.min(...boxes.map(b => b[1]));
  const r = Math.max(...boxes.map(b => b[0] + b[2])), b = Math.max(...boxes.map(b => b[1] + b[3]));
  return {center: [(x + r) / 2, (y + b) / 2], width: r - x, height: b - y};
}

export async function compileCaptureScene(jobDir, captureDir, edits, {
  width = 1920, height = 1080, fit = 0.9, outFile = null,
} = {}) {
  const manifest = JSON.parse(await readFile(path.join(captureDir, 'manifest.json'), 'utf8'));
  if (manifest.recorder?.pointer !== 'composited')
    throw new Error(`Capture "${manifest.task}" was not recorded with a composited pointer. The app-capture recorder was removed; record the task again with reshoot and ingest the run (docs/capture.md).`);
  // Bind all derived scene data and omission evidence to the action log captured by the
  // recorder. Hash the exact bytes (including the final newline), before interpreting actions.
  const actionLog = await readFile(path.join(captureDir, 'actions.jsonl'));
  const actionLogSha256 = createHash('sha256').update(actionLog).digest('hex');
  const manifestActionSha256 = manifest.files?.actions?.sha256;
  if (typeof manifestActionSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifestActionSha256)) {
    throw new Error('Capture manifest is missing a valid files.actions.sha256 provenance hash. This legacy capture cannot be authenticated; record the task again with reshoot and ingest it before compiling.');
  }
  if (actionLogSha256 !== manifestActionSha256.toLowerCase()) {
    throw new Error(`Capture action log provenance mismatch: actions.jsonl hashes to ${actionLogSha256}, but manifest.json records ${manifestActionSha256}. Restore the original action log or record the task again before compiling.`);
  }
  const actions = actionLog.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const duration = await probeDuration(path.join(captureDir, 'recording.mp4'));
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Capture recording has invalid duration metadata; record the task again before compiling.');
  const meaningfulTypes = ['click', 'type', 'press', 'scroll', 'wait'];
  for (let index = 0; index < actions.length; index++) {
    const action = actions[index];
    if (!meaningfulTypes.includes(action?.type)) continue;
    if (typeof action.t !== 'number' || !Number.isFinite(action.t) || action.t < 0 || action.t > duration)
      throw new Error(`Capture action ${index} (${action.type}) has invalid timestamp "t"; require a finite number from 0 through the ${round(duration)}s recording duration. Record the task again before compiling.`);
    if (['type', 'wait'].includes(action.type)) {
      if (typeof action.startedAt !== 'number' || !Number.isFinite(action.startedAt) || action.startedAt < 0 ||
          typeof action.dur !== 'number' || !Number.isFinite(action.dur) || action.dur < 0 ||
          action.startedAt > action.t || action.startedAt + action.dur > duration + 0.001 || action.startedAt + action.dur > action.t + 0.05)
        throw new Error(`Capture action ${index} (${action.type}) has invalid timed-interval metadata; require finite non-negative startedAt/dur within the recording and ending no later than its event timestamp.`);
    } else if (action.type === 'scroll' &&
        (typeof action.dur !== 'number' || !Number.isFinite(action.dur) || action.dur < 0 || action.t - action.dur < 0)) {
      throw new Error(`Capture action ${index} (scroll) has invalid duration metadata; require a finite non-negative dur whose interval stays within the recording.`);
    }
  }
  const errors = validateEdits(edits, duration);
  if (errors.length) throw new Error(`The edits file is invalid:\n  - ${errors.join('\n  - ')}`);
  const [cssW, cssH] = manifest.viewport;
  const [capW, capH] = manifest.frameSize;
  const warnings = [];
  const ranges = edits.edits.map(edit => ({id: kebab(edit.id), start: Number(edit.source?.[0]), end: Number(edit.source?.[1])})).sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) if (ranges[i].start < ranges[i - 1].end - 0.001)
    warnings.push(`${ranges[i].id} starts ${round(ranges[i - 1].end - ranges[i].start)}s before ${ranges[i - 1].id} ends: the same click appears in both cuts, so give each cut its own moment.`);
  const interactions = actions.filter(action => ['click', 'type', 'press', 'scroll'].includes(action.type));
  const sequencedActions = actions.filter(action => ['click', 'type', 'press', 'scroll', 'wait'].includes(action.type));
  const uncovered = sequencedActions.filter(action => !ranges.some(range => action.t >= range.start && action.t <= range.end));
  if (!interactions.some(action => ranges.some(range => action.t >= range.start && action.t <= range.end)))
    throw new Error('The edits show no recorded task interaction. Include at least one source range containing the real click, typing, keypress, or scroll; screenshots cannot stand in for the task.');
  for (const action of actions.filter(item => ['type', 'wait'].includes(item.type) && Number.isFinite(item.startedAt) && Number.isFinite(item.dur))) {
    const end = action.startedAt + action.dur;
    const partial = ranges.find(range => action.startedAt < range.end && end > range.start &&
      (action.startedAt < range.start - 0.04 || end > range.end + 0.04));
    if (partial) throw new Error(`Edit "${partial.id}" cuts through a recorded ${action.type} sequence (${round(action.startedAt)}–${round(end)}s). Keep the complete sequence, or omit it entirely and record an evidence-backed omission.`);
  }
  const omissions = edits.omissions ?? [];
  if (!Array.isArray(omissions)) throw new Error('"omissions" must be a list of {actionIndex, reason, evidence} records for meaningful actions outside the cuts; evidence must bind the action-log index to its current SHA-256.');
  const expectedOmissionIndexes = new Set(uncovered.map(action => actions.indexOf(action)));
  const invalidOmissions = omissions.filter(item => !Number.isInteger(item?.actionIndex) || !expectedOmissionIndexes.has(item.actionIndex) ||
    typeof item.reason !== 'string' || !item.reason.trim());
  if (invalidOmissions.length) throw new Error('Each omission must refer exactly once to an uncovered actionIndex and give a non-empty reason grounded in the recorded evidence.');
  const missingOmissions = uncovered.filter(action => {
    const index = actions.indexOf(action);
    return omissions.filter(item => item.actionIndex === index && Array.isArray(item.evidence) && item.evidence.some(e =>
      e?.kind === 'action-log' && e.path === 'actions.jsonl' && e.sha256 === actionLogSha256 && e.actionIndex === index)).length !== 1;
  });
  if (missingOmissions.length) throw new Error(`Meaningful recorded action(s) outside all cuts need evidence-backed omissions with actionIndex, reason, and matching action-log hash: ${missingOmissions.map(a => `${a.type}@${round(a.t)}s`).join(', ')}.`);
  if (new Set(omissions.map(item => item.actionIndex)).size !== omissions.length)
    throw new Error('Each omitted action must have exactly one omission record.');
  const omissionRecords = uncovered.map(action => ({actionIndex: actions.indexOf(action), action: {...action}, reason: omissions.find(item => item.actionIndex === actions.indexOf(action)).reason.trim(),
    evidence: [{kind: 'action-log', path: 'actions.jsonl', sha256: actionLogSha256, actionIndex: actions.indexOf(action)}]}));
  await updateOmissionEvidence(captureDir, {scene: edits.scene, capture: manifest.task,
    actionsSha256: actionLogSha256, records: omissionRecords,
    ranges: ranges.map(({start,end}) => [start,end]), expectedActionIndexes: uncovered.map(action => actions.indexOf(action))});

  // The adapter cuts genuine media and emits a native composition. The agent owns optional overlays/camera.
  const alignment=JSON.parse(await readFile(path.join(jobDir,'alignment.json'),'utf8'));
  const filmFile=path.join(jobDir,'film.json'), film=JSON.parse(await readFile(filmFile,'utf8'));
  const job=JSON.parse(await readFile(path.join(jobDir,'job.json'),'utf8'));
  const filmScene=film.scenes.find(scene=>scene.id===edits.scene);
  if(!filmScene) throw new Error(`film.json has no scene ${edits.scene}`);
  filmScene.kind='html';filmScene.file=`compositions/${edits.scene}.html`;
  const bounds=validateFilm(film,alignment,job.duration).scenes.find(scene=>scene.id===edits.scene);
  const assetDir=path.join(jobDir,'assets/app-review',manifest.task);
  await mkdir(assetDir,{recursive:true});
  const objects=[],report=[],clips=[];
  const mediaScale=Math.min(width/capW,height/capH),shown=[Math.round(capW*mediaScale),Math.round(capH*mediaScale)];
  const ordered=edits.edits.map(edit=>({...edit,at:resolveSceneCue({phrase:edit.phrase,occurrence:edit.occurrence,offset:edit.offset},
    alignment,job.duration,bounds.start,bounds.end,`capture ${edit.id}`,warnings)})).sort((a,b)=>a.at-b.at);
  for(const [index,edit] of ordered.entries()) {
    const id=kebab(edit.id),[start,end]=edit.source.map(Number),clip=path.join(assetDir,`${id}.mp4`);
    await ffmpeg(['-y','-ss',String(start),'-i',path.join(captureDir,'recording.mp4'),'-t',String(end-start),
      '-r','30','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-an','-movflags','+faststart',clip]);
    const measured=await probeDuration(clip),local=edit.at-bounds.start,next=ordered[index+1]?.at??bounds.end;
    const play=Math.min(measured,next-edit.at),src=`assets/app-review/${manifest.task}/${id}.mp4`;
    if(!(play>0)) throw new Error(`capture ${id}: cue is outside its scene or overlaps the next cut`);
    const poster=path.join(assetDir,`${id}-hold.png`);
    await ffmpeg(['-y','-ss',String(Math.max(0,play-1/30)),'-i',clip,'-frames:v','1','-update','1',poster]);
    clips.push(`<video id="${edits.scene}-${id}" src="${src}" muted playsinline data-start="${local}" data-duration="${play}" data-track-index="1" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain"></video>`);
    if(edit.hold!==false&&next-edit.at>play+.01) clips.push(`<img id="${edits.scene}-${id}-hold" class="clip" src="${src.replace(/\.mp4$/,'-hold.png')}" data-start="${local+play}" data-duration="${next-edit.at-play}" data-track-index="1" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain">`);
    // Geometry metadata is evidence for source/render comparison, not an executable visual schema.
    objects.push({id:`screen-${id}`,type:'video',scene:edits.scene,src,at:[width/2,height/2],size:shown,
      clipDuration:play,mediaDuration:play,mediaStart:edit.at,sourceStart:0});
    report.push({id,cut:[start,end],duration:play,cue:edit.phrase,clicks:actions.filter(a=>a.type==='click'&&a.t>=start&&a.t<=end).length,camera:'agent-authored'});
  }
  const target=outFile||path.join(jobDir,filmScene.file);
  await mkdir(path.dirname(target),{recursive:true});
  await writeFile(target,`<!doctype html><html><body><template id="${edits.scene}-template"><div id="${edits.scene}-root" data-composition-id="${edits.scene}" data-width="${width}" data-height="${height}" data-duration="${bounds.duration}" style="position:absolute;inset:0;overflow:hidden">${clips.join('\n')}</div><script>window.__timelines['${edits.scene}']=gsap.timeline({paused:true});</script></template></body></html>`);
  await writeFile(target.replace(/\.html$/,'.capture.json'),JSON.stringify({objects},null,2)+'\n');
  await writeFile(filmFile,JSON.stringify(film,null,2)+'\n');
  return {scene:filmScene,file:target,report,warnings,omissions:omissionRecords,shown:[width,height],capture:manifest,duration};
}

export async function captureFingerprint(captureDir) {
  const manifest = await readFile(path.join(captureDir, 'manifest.json'));
  return createHash('sha256').update(manifest).digest('hex');
}
