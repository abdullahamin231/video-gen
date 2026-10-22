import http from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, mkdir, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { Transform } from 'node:stream';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Store, summary } from './store.mjs';
import { Runner } from './runner.mjs';
import { providerNames, discoverProviders } from './providers.mjs';
import { jobFile, listFiles, inside, parseRange } from './files.mjs';
import { redact } from './events.mjs';
import { DELEGATE_ROLES } from '../shared/routing.mjs';
import { durationFromPrompt } from '../shared/duration.mjs';
import { findIdeas, loadIdeas, setIdeaStatus, loadProfile, newestFirst, STATUSES } from '../../lib/ideas.mjs';
import { servePlayer, playerPage } from '../../lib/player.mjs';
import { createAccess, isLoopback } from './access.mjs';
import { TTS_PROVIDERS } from '../../lib/tts.mjs';
import { send, serveStatic, fileTag, fresh, rangeAllowed, jobDelta } from './http.mjs';

// The film plays from its built HTML inside the player's own frame: the kit's inline scripts need a looser policy
// than the workspace page, and only this server may embed it.
const PLAYER_POLICY = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";

const staticFiles = new Map([
  ['/', ['ui/index.html', 'text/html']], ['/app.mjs', ['ui/app.mjs', 'text/javascript']],
  ['/styles.css', ['ui/styles.css', 'text/css']],
  ['/icons.mjs', ['ui/icons.mjs', 'text/javascript']],
  ['/shared/routing.mjs', ['ui/shared/routing.mjs', 'text/javascript']],
  ['/shared/duration.mjs', ['ui/shared/duration.mjs', 'text/javascript']],
  ['/shared/delta.mjs', ['ui/shared/delta.mjs', 'text/javascript']],
  ...['400', '500', '600'].map(weight => [`/fonts/inter-${weight}.woff2`, [`node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2`, 'font/woff2']]),
  ['/fonts/mono.woff2', ['node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2', 'font/woff2']],
]);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const json = (res, status, data) => res.headersSent ? res.end() : send(res.req, res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, JSON.stringify(data)).catch(() => res.destroy());
// The browser gets a short preview of each tool output; the full text is one click away (`/events/:id`).
const BROWSER_PREVIEW = 400;
const browserEvent = item => typeof item.output !== 'string' || item.output.length <= BROWSER_PREVIEW ? item
  : { ...item, output: item.output.slice(0, BROWSER_PREVIEW), outputSize: item.outputSize ?? item.output.length, truncated: true };
