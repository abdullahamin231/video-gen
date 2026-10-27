// Headless app capture: drives a scripted task in Chrome, records the window *without* the OS pointer, and writes a
// timestamped action log beside it. The pointer is drawn later from that log (lib/appcapture.mjs), so it can be
// redrawn, resized and mapped through camera moves instead of being baked into the footage.
//
// Evidence contract (personalities/app-review/TOOLS.md): feature/task id, build, viewport and scale, starting state,
// each action with the observed result, file hashes and the source time range. Actions are recorded by us, because we
// dispatch them, so nothing is inferred from pixel positions.
import path from 'node:path';
import {mkdir, writeFile, readFile, rm, access, open, stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromePath} from './inspect.mjs';

const exists = async file => { try { await access(file); return true; } catch { return false; } };
const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const round = (n, p = 3) => Number(n.toFixed(p));

function ffmpeg(args, {capture = false} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, {stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe']});
    let out = '', err = '';
    child.stdout?.on('data', d => out += d);
    child.stderr?.on('data', d => err += d);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(out) : reject(new Error(`ffmpeg failed (${code}): ${err.trim().split('\n').slice(-4).join(' ')}`)));
  });
}

export async function probeDuration(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], {stdio: ['ignore', 'pipe', 'pipe']});
    let out = '', err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Number(out.trim())) : reject(new Error(`ffprobe failed: ${err.trim()}`)));
  });
}

const STEP_VERBS = new Set(['goto', 'wait', 'click', 'type', 'press', 'scroll', 'shot', 'assert']);

/** Read a JPEG's pixel size from its SOF marker, so a frame that arrives before layout settles can be discarded. */
export function jpegSize(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  for (let i = 2; i < buffer.length - 9;) {
    if (buffer[i] !== 0xff) { i++; continue; }
    const marker = buffer[i + 1], length = buffer.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return [buffer.readUInt16BE(i + 7), buffer.readUInt16BE(i + 5)];
    if (!(length >= 2)) return null;
    i += 2 + length;
  }
  return null;
}

/** Validate a capture plan before spending time on a recording. Errors name the step, so a plan is cheap to fix. */
export function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object') return ['the plan must be a JSON object'];
  if (!plan.task || typeof plan.task !== 'string') errors.push('"task" is required (the feature/task id this recording evidences)');
  else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(plan.task)) errors.push('"task" must be a short id of letters, digits, dot, dash or underscore: it names the capture folder and the asset path');
  if (!Array.isArray(plan.steps) || !plan.steps.length) errors.push('"steps" must be a non-empty list');
  const viewport = plan.viewport ?? [1440, 900];
  if (!Array.isArray(viewport) || viewport.length !== 2 || viewport.some(n => !(Number(n) > 0))) errors.push('"viewport" must be [width, height]');
  if (viewport[0] < 900 || viewport[1] < 600) errors.push('"viewport" is too small to read after a push-in; use at least [1440, 900], and 2560×1600 by default');
  if (plan.scale != null && !(Number(plan.scale) >= 1 && Number(plan.scale) <= 3)) errors.push('"scale" must be between 1 and 3 (device pixels per CSS pixel for the evidence stills)');
  (plan.steps || []).forEach((step, i) => {
    const at = `steps[${i}]`;
    if (!step || typeof step !== 'object') return errors.push(`${at} must be an object`);
    if (!STEP_VERBS.has(step.do)) return errors.push(`${at}: "do" must be one of ${[...STEP_VERBS].join(', ')}`);
    if (step.do === 'goto' && !step.url) errors.push(`${at}: goto needs "url"`);
    if (['click', 'type'].includes(step.do) && !step.target) errors.push(`${at}: ${step.do} needs "target" (a selector)`);
    if (step.do === 'wait' && step.for == null && step.seconds == null) errors.push(`${at}: wait needs "for" (a selector) or "seconds"`);
    if (step.do === 'type' && typeof step.text !== 'string') errors.push(`${at}: type needs "text"`);
    if (step.do === 'press' && !step.key) errors.push(`${at}: press needs "key"`);
    if (step.do === 'scroll' && step.dy == null) errors.push(`${at}: scroll needs "dy"`);
    if (step.do === 'shot' && !step.name) errors.push(`${at}: shot needs "name"`);
    if (step.do === 'assert' && !step.target && !step.expect) errors.push(`${at}: assert needs "target" or "expect"`);
  });
  if (!plan.url && !(plan.steps || []).some(step => step?.do === 'goto')) errors.push('the plan needs a "url" or a goto step');
  return errors;
}

