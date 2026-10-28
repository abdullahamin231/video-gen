import {spawn} from 'node:child_process';
import path from 'node:path';
// Pixel-level checks on the rendered MP4. They see everything (hooks, Manim clips, HTML scenes) because
// they read the actual frames: frame use and stillness measured from pixels, not from declared beats.
// They are warnings: reviewers weigh them against the frames (a long hold or an empty beat can be deliberate).

const FPS = 6, W = 192, H = 108;
function decode(file, fps = FPS, w = W, h = H) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `fps=${fps},scale=${w}:${h}:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1'], {stdio: ['ignore', 'pipe', 'pipe']});
    const chunks = []; let err = '';
    child.stdout.on('data', c => chunks.push(c)); child.stderr.on('data', c => { err += c; });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg decode failed: ${err.slice(-400)}`)));
  });
}

export async function pixelChecks(videoFile, timing, {strictBlank = false, verifiedBlackIntervals = []} = {}) {
  const raw = await decode(videoFile), n = Math.floor(raw.length / (W * H)), frames = [];
  for (let i = 0; i < n; i++) frames.push(raw.subarray(i * W * H, (i + 1) * W * H));
  const perFrame = frames.map((f, i) => {
    // A film may change background colour between scenes. Estimating it once from
    // frame zero makes a later flat black frame look like full-frame content.
    const border = new Array(256).fill(0);
    for (let x = 0; x < W; x++) { border[f[x]]++; border[f[(H - 1) * W + x]]++; }
    for (let y = 1; y < H - 1; y++) { border[f[y * W]]++; border[f[y * W + W - 1]]++; }
    const bg = border.indexOf(Math.max(...border));
    let x0 = W, y0 = H, x1 = -1, y1 = -1, ink = 0, changed = 0;
    const p = frames[i - 1];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = f[y * W + x];
      if (Math.abs(v - bg) > 14) { ink++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (p && Math.abs(v - p[y * W + x]) > 6) changed++;
    }
    // A fully flat nonblack frame is itself a legitimate page state. Treat its
    // footprint as the full screen instead of letting its dominant border
    // shade erase it from both layout and blank-share diagnostics.
    if (x1 < 0 && bg > 8 && f.every(v => Math.abs(v - bg) <= 14)) {
      x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; ink = W * H;
    }
    const box = x1 < 0 ? 0 : ((x1 - x0 + 1) * (y1 - y0 + 1)) / (W * H);
    // Border-derived ink is useful for layout diagnostics, but it cannot tell a
    // flat captured page from a missing frame: both can have one dominant edge
    // shade. Keep that metric advisory and identify playback loss from absolute
    // near-black coverage instead. A flat nonblack app screen is recorded UI.
    let nearBlack = 0;
    for (const v of f) if (v <= 8) nearBlack++;
    return {t: i / FPS, box, ink: ink / (W * H), black: nearBlack / (W * H) >= 0.995, changed: changed / (W * H)};
  });
  const errors = [], warnings = [], scenes = {};
  // A prose rationale cannot prove that a black interval is intentional. Pixel
  // checks therefore never exempt scene-wide black ranges.
  for (const s of timing.scenes) {
    const fs = perFrame.filter(f => f.t >= s.start && f.t < s.end);
    if (!fs.length) continue;
    const med = arr => { const v = arr.slice().sort((a, b) => a - b); return v[Math.floor(v.length / 2)] ?? 0; };
    const box = med(fs.map(f => f.box));
    let run = 0, runStart = s.start, longest = {d: 0};
    for (const f of fs) {
      if (f.changed < 0.0006) { if (!run) runStart = f.t; run += 1 / FPS; if (run > longest.d) longest = {d: run, a: runStart, b: f.t}; }
      else run = 0;
    }
    const inHold = (s.holds || []).some(h => longest.d && h.start <= longest.a + 0.3 && h.end >= longest.b - 0.3);
    if (box < 0.3) warnings.push(`[${s.id}] rendered pixels: content box covers only ${Math.round(box * 100)}% of the frame. The layout is crammed into one area; use the whole frame.`);
    if (longest.d > 3 && !inHold) warnings.push(`[${s.id}] rendered pixels: the picture is frozen for ${longest.d.toFixed(1)}s (${longest.a.toFixed(1)}–${longest.b.toFixed(1)}s).`);
    // Keep legacy advisory statistics unchanged for non-app-review profiles;
    // strict playback blocking below uses the absolute near-black signal.
    const blank = fs.filter(f => f.ink < 0.002).length / fs.length;
    if (blank > 0.25) {
      const message = `[${s.id}] rendered pixels: ${Math.round(blank * 100)}% of the scene is an empty frame.`;
      // The share remains advisory. App-review blocking is based on contiguous
      // duration below, which preserves brief intentional openings and exits.
      warnings.push(message);
    }
    scenes[s.id] = {contentBox: Number(box.toFixed(3)), longestFrozen: Number(longest.d.toFixed(2)), blankShare: Number(blank.toFixed(3)), meanChange: Number((fs.reduce((a, f) => a + f.changed, 0) / fs.length).toFixed(4))};
  }
  // Evaluate blank runs on the entire encoded sequence, not per scene. This
  // catches a blackout diluted by a long scene and one split by a scene cut.
  // App reviews may have a brief intentional black open/close; those edge runs
  // are exempt up to 1.25 seconds. Internal runs longer than 0.75 seconds block.
  if (strictBlank) {
    const runs = [];
    let start = -1;
    for (let i = 0; i <= perFrame.length; i++) {
      const t = i / FPS;
      const blank = i < perFrame.length && perFrame[i].black;
      if (blank && start < 0) start = i;
      if (!blank && start >= 0) {
        runs.push({start, end: i, duration: (i - start) / FPS});
        start = -1;
      }
    }
    const filmDuration = perFrame.length / FPS;
    for (const run of runs) {
      const atOpening = run.start === 0 && run.duration <= 1.25;
      const atExit = run.end === perFrame.length && filmDuration - run.start / FPS <= 1.25;
      const startTime = run.start / FPS, endTime = run.end / FPS;
      const sourceMatched = verifiedBlackIntervals.some(interval => interval.start <= startTime + 0.18 && interval.end >= endTime - 0.18);
      if (run.duration <= 0.75 || atOpening || atExit || sourceMatched) continue;
      const owners = timing.scenes.filter(s => s.end > run.start / FPS && s.start < run.end / FPS).map(s => s.id);
      errors.push(`${owners.length ? `${owners.map(id => `[${id}]`).join(' ')} ` : ''}rendered pixels: sustained empty playback for ${run.duration.toFixed(1)}s (${(run.start / FPS).toFixed(1)}–${(run.end / FPS).toFixed(1)}s)${owners.length > 1 ? ' across scene boundary' : ''}.`);
    }
  }
  return {ok: !errors.length, method: `ffmpeg ${FPS}fps ${W}x${H} luma; near-black coverage (≤8 luma on ≥99.5% of pixels); border-background ink is advisory`, errors, warnings, scenes};
}

