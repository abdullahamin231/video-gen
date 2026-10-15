// DOM inspection of the compiled world: seeks the real timeline in headless Chrome, measures every object,
// and turns the measurements into checks and a motion transcript that a reviewer without image input can read.
// Errors: the timeline is broken (conflicting tweens, not seek-safe). Legibility, collisions, frame use and
// stillness are warnings for agents and reviewers to weigh.
import path from 'node:path';
import {access, writeFile, mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import os from 'node:os';

const exists = async f => { try { await access(f); return true; } catch { return false; } };
export async function chromePath() {
  for (const c of [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) if (c && await exists(c)) return c;
  const {readdir} = await import('node:fs/promises');
  const base = path.join(os.homedir(), '.cache/hyperframes/chrome');
  try {
    for (const d of await readdir(base, {recursive: true})) if (/chrome(-headless-shell)?$/.test(d) && !d.endsWith('.app')) return path.join(base, d);
  } catch {}
  throw new Error('No Chrome found for inspection. Set CHROME_PATH or run `npx hyperframes browser install`.');
}

export async function openInspector(job, manifest) {
  const {default: puppeteer} = await import('puppeteer-core');
  const browser = await puppeteer.launch({executablePath: await chromePath(), headless: true,
    args: ['--allow-file-access-from-files', '--disable-web-security', '--no-sandbox', '--font-render-hinting=none', '--hide-scrollbars']});
  const page = await browser.newPage();
  await page.setViewport({width: manifest.width, height: manifest.height, deviceScaleFactor: 1});
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(pathToFileURL(path.join(job, 'review/inspect/index.html')).href, {waitUntil: 'load', timeout: 60000});
  await page.waitForFunction('window.__vgReady || window.__vgError', {timeout: 60000}).catch(() => {});
  const failure = await page.evaluate(() => window.__vgError || (!window.__vgReady ? 'world did not finish building' : null));
  if (failure) { await browser.close(); const e = new Error(`World build failed in the browser: ${failure}${consoleErrors.length ? '\n' + consoleErrors.slice(0, 5).join('\n') : ''}`); e.browser = true; throw e; }
  const seek = t => page.evaluate(time => { window.__timelines.world.seek(time, false); return VG.snapshot(); }, t);
  return {
    page, browser, seek, consoleErrors,
    log: () => page.evaluate(() => VG.__last.log),
    conflicts: () => page.evaluate(() => (VG.__last.conflicts || []).map(c => c.text)),
    async screenshot(t, file) { await seek(t); await mkdir(path.dirname(file), {recursive: true}); await page.screenshot({path: file, type: 'png'}); },
    close: () => browser.close(),
  };
}

const area = b => Math.max(0, b[2]) * Math.max(0, b[3]);
const inter = (a, b) => { const x = Math.max(a[0], b[0]), y = Math.max(a[1], b[1]), x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]); return Math.max(0, x2 - x) * Math.max(0, y2 - y); };
const fmt = t => t.toFixed(2).padStart(6, ' ');

