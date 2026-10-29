// HyperFrames assembly, browser inspection and lint diagnostics.
import {readFile,readdir,mkdir,access,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import sharp from 'sharp';
// Native composition inspection uses the same assembler/player as the installed HyperFrames snapshot command.
// HyperFrames has no public assembly API in the pinned version. Keep its internal-module integration here.

const DIST = fileURLToPath(new URL('../node_modules/hyperframes/dist/', import.meta.url));
let runtime;
async function captureRuntime() {
  return runtime ??= (async () => {
    const files = await readdir(DIST);
    const moduleFor = async prefix => {
      const file = files.find(name => name.startsWith(prefix) && name.endsWith('.js'));
      if (!file) throw new Error(`Installed HyperFrames lacks ${prefix}; check the pinned renderer integration.`);
      return path.join(DIST, file);
    };
    const snapshot = await readFile(await moduleFor('snapshot-'), 'utf8');
    const dependency = async name => {
      for (const match of snapshot.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
        if (match[1].split(',').map(s => s.trim()).includes(name)) {
          const mod = await import(pathToFileURL(path.resolve(DIST, match[2])).href);
          if (typeof mod[name] === 'function') return mod[name];
        }
      }
      throw new Error(`Installed HyperFrames snapshot no longer exports ${name}; update lib/native.mjs.`);
    };
    const {bundleWithLocalizedFonts} = await import(pathToFileURL(await moduleFor('bundleWithLocalizedFonts-')).href);
    return {bundleWithLocalizedFonts, serve: await dependency('serveStaticProjectHtml'),
      open: await dependency('openSettledCompositionPage'), seek: await dependency('seekCompositionTimeline')};
  })();
}


export async function openNativeInspector(job, manifest) {
  const hf = await captureRuntime();
  const html = await hf.bundleWithLocalizedFonts(job);
  const server = await hf.serve(job, html);
  let browser;
  try {
    const errors = [];
    const opened = await hf.open(html, server.url, {renderReadyTimeoutMs: 10000,
      beforeNavigate: async page => {
        page.on('pageerror', error => errors.push(error.message));
        page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`Asset request failed: ${request.url()} (${request.failure()?.errorText})`); });
        page.on('response', response => { if (response.status() >= 400) errors.push(`Asset HTTP ${response.status()}: ${response.url()}`); });
      }});
    browser = opened.browser;
    if (opened.renderReadyTimedOut) throw new Error('HyperFrames composition did not become render-ready.');
    const page = opened.page;
    const seek = async time => {
      await hf.seek(page, time, {exactTime: true});
      return page.evaluate(() => {
        const visible = element => {
          for (let node = element; node instanceof Element; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < .05) return false;
          }
          return true;
        };
        const texts = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode, parent = node.parentElement;
          if (!parent || /^(SCRIPT|STYLE|TEMPLATE)$/.test(parent.tagName) || !node.textContent.trim() || !visible(parent)) continue;
          const range = document.createRange(); range.selectNodeContents(node);
          const rect = range.getBoundingClientRect();
          if (rect.width && rect.height) texts.push({text: node.textContent.trim(), box: [rect.x, rect.y, rect.width, rect.height]});
        }
        return {texts};
      });
    };
    return {page, browser, seek, consoleErrors: errors, log: async () => [], conflicts: async () => [],
      async screenshot(time, file) { await seek(time); await mkdir(path.dirname(file), {recursive: true}); await page.screenshot({path: file, type: 'png'}); },
      async close() { try { await browser.close(); } finally { await server.close(); } }};
  } catch (error) {
    try { await browser?.close(); } finally { await server.close(); }
    throw error;
  }
}

// Allow sparse rasterization noise while detecting visible seek-dependent changes.
export async function materiallyDifferentFrames(first, second) {
  const a = await sharp(first).removeAlpha().raw().toBuffer({resolveWithObject: true});
  const b = await sharp(second).removeAlpha().raw().toBuffer({resolveWithObject: true});
  if (a.info.width !== b.info.width || a.info.height !== b.info.height || a.info.channels !== b.info.channels) return true;
  let changed = 0;
  for (let i = 0; i < a.data.length; i += a.info.channels) {
    let delta = 0;
    for (let c = 0; c < a.info.channels; c++) delta = Math.max(delta, Math.abs(a.data[i + c] - b.data[i + c]));
    if (delta > 3) changed++;
  }
  return changed / (a.info.width * a.info.height) > 0.0005;
}