/** How much of the frame a film uses, measured the same way for any MP4 (ours or a reference channel's), so two
 *  films can be compared by numbers. Per sampled frame: ink = share of pixels that differ from the background;
 *  spread = the box spanned by rows and columns holding at least 0.5% ink (ignores specks); near-blank = ink < 1.5%. */
export async function frameStats(videoFile, {every = 2, width = 480} = {}) {
  const w = width, h = Math.round(width * 9 / 16 / 2) * 2, raw = await decode(videoFile, `1/${every}`, w, h), n = Math.floor(raw.length / (w * h));
  const ink = [], spread = [];
  for (let i = 1; i < n - 1; i++) { // the first and last frames are usually title or black
    const f = raw.subarray(i * w * h, (i + 1) * w * h), sorted = Uint8Array.from(f).sort(), bg = sorted[Math.floor(sorted.length / 2)];
    const rows = new Array(h).fill(0), cols = new Array(w).fill(0); let count = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs(f[y * w + x] - bg) > 24) { count++; rows[y]++; cols[x]++; }
    const rs = rows.map((v, y) => v / w > 0.005 ? y : -1).filter(v => v >= 0), cs = cols.map((v, x) => v / h > 0.005 ? x : -1).filter(v => v >= 0);
    ink.push(count / (w * h));
    spread.push(rs.length && cs.length ? (rs.at(-1) - rs[0]) * (cs.at(-1) - cs[0]) / (w * h) : 0);
  }
  const q = (arr, p) => { const v = arr.slice().sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * p))] : 0; }, pct = v => Number((v * 100).toFixed(1));
  return {frames: ink.length, every, inkMedian: pct(q(ink, 0.5)), inkP90: pct(q(ink, 0.9)), spreadMedian: pct(q(spread, 0.5)), nearBlank: pct(ink.filter(v => v < 0.015).length / Math.max(1, ink.length))};
}

// Compare supported capture layers in the encoded film with their recorded source.
// This deliberately declines scenes where the layer's rendered footprint is ambiguous.