/**
 * Record one scripted session.
 * `dir` receives recording.mp4, actions.jsonl, manifest.json, shots/ and frames/ (frames are cleaned on success).
 */
export async function captureSession(dir, plan, options = {}) {
  await mkdir(dir, {recursive: true});
  const lockPath = path.join(dir, '.capture.lock');
  let lock;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { lock = await open(lockPath, 'wx'); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner = null;
      try { owner = JSON.parse(await readFile(lockPath, 'utf8')); } catch {}
      let stale = false;
      if (Number.isInteger(owner?.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); }
        catch (probe) { if (probe.code === 'ESRCH') stale = true; }
      } else {
        // A crash during lock initialization can leave empty/partial JSON. Reclaim only
        // after a generous age threshold; a fresh malformed lock may belong to a live writer.
        try { stale = Date.now() - (await stat(lockPath)).mtimeMs > 120000; } catch {}
      }
      if (attempt === 0 && stale) { await rm(lockPath, {force: true}); continue; }
      throw new Error(`A capture is already running for ${dir}; its generated files were left untouched.`);
    }
  }
  try {
    await lock.writeFile(JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}));
    return await captureSessionUnlocked(dir, plan, options);
  } finally {
    await lock.close().catch(() => {});
    await rm(lockPath, {force: true});
  }
}

