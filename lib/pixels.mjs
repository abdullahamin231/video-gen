// Pixel-level checks on the rendered MP4. They see everything (hooks, Manim clips, HTML scenes) because
// they read the actual frames: frame use and stillness measured from pixels, not from declared beats.
// They are warnings: reviewers weigh them against the frames (a long hold or an empty beat can be deliberate).
import {spawn} from 'node:child_process';

const FPS = 6, W = 192, H = 108;
function decode(file, fps = FPS, w = W, h = H) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `fps=${fps},scale=${w}:${h}:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1'], {stdio: ['ignore', 'pipe', 'pipe']});
    const chunks = []; let err = '';
    child.stdout.on('data', c => chunks.push(c)); child.stderr.on('data', c => { err += c; });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg decode failed: ${err.slice(-400)}`)));
  });
}

export async function pixelChecks(videoFile, timing) {
  const raw = await decode(videoFile), n = Math.floor(raw.length / (W * H)), frames = [];
  for (let i = 0; i < n; i++) frames.push(raw.subarray(i * W * H, (i + 1) * W * H));
  // background: the most common border value of the first frame
  const hist = new Array(256).fill(0), f0 = frames[0] || new Uint8Array(W * H);
  for (let x = 0; x < W; x++) { hist[f0[x]]++; hist[f0[(H - 1) * W + x]]++; }
  const bg = hist.indexOf(Math.max(...hist));
  const perFrame = frames.map((f, i) => {
    let x0 = W, y0 = H, x1 = -1, y1 = -1, ink = 0, changed = 0;
    const p = frames[i - 1];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = f[y * W + x];
      if (Math.abs(v - bg) > 14) { ink++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (p && Math.abs(v - p[y * W + x]) > 6) changed++;
    }
    const box = x1 < 0 ? 0 : ((x1 - x0 + 1) * (y1 - y0 + 1)) / (W * H);
    return {t: i / FPS, box, ink: ink / (W * H), changed: changed / (W * H)};
  });
  const errors = [], warnings = [], scenes = {};
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
    const blank = fs.filter(f => f.ink < 0.002).length / fs.length;
    if (blank > 0.25) warnings.push(`[${s.id}] rendered pixels: ${Math.round(blank * 100)}% of the scene is an empty frame.`);
    scenes[s.id] = {contentBox: Number(box.toFixed(3)), longestFrozen: Number(longest.d.toFixed(2)), blankShare: Number(blank.toFixed(3)), meanChange: Number((fs.reduce((a, f) => a + f.changed, 0) / fs.length).toFixed(4))};
  }
  return {ok: !errors.length, method: `ffmpeg ${FPS}fps ${W}x${H} luma; background ${bg}`, errors, warnings, scenes};
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
