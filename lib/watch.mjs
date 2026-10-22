// `npm run video -- watch --project <slug>`: one read-only page per project for Tailscale review from T3 Code.
// The overview shows where the video is, the script with its review, the thumbnails, and the delivered MP4;
// /player/ plays the built HTML with HyperFrames' own player (the same as `play`), so the person can watch the
// prototype or final film and quote the time in a note. Nothing here writes to the project or the job.
//
// The server runs detached, one per project, on a free loopback port recorded in .video/watch/<slug>.json, and stops
// by itself after a long idle spell. `watch` reuses a live one.
import http from 'node:http';
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir, realpath, stat, rm, open} from 'node:fs/promises';
import path from 'node:path';
import {servePlayer, playerPage, sendFile, TYPES} from './player.mjs';
import {projectStatus, projectDir, projectJob, loadProject} from './project.mjs';

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
      const png = `jobs/${slug}/thumbnail/variants/${v.id}/thumbnail.png`, small = `jobs/${slug}/thumbnail/variants/${v.id}/preview-320x180.png`;
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