async function captureSessionUnlocked(dir, plan, {onProgress = () => {}} = {}) {
  const errors = validatePlan(plan);
  if (errors.length) throw new Error(`The capture plan is invalid:\n  - ${errors.join('\n  - ')}`);
  if (!await exists('/usr/bin/ffmpeg') && !await exists(process.env.FFMPEG_PATH || ''))
    throw new Error('ffmpeg is required to encode a capture (npm run video -- setup-audio checks it).');
  // Only generated artefacts are cleared. A capture folder also holds the hand-written plan.json and edits.json.
  for (const name of ['frames', 'shots']) await rm(path.join(dir, name), {recursive: true, force: true});
  for (const name of ['recording.mp4', 'actions.jsonl', 'pointer.json', 'manifest.json', 'frames.txt'])
    await rm(path.join(dir, name), {force: true});
  const framesDir = path.join(dir, 'frames'), shotsDir = path.join(dir, 'shots');
  await mkdir(framesDir, {recursive: true});
  await mkdir(shotsDir, {recursive: true});

  const [width, height] = plan.viewport ?? [2560, 1600];
  const scale = plan.scale ?? 1;
  const maxFrame = plan.maxFrame ?? [2880, 1800];
  const {default: puppeteer} = await import('puppeteer-core');
  const browser = await puppeteer.launch({executablePath: plan.chrome || await chromePath(), headless: true,
    args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none']});
  const page = await browser.newPage();
  await page.setViewport({width, height, deviceScaleFactor: scale});
  await page.evaluateOnNewDocument(() => {
    window.__vgPointer = [];
    addEventListener('mousemove', event => {
      const last = window.__vgPointer[window.__vgPointer.length - 1];
      const now = Date.now();
      if (last && now - last.t < 16) return;
      window.__vgPointer.push({t: now, x: Math.round(event.clientX), y: Math.round(event.clientY)});
    }, {passive: true});
  });

  const actions = [];
  const results = [];
  let pointerSamples = [];
  const files = [];
  const consoleErrors = [];
  page.on('pageerror', error => consoleErrors.push(String(error.message || error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  const client = await page.createCDPSession();
  const frameFiles = [];
  let origin = null, frameCount = 0, recording = true;
  const onFrame = async ({data, metadata, sessionId}) => {
    if (!recording) return;
    const stamp = Number(metadata?.timestamp) * 1000;
    if (origin == null) origin = stamp;
    const t = round((stamp - origin) / 1000);
    const file = path.join(framesDir, `f${String(frameCount++).padStart(6, '0')}.jpg`);
    const buffer = Buffer.from(data, 'base64');
    await writeFile(file, buffer);
    frameFiles.push({t, file, size: jpegSize(buffer)});
    client.send('Page.screencastFrameAck', {sessionId}).catch(() => {});
  };
  client.on('Page.screencastFrame', frame => { onFrame(frame).catch(() => {}); });
  await client.send('Page.startScreencast', {format: 'jpeg', quality: 92, maxWidth: maxFrame[0], maxHeight: maxFrame[1], everyNthFrame: 1});

  // Wait for the first frame so the recording's zero is a frame, not an arbitrary moment before it.
  for (let i = 0; i < 100 && origin == null; i++) await new Promise(r => setTimeout(r, 25));
  if (origin == null) { await browser.close(); throw new Error('Chrome produced no screencast frames; nothing was recorded.'); }
  const now = () => round((Date.now() - origin) / 1000);
  const log = event => { actions.push({t: now(), ...event}); };

  const boxOf = async (selector) => {
    const handle = await page.$(selector);
    if (!handle) throw new Error(`No element matches ${selector}`);
    await handle.evaluate(element => element.scrollIntoView({block: 'center', inline: 'center'}));
    await new Promise(r => setTimeout(r, 120));
    const box = await handle.boundingBox();
    const rect = await handle.evaluate(element => { const r = element.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; });
    return {handle, box, rect};
  };
  const clickOn = async (selector, why, target) => {
    const {handle, box, rect} = await boxOf(selector);
    if (!box) throw new Error(`${selector} has no box; it may be hidden`);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y, {steps: 14});
    await new Promise(r => setTimeout(r, 90));
    log({type: 'move', x: Math.round(x), y: Math.round(y), target});
    await page.mouse.click(x, y);
    log({type: 'click', x: Math.round(x), y: Math.round(y), target, why: why || null,
      bounds: [round(rect.x), round(rect.y), round(rect.width), round(rect.height)]});
    await handle.dispose().catch(() => {});
    await new Promise(r => setTimeout(r, 220));
  };

  const startedAt = new Date().toISOString();
  let url = plan.url || null, sessionError = null;
  try {
    if (url) {
      await page.goto(url, {waitUntil: 'networkidle2', timeout: plan.timeout ?? 45000});
      log({type: 'goto', url, title: await page.title()});
    }
    for (const step of plan.steps) {
      onProgress(step);
      try {
        if (step.do === 'goto') {
          url = step.url;
          await page.goto(url, {waitUntil: step.until || 'networkidle2', timeout: step.timeout ?? 45000});
          log({type: 'goto', url, title: await page.title()});
        } else if (step.do === 'wait') {
          const from = now();
          const budget = step.timeout ?? 20000;
          let waitError = null;
          try { if (step.for) await page.waitForSelector(step.for, {timeout: budget}); }
          catch (error) {
            // A failed wait is evidence: say plainly that it timed out, after how long, and
            // keep the page's own words so a plan author can see which selector never arrived.
            const detail = String(error?.message || error).trim();
            waitError = step.for
              ? `Wait for ${step.for} hit its ${budget} ms timeout; the element never appeared${detail ? ` (${detail})` : ''}`
              : `Wait hit its ${budget} ms timeout: ${detail}`;
          }
          if (step.seconds) await new Promise(r => setTimeout(r, Number(step.seconds) * 1000));
          const record = {type: 'wait', startedAt: from, dur: round(now() - from), for: step.for ?? null, ok: !waitError, why: step.why ?? null};
          if (waitError) record.error = waitError;
          log(record);
          if (waitError) results.push({kind: 'wait', ok: false, target: step.for, duration: record.dur, error: waitError, why: step.why ?? null});
        } else if (step.do === 'click') {
          await clickOn(step.target, step.why, step.target);
        } else if (step.do === 'type') {
          await clickOn(step.target, step.why, step.target);
          // The field's own type decides masking, not how the plan spelled the selector.
          const secret = await page.$eval(step.target, el => (el.tagName === 'INPUT' && el.type === 'password') ||
            /current-password|new-password/.test(el.getAttribute('autocomplete') || '')).catch(() => false);
          const masked = step.masked === true || secret;
          const typingStarted = now();
          await page.type(step.target, step.text, {delay: step.delay ?? 35});
          log({type: 'type', target: step.target, text: masked ? '*'.repeat(step.text.length) : step.text, masked,
            startedAt: typingStarted, dur: round(now() - typingStarted), why: step.why ?? null});
          if (masked) results.push({kind: 'privacy', step: step.target, note: 'typed text masked in the action log'});
        } else if (step.do === 'press') {
          await page.keyboard.press(step.key);
          log({type: 'press', key: step.key, why: step.why ?? null});
          await new Promise(r => setTimeout(r, 180));
        } else if (step.do === 'scroll') {
          const target = step.target || null;
          if (target) {
            const handle = await page.$(target);
            if (!handle) throw new Error(`No element matches ${target}`);
            await handle.evaluate(e => e.scrollIntoView({block: 'center'}));
            await handle.dispose().catch(() => {});
          }
          // A single large wheel event jumps the page and makes the recording feel
          // like a sequence of states. Send a short, paced wheel gesture instead.
          await page.mouse.move(width / 2, height / 2, {steps: 8});
          const delta = Number(step.dy), ticks = Math.max(4, Math.min(16, Math.ceil(Math.abs(delta) / 100)));
          const fromY = await page.evaluate(() => Math.round(scrollY));
          const started = now();
          for (let tick = 0; tick < ticks; tick++) {
            await page.mouse.wheel({deltaY: delta / ticks});
            if (tick + 1 < ticks) await new Promise(r => setTimeout(r, 35));
          }
          const scrollY = await page.evaluate(() => Math.round(scrollY));
          log({type: 'scroll', dy: Number(step.dy), target, fromY, scrollY, dur: round(now() - started), why: step.why ?? null});
          await new Promise(r => setTimeout(r, step.settle ?? 320));
        } else if (step.do === 'shot') {
          const file = path.join(shotsDir, `${step.name}.png`);
          await page.screenshot({path: file, type: 'png'});
          log({type: 'shot', src: path.relative(dir, file).split(path.sep).join('/'), state: step.state ?? null, why: step.why ?? null});
          results.push({kind: 'evidence', state: step.state ?? step.name, file: path.relative(dir, file).split(path.sep).join('/')});
        } else if (step.do === 'assert') {
          let actual = null, ok = false, detail = '';
          try {
            if (step.target) {
              const handle = await page.waitForSelector(step.target, {timeout: step.timeout ?? 8000});
              actual = (await handle.evaluate(element => element.innerText ?? element.textContent ?? '')).trim().replace(/\s+/g, ' ');
              ok = step.text == null || actual.includes(step.text);
              detail = step.text == null ? `visible: "${actual.slice(0, 120)}"` : `contains "${step.text}": "${actual.slice(0, 200)}"`;
              await handle.dispose().catch(() => {});
            } else {
              actual = await page.evaluate(() => document.body.innerText);
              ok = actual.includes(step.expect);
              detail = `body contains "${step.expect}"`;
            }
          } catch (error) { detail = error.message; }
          log({type: 'assert', target: step.target ?? null, text: step.text ?? step.expect ?? null, ok, detail, why: step.why ?? null});
          results.push({kind: 'assert', ok, target: step.target ?? null, expected: step.text ?? step.expect ?? null,
            observed: detail, why: step.why ?? null});
        }
      } catch (error) {
        sessionError = String(error?.message || error);
        log({type: 'error', step: step.do, target: step.target ?? null, message: sessionError, why: step.why ?? null});
        results.push({kind: 'error', step: step.do, target: step.target ?? null, message: sessionError});
        break;
      }
    }
    log({type: 'end'});
  } finally {
    recording = false;
    await client.send('Page.stopScreencast').catch(() => {});
    pointerSamples = await page.evaluate(() => window.__vgPointer || []).catch(() => []);
    await browser.close().catch(() => {});
  }

  // Pointer samples share the action clock. Anything before the first frame is clamped to zero.
  const pointerLog = pointerSamples.map(({t, x, y}) => ({t: Math.max(0, round((t - origin) / 1000)), x, y}));

  // A frame can arrive before layout settles, at the wrong size. Keep the size that the recording actually settled on,
  // and hold the first surviving frame from zero so action times still line up with the picture.
  const sizes = new Map();
  for (const frame of frameFiles) if (frame.size) sizes.set(frame.size.join('x'), (sizes.get(frame.size.join('x')) || 0) + 1);
  const settled = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const kept = frameFiles.filter(frame => !settled || frame.size?.join('x') === settled);
  const discarded = frameFiles.length - kept.length;
  if (!kept.length) throw new Error('Every screencast frame had an unreadable size; nothing was recorded.');
  kept[0] = {...kept[0], t: 0};
  const duration = round(kept[kept.length - 1].t + 0.15);

  // Frames carry real timestamps, so a still section becomes one long frame rather than a guessed frame rate.
  const list = ['ffconcat version 1.0'];
  kept.forEach((frame, i) => {
    list.push(`file '${frame.file.replace(/'/g, "'\\''")}'`);
    list.push(`duration ${Math.max(1 / 60, (i + 1 < kept.length ? kept[i + 1].t : frame.t + 0.15) - frame.t).toFixed(4)}`);
  });
  list.push(`file '${kept[kept.length - 1].file.replace(/'/g, "'\\''")}'`);
  const listFile = path.join(dir, 'frames.txt');
  await writeFile(listFile, list.join('\n') + '\n');
  const recordingFile = path.join(dir, 'recording.mp4');
  onProgress({do: 'encode'});
  await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '20', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', recordingFile]);
  const measured = await probeDuration(recordingFile);
  await rm(framesDir, {recursive: true, force: true});
  await rm(listFile, {force: true});

  const frameSize = frameFiles.length ? await probeSize(recordingFile) : [width * scale, height * scale];
  actions.sort((a, b) => a.t - b.t);
  const actionsFile = path.join(dir, 'actions.jsonl');
  await writeFile(actionsFile, actions.map(action => JSON.stringify(action)).join('\n') + '\n');
  const pointerFile = path.join(dir, 'pointer.json');
  await writeFile(pointerFile, JSON.stringify(pointerLog, null, 0) + '\n');

  const manifest = {
    version: 1,
    task: plan.task,
    feature: plan.feature ?? null,
    claim: plan.claim ?? null,
    build: plan.build ?? null,
    url,
    viewport: [width, height],
    scale,
    frameSize,
    startedAt,
    duration: round(measured, 3),
    frames: kept.length,
    ...(sessionError ? {aborted: sessionError} : {}),
    discardedFrames: discarded,
    recorder: {app: 'video-gen capture', transport: 'chrome-headless/cdp-screencast', pointer: 'not composited; redrawn from actions.jsonl'},
    files: {
      recording: {path: 'recording.mp4', sha256: await sha256(recordingFile), bytes: (await readFile(recordingFile)).length},
      actions: {path: 'actions.jsonl', sha256: await sha256(actionsFile)},
      pointer: {path: 'pointer.json', sha256: await sha256(pointerFile)},
    },
    results,
    consoleErrors: consoleErrors.slice(0, 20),
    notes: plan.notes ?? null,
  };
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return {dir, manifest, actions, pointer: pointerLog, recording: recordingFile};
}

async function probeSize(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file], {stdio: ['ignore', 'pipe', 'pipe']});
    let out = '';
    child.stdout.on('data', d => out += d);
    child.on('close', code => code === 0 ? resolve(out.trim().split('x').map(Number)) : reject(new Error('ffprobe could not read the recording size')));
  });
}

export async function readActions(dir) {
  const raw = await readFile(path.join(dir, 'actions.jsonl'), 'utf8');
  return raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
}
