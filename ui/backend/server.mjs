import http from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, mkdir, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Store } from './store.mjs';
import { Runner } from './runner.mjs';
import { providerNames, discoverProviders } from './providers.mjs';
import { jobFile, listFiles, inside, parseRange } from './files.mjs';
import { redact } from './events.mjs';

const staticFiles = new Map([
  ['/', ['ui/index.html', 'text/html']], ['/app.mjs', ['ui/app.mjs', 'text/javascript']],
  ['/styles.css', ['ui/styles.css', 'text/css']],
  ['/icons.mjs', ['ui/icons.mjs', 'text/javascript']],
  ...['400', '500', '600'].map(weight => [`/fonts/inter-${weight}.woff2`, [`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`, 'font/woff2']]),
  ['/fonts/mono.woff2', ['node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2', 'font/woff2']],
]);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const json = (res, status, data) => { if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail('Expected application/json', 415);
  let content = '';
  for await (const chunk of req) { content += chunk; if (content.length > 200000) throw fail('Request too large', 413); }
  try { return JSON.parse(content); } catch { throw fail('Invalid JSON'); }
}
const string = (value, max = 120) => typeof value === 'string' && value.length <= max && !value.includes('\0');
function config(input, existing) {
  if (!providerNames.includes(input.provider)) throw fail('Choose Codex, Claude, or OpenCode');
  for (const field of ['main', 'sub', 'directorModel', 'reviewerModel']) if (!string(input[field] ?? '')) throw fail(`Invalid ${field}`);
  if (typeof input.gateScript !== 'boolean' || typeof input.gatePrototype !== 'boolean') throw fail('Invalid checkpoint settings');
  if (existing && input.provider !== existing.provider && existing.agents.length) throw fail('Provider cannot change after its first agent starts. Create a new thread to use a different CLI.');
  return { provider: input.provider, main: (input.main || '').trim(), sub: (input.sub || '').trim(), directorModel: (input.directorModel || '').trim(), reviewerModel: (input.reviewerModel || '').trim(), gateScript: input.gateScript, gatePrototype: input.gatePrototype };
}
function summary(job) { const { messages, events, ...rest } = job; return { ...rest, messageCount: messages.length, eventCount: events.length }; }

