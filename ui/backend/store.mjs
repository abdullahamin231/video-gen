import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, existsSync, openSync, readSync, fstatSync, closeSync, rmSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const RECENT = 600; // events kept in memory per thread; the JSONL log keeps all of them
const PREVIEW = 4000; // tool output characters kept in memory and streamed to the browser
const SAVE_DELAY = 150;

// Strip what the browser never needs: full outputs and per-message usage ledgers.
export function compactEvent(item) {
  if (typeof item.output !== 'string' || item.output.length <= PREVIEW) return item;
  return { ...item, output: item.output.slice(0, PREVIEW), outputSize: item.output.length, truncated: true };
}
export function summary(job) {
  const { messages, events, ...rest } = job;
  return { ...rest, agents: job.agents.map(({ usageLedger, costLedger, claudeRunTotals, ...agent }) => agent), messageCount: messages.length };
}

function tail(filename, count) {
  if (!existsSync(filename)) return [];
  const fd = openSync(filename, 'r');
  try {
    const size = fstatSync(fd).size, length = Math.min(size, 6 * 1024 * 1024), buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    if (length < size) lines.shift(); // partial first line
    const events = [];
    for (const line of lines.slice(-count - 1)) { if (!line.trim()) continue; try { events.push(compactEvent(JSON.parse(line))); } catch { /* torn write */ } }
    return events.slice(-count);
  } finally { closeSync(fd); }
}

export class Store {
  constructor(directory, defaults = {}) {
    this.directory = directory;
    this.defaults = { concurrency: 1, defaultFormat: 'landscape', ...defaults };
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.jobs = new Map(); this.recent = new Map(); this.timers = new Map(); this.listeners = new Set();
    for (const name of readdirSync(directory).filter(name => /^[a-f0-9-]+\.json$/.test(name))) {
      try {
        const job = JSON.parse(readFileSync(path.join(directory, name), 'utf8'));
        const legacy = Array.isArray(job.events) ? job.events : [];
        delete job.events;
        let events = tail(this.logPath(job.id), RECENT);
        if (!events.length && legacy.length) events = legacy.slice(-RECENT).map(compactEvent);
        events.forEach((event, index) => { event.seq ??= index + 1; });
        job.eventSeq = Math.max(job.eventSeq || 0, events.at(-1)?.seq || 0);
        job.messages ||= []; job.agents ||= [];
        this.jobs.set(job.id, job); this.recent.set(job.id, events);
      } catch (error) { console.error(`Unable to load thread ${name}: ${error.message}`); }
    }
  }
  logPath(id) { return path.join(this.directory, `${id}.events.jsonl`); }
  all() { return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(id) { const job = this.jobs.get(id); if (!job) throw Object.assign(new Error('Thread not found'), { status: 404 }); return job; }
  events(id) { return this.recent.get(id) || []; }
  emit(type, id, payload) { for (const listener of this.listeners) listener(type, id, payload); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  // Snapshots are written shortly after a burst of changes, never once per event.
  save(job, broadcast = true) {
    this.jobs.set(job.id, job);
    if (!this.timers.has(job.id)) this.timers.set(job.id, setTimeout(() => this.write(job.id), SAVE_DELAY));
    if (broadcast) this.emit('job', job.id);
    return job;
  }
  write(id) {
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    const job = this.jobs.get(id); if (!job) return;
    const filename = path.join(this.directory, `${id}.json`);
    writeFileSync(filename + '.next', JSON.stringify(job), { mode: 0o600 });
    renameSync(filename + '.next', filename);
  }
  flush() { for (const id of [...this.timers.keys()]) this.write(id); }

  create(input) {
    const id = randomUUID();
    const latest = Math.max(0, ...this.all().map(job => Date.parse(job.createdAt)));
    const createdAt = new Date(Math.max(Date.now(), latest + 1)).toISOString();
    const slug = `${input.title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'video'}-${id.slice(0, 6)}`;
    const job = { ...input, id, slug, jobPath: `jobs/${slug}`, scriptPath: `jobs/scripts/${slug}`, createdAt, updatedAt: createdAt, status: 'queued',
      messages: [], agents: [], gate: null, error: '', pipeline: null, progress: null, health: null, qualification: null, outputs: {},
      elapsedMs: 0, eventSeq: 0, archived: false, activeCommands: [], lastNext: null };
    this.recent.set(id, []);
    this.save(job); this.write(id);
    return job;
  }
  event(job, input) {
    const item = { ...input, id: randomUUID(), seq: ++job.eventSeq, at: new Date().toISOString() };
    // The append-only log is the durable audit stream; the snapshot only keeps a counter.
    writeFileSync(this.logPath(job.id), JSON.stringify(item) + '\n', { flag: 'a', mode: 0o600 });
    const compact = compactEvent(item), list = this.recent.get(job.id) || [];
    list.push(compact); if (list.length > RECENT) list.splice(0, list.length - RECENT);
    this.recent.set(job.id, list);
    job.updatedAt = item.at;
    this.save(job, false);
    this.emit('event', job.id, compact);
    return item;
  }
  message(job, role, text, agentId = '', extra = {}) {
    const message = { id: randomUUID(), role, text: String(text).slice(0, 60000), agentId, at: new Date().toISOString(), ...extra };
    job.messages.push(message);
    this.save(job, false);
    this.emit('message', job.id, message);
    return message;
  }
  touchMessage(job, message) { this.save(job, false); this.emit('message', job.id, message); }
  remove(id) {
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    rmSync(path.join(this.directory, `${id}.json`), { force: true }); rmSync(this.logPath(id), { force: true });
    this.jobs.delete(id); this.recent.delete(id);
    this.emit('removed', id);
  }
  // Older events and full outputs come from the log on demand.
  async scan(id, keep) {
    const filename = this.logPath(id); if (!existsSync(filename)) return;
    const lines = createInterface({ input: createReadStream(filename, 'utf8'), crlfDelay: Infinity });
    for await (const line of lines) { if (!line.trim()) continue; let item; try { item = JSON.parse(line); } catch { continue; } if (keep(item) === false) { lines.close(); break; } }
  }
  async fullEvent(id, eventId) { let found = null; await this.scan(id, item => { if (item.id === eventId) { found = item; return false; } }); return found; }
  async page(id, { before = Infinity, limit = 200, agentId = '' } = {}) {
    const result = [];
    await this.scan(id, item => { if ((item.seq ?? 0) < before && (!agentId || item.agentId === agentId)) { result.push(compactEvent(item)); if (result.length > limit) result.shift(); } });
    return result;
  }

  settings() {
    const filename = path.join(this.directory, 'settings.json');
    if (!existsSync(filename)) return { ...this.defaults };
    return { ...this.defaults, ...JSON.parse(readFileSync(filename, 'utf8')) };
  }
  saveSettings(settings) {
    const filename = path.join(this.directory, 'settings.json');
    writeFileSync(filename + '.next', JSON.stringify(settings), { mode: 0o600 });
    renameSync(filename + '.next', filename);
  }
}
