// Assembles a compiled world spec into HyperFrames files: compositions/world.html, the root index.html,
// and a standalone inspection page used by the pipeline's DOM checks and snapshots.
import {copyFile, mkdir, writeFile, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NM = path.join(ROOT, 'node_modules');
export const KIT_FILES = {
  'kit.js': path.join(ROOT, 'lib/kit/kit.js'),
  'gsap.min.js': path.join(NM, 'gsap/dist/gsap.min.js'),
  'DrawSVGPlugin.min.js': path.join(NM, 'gsap/dist/DrawSVGPlugin.min.js'),
  'MorphSVGPlugin.min.js': path.join(NM, 'gsap/dist/MorphSVGPlugin.min.js'),
  'MotionPathPlugin.min.js': path.join(NM, 'gsap/dist/MotionPathPlugin.min.js'),
  'fonts/sans-400.woff2': path.join(NM, '@fontsource/inter/files/inter-latin-400-normal.woff2'),
  'fonts/sans-500.woff2': path.join(NM, '@fontsource/inter/files/inter-latin-500-normal.woff2'),
  'fonts/sans-600.woff2': path.join(NM, '@fontsource/inter/files/inter-latin-600-normal.woff2'),
  'fonts/sans-700.woff2': path.join(NM, '@fontsource/inter/files/inter-latin-700-normal.woff2'),
  'fonts/serif-400.woff2': path.join(NM, '@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2'),
  'fonts/serif-400i.woff2': path.join(NM, '@fontsource/source-serif-4/files/source-serif-4-latin-400-italic.woff2'),
  'fonts/serif-600.woff2': path.join(NM, '@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2'),
  'fonts/mono-400.woff2': path.join(NM, '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2'),
  'fonts/mono-500.woff2': path.join(NM, '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2'),
};
const SCRIPTS = ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'MotionPathPlugin.min.js', 'kit.js'];

export async function installKit(job) {
  await mkdir(path.join(job, 'assets/kit/fonts'), {recursive: true});
  for (const [rel, src] of Object.entries(KIT_FILES)) await copyFile(src, path.join(job, 'assets/kit', rel));
}

const FONT_CSS = [
  ['VG Sans', 'sans-400', 400], ['VG Sans', 'sans-500', 500], ['VG Sans', 'sans-600', 600], ['VG Sans', 'sans-700', 700],
  ['VG Serif', 'serif-400', 400], ['VG Serif', 'serif-600', 600], ['VG Mono', 'mono-400', 400], ['VG Mono', 'mono-500', 500],
].map(([f, file, w]) => `@font-face{font-family:'${f}';src:url('assets/kit/fonts/${file}.woff2') format('woff2');font-weight:${w};font-style:normal}`).join('\n') +
  `\n@font-face{font-family:'VG Serif';src:url('assets/kit/fonts/serif-400i.woff2') format('woff2');font-weight:400;font-style:italic}`;

const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');

function mountScript(world) {
  const {componentSrc, hooks, ...film} = world;
  return `${(componentSrc || []).map(c => `<script>/* ${c.file} */\n${c.src}\n</script>`).join('\n')}
${(hooks || []).map(h => `<script>/* ${h.file} */\n${h.src}\n</script>`).join('\n')}
<script>
(function () {
  var film = ${safeJSON(film)};
  gsap.registerPlugin(DrawSVGPlugin, MorphSVGPlugin, MotionPathPlugin);
  function build() {
    try { window.__timelines['world'] = VG.mount(document.getElementById('world-mount'), film); window.__vgReady = true; }
    catch (error) { window.__vgError = String(error && error.message || error); console.error('VG build failed: ' + window.__vgError); throw error; }
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(build); else build();
})();
</script>`;
}

