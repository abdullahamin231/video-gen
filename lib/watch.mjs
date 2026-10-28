// Read-only harness review: overview, player, assets, HTTP caching and server lifecycle.
import http from 'node:http';
import zlib from 'node:zlib';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,mkdir,realpath,stat,rm,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {projectStatus,projectDir,projectJob,loadProject} from './project.mjs';
// Compression, validators and delta encoding for clients on slow links.
const brotli = promisify(zlib.brotliCompress), gzip = promisify(zlib.gzip);
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|x-ndjson)|image\/svg\+xml)/;

export function encoding(req) {
  const accept = String(req?.headers['accept-encoding'] || '');
  return /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : '';
}
// Dynamic responses use a fast setting; static files are compressed once at the highest one and kept.
export function compress(buffer, kind, best = false) {
  if (kind === 'br') return brotli(buffer, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: best ? 11 : 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.length } });
  return gzip(buffer, { level: best ? 9 : 6 });
}
export async function send(req, res, status, headers, body) {
  let data = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '');
  const compressible = COMPRESSIBLE.test(headers['Content-Type'] || '');
  const kind = compressible && data.length > 1024 ? encoding(req) : '';
  if (kind) data = await compress(data, kind);
  res.writeHead(status, { ...headers, ...(compressible ? { Vary: 'Accept-Encoding' } : {}), ...(kind ? { 'Content-Encoding': kind } : {}), 'Content-Length': data.length });
  res.end(req.method === 'HEAD' ? undefined : data);
}

