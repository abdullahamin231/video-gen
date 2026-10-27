// Compile a headless capture into a scene: cut the source recording per edit, then derive the camera push-in/pull-out
// and the giant synthetic cursor from the action log. The source recording stays untouched; every cut is a derived
// copy under assets/, so the evidence in the capture directory still matches the manifest hashes.
//
// Timing stays cue-relative (`at: "edit-id+1.4"`), never absolute seconds, so the compiled scene follows narration
// timing the way every other scene does.
import path from 'node:path';
import {mkdir, writeFile, readFile, access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readActions, probeDuration} from './capture.mjs';

const exists = async file => { try { await access(file); return true; } catch { return false; } };
const round = (n, p = 3) => Number(n.toFixed(p));
const ID = /^[a-z][a-z0-9-]*$/;
const kebab = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '') || 'edit';

const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 34" width="24" height="34">
  <!-- The pointer drawn by the capture adapter: sharp white arrow, dark outline so it reads on light and dark UIs. -->
  <path d="M2 2 L2 28.5 L8.6 22 L12.6 31.4 L17.2 29.4 L13.2 20.3 L22 20.3 Z"
        fill="#ffffff" stroke="#101114" stroke-width="2.2" stroke-linejoin="round"/>
</svg>
`;

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
  width = 1920, height = 1080, fit = 0.9, cursorSize = 54, outFile = null,
} = {}) {
  const manifest = JSON.parse(await readFile(path.join(captureDir, 'manifest.json'), 'utf8'));
  const actions = await readActions(captureDir);
  const duration = await probeDuration(path.join(captureDir, 'recording.mp4'));
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
    if (partial) throw new Error(`Edit "${partial.id}" cuts through a recorded ${action.type} sequence (${round(action.startedAt)}–${round(end)}s). Keep the complete typing/wait interval, or make the omission explicit in the review.`);
  }
  const omissions = edits.omissions ?? [];
  if (!Array.isArray(omissions)) throw new Error('"omissions" must be a list of {actionIndex, reason} records for meaningful recorded actions outside the cuts.');
  const missingOmissions = uncovered.filter(action => {
    const index = actions.indexOf(action);
    return !omissions.some(item => item?.actionIndex === index && typeof item.reason === 'string' && item.reason.trim());
  });
  if (missingOmissions.length) throw new Error(`Meaningful recorded action(s) outside all cuts need evidence-backed omissions with actionIndex and reason: ${missingOmissions.map(a => `${a.type}@${round(a.t)}s`).join(', ')}.`);
  const omissionRecords = uncovered.map(action => ({actionIndex: actions.indexOf(action), action: {...action}, reason: omissions.find(item => item.actionIndex === actions.indexOf(action)).reason.trim()}));
  if (omissionRecords.length) await writeFile(path.join(captureDir, 'omissions.json'), JSON.stringify({version: 1,
    capture: manifest.task, actionsSha256: manifest.files?.actions?.sha256 ?? null, records: omissionRecords}, null, 2) + '\n');

  // The recording sits on the theme background like a studio canvas; the camera then frames parts of it.
  const boxW = width * fit, boxH = height * fit;
  const scale = Math.min(boxW / capW, boxH / capH);
  const shown = [Math.round(capW * scale), Math.round(capH * scale)];
  const originWorld = [Math.round((width - shown[0]) / 2), Math.round((height - shown[1]) / 2)];
  const toWorld = ([x, y]) => [round(originWorld[0] + (x / cssW) * shown[0], 2), round(originWorld[1] + (y / cssH) * shown[1], 2)];
  const worldPerCss = shown[0] / cssW;
  // The screencast records at CSS resolution, so a push-in beyond this budget would only magnify compression.
  const maxZoom = clamp(1.5 / worldPerCss, 1.05, 3.2);
  const centre = [width / 2, height / 2];
  // Keep a pushed-in camera inside the recording, so a control near an edge is framed as far as the footage allows
  // instead of opening a gap of theme background beside it.
  const clampCentre = (point, zoom) => {
    const halfW = width / (2 * zoom), halfH = height / (2 * zoom);
    const x = shown[0] <= 2 * halfW ? originWorld[0] + shown[0] / 2 : clamp(point[0], originWorld[0] + halfW, originWorld[0] + shown[0] - halfW);
    const y = shown[1] <= 2 * halfH ? originWorld[1] + shown[1] / 2 : clamp(point[1], originWorld[1] + halfH, originWorld[1] + shown[1] - halfH);
    return [round(x, 2), round(y, 2)];
  };

  const assetDir = path.join(jobDir, 'assets/app-capture', manifest.task);
  await mkdir(assetDir, {recursive: true});
  const cursorAsset = path.join(jobDir, 'assets/app-capture/cursor.svg');
  if (!await exists(cursorAsset)) { await mkdir(path.dirname(cursorAsset), {recursive: true}); await writeFile(cursorAsset, CURSOR_SVG); }

  const objects = [], sceneActions = [], cues = {}, report = [], sounds = [];
  const pointer = await readFile(path.join(captureDir, 'pointer.json'), 'utf8').then(JSON.parse, () => []);
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
      ...(edit.hold == null ? {} : {hold: edit.hold}), src: `assets/app-capture/${manifest.task}/${id}.mp4`});
    sceneActions.push({do: 'play', target: `screen-${id}`, at: id});

    // Pointer path: real samples between this cut's in and out points, resampled so each move is a readable step rather
    // than one tween per 16 ms mouse event (which the recording never actually showed at a constant rate).
    const samples = pointer.filter(sample => sample.t >= start - 0.05 && sample.t <= end)
      .map(sample => ({t: rel(sample.t), at: toWorld([sample.x, sample.y])}));
    const thinned = [];
    for (const sample of samples) {
      const last = thinned[thinned.length - 1];
      if (!last) { thinned.push(sample); continue; }
      const moved = Math.hypot(sample.at[0] - last.at[0], sample.at[1] - last.at[1]);
      if (sample.t - last.t >= 0.07 && moved >= 2) thinned.push(sample);
      else if (sample.t - last.t >= 0.07) thinned[thinned.length - 1] = sample;
    }
    if (samples.length && thinned[thinned.length - 1] !== samples[samples.length - 1]) thinned.push(samples[samples.length - 1]);
    const cursorId = `cursor-${id}`;
    const first = thinned[0]?.at ?? toWorld([cssW / 2, cssH / 2]);
    objects.push({id: cursorId, type: 'image', src: 'assets/app-capture/cursor.svg', at: first, layer: 'media',
      size: [Math.round(cursorSize * (24 / 34)), cursorSize]});
    sceneActions.push({do: 'fadeIn', target: cursorId, at: id, dur: 0.18});
    thinned.slice(1).forEach((sample, i) => {
      const prev = thinned[i];
      const gap = round(Math.max(0.02, sample.t - prev.t), 3);
      if (Math.hypot(sample.at[0] - prev.at[0], sample.at[1] - prev.at[1]) < 1) return;
      sceneActions.push({do: 'move', target: cursorId, to: sample.at, at: `${id}+${prev.t}`, dur: gap, ease: 'linear'});
    });
    if (cutMeasured > 0.3) sceneActions.push({do: 'fadeOut', target: cursorId, at: `${id}+${round(cutMeasured - 0.12, 3)}`, dur: 0.12});

    // Clicks: a ring where the action landed, one per click, faded so several clicks stay readable. A click too late in
    // the cut gets a shorter fade rather than a collapsed one that would animate past the end.
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
    const cameraSteps = [];
    let lastZoom = 1, lastCameraAt = 0;
    clusters.forEach((cluster, index) => {
      const focus = clusterFocus(cluster);
      const elementWidth = Math.max(120, (focus.width || 320) * worldPerCss);
      const requested = edit.zoom != null ? Number(edit.zoom) : (0.58 * width) / elementWidth;
      const zoom = round(clamp(requested, 1.15, maxZoom), 2);
      if (requested > maxZoom + 0.01) warnings.push(`${id}: zoom ${round(requested, 2)}× would magnify a ${cssW}px capture past 1.5×; using ${zoom}×. Raise the capture viewport for a closer push-in.`);
      const focusCentre = clampCentre(toWorld(focus.center), zoom);
      const inAt = Math.max(0.05, rel(cluster[0].t - 0.28));
      const outAt = rel(cluster[cluster.length - 1].t + 0.95);
      const next = clusters[index + 1];
      const followsSoon = next && rel(next[0].t - 0.28) - outAt < 1.2;
      sceneActions.push({do: 'camera', center: focusCentre, zoom, at: `${id}+${inAt}`, dur: 0.6, ease: 'snap'});
      cameraSteps.push({at: inAt, dur: 0.6, ease: 'snap', zoom});
      moves.push({at: inAt, zoom, center: focusCentre, action: cluster[0].target || null});
      lastZoom = zoom; lastCameraAt = inAt + 0.6;
      if (!followsSoon && outAt > lastCameraAt && outAt < cutMeasured - 0.15) {
        sceneActions.push({do: 'camera', center: centre, zoom: 1, at: `${id}+${outAt}`, dur: 0.7, ease: 'smooth'});
        cameraSteps.push({at: outAt, dur: 0.7, ease: 'smooth', zoom: 1});
        lastZoom = 1; lastCameraAt = outAt + 0.7;
      }
    });
    // Always end the cut wide: a push-in left uncorrected reads as a jump cut into the next shot.
    if (lastZoom !== 1 && cutMeasured - 0.2 > lastCameraAt + 0.05) {
      sceneActions.push({do: 'camera', center: centre, zoom: 1, at: `${id}+${round(cutMeasured - 0.2, 3)}`, dur: 0.4, ease: 'smooth'});
      cameraSteps.push({at: round(cutMeasured - 0.2, 3), dur: 0.4, ease: 'smooth', zoom: 1});
    }
    // A pointer drawn in world space would grow to several times its natural size inside a push-in. Counter-scale it on
    // the same curve as the camera, so the pointer keeps one readable size while the interface moves underneath it.
    if (edits.cursorScreen !== false) for (const step of cameraSteps)
      sceneActions.push({do: 'scale', target: cursorId, to: round(1 / step.zoom, 3), at: `${id}+${step.at}`, dur: step.dur, ease: step.ease});

    if (edits.sounds?.click || edits.sounds?.whoosh) {
      for (const click of clicks) sounds.push({src: edits.sounds.click, at: offsetAt(click.t), align: 'peak', volume: 0.05, why: 'the click lands'});
      for (const move of moves.slice(1)) if (edits.sounds.whoosh) sounds.push({src: edits.sounds.whoosh, at: `${id}+${move.at}`, align: 'peak', volume: 0.05, why: 'the camera pushes in'});
    }

    const cameraText = moves.map(m => `${m.zoom}× at ${m.at.toFixed(2)}s`).join(', ') || 'no clicks, no push-in';
    const actionTypes = ['click', 'type', 'press', 'scroll', 'wait'];
    const interactionCounts = Object.fromEntries(actionTypes.map(type => [type,
      actions.filter(action => action.type === type && action.t >= start && action.t <= end).length]));
    report.push({id, feature: edit.feature ?? null, result: edit.result ?? null, cut: [start, end], duration: cutDuration,
      clicks: clicks.length, interactionCounts, camera: cameraText, pointerSamples: thinned.length, cue: id});
  }

  const scene = {
    scene: edits.scene,
    cues,
    objects,
    actions: sceneActions,
    ...(sounds.length ? {sounds} : {}),
    notes: `Compiled by the app-capture adapter from capture "${manifest.task}" (recording.mp4 ${manifest.files?.recording?.sha256?.slice(0, 12) ?? ''}, ${manifest.frames} frames, ${round(duration)}s). ` +
      'Cuts are derived copies; the source recording is unchanged. Cursor, click rings and camera moves come from actions.jsonl and pointer.json, so every pointer position is the one the task actually used.',
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