/** Run all DOM checks. scope: list of scene ids to check (default: all built scenes). */
export async function inspectFilm(job, manifest, timing, {scope = null, step = 0.25} = {}) {
  const ins = await openInspector(job, manifest);
  const W = manifest.width, H = manifest.height;
  const scenes = timing.scenes.filter(s => s.kind !== 'html' && !(timing.missing || []).includes(s.id) && (!scope || scope.includes(s.id)));
  const samples = [];
  try {
    for (const s of scenes) for (let t = s.start; t < s.end - 1e-6; t += step) samples.push({t: Number(t.toFixed(3)), scene: s.id, snap: await ins.seek(t)});
    var log = await ins.log(), conflicts = await ins.conflicts();
    // Seek-safety: revisit samples in a scrambled order; every frame must match the forward pass.
    var seekIssues = [];
    const order = samples.map((_, i) => i).filter(i => i % 7 === 3).reverse();
    for (let k = 0; k < order.length; k++) {
      const i = order[(k * 5) % order.length], again = await ins.seek(samples[i].t);
      const first = new Map(samples[i].snap.objects.map(o => [o.id, o]));
      for (const o of again.objects) {
        const p = first.get(o.id); if (!p) continue;
        if (Math.abs(o.opacity - p.opacity) > 0.02 || o.box.some((v, j) => Math.abs(v - p.box[j]) > 2) || (o.sig !== p.sig && o.opacity > 0.05))
          seekIssues.push({t: samples[i].t, id: o.id, scene: samples[i].scene});
      }
    }
  } finally { await ins.close(); }
  const errors = [], warnings = [], seen = new Set();
  for (const c of [...new Set(conflicts)]) errors.push(`Overlapping actions: ${c}.`);
  for (const issue of seekIssues) if (!seen.has('seek:' + issue.id)) { seen.add('seek:' + issue.id); errors.push(`t=${issue.t.toFixed(2)}s [${issue.scene}] "${issue.id}" looks different when the timeline is seeked out of order (not seek-safe). Hooks/components must create every tween with explicit from/to values at cue times; no callbacks or state read during playback.`); }
  const once = (key, list, msg) => { if (!seen.has(key)) { seen.add(key); list.push(msg); } };
  const perScene = {};
  for (const s of scenes) perScene[s.id] = {frameUse: [], centre: [], windows: [], still: [], developing: []};
  let prev = null;
  for (const smp of samples) {
    const S = perScene[smp.scene], vis = smp.snap.objects.filter(o => o.opacity >= 0.3 && o.box[2] > 0 && o.box[3] > 0);
    // legibility and collisions
    const texts = [];
    for (const o of vis) for (const tx of o.texts) {
      if (tx.opacity < 0.5 || !tx.text.trim()) continue;
      texts.push({...tx, id: o.id});
      const min = o.type === 'counter' ? 40 : 28;
      if (tx.px < min - 0.5) once(`small:${o.id}:${tx.text}`, warnings, `t=${smp.t.toFixed(2)}s [${smp.scene}] "${tx.text}" (${o.id}) is ${tx.px}px on screen (legibility minimum ${min}px). Enlarge it or zoom in if it is essential.`);
      const b = tx.box; if (b[0] < -4 || b[1] < -4 || b[0] + b[2] > W + 4 || b[1] + b[3] > H + 4) once(`off:${o.id}:${tx.text}`, warnings, `t=${smp.t.toFixed(2)}s [${smp.scene}] "${tx.text}" (${o.id}) is cut off by the frame edge at box ${JSON.stringify(b)}.`);
    }
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j]; if (a.id === b.id && a.text === b.text) continue;
      const ov = inter(a.box, b.box); if (ov > 0.2 * Math.min(area(a.box), area(b.box)))
        once(`ov:${[a.id + a.text, b.id + b.text].sort().join('|')}`, warnings, `t=${smp.t.toFixed(2)}s [${smp.scene}] text "${a.text}" (${a.id}) overlaps "${b.text}" (${b.id}). Move one of them.`);
    }
    // frame use: union box of visible content, clipped to the frame
    if (vis.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const o of vis) { const b = o.box; x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[0] + b[2]); y1 = Math.max(y1, b[1] + b[3]); }
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
      S.frameUse.push(Math.max(0, x1 - x0) * Math.max(0, y1 - y0) / (W * H));
      S.centre.push([((x0 + x1) / 2 - W / 2) / W, ((y0 + y1) / 2 - H / 2) / H]);
    } else S.frameUse.push(0);
    // development between consecutive samples
    if (prev && prev.scene === smp.scene) {
      const before = new Map(prev.snap.objects.map(o => [o.id, o])), dev = [];
      for (const o of smp.snap.objects) {
        const p = before.get(o.id); if (!p) continue;
        if (Math.max(o.opacity, p.opacity) < 0.05) continue;
        const beforeBox = p.worldBox || p.box, afterBox = o.worldBox || o.box;
        const measurable = (o.worldBox && p.worldBox) || smp.snap.camera.transform === prev.snap.camera.transform;
        const moved = measurable && afterBox.some((v, k) => Math.abs(v - beforeBox[k]) > 1.5), faded = Math.abs(o.opacity - p.opacity) > 0.02, changed = o.sig !== p.sig && o.sig != null && p.sig != null;
        if (moved || faded || changed) dev.push(o.id);
      }
      S.developing.push({t: smp.t, ids: dev});
    }
    prev = smp;
  }
  const report = {step, scenes: {}};
  for (const s of scenes) {
    const S = perScene[s.id], med = arr => { const v = arr.slice().sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };
    const holds = s.holds || [], inHold = (a, b) => holds.some(h => h.start <= a + 0.25 && h.end >= b - 0.25);
    const fu = med(S.frameUse), cx = med(S.centre.map(c => c[0])), cy = med(S.centre.map(c => c[1]));
    if (fu < 0.2) warnings.push(`[${s.id}] content fills only ${Math.round(fu * 100)}% of the frame (median). Make the subject larger, spread the layout, or move the camera closer (camera zoom).`);
    if (Math.abs(cx) > 0.2 || Math.abs(cy) > 0.2) warnings.push(`[${s.id}] content sits off-centre (median centre offset ${Math.round(cx * 100)}%, ${Math.round(cy * 100)}% of the frame). Check the composition is balanced.`);
    // stillness: longest run with nothing developing
    let runStart = s.start, longest = {d: 0};
    const points = S.developing;
    for (const p of points) { if (p.ids.length) { const d = p.t - runStart - step; if (d > longest.d) longest = {d, a: runStart, b: p.t}; runStart = p.t; } }
    const tail = s.end - runStart; if (tail > longest.d) longest = {d: tail, a: runStart, b: s.end};
    if (longest.d > 4 && !inHold(longest.a, longest.b)) warnings.push(`[${s.id}] nothing changes for ${longest.d.toFixed(1)}s (${longest.a.toFixed(2)}–${longest.b.toFixed(2)}s) while the narration moves on. Give the next spoken idea its visible event, or declare a hold with a reason.`);
    // activity: distinct developing elements per 3 s window
    const windows = [];
    for (let a = s.start; a < s.end - 0.5; a += 1.5) {
      const b = Math.min(s.end, a + 3), ids = new Set(points.filter(p => p.t > a && p.t <= b).flatMap(p => p.ids));
      windows.push({a, b, n: ids.size}); // diagnostic only: one clear event can be worth more than many small ones
    }
    report.scenes[s.id] = {frameUse: Number(fu.toFixed(3)), centre: [Number(cx.toFixed(3)), Number(cy.toFixed(3))], longestStill: Number(longest.d.toFixed(2)), windows: windows.map(w => w.n)};
  }
  const transcript = motionTranscript(timing, scenes, log, samples, report);
  return {errors, warnings, report, transcript, log};
}

