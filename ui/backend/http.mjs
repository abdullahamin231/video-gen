import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

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

// Live updates send only what changed since the previous broadcast.
// A patch lists changed keys with their new values; nested plain objects are patched recursively and removed keys are named in `$unset`.
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function diff(before, after) {
  const out = {}; let changed = false;
  for (const key of Object.keys(after)) {
    const a = before[key], b = after[key];
    if (a === b) continue;
    if (plain(a) && plain(b)) { const nested = diff(a, b); if (nested) { out[key] = nested; changed = true; } }
    else if (JSON.stringify(a) !== JSON.stringify(b)) { out[key] = b; changed = true; }
  }
  const gone = Object.keys(before).filter(key => !(key in after));
  if (gone.length) { out.$unset = gone; changed = true; }
  return changed ? out : null;
}
// Agents are patched by id; the id order is sent only when it changed.
export function jobDelta(before, after) {
  const { agents: oldAgents = [], ...oldRest } = before, { agents: newAgents = [], ...newRest } = after;
  const delta = {};
  const patch = diff(oldRest, newRest); if (patch) delta.patch = patch;
  const previous = new Map(oldAgents.map(agent => [agent.id, agent])), agents = {};
  let agentChanges = false;
  for (const agent of newAgents) {
    const old = previous.get(agent.id);
    const change = old ? diff(old, agent) : agent;
    if (change) { agents[agent.id] = old ? change : { $full: agent }; agentChanges = true; }
  }
  if (agentChanges) delta.agents = agents;
  if (oldAgents.length !== newAgents.length || oldAgents.some((agent, index) => agent.id !== newAgents[index].id)) delta.agentIds = newAgents.map(agent => agent.id);
  return delta.patch || delta.agents || delta.agentIds ? delta : null;
}
