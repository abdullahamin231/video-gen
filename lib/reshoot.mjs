// Ingest a reshoot run into the capture evidence contract.
//
// reshoot (https://github.com/mumit/reshoot, MIT) records a storyboard in headless Chrome and writes a run folder:
// per-beat result checks with the text it actually saw, evidence frames, and an event stream of the controls each
// action touched. This module reads that folder and writes the capture/ layout the pipeline consumes —
// recording.mp4, actions.jsonl, shots/ and manifest.json — so capture-scene compiles it unchanged.
//
// What reshoot does NOT give us, and this module therefore never claims:
//   - the pointer path. reshoot draws the cursor into the page, so it is composited into the footage. The manifest
//     says pointer: "composited" and capture-scene draws no second cursor over it.
//   - typing, keypresses and scrolling as distinct actions. Its event stream marks the control an action touched,
//     not what the action was. Every act is recorded here as a click on that control, which is what focusing it did.
//   - the URL. It is not in the run folder, so it comes from the storyboard or from the caller.
import path from 'node:path';
import {mkdir, writeFile, readFile, copyFile, readdir, access, stat, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {probeDuration, probeSize} from './media.mjs';

const exists = async file => { try { await access(file); return true; } catch { return false; } };
const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const round = (n, p = 3) => Number(n.toFixed(p));
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The storyboard a run belongs to, for the URL. Returns null when the project layout is not the usual one. */
async function storyboardUrl(runDir) {
  const project = path.resolve(runDir, '..', '..', '..');
  const config = path.join(project, 'reshoot.toml');
  if (!await exists(config)) return null;
  const text = await readFile(config, 'utf8');
  const take = text.match(/^\s*web\s*=\s*"([^"]+)"/m)?.[1];
  if (!take) return null;
  const file = path.resolve(project, take);
  if (!await exists(file)) return null;
  return (await readFile(file, 'utf8')).match(/^\s*url\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

/** Read one run folder and check it is a complete take we are allowed to treat as evidence. */
export async function readReshootRun(runDir) {
  const dir = path.resolve(runDir);
  if (!await exists(dir)) throw new Error(`No reshoot run at ${runDir}. Pass the run folder, such as demo/takes/runs/<id>.`);
  const runJson = JSON.parse(await readFile(path.join(dir, 'run.json'), 'utf8').catch(() => 'null'));
  if (!runJson) throw new Error(`${runDir} has no run.json; it is not a reshoot run folder.`);
  const takesDir = path.join(dir, 'takes');
  const takes = (await readdir(takesDir)).filter(name => name.endsWith('.take.json'));
  if (takes.length !== 1) throw new Error(`${runDir} has ${takes.length} takes; capture-ingest reads one take per run.`);
  const takeFile = path.join(takesDir, takes[0]);
  const take = JSON.parse(await readFile(takeFile, 'utf8'));
  const name = takes[0].replace(/\.take\.json$/, '');
  const readJson = async file => JSON.parse(await readFile(path.join(takesDir, file), 'utf8').catch(() => 'null'));
  const events = await readJson(`${name}.events.json`);
  const beats = await readJson(`${name}.beats.json`) ?? {};
  const recording = path.join(takesDir, `${name}.clean.mp4`);
  const evidence = path.join(takesDir, `${name}.evidence`);

  if (take.schema_version !== 1) throw new Error(`reshoot take schema_version ${take.schema_version} is not supported (1 is); upgrade capture-ingest with reshoot.`);
  if (take.status !== 'completed') throw new Error(`This reshoot run is "${take.status}", not completed; re-record it before ingesting.`);
  if (take.mode && take.mode !== 'final') throw new Error(`This is a "${take.mode}" run. reshoot previews record a smaller, partial take; ingest the final run instead.`);
  if (!runJson.ok) throw new Error(`reshoot reports this run failed: ${(runJson.errors || []).join('; ') || 'no detail'}.`);
  if (!await exists(recording)) throw new Error(`${path.join('takes', name + '.clean.mp4')} is missing; ingest needs the take without captions drawn on.`);
  if (!Array.isArray(events) || !events.length) throw new Error(`${name}.events.json is missing or empty; the run has no action evidence to ingest.`);
  return {dir, name, take, takeFile, events, beats, runJson, recording, evidence, url: await storyboardUrl(dir)};
}

/**
 * Write a capture directory our compiler understands from one reshoot run.
 * `outDir` receives recording.mp4, actions.jsonl, shots/ and manifest.json.
 */
export async function ingestReshootRun(runDir, outDir, {task, feature = null, claim = null, build = null, url = null, notes = null} = {}) {
  const run = await readReshootRun(runDir);
  if (!task) throw new Error('capture-ingest needs --task (the feature/task id this recording evidences).');
  if (!SLUG.test(task)) throw new Error('--task must be a short id of letters, digits, dot, dash or underscore: it names the capture folder and the asset path.');

  await mkdir(outDir, {recursive: true});
  // Only generated artefacts are cleared; edits.json is hand-written and stays.
  await rm(path.join(outDir, 'shots'), {recursive: true, force: true});
  for (const name of ['recording.mp4', 'actions.jsonl', 'manifest.json'])
    await rm(path.join(outDir, name), {force: true});
  const shotsDir = path.join(outDir, 'shots');
  await mkdir(shotsDir, {recursive: true});

  const recordingFile = path.join(outDir, 'recording.mp4');
  await copyFile(run.recording, recordingFile);
  const duration = round(await probeDuration(recordingFile));
  const frameSize = await probeSize(recordingFile);

  const beats = run.take.beats || [];
  const beatOf = t => beats.find(beat => Number.isFinite(beat.start) && t >= beat.start && t < (Number.isFinite(beat.end) ? beat.end : Infinity));
  const actions = [];
  const results = [];
  for (const event of run.events) {
    if (event.kind !== 'act' || event.phase !== 'start') continue;
    const [x, y, width, height] = event.rect || [];
    if (![x, y, width, height].every(Number.isFinite)) continue;
    const beat = beatOf(event.t);
    actions.push({t: round(event.t), type: 'click', x: Math.round(x + width / 2), y: Math.round(y + height / 2),
      bounds: [round(x), round(y), round(width), round(height)], target: null, why: beat?.purpose ?? null, source: 'reshoot-act'});
  }
  for (const beat of beats) {
    for (const expectation of beat.expectations || []) {
      const observed = String(expectation.actual ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
      actions.push({t: round(expectation.at ?? beat.end ?? 0), type: 'assert', target: null, text: null,
        ok: expectation.status === 'passed', detail: `${expectation.type}: ${observed}`, why: beat.purpose ?? null});
      results.push({kind: 'assert', ok: expectation.status === 'passed', target: null,
        expected: expectation.type === 'count' ? `count ${expectation.count}` : expectation.type,
        observed, why: beat.purpose ?? null, beat: beat.id});
    }
    const file = beat.screenshot ? path.join(path.dirname(run.recording), beat.screenshot) : null;
    if (file && await exists(file)) {
      const target = path.join(shotsDir, `${beat.id}.png`);
      await copyFile(file, target);
      results.push({kind: 'evidence', state: beat.purpose ?? beat.id, file: `shots/${beat.id}.png`});
    }
  }
  actions.sort((a, b) => a.t - b.t);
  const clicks = actions.filter(action => action.type === 'click');
  if (!clicks.length) throw new Error('This reshoot run logged no action on any control; there is nothing to compile.');

  const actionsFile = path.join(outDir, 'actions.jsonl');
  await writeFile(actionsFile, actions.map(action => JSON.stringify(action)).join('\n') + '\n');

  const [cssWidth, cssHeight] = [run.take.capture?.css_width, run.take.capture?.css_height];
  const scale = round(frameSize[0] / (cssWidth || frameSize[0]), 3);
  const manifest = {
    version: 1,
    task,
    feature,
    claim,
    build,
    url: url || run.url || null,
    viewport: [cssWidth || Math.round(frameSize[0] / scale), cssHeight || Math.round(frameSize[1] / scale)],
    // The frame-to-CSS ratio of the footage itself. reshoot's own pixel_ratio is the page's device pixel ratio times the
    // storyboard zoom, which is not what the frames carry; it is kept below as provenance.
    scale,
    frameSize,
    startedAt: run.runJson.finished_at ? new Date(new Date(run.runJson.finished_at).getTime() - duration * 1000).toISOString() : new Date().toISOString(),
    duration,
    frames: run.take.capture?.frames ?? null,
    recorder: {
      app: 'reshoot', version: run.runJson.inputs?.reshoot ?? null,
      transport: 'chrome-headless/playwright+cdp-screencast',
      pointer: 'composited',
      pixelRatio: run.take.capture?.pixel_ratio ?? null,
      log: 'clicks and result checks only: reshoot marks the control each storyboard action touched, not whether it was a click, typing or a keypress',
      browser: run.take.browser ?? null,
    },
    source: {
      run: run.runJson.id ?? path.basename(run.dir),
      take: `takes/${run.name}.take.json`,
      takeSha256: await sha256(run.takeFile),
      storyId: run.take.story_id ?? null,
      storySha256: run.take.story_sha256 ?? null,
    },
    files: {
      recording: {path: 'recording.mp4', sha256: await sha256(recordingFile), bytes: (await stat(recordingFile)).size},
      actions: {path: 'actions.jsonl', sha256: await sha256(actionsFile)},
    },
    results,
    consoleErrors: [],
    notes: notes ?? `Ingested from reshoot run ${run.runJson.id ?? path.basename(run.dir)} (${run.take.capture?.frames ?? '?'} frames). The cursor is composited into this recording by reshoot; capture-scene draws no second pointer. Typing and keypresses are not in the source log.`,
  };
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return {dir: outDir, manifest, actions, recording: recordingFile, clicks: clicks.length};
}