// A weak validator from size and modification time: cheap for large media, and stable across restarts.
export const fileTag = info => `W/"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
export function fresh(req, tag, modified) {
  const match = req.headers['if-none-match'];
  if (match) return match.split(',').map(value => value.trim()).some(value => value === tag || value === '*' || value.replace(/^W\//, '') === tag.replace(/^W\//, ''));
  const since = Date.parse(req.headers['if-modified-since'] || '');
  return Boolean(modified) && Number.isFinite(since) && Math.floor(modified / 1000) <= Math.floor(since / 1000);
}
// A Range request is honoured only while `If-Range` still names the current file, so a resumed download never mixes two versions.
export function rangeAllowed(req, tag, modified) {
  const condition = req.headers['if-range'];
  if (!condition) return true;
  if (condition.startsWith('"') || condition.startsWith('W/')) return condition.replace(/^W\//, '') === tag.replace(/^W\//, '');
  const date = Date.parse(condition);
  return Number.isFinite(date) && Math.floor(modified / 1000) <= Math.floor(date / 1000);
}

// Static files: read, hashed and compressed once per modification; answered with 304 while the browser's copy is current.
const staticCache = new Map();
export async function serveStatic(req, res, filename, type, cacheControl) {
  const info = await stat(filename);
  let entry = staticCache.get(filename);
  if (!entry || entry.mtimeMs !== info.mtimeMs || entry.size !== info.size) {
    const raw = await readFile(filename);
    entry = { mtimeMs: info.mtimeMs, size: info.size, raw, tag: `"${createHash('sha256').update(raw).digest('base64url').slice(0, 22)}"`, encoded: {} };
    staticCache.delete(filename); staticCache.set(filename, entry);
    // Film assets pass through here too; keep the most recently loaded files only.
    while (staticCache.size > 400) staticCache.delete(staticCache.keys().next().value);
  }
  const headers = { 'Content-Type': type, 'Cache-Control': cacheControl, ETag: entry.tag, 'Last-Modified': new Date(entry.mtimeMs).toUTCString() };
  const compressible = COMPRESSIBLE.test(type);
  if (compressible) headers.Vary = 'Accept-Encoding';
  if (fresh(req, entry.tag, entry.mtimeMs)) { res.writeHead(304, headers); return res.end(); }
  const kind = compressible && entry.raw.length > 1024 ? encoding(req) : '';
  let data = entry.raw;
  if (kind) { entry.encoded[kind] ||= compress(entry.raw, kind, true); data = await entry.encoded[kind]; headers['Content-Encoding'] = kind; }
  res.writeHead(200, { ...headers, 'Content-Length': data.length });
  res.end(req.method === 'HEAD' ? undefined : data);
}


// Plays a job's built HTML in the browser with HyperFrames' own <hyperframes-player> (the same runtime the renderer
// uses), without rendering and without writing anything: unlike Studio, which stamps ids into the job's HTML.
// Used by harness review and `npm run video -- play`.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'node_modules/hyperframes/dist');
export const PLAYER_SCRIPT = path.join(DIST, 'hyperframes-player.global.js');
export const RUNTIME_SCRIPT = path.join(DIST, 'hyperframe-runtime.js');
export const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf'};
// Review records, renders and agent briefs are not part of the film; nothing outside the job is served.
const HIDDEN = new Set(['review', 'renders', 'briefs', 'node_modules', '.git', '.hyperframes']);

// Text assets (the player runtime, scripts, styles) are compressed and cached by content; media is streamed with validators,
// so revisiting the film revalidates instead of downloading every asset again.
const TEXT = /^(text\/|application\/json|image\/svg\+xml)/;
export async function sendFile(req, res, file, type) {
  const info = await stat(file), {size} = info;
  if (TEXT.test(type) && size < 8 * 1024 * 1024) return serveStatic(req, res, file, type, 'no-cache');
  const tag = fileTag(info);
  const headers = {'Content-Type': type, 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes', ETag: tag, 'Last-Modified': new Date(info.mtimeMs).toUTCString()};
  if (fresh(req, tag, info.mtimeMs)) { res.writeHead(304, headers); return res.end(); }
  const range = rangeAllowed(req, tag, info.mtimeMs) ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '') : null;
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]), end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start); end = Math.min(size - 1, end);
    if (start > end) { res.writeHead(416, {'Content-Range': `bytes */${size}`}); return res.end(); }
    res.writeHead(206, {...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1});
    return req.method === 'HEAD' ? res.end() : createReadStream(file, {start, end, highWaterMark: 1024 * 1024}).pipe(res);
  }
  res.writeHead(200, {...headers, 'Content-Length': size});
  return req.method === 'HEAD' ? res.end() : createReadStream(file, {highWaterMark: 1024 * 1024}).pipe(res);
}

/** Serve `sub` (the path after the player's base URL) for one job. Returns false when the path is not the player's. */
export async function servePlayer(req, res, job, sub, {base = '/'} = {}) {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return true; }
  if (sub === 'player.js') { await sendFile(req, res, PLAYER_SCRIPT, TYPES['.js']); return true; }
  if (sub === 'runtime.js') { await sendFile(req, res, RUNTIME_SCRIPT, TYPES['.js']); return true; }
  if (sub === 'timing.json') {
    const timing = JSON.parse(await readFile(path.join(job, 'timing.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(path.join(job, 'job.json'), 'utf8'));
    const words = manifest.workflow === 'news-edit'
      ? JSON.parse(await readFile(path.join(job,'assets/news-captions.json'),'utf8'))
      : JSON.parse(await readFile(path.join(job, 'alignment.json'), 'utf8').catch(() => '{}')).words || [];
    const spoken = s => words.filter(w => w.start >= s.start - 0.01 && w.start < s.end).map(w => w.scriptText || w.text).join(' ');
    const body = JSON.stringify({duration: manifest.duration, width: manifest.width, height: manifest.height, missing: timing.missing || [],
      scenes: timing.scenes.map(s => ({id: s.id, start: s.start, end: s.end, purpose: s.purpose || '', spoken: spoken(s)}))});
    await send(req, res, 200, {'Content-Type': TYPES['.json'], 'Cache-Control': 'no-cache'}, body); return true;
  }
  if (!sub.startsWith('film/')) return false;
  const rel = decodeURIComponent(sub.slice('film/'.length).split('?')[0]) || 'index.html';
  if (rel.split('/').some(p => p === '..' || p === '') || HIDDEN.has(rel.split('/')[0])) { res.writeHead(403); res.end(); return true; }
  const root = await realpath(job);
  let file;
  try { file = await realpath(path.join(root, rel)); } catch { res.writeHead(404); res.end(); return true; }
  if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) { res.writeHead(404); res.end(); return true; }
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  if (path.extname(file) === '.html') {
    // The runtime goes first in <head>, as `hyperframes play` does.
    const html = (await readFile(file, 'utf8')).replace(/<head([^>]*)>/i, `<head$1><script src="${base}runtime.js"></script>`);
    await send(req, res, 200, {'Content-Type': type, 'Cache-Control': 'no-cache'}, html); return true;
  }
  await sendFile(req, res, file, type);
  return true;
}

// A standalone page for `npm run video -- play`: the film, its scenes, and the time to quote in a note.
export function playerPage(name, {back = ''} = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${name.replace(/[<&]/g, '')} · player</title><style>
body{box-sizing:border-box;width:100%;min-width:0;margin:0;background:#0b0d10;color:#e8e8e8;font:14px system-ui,sans-serif;padding:16px;display:grid;gap:12px;max-width:1280px;margin-inline:auto}
hyperframes-player{--ar:16/9;aspect-ratio:var(--ar);width:min(100%,calc((100dvh - 170px) * var(--arn,1.778)));max-width:100%;min-width:0;margin-inline:auto;display:block;background:#000}
#strip{display:flex;width:100%;min-width:0;height:34px;gap:2px;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;touch-action:pan-x}#strip button{flex:0 0 max(38px,calc(100% / 12));min-width:0;border:0;background:#222a33;color:#cfd6de;font:12px ui-monospace,monospace;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer;touch-action:manipulation}
#strip button.on{background:#f2c94c;color:#111}#strip button.missing{opacity:.35}#time{font:16px ui-monospace,monospace}small{color:#8a96a3}
</style><style>@supports not (height:100dvh){hyperframes-player{width:min(100%,calc((100vh - 170px) * var(--arn,1.778)))}}@media(max-width:650px){body{padding:max(8px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left));gap:10px}hyperframes-player{width:min(100%,calc((100dvh - 150px) * var(--arn,1.778)))}}</style></head><body>
${back ? `<a href="${back}" style="color:#8ab4f8">← Overview</a>` : ''}<hyperframes-player id="p" src="film/index.html" controls></hyperframes-player>
<div id="strip"></div><div id="time">0.0 s</div>
<small>Quote the time in your notes, e.g. "12.5: the bar should be red". Nothing is rendered or changed by watching.</small>
<script src="player.js"></script><script>
const p=document.getElementById('p'),strip=document.getElementById('strip'),time=document.getElementById('time');let scenes=[];
fetch('timing.json').then(r=>r.json()).then(t=>{scenes=t.scenes;if(t.width&&t.height){p.style.setProperty('--ar',t.width+'/'+t.height);p.style.setProperty('--arn',t.width/t.height);}for(const s of scenes){const b=document.createElement('button');b.textContent=s.id;b.title=s.id+' '+s.start.toFixed(1)+'–'+s.end.toFixed(1)+' s';b.style.flexGrow=Math.max(.5,s.end-s.start);if(t.missing.includes(s.id))b.className='missing';b.onclick=()=>p.seek(s.start+0.01);strip.append(b);}});
p.addEventListener('timeupdate',()=>{const t=p.currentTime||0;const s=scenes.find(x=>t>=x.start&&t<x.end);time.textContent=t.toFixed(1)+' s'+(s?' · '+s.id:'');[...strip.children].forEach((b,i)=>b.classList.toggle('on',scenes[i]===s));});
</script></body></html>`;
}