export async function inspectNative(job, manifest, timing, {scope = null} = {}) {
  const inspector = await openNativeInspector(job, manifest);
  const scenes = timing.scenes.filter(s => !(timing.missing || []).includes(s.id) && (!scope || scope.includes(s.id)));
  const samples = [], errors = [], warnings = [];

  try {
    for (const scene of scenes) {
      const times = new Set([scene.start, scene.start + scene.duration / 2, scene.end - 1 / (manifest.fps || 30)]);
      for (let time = scene.start; time < scene.end; time += .5) times.add(time);
      for (const time of [...times].sort((a, b) => a - b)) {
        const snapshot = await inspector.seek(time);
        for (const text of snapshot.texts) {
          const [x, y, w, h] = text.box;
          // A sustained partial clipping is a concrete layout risk. Offscreen and transitional text needs visual judgment.
          if ((x < -1 && x + w > 0) || (y < -1 && y + h > 0) || (x < manifest.width && x + w > manifest.width + 1) || (y < manifest.height && y + h > manifest.height + 1))
            warnings.push(`[${scene.id}] t=${time.toFixed(2)}s partially clipped text: ${text.text.slice(0, 100)}`);
        }
        samples.push({scene: scene.id, time, texts: snapshot.texts});
      }
    }
    // Compare identical rendered timestamps after a backwards seek, rather than trusting declared timeline structure.
    for (const scene of scenes) {
      const time = scene.start + scene.duration / 2;
      await inspector.seek(time); const first = await inspector.page.screenshot();
      await inspector.seek(scene.start); await inspector.seek(time);
      if (await materiallyDifferentFrames(first, await inspector.page.screenshot())) errors.push(`[${scene.id}] frame at ${time.toFixed(2)}s changes after a backwards seek.`);
    }
    errors.push(...[...new Set(inspector.consoleErrors)].map(error => `Composition runtime: ${error}`));
  } finally { await inspector.close(); }
  return {errors, warnings: [...new Set(warnings)], report: {mode: 'native-hyperframes', scenes: Object.fromEntries(scenes.map(scene=>[scene.id,{sampledFrames:samples.filter(s=>s.scene===scene.id).length}])), sampledFrames: samples.length,
    limitations: ['Sampled text bounds and seek consistency; visual review must assess occlusion, contrast, meaning and motion.'], samples},
    transcript: '# Composition observations\n\nNative HyperFrames frames sampled by the renderer player. Text observations are diagnostics, not a motion or quality verdict.\n\n' +
      samples.map(s => `${s.time.toFixed(2)}s [${s.scene}] ${s.texts.map(t => t.text).join(' | ')}`).join('\n') + '\n'};
}

const exists = async f => { try { await access(f); return true; } catch { return false; } };
export async function chromePath() {
  for (const c of [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) if (c && await exists(c)) return c;
  const {readdir} = await import('node:fs/promises');
  const base = path.join(os.homedir(), '.cache/hyperframes/chrome');
  try {
    for (const d of await readdir(base, {recursive: true})) if (/chrome(-headless-shell)?$/.test(d) && !d.endsWith('.app')) return path.join(base, d);
  } catch {}
  throw new Error('No Chrome found for inspection. Set CHROME_PATH or run `npx hyperframes browser ensure`.');
}

export async function openInspector(job,manifest) {
  const {isNews,openNewsInspector}=await import('./news.mjs');
  const {readPersonality}=await import('./personalities.mjs');
  return isNews(readPersonality(job)) ? openNewsInspector(job,manifest) : openNativeInspector(job,manifest);
}
export const inspectFilm=inspectNative;
export async function writeInspection(job, result) {
  await mkdir(path.join(job, 'review'), {recursive: true});
  await writeFile(path.join(job, 'review/inspect.json'), JSON.stringify({errors: result.errors, warnings: result.warnings, report: result.report}, null, 2) + '\n');
  await writeFile(path.join(job, 'review/motion.md'), result.transcript);
}

// HyperFrames lint, run by build so its errors reach `next` (and get repaired) before render rather than stopping render.
// Each finding is attributed to the file an agent wrote (an html scene, a hook, a component) or to the pipeline's own
// generated code (index.html, the world mount script), which no agent may edit.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HF = path.join(ROOT, 'node_modules/hyperframes/bin/hyperframes.mjs');

/** Files a render writes and removes; one left by a crashed render makes HyperFrames see two root compositions. */
export const RENDER_TEMP_FILES = ['index.cut.html'];
export const removeRenderTempFiles = job => Promise.all(RENDER_TEMP_FILES.map(f => rm(path.join(job, f), {force: true})));

function runLint(dir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HF, 'lint'], {cwd: dir, env: {...process.env, PWD: dir, NO_COLOR: '1', FORCE_COLOR: '0'}, stdio: ['ignore', 'pipe', 'pipe']});
    let out = '';
    child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { out += c; });
    child.on('error', reject);
    child.on('close', code => resolve({code, out: out.replace(/\x1b\[[0-9;]*m/g, '')}));
  });
}

/** Parse `hyperframes lint` text output: "  ✗ [file:line:col] code: message" then "    Fix: hint". */
export function parseLint(out, job) {
  const findings = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(✗|⚠)\s+(?:\[([^\]]+)\]\s+)?([a-z0-9_]+)(?:\s+\[[^\]]*\])?:\s*(.*)$/.exec(line);
    if (m) {
      let file = 'index.html', at = null;
      if (m[2]) {
        const loc = /^(.*?)(?::(\d+))?(?::\d+)?$/.exec(m[2]);
        file = path.isAbsolute(loc[1]) ? path.relative(job, loc[1]) : loc[1];
        at = loc[2] ? Number(loc[2]) : null;
      }
      findings.push({severity: m[1] === '✗' ? 'error' : 'warning', file: file.replace(/\\/g, '/'), line: at, code: m[3], message: m[4].trim()});
      continue;
    }
    const fix = /^\s+Fix:\s*(.*)$/.exec(line);
    if (fix && findings.length) findings.at(-1).fix = fix[1].trim();
  }
  return findings;
}

export async function lintJob(job,film) {
  await removeRenderTempFiles(job);
  const {code,out}=await runLint(job), findings=parseLint(out,job);
  const result={errors:[],warnings:[],pipeline:[]};
  for(const finding of findings) {
    const owner=film.scenes.find(scene=>scene.file===finding.file);
    const text=`${owner ? `[${owner.id}] ` : ''}${finding.file}: ${finding.code}: ${finding.message}${finding.fix ? ` Fix: ${finding.fix}` : ''}`;
    (finding.severity==='warning' ? result.warnings : owner ? result.errors : result.pipeline).push(text);
  }
  if(code!==0&&!findings.some(f=>f.severity==='error')) result.pipeline.push(out.trim().slice(-1000)||'HyperFrames lint failed without diagnostics');
  return result;
}
