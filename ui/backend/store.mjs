import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(directory, defaults = {}) {
    this.directory = directory;
    this.defaults = { concurrency: 1, defaultFormat: 'landscape', defaultDuration: 180, ...defaults };
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.jobs = new Map();
    this.listeners = new Set();
    for (const name of readdirSync(directory).filter(name => /^[a-f0-9-]+\.json$/.test(name))) {
      try { const job = JSON.parse(readFileSync(path.join(directory, name), 'utf8')); this.jobs.set(job.id, job); }
      catch (error) { console.error(`Unable to load thread ${name}: ${error.message}`); }
    }
  }
  all() { return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(id) { const job = this.jobs.get(id); if (!job) throw Object.assign(new Error('Thread not found'), { status: 404 }); return job; }
  save(job, broadcast = true) {
    const filename = path.join(this.directory, `${job.id}.json`);
    writeFileSync(filename + '.next', JSON.stringify(job), { mode: 0o600 });
    renameSync(filename + '.next', filename);
    this.jobs.set(job.id, job);
    if (broadcast) for (const listener of this.listeners) listener(job.id);
    return job;
  }
  create(input) {
    const id = randomUUID();
    const latest = Math.max(0, ...this.all().map(job => Date.parse(job.createdAt)));
    const createdAt = new Date(Math.max(Date.now(), latest + 1)).toISOString();
    const slug = `${input.title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'video'}-${id.slice(0, 6)}`;
    return this.save({ ...input, id, slug, jobPath: `jobs/${slug}`, scriptPath: `jobs/scripts/${slug}`, createdAt, updatedAt: createdAt, status: 'queued', stage: 0, stageSource: 'runner', messages: [], events: [], agents: [], sessions: {}, gate: null, current: '', operation: '', role: '', error: '', pipeline: null, outputs: {}, elapsedMs: 0 });
  }
  event(job, input) {
    const item = { ...input, id: randomUUID(), at: new Date().toISOString() };
    job.events.push(item);
    // Keep recent events in snapshots. The complete stream is separately durable.
    if (job.events.length > 1000) job.events.splice(0, job.events.length - 1000);
    const filename = path.join(this.directory, `${job.id}.events.jsonl`);
    // A single server owns this store. Appending before the snapshot preserves the audit stream.
    writeFileSync(filename, JSON.stringify(item) + '\n', { flag: 'a', mode: 0o600 });
    job.updatedAt = item.at;
    this.save(job);
    return item;
  }
  message(job, role, text, agentId = '') {
    const message = { id: randomUUID(), role, text: String(text).slice(0, 200000), agentId, at: new Date().toISOString() };
    job.messages.push(message);
    this.save(job);
    return message;
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
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