export async function createApp({ root, directory = path.join(root, '.video/ui'), runnerFactory } = {}) {
  let defaults = {};
  try { const source = JSON.parse(await readFile(path.join(root, 'video.config.json'), 'utf8')); defaults = { defaultFormat: source.format === 'vertical' ? 'vertical' : 'landscape', defaultDuration: Number.isInteger(source.length) && source.length > 0 ? source.length : 180 }; } catch {}
  const store = new Store(directory, defaults);
  const runner = runnerFactory ? runnerFactory({ root, store }) : new Runner({ root, store });
  const clients = new Set();
  let providerCache = null;
  const getProviders = refresh => { if (!providerCache || refresh) providerCache = discoverProviders(root); return providerCache; };
  const unsubscribe = store.subscribe(id => { for (const client of clients) client.write(`event: change\ndata: ${JSON.stringify({ id })}\n\n`); });
  async function validateInput(filename, audio) {
    if (!filename) return '';
    if (!string(filename, 1000) || path.isAbsolute(filename)) throw fail('Input paths must be relative to the repository');
    const extensions = audio ? ['.wav', '.mp3', '.m4a', '.ogg', '.flac', '.webm', '.mp4', '.aac'] : ['.md', '.txt'];
    if (!extensions.includes(path.extname(filename).toLowerCase())) throw fail(audio ? 'Unsupported recording format' : 'Script must be Markdown or text');
    const actual = await realpath(path.join(root, filename));
    if (!inside(await realpath(root), actual)) throw fail('Input file leaves the repository', 403);
    if (!(await stat(actual)).isFile()) throw fail('Input is not a file');
    return path.relative(root, actual).split(path.sep).join('/');
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const host = req.headers.host;
      if (!host || !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) throw fail('Local requests only', 403);
      const url = new URL(req.url, `http://${host}`);
      if (req.headers.origin && req.headers.origin !== url.origin) throw fail('Cross-origin requests are not allowed', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw fail('Cross-site requests are not allowed', 403);
      if (url.pathname === '/api/internal/tool' && req.method === 'POST') {
        const input = await body(req);
        const token = req.headers.authorization?.replace(/^Bearer /, '') || '';
        if (!runner.authorize(token, input.thread, input.agentId)) throw fail('Invalid runner credential', 403);
        return json(res, 200, await runner.tool(store.get(input.thread), input.agentId, input.name, input.arguments || {}));
      }
      if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-video-client'] !== '1') throw fail('Missing local client header', 403);
      if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, workspace: path.basename(root), concurrency: store.settings().concurrency });
      if (url.pathname === '/api/providers' && req.method === 'GET') return json(res, 200, await getProviders(url.searchParams.get('refresh') === '1'));
      if (url.pathname === '/api/usage' && req.method === 'GET') return json(res, 200, await runner.usage.snapshot(store.all(), url.searchParams.get('refresh') === '1'));
      if (url.pathname === '/api/settings') {
        if (req.method === 'GET') return json(res, 200, store.settings());
        if (req.method === 'PATCH') {
          const input = { ...store.settings(), ...await body(req) };
          if (!Number.isInteger(input.concurrency) || input.concurrency < 1 || input.concurrency > 3) throw fail('Choose 1–3 simultaneous jobs');
          if (!['landscape', 'vertical'].includes(input.defaultFormat)) throw fail('Choose landscape or portrait');
          if (!Number.isInteger(input.defaultDuration) || input.defaultDuration < 10 || input.defaultDuration > 3600) throw fail('Default target must be 10–3600 seconds');
          store.saveSettings({ concurrency: input.concurrency, defaultFormat: input.defaultFormat, defaultDuration: input.defaultDuration }); runner.pump(); return json(res, 200, store.settings());
        }
      }
      if (url.pathname === '/api/stream' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('event: connected\ndata: {}\n\n'); clients.add(res);
        const timer = setInterval(() => res.write(': heartbeat\n\n'), 20000);
        req.on('close', () => { clearInterval(timer); clients.delete(res); }); return;
      }
      if (url.pathname === '/api/uploads' && req.method === 'POST') {
        const filename = (url.searchParams.get('name') || '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-150);
        if (!/\.(md|txt|wav|mp3|m4a|ogg|flac|webm|mp4|aac)$/i.test(filename)) throw fail('Choose a script or recording');
        const relative = `.video/ui/uploads/${randomUUID()}/${filename}`;
        await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
        let size = 0;
        const limit = new Transform({ transform(chunk, encoding, callback) { size += chunk.length; callback(size > 250 * 1024 * 1024 ? fail('Uploads are limited to 250 MB', 413) : null, chunk); } });
        await pipeline(req, limit, createWriteStream(path.join(root, relative), { flags: 'wx', mode: 0o600 }));
        return json(res, 201, { path: relative, size, name: filename });
      }
      if (url.pathname === '/api/jobs') {
        if (req.method === 'GET') return json(res, 200, store.all().map(summary));
        if (req.method === 'POST') {
          const input = await body(req);
          if (!string(input.prompt, 20000) || !input.prompt.trim()) throw fail('Describe the video you want');
          if (!['landscape', 'vertical'].includes(input.format)) throw fail('Choose landscape or vertical');
          if (!Number.isInteger(input.duration) || input.duration < 10 || input.duration > 3600) throw fail('Target duration must be 10–3600 seconds');
          const title = string(input.title, 150) && input.title.trim() ? input.title.trim() : input.prompt.replace(/\s+/g, ' ').trim().slice(0, 65);
          return json(res, 201, await runner.create({ ...config(input), title, prompt: input.prompt.trim(), duration: input.duration, format: input.format, audioPath: await validateInput(input.audioPath, true), inputScript: await validateInput(input.inputScript, false) }));
        }
      }
      const match = /^\/api\/jobs\/([a-f0-9-]+)(?:\/(file|files|artifact|messages|control|log))?$/.exec(url.pathname);
      if (match) {
        const job = store.get(match[1]); const operation = match[2];
        if (!operation && req.method === 'GET') return json(res, 200, job);
        if (!operation && req.method === 'PATCH') { Object.assign(job, config(await body(req), job)); store.event(job, { type: 'configuration', text: 'Model routing and checkpoint preferences updated', source: 'user' }); return json(res, 200, job); }
        if (operation === 'files' && req.method === 'GET') return json(res, 200, await listFiles(root, job));
        if (operation === 'messages' && req.method === 'POST') {
          const input = await body(req);
          if (!string(input.text, 20000) || !input.text.trim()) throw fail('Message is empty or too long');
          store.message(job, 'You', input.text.trim());
          store.event(job, { type: 'feedback', text: 'Feedback saved for the agent’s next feedback poll', source: 'user' }); return json(res, 201, job);
        }
        if (operation === 'control' && req.method === 'POST') { const input = await body(req); if (input.feedback !== undefined && !string(input.feedback, 20000)) throw fail('Feedback too long'); return json(res, 200, await runner.control(job, input.action, input)); }
        if (operation === 'log' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Content-Disposition': `attachment; filename="${job.slug}-events.jsonl"` });
          const stream = createReadStream(path.join(directory, `${job.id}.events.jsonl`)); stream.on('error', () => res.end()); stream.pipe(res); return;
        }
        if ((operation === 'file' || operation === 'artifact') && ['GET', 'HEAD'].includes(req.method)) {
          const file = await jobFile(root, job, url.searchParams.get('path'));
          if (operation === 'file') {
            if (file.info.size > 2 * 1024 * 1024) throw fail('File too large for the text inspector. Download it instead.', 413);
            if (!/^text\/|application\/json/.test(file.type)) throw fail('Use the media preview for this artifact');
            return json(res, 200, { path: url.searchParams.get('path'), text: await readFile(file.path, 'utf8') });
          }
          const range = parseRange(req.headers.range, file.info.size);
          const headers = { 'Content-Type': file.type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Length': range ? range.end - range.start + 1 : file.info.size, 'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(path.basename(file.path))}` };
          if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${file.info.size}`;
          res.writeHead(range ? 206 : 200, headers);
          if (req.method === 'HEAD') return res.end();
          const stream = createReadStream(file.path, range || {}); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); return;
        }
      }
      const file = staticFiles.get(url.pathname);
      if (file && ['GET', 'HEAD'].includes(req.method)) { const bytes = await readFile(path.join(root, file[0])); res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' }); return res.end(req.method === 'HEAD' ? undefined : bytes); }
      throw fail('Not found', 404);
    } catch (error) { if (!res.headersSent) json(res, error.status || (error.code === 'ENOENT' ? 404 : 500), { error: redact(error.message) }); else res.end(); }
  });
  server.requestTimeout = 0;
  return { server, store, runner, async start(port = 4310) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); const url = `http://127.0.0.1:${server.address().port}`; await runner.initialize(url); return url; }, async close() { unsubscribe(); await runner.shutdown(); for (const client of clients) client.end(); await new Promise(resolve => server.close(resolve)); } };
}
