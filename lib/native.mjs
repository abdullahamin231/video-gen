// Native composition inspection uses the same assembler/player as the installed HyperFrames snapshot command.
// HyperFrames has no public assembly API in the pinned version. Keep its internal-module integration here.
import {readFile, readdir, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

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

export async function inspectNative(job, manifest, timing, {scope = null} = {}) {
  const inspector = await openNativeInspector(job, manifest);
  const scenes = timing.scenes.filter(s => !(timing.missing || []).includes(s.id) && (!scope || scope.includes(s.id)));
  const samples = [], errors = [], warnings = [];
  const hash = buffer => createHash('sha256').update(buffer).digest('hex');
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
      await inspector.seek(time); const first = hash(await inspector.page.screenshot());
      await inspector.seek(scene.start); await inspector.seek(time);
      if (first !== hash(await inspector.page.screenshot())) errors.push(`[${scene.id}] frame at ${time.toFixed(2)}s changes after a backwards seek.`);
    }
    errors.push(...[...new Set(inspector.consoleErrors)].map(error => `Composition runtime: ${error}`));
  } finally { await inspector.close(); }
  return {errors, warnings: [...new Set(warnings)], report: {mode: 'native-hyperframes', scenes: Object.fromEntries(scenes.map(scene=>[scene.id,{sampledFrames:samples.filter(s=>s.scene===scene.id).length}])), sampledFrames: samples.length,
    limitations: ['Sampled text bounds and seek consistency; visual review must assess occlusion, contrast, meaning and motion.'], samples},
    transcript: '# Composition observations\n\nNative HyperFrames frames sampled by the renderer player. Text observations are diagnostics, not a motion or quality verdict.\n\n' +
      samples.map(s => `${s.time.toFixed(2)}s [${s.scene}] ${s.texts.map(t => t.text).join(' | ')}`).join('\n') + '\n'};
}