/** `npm run video -- play`: serve the player on loopback until stopped. */
export async function startPlayer(job, {port = 3004} = {}) {
  const name = path.basename(job);
  const server = http.createServer(async (req, res) => {
    try {
      const sub = new URL(req.url, 'http://x').pathname.slice(1);
      if (sub === '') { res.writeHead(200, {'Content-Type': TYPES['.html']}); res.end(playerPage(name)); return; }
      if (!await servePlayer(req, res, job, sub, {base: '/'})) { res.writeHead(404); res.end(); }
    } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(String(error.message)); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(port), '127.0.0.1', resolve); });
  return {server, url: `http://127.0.0.1:${server.address().port}/`};
}

// `npm run video -- watch --project <slug>`: one read-only page per project for Tailscale review from T3 Code.
// The overview shows where the video is, the script with its review, the thumbnails, and the delivered MP4;
// /player/ plays the built HTML with HyperFrames' own player (the same as `play`), so the person can watch the
// built film and quote the time in a note. Nothing here writes to the project or the job.
//
// The server runs detached, one per project, on a free loopback port recorded in .video/watch/<slug>.json, and stops
// by itself after a long idle spell. `watch` reuses a live one.

const IDLE_MS = 8 * 60 * 60 * 1000;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const text = file => readFile(file, 'utf8').catch(() => null);
const exists = file => stat(file).then(() => true, () => false);
const stateFile = (root, slug) => path.join(root, '.video/watch', `${slug}.json`);