// What the thread view shows; sub-agent messages and tool events are fetched when their agent or the activity log is opened.
const threadMessage = (job, m) => m.role === 'You' || m.agentId === job.orchestratorId || m.role === 'orchestrator' || m.role === 'narration';
const threadEvent = (job, e) => ['lifecycle', 'pipeline', 'checkpoint', 'delivery'].includes(e.type) || (e.type === 'progress' && e.agentId === job.orchestratorId) || (e.type === 'agent' && e.role !== 'orchestrator') || (e.type === 'error' && e.source === 'runner');
const THREAD_MESSAGES = 150, ACTIVITY_PAGE = 250;
// The agent's final answer, last message and prompt are large and are read only in its drawer.
const slimAgent = ({ result, lastMessage, promptPreview, ...agent }) => agent;
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail('Expected application/json', 415);
  let content = '';
  for await (const chunk of req) { content += chunk; if (content.length > 200000) throw fail('Request too large', 413); }
  try { return JSON.parse(content); } catch { throw fail('Invalid JSON'); }
}
const string = (value, max = 120) => typeof value === 'string' && value.length <= max && !value.includes('\0');
function config(input, existing) {
  const ttsProvider = input.ttsProvider ?? existing?.ttsProvider ?? 'kokoro';
  if (!TTS_PROVIDERS.includes(ttsProvider)) throw fail('Choose Kokoro or Gemini for narration');
  if (existing && ttsProvider !== (existing.ttsProvider || 'kokoro') && existing.agents.length)
    throw fail('Narration provider cannot change after production starts. Choose it when creating a new video.');
  if (!providerNames.includes(input.provider)) throw fail('Choose Codex, Claude, OpenCode, or Pi');
  if (!string(input.main ?? '')) throw fail('Invalid main model');
  const models = input.models ?? {};
  if (!models || typeof models !== 'object' || Array.isArray(models)) throw fail('Invalid role models');
  for (const [role, model] of Object.entries(models)) {
    if (!DELEGATE_ROLES.includes(role)) throw fail(`Unknown role ${role}`);
    if (!string(model)) throw fail(`Invalid model for ${role}`);
  }
  if (typeof input.gateScript !== 'boolean' || typeof input.gatePrototype !== 'boolean' || !['boolean', 'undefined'].includes(typeof input.gateFinal) || !['boolean', 'undefined'].includes(typeof input.gateThumbnail)) throw fail('Invalid checkpoint settings');
  if (input.thumbnails !== undefined && (!Number.isInteger(input.thumbnails) || input.thumbnails < 1 || input.thumbnails > 6)) throw fail('Choose 1–6 thumbnails');
  if (existing && input.provider !== existing.provider && existing.agents.length) throw fail('Provider cannot change after its first agent starts. Create a new thread to use a different CLI.');
  return { ttsProvider, provider: input.provider, main: (input.main || '').trim(), models: Object.fromEntries(DELEGATE_ROLES.map(role => [role, (models[role] || '').trim()])), gateScript: input.gateScript, gatePrototype: input.gatePrototype, gateFinal: Boolean(input.gateFinal),
    gateThumbnail: input.gateThumbnail ?? existing?.gateThumbnail ?? true, thumbnails: input.thumbnails ?? existing?.thumbnails };
}

