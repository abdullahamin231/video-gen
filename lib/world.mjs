// Assembles a compiled world spec into HyperFrames files: compositions/world.html, the root index.html,
// and a standalone inspection page used by the pipeline's DOM checks and snapshots.
import {access, copyFile, mkdir, writeFile, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NM = path.join(ROOT, 'node_modules');
// Typefaces bundled with every job. A film's theme picks among them by family name (or ships its own font files).
// The VG Sans/Serif/Mono aliases keep older films rendering unchanged.
export const FONT_FAMILIES = {
  'Inter': {pkg: 'inter', weights: [400, 500, 600, 700, 800, 900], alias: 'VG Sans', kind: 'neutral grotesk sans'},
  'Archivo': {pkg: 'archivo', weights: [400, 500, 600, 700, 800, 900], italic: [400, 700], kind: 'sturdy grotesk sans, very heavy weights for display'},
  'Space Grotesk': {pkg: 'space-grotesk', weights: [300, 400, 500, 600, 700], kind: 'geometric techy sans'},
  'Nunito': {pkg: 'nunito', weights: [400, 600, 700, 800, 900], kind: 'rounded friendly sans'},
  'Bebas Neue': {pkg: 'bebas-neue', weights: [400], kind: 'tall condensed all-caps display'},
  'Source Serif 4': {pkg: 'source-serif-4', weights: [400, 600], italic: [400], alias: 'VG Serif', kind: 'text serif, equations'},
  'Fraunces': {pkg: 'fraunces', weights: [400, 600, 700, 900], italic: [400], kind: 'soft high-contrast display serif'},
  'DM Serif Display': {pkg: 'dm-serif-display', weights: [400], italic: [400], kind: 'elegant editorial display serif'},
  'JetBrains Mono': {pkg: 'jetbrains-mono', weights: [400, 500, 700, 800], alias: 'VG Mono', kind: 'code mono, heavy weights for chips'},
  'IBM Plex Mono': {pkg: 'ibm-plex-mono', weights: [400, 500, 700], italic: [400], kind: 'typewriter-like mono'},
  'Caveat': {pkg: 'caveat', weights: [400, 700], kind: 'handwritten marker'},
};
const fontFile = (family, w, style) => `fonts/${FONT_FAMILIES[family].pkg}-${w}${style === 'italic' ? 'i' : ''}.woff2`;
const fontFaces = () => Object.entries(FONT_FAMILIES).flatMap(([family, f]) => [...f.weights.map(w => [family, w, 'normal']), ...(f.italic || []).map(w => [family, w, 'italic'])]);

export const KIT_FILES = {
  'kit.js': path.join(ROOT, 'lib/kit/kit.js'),
  'gsap.min.js': path.join(NM, 'gsap/dist/gsap.min.js'),
  'DrawSVGPlugin.min.js': path.join(NM, 'gsap/dist/DrawSVGPlugin.min.js'),
  'MorphSVGPlugin.min.js': path.join(NM, 'gsap/dist/MorphSVGPlugin.min.js'),
  'MotionPathPlugin.min.js': path.join(NM, 'gsap/dist/MotionPathPlugin.min.js'),
  ...Object.fromEntries(fontFaces().map(([family, w, style]) => [fontFile(family, w, style),
    path.join(NM, `@fontsource/${FONT_FAMILIES[family].pkg}/files/${FONT_FAMILIES[family].pkg}-latin-${w}-${style}.woff2`)])),
};
const SCRIPTS = ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'MotionPathPlugin.min.js', 'kit.js'];

/** Copy the kit into a job. With onlyMissing, files already in the job (a pinned kit.js) are kept. */
export async function installKit(job, {onlyMissing = false} = {}) {
  await mkdir(path.join(job, 'assets/kit/fonts'), {recursive: true});
  for (const [rel, src] of Object.entries(KIT_FILES)) {
    const dst = path.join(job, 'assets/kit', rel);
    if (onlyMissing && await access(dst).then(() => true, () => false)) continue;
    await copyFile(src, dst);
  }
}

const face = (family, file, w, style) => `@font-face{font-family:'${family}';src:url('${file}') format('woff2');font-weight:${w};font-style:${style}}`;
const FONT_CSS = fontFaces().flatMap(([family, w, style]) => {
  const file = `assets/kit/${fontFile(family, w, style)}`, alias = FONT_FAMILIES[family].alias;
  return [face(family, file, w, style), ...(alias ? [face(alias, file, w, style)] : [])];
}).join('\n');
/** Font files a theme ships itself: theme.fontFiles = [{"family", "src": "assets/fonts/x.woff2", "weight", "style"}]. */
const themeFontCSS = theme => (theme?.fontFiles || []).map(f => face(String(f.family).replace(/'/g, ''), String(f.src).replace(/'/g, ''), Number(f.weight) || 400, f.style === 'italic' ? 'italic' : 'normal')).join('\n');

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
${themeFontCSS(world.theme)}
#world-root{position:absolute;inset:0;overflow:hidden;background:${bg};font-family:'Inter',sans-serif}
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
${themeFontCSS(world.theme)}
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