function markdownish(src) { // headings, paragraphs and lists; enough to read a script or a review
  const out = [];
  let list = false;
  for (const raw of String(src || '').split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line), li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!li && list) { out.push('</ul>'); list = false; }
    if (h) out.push(`<h${Math.min(6, h[1].length + 2)}>${esc(h[2])}</h${Math.min(6, h[1].length + 2)}>`);
    else if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${esc(li[1])}</li>`); }
    else if (line.trim()) out.push(`<p>${esc(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('\n');
}

async function overview(root, slug) {
  const status = await projectStatus(root, slug), dir = projectDir(root, slug), job = projectJob(root, slug);
  const [brief, script, visuals, review] = await Promise.all(['BRIEF.md', 'SCRIPT.md', 'VISUALS.md', 'review.md'].map(n => text(path.join(dir, n))));
  const film = status.film, thumbs = status.thumbnails;
  const built = await exists(path.join(job, 'index.html')) && await exists(path.join(job, 'timing.json'));
  const delivered = film && status.project && (await text(path.join(job, 'job.json')).then(t => JSON.parse(t).status === 'complete').catch(() => false));
  const sections = [];
  sections.push(`<section><h2>Where it is</h2><p class="phase">${esc(status.phase)}</p>${status.delegation?.open ? `<p class="muted">Working: ${status.delegation.tasks.map(t => esc(t.title)).join(', ')}</p>` : ''}
${film?.steps?.length ? `<ol class="steps">${film.steps.map(s => `<li class="${esc(s.status)}"><b>${esc(s.label)}</b> <span>${esc(s.detail)}</span></li>`).join('')}</ol>` : ''}
${built ? `<p><a class="button" href="player/">▶ Watch the current build</a> <span class="muted">plays the built HTML with narration; pause and quote the time in your notes</span></p>` : ''}</section>`);
  if (delivered && await exists(path.join(job, 'renders/video.mp4')))
    sections.push(`<section><h2>Delivered film</h2><video controls preload="metadata" src="file/jobs/${esc(slug)}/renders/video.mp4"></video></section>`);
  if (thumbs?.variants?.length) {
    sections.push(`<section id="thumbnails"><h2>Thumbnails</h2><div class="thumbs">${thumbs.variants.map(v => {
      const png = `jobs/${slug}/thumbnail/variants/${v.id}/thumbnail.png`, small = `jobs/${slug}/thumbnail/variants/${v.id}/${v.previewFile}`;
      const chosen = thumbs.chosen?.variant === v.id;
      return `<figure class="${chosen ? 'chosen' : ''}"><img src="file/${esc(png)}?v=${esc(v.pngSha256 || '')}" alt="${esc(v.id)}"><figcaption><b>${esc(v.id)}</b> “${esc(v.headline)}” · ${v.review ? esc(v.review.status) : 'not reviewed'}${chosen ? ' · <b>chosen</b>' : ''}
<br><img class="feed" src="file/${esc(small)}?v=${esc(v.pngSha256 || '')}" alt="${esc(v.id)} at feed size"> <span class="muted">feed size</span>${v.review?.findings?.length ? `<br><span class="muted">${esc(v.review.findings.join(' '))}</span>` : ''}</figcaption></figure>`;
    }).join('')}</div></section>`);
  }
  if (script) {
    const s = status.script;
    sections.push(`<section><h2>Script</h2>${s ? `<p class="muted">${s.words} words · review: ${esc(s.disposition || 'not yet')}${s.stale ? ' (older than the script)' : ''}${s.human ? ` · your decision: ${esc(s.human.decision)}` : ''}</p>` : ''}<article class="script">${markdownish(script)}</article></section>`);
    if (review) sections.push(`<section><details><summary>Independent script review</summary><article>${markdownish(review)}</article></details></section>`);
    if (visuals) sections.push(`<section><details><summary>Visual plan</summary><article>${markdownish(visuals)}</article></details></section>`);
  }
  if (brief) sections.push(`<section><details${script ? '' : ' open'}><summary>Brief</summary><article>${markdownish(brief)}</article></details></section>`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(slug)} · video</title><style>
:root{color-scheme:dark}body{margin:0 auto;max-width:980px;padding:20px;background:#0b0d10;color:#e8e8e8;font:15px/1.55 system-ui,sans-serif}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:0 0 8px}section{background:#14181d;border-radius:10px;padding:16px;margin:14px 0}
.muted{color:#8a96a3}.phase{font-size:18px;color:#f2c94c;margin:0 0 8px}a{color:#8ab4f8}.button{display:inline-block;background:#f2c94c;color:#111;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:600}
.steps{padding-left:18px;margin:8px 0}.steps li{margin:2px 0}.steps li span{color:#8a96a3}.steps li.done b{color:#7bd88f}.steps li.current b,.steps li.repair b{color:#f2c94c}.steps li.blocked b{color:#ff6b6b}
.script p{margin:0 0 12px;font-size:16px}video{width:100%;border-radius:8px;background:#000}
.thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}figure{margin:0}figure img{width:100%;border-radius:6px;display:block}figure img.feed{width:160px;display:inline-block;vertical-align:middle;margin-top:6px}
figure.chosen img:first-child{outline:3px solid #f2c94c}summary{cursor:pointer;font-weight:600}
</style></head><body><h1>${esc(slug)}</h1><p class="muted">Read-only. Reply in the chat to approve or ask for changes. <a href="./">Reload</a></p>
${sections.join('\n')}</body></html>`;
}

// Files the overview may show: this project's script folder, its job's thumbnails and its delivered MP4.
async function serveFile(req, res, root, slug, rel) {
  const allowed = [`jobs/scripts/${slug}/`, `jobs/${slug}/thumbnail/`, `jobs/${slug}/renders/video.mp4`];
  if (rel.split('/').includes('..') || !allowed.some(a => a.endsWith('/') ? rel.startsWith(a) : rel === a)) { res.writeHead(403); return res.end(); }
  let file;
  try { file = await realpath(path.join(root, rel)); } catch { res.writeHead(404); return res.end(); }
  if (!file.startsWith(await realpath(root) + path.sep) || !(await stat(file)).isFile()) { res.writeHead(404); return res.end(); }
  await sendFile(req, res, file, TYPES[path.extname(file).toLowerCase()] || 'text/plain; charset=utf-8');
}

/** Run the server in this process (the detached child of `watch`). */
export async function serveWatch(root, slug, {port = 0, host = '127.0.0.1'} = {}) {
  await loadProject(root, slug);
  const job = projectJob(root, slug);
  let last = Date.now();
  const server = http.createServer(async (req, res) => {
    last = Date.now();
    try {
      const url = new URL(req.url, 'http://x'), sub = decodeURIComponent(url.pathname).slice(1);
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
      if (sub === 'health') { res.writeHead(200, {'Content-Type': 'text/plain'}); return res.end(slug); }
      if (sub === '') { res.writeHead(200, {'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache'}); return res.end(await overview(root, slug)); }
      if (sub === 'player') { res.writeHead(302, {Location: '/player/'}); return res.end(); }
      if (sub === 'player/') { res.writeHead(200, {'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache'}); return res.end(playerPage(slug, {back: '/'})); }
      if (sub.startsWith('player/')) { if (!await servePlayer(req, res, job, url.pathname.slice('/player/'.length), {base: '/player/'})) { res.writeHead(404); res.end(); } return; }
      if (sub.startsWith('file/')) return await serveFile(req, res, root, slug, sub.slice('file/'.length));
      res.writeHead(404); res.end();
    } catch (error) { if (!res.headersSent) res.writeHead(500, {'Content-Type': 'text/plain'}); res.end(String(error.message)); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(port), host, resolve); });
  const address = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${server.address().port}/`;
  await mkdir(path.dirname(stateFile(root, slug)), {recursive: true});
  await writeFile(stateFile(root, slug), JSON.stringify({pid: process.pid, port: server.address().port, url: address, startedAt: new Date().toISOString()}) + '\n');
  const idle = setInterval(() => { if (Date.now() - last > IDLE_MS) { clearInterval(idle); server.close(); process.exit(0); } }, 60000);
  idle.unref();
  return {server, url: address};
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function healthy(state, slug) {
  if (!state?.pid || !alive(state.pid)) return false;
  try { const r = await fetch(state.url + 'health', {signal: AbortSignal.timeout(2000)}); return r.ok && (await r.text()) === slug; } catch { return false; }
}

/** Start (or reuse) the project's watch server in the background and return its address. */
export async function startWatch(root, slug, {script, port = 0} = {}) {
  await loadProject(root, slug);
  const file = stateFile(root, slug);
  const current = JSON.parse(await text(file) || 'null');
  if (await healthy(current, slug)) return {url: current.url, reused: true};
  await rm(file, {force: true});
  await mkdir(path.dirname(file), {recursive: true});
  const log = await open(path.join(path.dirname(file), `${slug}.log`), 'a');
  const child = spawn(process.execPath, [script, 'watch-serve', '--project', slug, '--port', String(port)],
    {cwd: root, detached: true, stdio: ['ignore', log.fd, log.fd], env: {...process.env, VIDEO_AGENT_ROLE: ''}});
  child.unref();
  await log.close();
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 100));
    const state = JSON.parse(await text(file) || 'null');
    if (state && await healthy(state, slug)) return {url: state.url, reused: false};
    if (child.exitCode !== null) break;
  }
  throw new Error(`The watch server did not start; see .video/watch/${slug}.log`);
}

export async function stopWatch(root, slug) {
  const file = stateFile(root, slug), state = JSON.parse(await text(file) || 'null');
  if (state?.pid && alive(state.pid)) process.kill(state.pid, 'SIGTERM');
  await rm(file, {force: true});
  return Boolean(state);
}

export function watchInstructions(url,slug,reused) {
  return [`Local overview: ${url}`,`Local player: ${url}player/`,reused?'Already running.':'Started in the background.',
    process.env.VG_REVIEW_URL ? `Review: ${process.env.VG_REVIEW_URL}` : `Review: ${url}`,
    `Optional remote access: tailscale serve --bg ${url}`,
    'Share the actual review URL with the person; they reply in the harness chat.',
    `Read-only. Stop after review: npm run video -- watch --project ${slug} --stop true`].join('\n');
}