export async function createApp({ root, directory = path.join(root, '.video/ui'), runnerFactory, ideaOptions = {}, ideasRoot = root, password } = {}) {
  // Without a password the workspace answers loopback only; with one it may listen on the network behind a login.
  const access = createAccess(password);
  // The film runs sandboxed, so its requests carry no session cookie; a per-thread key in the URL admits them instead.
  // Keys change on restart, and every thread summary the signed-in client receives carries the current one.
  const playerSecret = randomBytes(32);
  const playerKey = id => createHmac('sha256', playerSecret).update(id).digest('hex').slice(0, 32);
  // Every broadcast of a thread raises its revision; a client applies a delta only on top of the revision it was made from.
  const snapshots = new Map(), revs = new Map();
  const shape = job => { const base = summary(job); return { ...base, agents: base.agents.map(slimAgent), firstMessageId: job.messages[0]?.id || '', playerKey: playerKey(job.id) }; };
  const clone = value => JSON.parse(JSON.stringify(value));
  // Before answering with a thread, broadcast anything pending, so the answer and its revision match what later deltas build on.
  const settle = (...jobs) => { if (flushTimer) flush(); for (const job of jobs) if (!snapshots.has(job.id)) snapshots.set(job.id, clone(shape(job))); };
  const view = job => { settle(job); return { ...shape(job), rev: revs.get(job.id) || 0 }; };
  // The sidebar needs titles and states, not agents or pipeline checks.
  const card = job => { const { agents, pipeline, ...rest } = view(job); return rest; };
  const detail = (store, job) => {
    // Only what the thread shows. The Activity log (every tool call) is fetched when its tab is opened.
    const messages = job.messages.filter(m => threadMessage(job, m)), recent = store.events(job.id);
    return { ...view(job), messages: messages.slice(-THREAD_MESSAGES), messagesMore: messages.length > THREAD_MESSAGES,
      events: recent.filter(event => threadEvent(job, event)).map(browserEvent), eventsFrom: recent[0]?.seq ?? 1 };
  };
  let defaults = {};
  try { const source = JSON.parse(await readFile(path.join(root, 'video.config.json'), 'utf8')); defaults = { defaultFormat: source.format === 'vertical' ? 'vertical' : 'landscape', defaultThumbnails: Number.isInteger(source.thumbnails) ? source.thumbnails : 3 }; } catch {}
  const store = new Store(directory, defaults);
  const runner = runnerFactory ? runnerFactory({ root, store }) : new Runner({ root, store });
  const clients = new Set();
  let providerCache = null;
  const getProviders = refresh => { if (!providerCache || refresh) providerCache = discoverProviders(root); return providerCache; };

  // Changes are batched and pushed as deltas: new events, new or updated messages, and only the changed fields of each thread.
  // Recent batches are kept so a client that reconnects with Last-Event-ID receives what it missed instead of reloading everything.
  const pending = { jobs: new Set(), events: [], messages: [], removed: [] };
  const boot = randomBytes(4).toString('hex'), history = [];
  let flushTimer = null, streamSeq = 0, historyBytes = 0;
  const flush = () => {
    clearTimeout(flushTimer); flushTimer = null;
    const jobs = [];
    for (const id of pending.jobs) {
      const job = store.jobs.get(id); if (!job) continue;
      const next = clone(shape(job)), previous = snapshots.get(id);
      const delta = previous ? jobDelta(previous, next) : { full: next };
      if (!delta) continue;
      const rev = (revs.get(id) || 0) + 1; revs.set(id, rev); snapshots.set(id, next);
      jobs.push(delta.full ? { id, rev, full: { ...next, rev } } : { id, base: rev - 1, rev, ...delta });
    }
    for (const id of pending.removed) { snapshots.delete(id); revs.delete(id); }
    const payload = { jobs, events: pending.events.map(browserEvent), messages: pending.messages, removed: pending.removed };
    pending.jobs.clear(); pending.events = []; pending.messages = []; pending.removed = [];
    if (!payload.jobs.length && !payload.events.length && !payload.messages.length && !payload.removed.length) return;
    streamSeq++;
    const data = `id: ${boot}-${streamSeq}\nevent: update\ndata: ${JSON.stringify(payload)}\n\n`;
    history.push({ seq: streamSeq, data }); historyBytes += data.length;
    while (history.length > 1 && (historyBytes > 8 * 1024 * 1024 || history.length > 3000)) historyBytes -= history.shift().data.length;
    for (const client of clients) client.write(data);
  };
  const unsubscribe = store.subscribe((type, id, payload) => {
    if (type === 'removed') pending.removed.push(id);
    else {
      pending.jobs.add(id);
      if (type === 'event') pending.events.push({ ...payload, jobId: id });
      if (type === 'message') pending.messages.push({ ...payload, jobId: id });
    }
    flushTimer ||= setTimeout(flush, 200);
  });

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
  // Idea searches hit public feeds for a few seconds; only one runs at a time.
  let ideaRun = null;
  const ideasState = async () => { const data = await loadIdeas(ideasRoot), profile = await loadProfile(ideasRoot); return { niche: profile.niche, cards: newestFirst(data.cards), lastRun: data.runs?.at(-1) || null, running: Boolean(ideaRun) }; };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // `no-referrer` would make browsers send `Origin: null` on the login form post, which the origin check refuses.
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const host = req.headers.host;
      if (!host || (!access && !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host))) throw fail('Local requests only', 403);
      const url = new URL(req.url, `http://${host}`);
      const player = /^\/api\/jobs\/([a-f0-9-]+)\/player\/([a-f0-9]{32})\/(.*)$/.exec(url.pathname);
      const playerAllowed = Boolean(player && ['GET', 'HEAD'].includes(req.method) && timingSafeEqual(Buffer.from(player[2]), Buffer.from(playerKey(player[1]))));
      // Behind an HTTPS proxy the origin's scheme differs from ours, so compare hosts.
      let originHost = null; try { originHost = req.headers.origin && new URL(req.headers.origin).host; } catch { originHost = '?'; }
      // The sandboxed film's own requests come from an opaque origin (`null`); its key admits them, read-only.
      if (!playerAllowed && originHost && originHost !== host && originHost !== req.headers['x-forwarded-host']) throw fail('Cross-origin requests are not allowed', 403);
      if (!playerAllowed && req.headers['sec-fetch-site'] === 'cross-site') throw fail('Cross-site requests are not allowed', 403);
      if (access && url.pathname === '/login') return req.method === 'POST' ? await access.login(req, res) : access.authenticated(req) ? (res.writeHead(303, { Location: '/' }), res.end()) : access.page(res);
      if (access && url.pathname === '/logout') return access.logout(req, res);
      if (url.pathname === '/api/internal/tool' && req.method === 'POST') {
        const input = await body(req);
        const token = req.headers.authorization?.replace(/^Bearer /, '') || '';
        if (!runner.authorize(token, input.thread, input.agentId)) throw fail('Invalid runner credential', 403);
        return json(res, 200, await runner.tool(store.get(input.thread), input.agentId, input.name, input.arguments || {}));
      }
      if (access && !playerAllowed && !access.authenticated(req)) {
        if (url.pathname.startsWith('/api/')) throw fail('Sign in first', 401);
        res.writeHead(303, { Location: '/login' }); return res.end();
      }
      if (url.pathname === '/api/session' && req.method === 'GET') return json(res, 200, { remote: Boolean(access) });
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
          store.saveSettings({ concurrency: input.concurrency, defaultFormat: input.defaultFormat }); runner.pump(); return json(res, 200, store.settings());
        }
      }
      if (url.pathname === '/api/ideas' && req.method === 'GET') return json(res, 200, await ideasState());
      if (url.pathname === '/api/ideas' && req.method === 'POST') {
        const input = await body(req);
        if (input.focus !== undefined && !string(input.focus, 200)) throw fail('Keep the request under 200 characters');
        if (ideaRun) throw fail('Already looking for ideas. Wait for that search to finish.', 409);
        ideaRun = findIdeas(ideasRoot, { ...ideaOptions, focus: input.focus || '', refresh: input.refresh === true });
        try { const result = await ideaRun; ideaRun = null; return json(res, 201, { ...await ideasState(), found: result.cards.map(c => c.id) }); }
        finally { ideaRun = null; }
      }
      const ideaMatch = /^\/api\/ideas\/([a-f0-9]{8})$/.exec(url.pathname);
      if (ideaMatch && req.method === 'PATCH') {
        const input = await body(req);
        if (!STATUSES.includes(input.status)) throw fail('Unknown status');
        if (input.reason !== undefined && !string(input.reason, 300)) throw fail('Reason too long');
        try { return json(res, 200, await setIdeaStatus(ideasRoot, ideaMatch[1], input.status, input.reason || '')); }
        catch (error) { throw fail(error.message, 404); }
      }
      if (url.pathname === '/api/stream' && req.method === 'GET') {
        // The stream is gzip-compressed with one shared dictionary; each batch is sync-flushed so it arrives at once.
        const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...(gzip ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) });
        let out = res;
        if (gzip) { out = zlib.createGzip({ level: 6 }); out.on('error', () => {}); out.pipe(res); }
        const client = { write: data => { if (out.destroyed || res.destroyed) return; out.write(data); if (out !== res) out.flush(zlib.constants.Z_SYNC_FLUSH); }, end: () => out.end() };
        const last = /^([a-f0-9]+)-(\d+)$/.exec(req.headers['last-event-id'] || '');
        const lastSeq = last && last[1] === boot ? Number(last[2]) : -1;
        const resumed = lastSeq >= 0 && lastSeq <= streamSeq && (lastSeq === streamSeq || (history.length > 0 && history[0].seq <= lastSeq + 1));
        client.write(`id: ${boot}-${resumed ? lastSeq : streamSeq}\nevent: connected\ndata: ${JSON.stringify({ resumed })}\n\n`);
        if (resumed) for (const item of history) if (item.seq > lastSeq) client.write(item.data);
        clients.add(client);
        const timer = setInterval(() => client.write(': heartbeat\n\n'), 20000);
        req.on('close', () => { clearInterval(timer); clients.delete(client); if (out !== res) out.destroy(); }); return;
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
        if (req.method === 'GET') { settle(...store.all()); return json(res, 200, store.all().map(card)); }
        if (req.method === 'POST') {
          const input = await body(req);
          if (!string(input.prompt, 20000) || !input.prompt.trim()) throw fail('Describe the video you want');
          if (!['landscape', 'vertical'].includes(input.format)) throw fail('Choose landscape or vertical');
          // A length named in the prompt is the target; with none, the agent chooses one that fits the topic.
          const target = durationFromPrompt(input.prompt);
          if (target.error) throw fail(target.error);
          const title = string(input.title, 150) && input.title.trim() ? input.title.trim() : input.prompt.replace(/\s+/g, ' ').trim().slice(0, 65);
          const job = await runner.create({ ...config(input), title, prompt: input.prompt.trim(), duration: target.seconds, format: input.format, audioPath: await validateInput(input.audioPath, true), inputScript: await validateInput(input.inputScript, false) });
          return json(res, 201, detail(store, job));
        }
      }
      if (player && !playerAllowed) throw fail('Not found', 404);
      if (playerAllowed) {
        const job = store.get(player[1]), base = `/api/jobs/${job.id}/player/${player[2]}/`;
        // A sandboxed document fetches its own assets cross-origin; the key is what guards them.
        if (player[3].startsWith('film/')) res.setHeader('Access-Control-Allow-Origin', '*');
        // The film's HTML is written by agents that read the web, so it runs in an opaque origin: it cannot read
        // the workspace page, its cookie, or call this API as the signed-in person.
        res.setHeader('Content-Security-Policy', player[3].startsWith('film/') ? `${PLAYER_POLICY}; sandbox allow-scripts` : PLAYER_POLICY);
        if (!player[3]) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(playerPage(job.title || job.slug)); }
        if (await servePlayer(req, res, path.join(root, job.jobPath), player[3], { base })) return;
        throw fail('Not found', 404);
      }
      const match = /^\/api\/jobs\/([a-f0-9-]+)(?:\/(file|files|artifact|messages|control|log|events|agents)(?:\/([a-f0-9-]+))?)?$/.exec(url.pathname);
      if (match) {
        const job = store.get(match[1]); const operation = match[2];
        if (!operation && req.method === 'GET') return json(res, 200, detail(store, job));
        if (!operation && req.method === 'PATCH') { Object.assign(job, config(await body(req), job)); await runner.syncHumanReview?.(job); for (const legacy of ['sub', 'directorModel', 'reviewerModel']) delete job[legacy]; store.event(job, { type: 'configuration', text: 'Model routing and checkpoint preferences updated', source: 'user' }); store.save(job); return json(res, 200, detail(store, job)); }
        if (!operation && req.method === 'DELETE') { await runner.remove(job); return json(res, 200, { removed: job.id }); }
        if (operation === 'files' && req.method === 'GET') return json(res, 200, await listFiles(root, job));
        if (operation === 'events' && req.method === 'GET') {
          if (match[3]) { const event = await store.fullEvent(job.id, match[3]); if (!event) throw fail('Event not found', 404); return json(res, 200, event); }
          const before = Number(url.searchParams.get('before')) || Infinity, limit = Math.min(500, Number(url.searchParams.get('limit')) || 200);
          return json(res, 200, (await store.page(job.id, { before, limit, agentId: url.searchParams.get('agent') || '' })).map(browserEvent));
        }
        // Older thread messages, or one agent's messages for its drawer.
        if (operation === 'messages' && req.method === 'GET') {
          const agentId = url.searchParams.get('agent') || '', before = url.searchParams.get('before') || '', limit = Math.min(500, Number(url.searchParams.get('limit')) || 100);
          let list = agentId ? job.messages.filter(m => m.agentId === agentId) : job.messages.filter(m => threadMessage(job, m));
          if (before) { const index = list.findIndex(m => m.id === before); if (index >= 0) list = list.slice(0, index); }
          return json(res, 200, list.slice(-limit));
        }
        if (operation === 'agents' && match[3] && req.method === 'GET') {
          const agent = job.agents.find(item => item.id === match[3]); if (!agent) throw fail('Agent not found', 404);
          const { usageLedger, costLedger, claudeRunTotals, ...rest } = agent; return json(res, 200, rest);
        }
        if (operation === 'messages' && req.method === 'POST') {
          const input = await body(req);
          if (!string(input.text, 20000) || !input.text.trim()) throw fail('Message is empty or too long');
          store.message(job, 'You', input.text.trim());
          store.event(job, { type: 'feedback', text: 'Your message is queued for the orchestrator’s next feedback check', source: 'user' }); return json(res, 201, { ok: true });
        }
        if (operation === 'control' && req.method === 'POST') {
          const input = await body(req);
          for (const field of ['feedback', 'answer']) if (input[field] !== undefined && !string(input[field], 20000)) throw fail('Text too long');
          return json(res, 200, view(await runner.control(job, input.action, input)));
        }
        if (operation === 'log' && req.method === 'GET') {
          const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Content-Disposition': `attachment; filename="${job.slug}-events.jsonl"`, Vary: 'Accept-Encoding', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) });
          const stream = createReadStream(store.logPath(job.id)); stream.on('error', () => res.end());
          if (gzip) { const zip = zlib.createGzip({ level: 6 }); zip.on('error', () => res.destroy()); res.on('close', () => { stream.destroy(); zip.destroy(); }); stream.pipe(zip).pipe(res); } else stream.pipe(res);
          return;
        }
        if ((operation === 'file' || operation === 'artifact') && ['GET', 'HEAD'].includes(req.method)) {
          const file = await jobFile(root, job, url.searchParams.get('path'));
          if (operation === 'file') {
            if (file.info.size > 2 * 1024 * 1024) throw fail('File too large for the text inspector. Download it instead.', 413);
            if (!/^text\/|application\/json/.test(file.type)) throw fail('Use the media preview for this artifact');
            return json(res, 200, { path: url.searchParams.get('path'), text: await readFile(file.path, 'utf8') });
          }
          // Artifacts are agent-written (an SVG can carry script); opened on their own they render inert.
          res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");
          // Validators let the browser reuse its copy (a re-rendered page does not fetch the video again) and resume a broken download.
          const tag = fileTag(file.info), modified = file.info.mtimeMs;
          const validators = { 'Cache-Control': 'private, no-cache', ETag: tag, 'Last-Modified': new Date(modified).toUTCString(), 'Accept-Ranges': 'bytes' };
          if (fresh(req, tag, modified)) { res.writeHead(304, validators); return res.end(); }
          const range = rangeAllowed(req, tag, modified) ? parseRange(req.headers.range, file.info.size) : null;
          const headers = { 'Content-Type': file.type, ...validators, 'Content-Length': range ? range.end - range.start + 1 : file.info.size, 'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(path.basename(file.path))}` };
          if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${file.info.size}`;
          res.writeHead(range ? 206 : 200, headers);
          if (req.method === 'HEAD') return res.end();
          const stream = createReadStream(file.path, { ...(range || {}), highWaterMark: 1024 * 1024 }); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); return;
        }
      }
      const file = staticFiles.get(url.pathname);
      // Fonts never change under a name; the app's own files are revalidated (a 304 costs one round trip, no body).
      if (file && ['GET', 'HEAD'].includes(req.method)) return await serveStatic(req, res, path.join(root, file[0]), file[1], file[0].startsWith('node_modules/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      throw fail('Not found', 404);
    } catch (error) { if (!res.headersSent) json(res, error.status || (error.code === 'ENOENT' ? 404 : 500), { error: redact(error.message) }); else res.end(); }
  });
  server.requestTimeout = 0;
  return { server, store, runner, async start(port = 4310, host = '127.0.0.1') {
    if (!isLoopback(host) && !access) throw new Error(`Set VG_UI_PASSWORD (12+ characters) before listening on ${host}: anyone who reaches the workspace can run agents on this machine.`);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    // Agents call back over loopback unless the server listens on one specific address.
    const callback = ['0.0.0.0', '::', 'localhost'].includes(host) ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;
    const url = `http://${callback}:${server.address().port}`; await runner.initialize(url); return url; }, async close() { unsubscribe(); clearTimeout(flushTimer); await runner.shutdown(); for (const client of clients) client.end(); await new Promise(resolve => server.close(resolve)); } };
}
