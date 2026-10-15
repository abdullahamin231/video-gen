// Pixel-level checks on the rendered MP4. They see everything (hooks, Manim clips, HTML scenes) because
// they read the actual frames: frame use and stillness measured from pixels, not from declared beats.
// They are warnings: reviewers weigh them against the frames (a long hold or an empty beat can be deliberate).
import {spawn} from 'node:child_process';

const FPS = 6, W = 192, H = 108;
function decode(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `fps=${FPS},scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1'], {stdio: ['ignore', 'pipe', 'pipe']});
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
    if (box < 0.15) warnings.push(`[${s.id}] rendered pixels: content box covers only ${Math.round(box * 100)}% of the frame. The subject is too small or crammed into a corner.`);
    if (longest.d > 3 && !inHold) warnings.push(`[${s.id}] rendered pixels: the picture is frozen for ${longest.d.toFixed(1)}s (${longest.a.toFixed(1)}–${longest.b.toFixed(1)}s).`);
    const blank = fs.filter(f => f.ink < 0.002).length / fs.length;
    if (blank > 0.25) warnings.push(`[${s.id}] rendered pixels: ${Math.round(blank * 100)}% of the scene is an empty frame.`);
    scenes[s.id] = {contentBox: Number(box.toFixed(3)), longestFrozen: Number(longest.d.toFixed(2)), blankShare: Number(blank.toFixed(3)), meanChange: Number((fs.reduce((a, f) => a + f.changed, 0) / fs.length).toFixed(4))};
  }
  return {ok: !errors.length, method: `ffmpeg ${FPS}fps ${W}x${H} luma; background ${bg}`, errors, warnings, scenes};
}
