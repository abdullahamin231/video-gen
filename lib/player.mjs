// Plays a job's built HTML in the browser with HyperFrames' own <hyperframes-player> (the same runtime the renderer
// uses), without rendering and without writing anything: unlike Studio, which stamps ids into the job's HTML.
// Shared by `npm run video -- play` and the job UI.
import {createReadStream} from 'node:fs';
import {readFile, realpath, stat} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {send, serveStatic, fileTag, fresh, rangeAllowed} from '../ui/backend/http.mjs';

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
    const words = JSON.parse(await readFile(path.join(job, 'alignment.json'), 'utf8').catch(() => '{}')).words || [];
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name.replace(/[<&]/g, '')} · player</title><style>
body{margin:0;background:#0b0d10;color:#e8e8e8;font:14px system-ui,sans-serif;padding:16px;display:grid;gap:12px;max-width:1280px;margin-inline:auto}
hyperframes-player{--ar:16/9;aspect-ratio:var(--ar);width:min(100%,calc((100vh - 170px) * var(--arn,1.778)));min-width:min(100%,240px);margin-inline:auto;display:block;background:#000}
#strip{display:flex;height:34px;gap:2px}#strip button{flex:1;min-width:0;border:0;background:#222a33;color:#cfd6de;font:12px ui-monospace,monospace;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer}
#strip button.on{background:#f2c94c;color:#111}#strip button.missing{opacity:.35}#time{font:16px ui-monospace,monospace}small{color:#8a96a3}
</style></head><body>
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
