// Compile an ingested reshoot capture into a scene: cut the source recording per edit, then derive the camera
// push-in/pull-out and the click rings from the action log. The source recording stays untouched; every cut is a
// derived copy under assets/, so the evidence in the capture directory still matches the manifest hashes.
//
// The pointer is not drawn here. reshoot composites the cursor into the footage it records, so a synthetic cursor would
// be a second pointer; the manifest records `recorder.pointer: "composited"` and this module refuses anything else.
//
// Timing stays cue-relative (`at: "edit-id+1.4"`), never absolute seconds, so the compiled scene follows narration
// timing the way every other scene does.
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
async function updateOmissionEvidence(captureDir, update) {
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
    throw new Error(`Capture "${manifest.task}" was not recorded with a composited pointer. The app-capture recorder was removed; record the task again with reshoot and ingest the run (docs/reshoot.md).`);
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

  // The recording sits on the theme background like a studio canvas; the camera then frames parts of it.
  const boxW = width * fit, boxH = height * fit;
  const scale = Math.min(boxW / capW, boxH / capH);
  const shown = [Math.round(capW * scale), Math.round(capH * scale)];
  const originWorld = [Math.round((width - shown[0]) / 2), Math.round((height - shown[1]) / 2)];
  const toWorld = ([x, y]) => [round(originWorld[0] + (x / cssW) * shown[0], 2), round(originWorld[1] + (y / cssH) * shown[1], 2)];
  const worldPerCss = shown[0] / cssW;
  // The detail a recording actually carries is its frame size, not its CSS viewport: a @2 capture holds two source pixels
  // per CSS pixel, so it can be pushed in twice as far before one source pixel starts filling more than 1.5 world pixels.
  const detailPerCss = (manifest.frameSize?.[0] || cssW) / cssW;
  const maxZoom = clamp((1.5 * detailPerCss) / worldPerCss, 1.05, 3.2);
  const centre = [width / 2, height / 2];
  // Keep a pushed-in camera inside the recording, so a control near an edge is framed as far as the footage allows
  // instead of opening a gap of theme background beside it.
  const clampCentre = (point, zoom) => {
    const halfW = width / (2 * zoom), halfH = height / (2 * zoom);
    const x = shown[0] <= 2 * halfW ? originWorld[0] + shown[0] / 2 : clamp(point[0], originWorld[0] + halfW, originWorld[0] + shown[0] - halfW);
    const y = shown[1] <= 2 * halfH ? originWorld[1] + shown[1] / 2 : clamp(point[1], originWorld[1] + halfH, originWorld[1] + shown[1] - halfH);
    return [round(x, 2), round(y, 2)];
  };

  const assetDir = path.join(jobDir, 'assets/app-review', manifest.task);
  await mkdir(assetDir, {recursive: true});

  const objects = [], sceneActions = [], cues = {}, report = [], sounds = [];
  let clickNumber = 0;

  for (const edit of edits.edits) {
    const id = kebab(edit.id);
    const [start, end] = edit.source.map(Number);
    const cutDuration = round(end - start);
    const clip = path.join(assetDir, `${id}.mp4`);
    await ffmpeg(['-y', '-ss', String(start), '-i', path.join(captureDir, 'recording.mp4'), '-t', String(cutDuration),
      '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', clip]);
    const cutMeasured = await probeDuration(clip);

    cues[id] = {phrase: edit.phrase, ...(edit.occurrence ? {occurrence: edit.occurrence} : {}), ...(edit.offset ? {offset: edit.offset} : {})};
    const rel = t => round(clamp(t - start, 0, cutMeasured), 3);
    const offsetAt = t => `${id}+${rel(t)}`;

    objects.push({id: `screen-${id}`, type: 'video', at: centre, size: shown, clipDuration: cutMeasured,
      ...(edit.hold == null ? {} : {hold: edit.hold}), src: `assets/app-review/${manifest.task}/${id}.mp4`});
    sceneActions.push({do: 'play', target: `screen-${id}`, at: id});

    // Clicks: a ring where the action landed, one per click, faded so several clicks stay readable. A click too late in
    // the cut gets a shorter fade rather than a collapsed one that would animate past the end. The pointer itself is
    // already in the footage, so nothing here draws or moves it.
    const clicks = actions.filter(action => action.type === 'click' && action.t >= start && action.t <= end);
    for (const click of clicks) {
      const at = rel(click.t);
      const n = ++clickNumber, point = toWorld([click.x, click.y]);
      const outAt = Math.min(at + 0.5, cutMeasured - 0.26);
      const [bw, bh] = (click.bounds || []).slice(2);
      const r = round(clamp(Math.min(bw || 320, bh || 320) * worldPerCss * 0.55, 26, 44), 1);
      objects.push({id: `click-${n}`, type: 'circle', at: point, r, color: edits.ringColor || 'yellow', width: 4, layer: 'media'});
      sceneActions.push({do: 'fadeIn', target: `click-${n}`, at: `${id}+${at}`, dur: 0.1});
      sceneActions.push({do: 'scale', target: `click-${n}`, to: 1.45, at: `${id}+${round(at + 0.03, 3)}`, dur: 0.45, ease: 'out'});
      const fadeAt = Math.min(Math.max(at + 0.11, outAt), Math.max(0, cutMeasured - 0.08));
      sceneActions.push({do: 'fadeOut', target: `click-${n}`, at: `${id}+${round(fadeAt, 3)}`, dur: round(Math.max(0.08, Math.min(0.28, cutMeasured - fadeAt)), 3)});
    }

    // Camera: establish on the whole recording, push into each click cluster, pull back out between them.
    sceneActions.push({do: 'camera', center: centre, zoom: 1, at: id, dur: 0.001, ease: 'linear'});
    const clusters = clusterClicks(clicks);
    const moves = [];
    let lastZoom = 1, lastCameraAt = 0;
    clusters.forEach((cluster, index) => {
      const focus = clusterFocus(cluster);
      const elementWidth = Math.max(120, (focus.width || 320) * worldPerCss);
      const requested = edit.zoom != null ? Number(edit.zoom) : (0.58 * width) / elementWidth;
      const zoom = round(clamp(requested, 1.15, maxZoom), 2);
      if (requested > maxZoom + 0.01) warnings.push(`${id}: zoom ${round(requested, 2)}× would magnify a ${cssW}px capture past ${round(1.5 * detailPerCss, 2)}×; using ${zoom}×. Record at a higher scale or raise the capture viewport for a closer push-in.`);
      const focusCentre = clampCentre(toWorld(focus.center), zoom);
      const inAt = Math.max(0.05, rel(cluster[0].t - 0.28));
      const outAt = rel(cluster[cluster.length - 1].t + 0.95);
      const next = clusters[index + 1];
      const followsSoon = next && rel(next[0].t - 0.28) - outAt < 1.2;
      sceneActions.push({do: 'camera', center: focusCentre, zoom, at: `${id}+${inAt}`, dur: 0.6, ease: 'snap'});
      moves.push({at: inAt, zoom, center: focusCentre, action: cluster[0].target || null});
      lastZoom = zoom; lastCameraAt = inAt + 0.6;
      if (!followsSoon && outAt > lastCameraAt && outAt < cutMeasured - 0.15) {
        sceneActions.push({do: 'camera', center: centre, zoom: 1, at: `${id}+${outAt}`, dur: 0.7, ease: 'smooth'});
        lastZoom = 1; lastCameraAt = outAt + 0.7;
      }
    });
    // Always end the cut wide: a push-in left uncorrected reads as a jump cut into the next shot.
    if (lastZoom !== 1 && cutMeasured - 0.2 > lastCameraAt + 0.05)
      sceneActions.push({do: 'camera', center: centre, zoom: 1, at: `${id}+${round(cutMeasured - 0.2, 3)}`, dur: 0.4, ease: 'smooth'});

    if (edits.sounds?.click || edits.sounds?.whoosh) {
      for (const click of clicks) sounds.push({src: edits.sounds.click, at: offsetAt(click.t), align: 'peak', volume: 0.05, why: 'the click lands'});
      for (const move of moves.slice(1)) if (edits.sounds.whoosh) sounds.push({src: edits.sounds.whoosh, at: `${id}+${move.at}`, align: 'peak', volume: 0.05, why: 'the camera pushes in'});
    }

    const cameraText = moves.map(m => `${m.zoom}× at ${m.at.toFixed(2)}s`).join(', ') || 'no clicks, no push-in';
    const actionTypes = ['click', 'type', 'press', 'scroll', 'wait'];
    const interactionCounts = Object.fromEntries(actionTypes.map(type => [type,
      actions.filter(action => action.type === type && action.t >= start && action.t <= end).length]));
    report.push({id, feature: edit.feature ?? null, result: edit.result ?? null, cut: [start, end], duration: cutDuration,
      clicks: clicks.length, interactionCounts, camera: cameraText, cue: id});
  }

  const scene = {
    scene: edits.scene,
    cues,
    objects,
    actions: sceneActions,
    ...(sounds.length ? {sounds} : {}),
    notes: `Compiled from the reshoot capture "${manifest.task}" (recording.mp4 ${manifest.files?.recording?.sha256?.slice(0, 12) ?? ''}, ${manifest.frames} frames, ${round(duration)}s). ` +
      'Cuts are derived copies; the source recording is unchanged. The pointer is composited into this recording by reshoot, so no cursor is drawn here; click rings and camera moves come from actions.jsonl.',
  };
  const target = outFile || path.join(jobDir, 'shots', `${edits.scene}.json`);
  await mkdir(path.dirname(target), {recursive: true});
  await writeFile(target, JSON.stringify(scene, null, 2) + '\n');
  return {scene, file: target, report, warnings, omissions: omissionRecords, shown, originWorld, capture: manifest, duration};
}

export async function captureFingerprint(captureDir) {
  const manifest = await readFile(path.join(captureDir, 'manifest.json'));
  return createHash('sha256').update(manifest).digest('hex');
}