const CAPTURE_W = 96, CAPTURE_H = 54;
function frame(file, time, crop) {
  return new Promise((resolve, reject) => {
    const vf = `${crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},` : ''}scale=${CAPTURE_W}:${CAPTURE_H}:flags=area,format=rgb24`;
    const child = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, time)), '-i', file, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', 'pipe:1'], {stdio: ['ignore', 'pipe', 'pipe']});
    const chunks = []; let err = '';
    child.stdout.on('data', part => chunks.push(part)); child.stderr.on('data', part => err += part);
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(err.trim())));
  });
}

const overlaps = (a, b) => Math.abs(a.at[0] - b.at[0]) * 2 < a.size[0] + b.size[0] &&
  Math.abs(a.at[1] - b.at[1]) * 2 < a.size[1] + b.size[1];

export async function verifyCaptureVisibility(job, videoFile, world) {
  const videos = (world.objects || []).filter(o => o.type === 'video' && /app-(?:capture|review)\//.test(o.src || ''));
  const results = [];
  for (const v of videos) {
    const scene = (world.scenes || []).find(s => s.id === v.scene);
    const captureDuration = Number(v.clipDuration ?? v.mediaDuration);
    const interval = scene && captureDuration > 0 ? {start: v.mediaStart ?? scene.start, end: Math.min(scene.end, (v.mediaStart ?? scene.start) + captureDuration)} : undefined;
    const issues = [];
    if (!scene || !Array.isArray(v.at) || !Array.isArray(v.size) || v.size.length < 2) issues.push('missing scene or geometry');
    if (v.transform || v.zoom || v.rotation || v.scale) issues.push('capture layer has a transform');
    const others = (world.objects || []).filter(o => o !== v && o.scene === v.scene && o.visible !== false &&
      Array.isArray(o.at) && Array.isArray(o.size) && overlaps(v, o));
    if (others.length) issues.push(`overlapping composition objects: ${others.map(o => o.id).join(', ')}`);
    const actions = (world.actions || []).filter(a => a.target === v.id && ['move', 'zoom', 'rotate', 'scale'].includes(a.do));
    if (actions.length) issues.push('capture layer has animated geometry');
    if (issues.length) { results.push({id: v.id, scene: v.scene, interval, status: 'unverified', reason: issues.join('; ')}); continue; }
    const duration = Number(v.mediaDuration ?? v.clipDuration), start = Number(v.mediaStart ?? scene.start);
    if (!(duration > 0) || !Number.isFinite(start)) { results.push({id: v.id, scene: v.scene, interval, status: 'unverified', reason: 'missing playback interval'}); continue; }
    const x = Math.max(0, Math.round((v.at[0] - v.size[0] / 2) / world.width * world.width));
    const y = Math.max(0, Math.round((v.at[1] - v.size[1] / 2) / world.height * world.height));
    const w = Math.min(world.width - x, Math.round(v.size[0])), h = Math.min(world.height - y, Math.round(v.size[1]));
    if (x + w > world.width || y + h > world.height || w < 2 || h < 2) { results.push({id: v.id, scene: v.scene, interval, status: 'unverified', reason: 'capture geometry falls outside the render'}); continue; }
    const samples = [];
    // Sample on the same cadence as the global black-frame check. That lets a
    // recorded black run be exempted only where its source frames also match.
    for (let local = Math.min(1 / 6, duration / 2); local < duration; local += 1 / 6) {
      const t = start + local;
      try {
        const expected = await frame(path.resolve(job, v.src), local);
        const actual = await frame(videoFile, t, {x, y, w, h});
        if (expected.length !== CAPTURE_W * CAPTURE_H * 3 || actual.length !== expected.length) throw new Error('frame unavailable');
        let total = 0, changed = 0;
        for (let i = 0; i < expected.length; i += 3) {
          const d = Math.abs(expected[i] - actual[i]) + Math.abs(expected[i + 1] - actual[i + 1]) + Math.abs(expected[i + 2] - actual[i + 2]);
          total += d; if (d > 72) changed++;
        }
        const mean = total / expected.length, match = 1 - changed / (CAPTURE_W * CAPTURE_H);
        const sourceBlack = expected.every(channel => channel <= 20);
        const renderedBlack = actual.every(channel => channel <= 20);
        samples.push({t: Number(t.toFixed(3)), meanRgbError: Number(mean.toFixed(2)), matchingPixels: Number(match.toFixed(3)), blackMatch: sourceBlack && renderedBlack && mean <= 12});
      } catch (error) { samples.push({t: Number(t.toFixed(2)), error: error.message}); }
    }
    const failed = samples.some(s => s.error || s.meanRgbError > 32 || s.matchingPixels < 0.55);
    const blackIntervals = [];
    let blackStart = null, previous = null;
    for (const sample of samples) {
      if (sample.blackMatch && (previous == null || sample.t - previous <= 0.18)) { if (blackStart == null) blackStart = sample.t - 1 / 12; previous = sample.t; }
      else { if (blackStart != null && previous != null) blackIntervals.push({start: Math.max(start, blackStart), end: Math.min(start + duration, previous + 1 / 12)}); blackStart = sample.blackMatch ? sample.t - 1 / 12 : null; previous = sample.blackMatch ? sample.t : null; }
    }
    if (blackStart != null && previous != null) blackIntervals.push({start: Math.max(start, blackStart), end: Math.min(start + duration, previous + 1 / 12)});
    results.push({id: v.id, scene: v.scene, interval, status: failed ? 'failed' : 'verified', samples, ...(blackIntervals.length ? {blackIntervals} : {}),
      ...(failed ? {reason: 'rendered capture region does not match recorded footage'} : {})});
  }
  const counts = Object.fromEntries(['verified', 'failed', 'unverified'].map(status => [status, results.filter(r => r.status === status).length]));
  return {method: 'rendered capture regions sampled at 6fps and compared with their recorded source frames; exact untransformed geometry only', coverage: counts,
    complete: counts.unverified === 0 && counts.failed === 0, captures: results};
}