export async function writeWorld(job, world, manifest) {
  const bg = world.theme?.bg || '#10141a';
  const media = world.objects.filter(o => o.type === 'manim' || o.type === 'video');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>world</title></head>
<body>
<template id="world-template">
<style>
${FONT_CSS}
#world-root{position:absolute;inset:0;overflow:hidden;background:${bg};font-family:'VG Sans',sans-serif}
#world-mount{position:absolute;inset:0}
</style>
<div id="world-root" data-composition-id="world" data-width="${manifest.width}" data-height="${manifest.height}" data-duration="${manifest.duration}">
  <div id="world-mount"></div>
  <div id="world-media-src">${media.map(o => `<video id="vg-${o.id}-video" src="${o.src}" muted playsinline data-start="${o.mediaStart}" data-duration="${o.mediaDuration}" data-track-index="${40}" data-volume="0"></video>`).join('')}</div>
</div>
${mountScript(world)}
</template>
</body></html>
`;
  await mkdir(path.join(job, 'compositions'), {recursive: true});
  await writeFile(path.join(job, 'compositions/world.html'), html);
  const {componentSrc, hooks, ...film} = world; void componentSrc; void hooks;
  await writeFile(path.join(job, 'assets/world.json'), JSON.stringify(film, null, 1) + '\n');
  await writeInspectPage(job, world, manifest);
  return {media: media.length};
}

export async function writeInspectPage(job, world, manifest) {
  const page = `<!doctype html>
<html><head><meta charset="utf-8"><base href="../../"><title>inspect</title>
<style>${FONT_CSS}
html,body{margin:0;width:${manifest.width}px;height:${manifest.height}px;overflow:hidden;background:#000}
#world-mount{position:absolute;left:0;top:0;width:${manifest.width}px;height:${manifest.height}px;overflow:hidden}</style>
${SCRIPTS.map(s => `<script src="assets/kit/${s}"></script>`).join('\n')}
<script>window.__timelines = {};</script>
</head><body><div id="world-mount"></div><div id="world-media-src">${world.objects.filter(o => o.type === 'manim' || o.type === 'video').map(o => `<video id="vg-${o.id}-video" src="${o.src}" muted playsinline></video>`).join('')}</div>
${mountScript(world)}
</body></html>
`;
  await mkdir(path.join(job, 'review/inspect'), {recursive: true});
  await writeFile(path.join(job, 'review/inspect/index.html'), page);
}

export async function writeRoot(job, manifest, timing, film) {
  const hosts = [`<div id="host-world" class="clip" data-composition-id="world" data-composition-src="compositions/world.html" data-start="0" data-duration="${manifest.duration}" data-track-index="1" data-width="${manifest.width}" data-height="${manifest.height}"></div>`];
  let track = 2;
  for (const s of timing.scenes) if (s.kind === 'html') {
    const file = film.scenes.find(x => x.id === s.id).file;
    hosts.push(`<div id="host-${s.id}" class="clip" data-composition-id="${s.id}" data-composition-src="${file}" data-start="${s.start}" data-duration="${s.duration}" data-track-index="${track++}" data-width="${manifest.width}" data-height="${manifest.height}"></div>`);
  }
  const bg = film.theme?.bg || '#10141a';
  await writeFile(path.join(job, 'index.html'), `<!doctype html>
<html lang="${manifest.transcription?.language || 'en'}"><head><meta charset="utf-8"><title>${String(manifest.name).replace(/[<&]/g, '')}</title>
${SCRIPTS.map(s => `<script src="assets/kit/${s}"></script>`).join('\n')}
<script src="assets/cues.js"></script>
<style>html,body{margin:0;width:100%;height:100%;background:${bg}}#root{position:relative;width:100%;height:100%;overflow:hidden}.clip{position:absolute;inset:0}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${manifest.duration}" data-width="${manifest.width}" data-height="${manifest.height}">
${hosts.join('\n')}
<audio id="narration" src="assets/narration.wav" data-start="0" data-duration="${manifest.duration}" data-track-index="0" data-volume="1"></audio>
</div><script>window.__timelines['main'] = gsap.timeline({paused:true});</script></body></html>
`);
}

export async function readJSON(file) { return JSON.parse(await readFile(file, 'utf8')); }