function motionTranscript(timing, scenes, log, samples, report) {
  const lines = ['# Motion transcript', '', 'Every timed action in the film, in order, with where the subject is on screen when the action ends.',
    'Coordinates are pixels in a 1920×1080 frame (x right, y down). "dev/3s" counts distinct elements that visibly change in each 3 s window.', ''];
  const at = t => samples.reduce((best, s) => Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best, samples[0] || {t: 0, snap: {objects: []}});
  for (const s of scenes) {
    const r = report.scenes[s.id];
    lines.push(`## ${s.id} — ${s.start.toFixed(2)}–${s.end.toFixed(2)} s`, `Frame use ${Math.round(r.frameUse * 100)}% · longest still ${r.longestStill}s · dev/3s: ${r.windows.join(' ')}`, '');
    const cues = (s.beats || []).filter(b => !['start', 'end'].includes(b.id));
    const events = [...cues.map(c => ({t: c.at, text: `cue "${c.id}"`})),
      ...log.filter(e => e.t >= s.start - 0.6 && e.t < s.end).map(e => {
        const snap = at(Math.min(s.end - 0.01, e.t + e.d)), o = snap.snap.objects.find(x => x.id === String(e.id).split('.')[0]);
        const where = o && o.opacity > 0.05 ? ` → at (${Math.round(o.box[0] + o.box[2] / 2)},${Math.round(o.box[1] + o.box[3] / 2)}) ${o.box[2]}×${o.box[3]}${o.opacity < 0.95 ? ` opacity ${o.opacity}` : ''}` : (o ? ' → hidden' : '');
        return {t: e.t, text: `${e.verb.padEnd(12)} ${e.id}${e.detail ? ' ' + e.detail : ''} (${e.d.toFixed(2)}s)${where}`};
      })].sort((a, b) => a.t - b.t);
    for (const ev of events) lines.push(`${fmt(ev.t)}  ${ev.text}`);
    const end = at(s.end - 0.05), visible = end.snap.objects.filter(o => o.opacity > 0.3).map(o => o.id);
    lines.push('', `On screen at the end: ${visible.join(', ') || '(nothing)'}`, '');
  }
  return lines.join('\n') + '\n';
}

export async function writeInspection(job, result) {
  await mkdir(path.join(job, 'review'), {recursive: true});
  await writeFile(path.join(job, 'review/inspect.json'), JSON.stringify({errors: result.errors, warnings: result.warnings, report: result.report}, null, 2) + '\n');
  await writeFile(path.join(job, 'review/motion.md'), result.transcript);
}
