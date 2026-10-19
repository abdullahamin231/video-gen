import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { executable, invocation, capture } from './providers.mjs';
import { normalize, normalizeFile, redact } from './events.mjs';
import { listFiles, jobFile, readJson } from './files.mjs';
import { orchestratorPrompt } from './prompt.mjs';
import { UsageService, applyUsage, totalUsage } from './usage.mjs';

const busy = new Set(['running', 'paused']);
function signal(child, name) { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
export function modelFor(job, role) {
  if (role === 'builder') return job.sub || job.main;
  if (role === 'reviewer' || role.endsWith('reviewer')) return job.reviewerModel || job.main;
  if (role === 'director' || role === 'thumbnail-maker') return job.directorModel || job.main;
  return job.main;
}
export class Runner {
  constructor({ root, store, spawnProcess = spawn }) {
    this.root = root; this.store = store; this.spawn = spawnProcess;
    this.processes = new Map(); this.runningJobs = new Set(); this.credentials = new Map(); this.waiters = new Set();
    this.files = new Map(); this.slots = new Map(); this.url = ''; this.closed = false; this.polling = false;
    this.bridge = path.join(root, 'ui/backend/mcp.mjs');
    this.usage = new UsageService(root);
  }
  async initialize(url) {
    this.url = url;
    for (const job of this.store.all()) {
      // A new server must never imply that a previously running process survived.
      for (const agent of job.agents) if (agent.status === 'running' || agent.status === 'paused') {
        if (agent.pid && agent.processStart) {
          try {
            const proc = await readFile(`/proc/${agent.pid}/stat`, 'utf8');
            if (proc.slice(proc.lastIndexOf(')') + 2).split(' ')[19] === agent.processStart) {
              process.kill(-agent.pid, 'SIGCONT'); process.kill(-agent.pid, 'SIGTERM');
            }
          } catch { /* PID absent or no longer ours. */ }
        }
        agent.status = 'interrupted';
      }
      if (busy.has(job.status)) { job.status = 'interrupted'; job.error = 'Server stopped during this run. Resume to continue from the saved CLI session and job artifacts.'; }
      this.store.save(job, false);
    }
    this.timer = setInterval(() => this.poll().catch(error => console.error('Artifact poll:', error.message)), 2500);
    this.timer.unref();
    this.pump();
  }
  async create(input) {
    await executable(input.provider);
    const job = this.store.create(input);
    await mkdir(path.join(this.root, job.scriptPath), { recursive: true });
    this.store.message(job, 'You', job.prompt);
    this.store.event(job, { type: 'lifecycle', text: 'Thread queued', source: 'runner' });
    this.pump();
    return job;
  }
  pump() {
    if (this.closed) return;
    const concurrency = this.store.settings().concurrency;
    for (const job of this.store.all().reverse()) {
      if (this.runningJobs.size >= concurrency) break;
      if (job.status !== 'queued' || this.runningJobs.has(job.id)) continue;
      this.runningJobs.add(job.id);
      void this.run(job).finally(() => { this.runningJobs.delete(job.id); for (const wake of this.waiters) wake(); this.waiters.clear(); this.pump(); });
    }
  }
  async run(job) {
    job.status = 'running'; job.error = ''; job.runStartedAt = Date.now();
    if (!this.files.has(job.id)) this.files.set(job.id, new Map());
    this.store.event(job, { type: 'lifecycle', text: 'Orchestrator started', source: 'runner' });
    try {
      await this.runAgent(job, { role: 'orchestrator', prompt: orchestratorPrompt(job), agentId: job.orchestratorId });
      if (job.status === 'running') {
        job.status = 'needs_attention';
        job.error = 'The agent stopped before delivery was independently verified. Send feedback or continue the run.';
        this.store.event(job, { type: 'lifecycle', text: job.error, source: 'runner' });
      }
    } catch (error) {
      if (!['cancelled', 'interrupted', 'gate', 'complete'].includes(job.status)) {
        job.status = 'failed'; job.error = redact(error.message);
        this.store.event(job, { type: 'error', text: job.error, source: 'runner' });
      }
    } finally {
      job.elapsedMs += Date.now() - job.runStartedAt; delete job.runStartedAt;
      this.store.save(job);
    }
  }
  async runAgent(job, { role, prompt, agentId }) {
    while ((this.slots.get(job.id) || 0) >= 4 || job.status === 'paused') {
      await new Promise(resolve => this.waiters.add(resolve));
      if (this.closed || ['cancelled', 'interrupted'].includes(job.status)) throw new Error('Run stopped');
    }
    this.slots.set(job.id, (this.slots.get(job.id) || 0) + 1);
    try { return await this.executeAgent(job, { role, prompt, agentId }); }
    finally { this.slots.set(job.id, this.slots.get(job.id) - 1); for (const wake of this.waiters) wake(); this.waiters.clear(); }
  }
  async executeAgent(job, { role, prompt, agentId }) {
    if (this.closed || ['cancelled', 'interrupted'].includes(job.status)) throw new Error('Run stopped');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 150000) throw new Error('Invalid agent prompt');
    let agent = agentId ? job.agents.find(item => item.id === agentId) : null;
    if (agentId && (!agent || agent.role !== role)) throw new Error('Cannot resume an agent of another role or thread');
    if (agent && this.processes.has(agent.id)) throw new Error('This agent is already running');
    if (!agent) {
      agent = { id: randomUUID(), role, model: modelFor(job, role), provider: job.provider, status: 'starting', createdAt: new Date().toISOString(), current: '' };
      job.agents.push(agent);
      if (role === 'orchestrator') job.orchestratorId = agent.id;
    }
    agent.model = modelFor(job, role); agent.provider = job.provider;
    const command = await executable(job.provider);
    if (this.closed || ['cancelled', 'interrupted'].includes(job.status)) throw new Error('Run stopped');
    const token = randomUUID() + randomUUID();
    this.credentials.set(token, { thread: job.id, agentId: agent.id });
    const options = invocation(job.provider, { model: agent.model, session: agent.sessionId || '', bridge: this.bridge, root: this.root, env: { VIDEO_RUNNER_URL: this.url, VIDEO_RUNNER_TOKEN: token, VIDEO_THREAD_ID: job.id, VIDEO_AGENT_ID: agent.id } });
    this.store.event(job, { type: 'agent', text: `${role} started`, agentId: agent.id, role, model: agent.model || 'Provider default', source: 'runner' });
    const child = this.spawn(command, options.args, { cwd: this.root, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const record = { child, job, agent, token };
    this.processes.set(agent.id, record);
    agent.status = 'running'; agent.pid = child.pid; agent.startedAt = new Date().toISOString();
    // Install stream/exit listeners in this tick. Awaiting /proc here can miss
    // a fast process exit (especially a cancellation or rejected CLI flag).
    void readFile(`/proc/${child.pid}/stat`, 'utf8').then(proc => {
      if (this.processes.get(agent.id) === record) { agent.processStart = proc.slice(proc.lastIndexOf(')') + 2).split(' ')[19]; this.store.save(job); }
    }).catch(() => {});
    this.store.save(job);
    let buffer = '', stderr = '', response = '', providerError = '', spawnError = '', lines = 0, hasAssistantUsage = false;
    const runId = randomUUID();
    const consume = line => {
      if (!line.trim()) return;
      lines++;
      let raw;
      try { raw = JSON.parse(line); } catch { this.store.event(job, { type: 'log', text: redact(line), agentId: agent.id, role, source: 'stdout' }); return; }
      for (const item of normalize(job.provider, raw)) {
        if (item.type === 'session') {
          agent.sessionId = item.sessionId; this.store.save(job); continue;
        }
        if (item.type === 'message') { response += item.text + '\n'; this.store.message(job, role, item.text, agent.id); }
        if (item.type === 'usage' || item.type === 'context') {
          applyUsage(agent, job.provider, item, runId, lines, hasAssistantUsage);
          if (item.fromAssistant) hasAssistantUsage = true;
          job.usage = totalUsage(job.agents);
        }
        if (item.type === 'quota') this.usage.observe(job.provider, item);
        if (item.fatal) providerError = item.text || 'Provider reported an error';
        if (item.file) {
          item.file = normalizeFile(this.root, item.file); agent.current = item.file;
          job.current = item.file; job.operation = item.operation || 'changed'; job.role = role;
        }
        if (item.toolId && item.status !== 'running') {
          const start = job.events.findLast(event => event.toolId === item.toolId && event.agentId === agent.id && event.name);
          if (start) { item.name ||= start.name; item.file ||= start.file; }
        }
        this.store.event(job, { ...item, agentId: agent.id, role, source: 'provider' });
      }
    };
    const result = await new Promise(resolve => {
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, at); buffer = buffer.slice(at + 1); consume(line); }
        if (buffer.length > 8 * 1024 * 1024) { spawnError = 'Provider produced an oversized event'; signal(child, 'SIGTERM'); }
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-32000); });
      child.stdin.on('error', () => { /* A provider can reject flags before reading its prompt. */ });
      child.once('error', error => { spawnError = error.message; });
      child.once('close', (code, sig) => { if (buffer.trim()) consume(buffer); resolve({ code, signal: sig }); });
      child.stdin.end(prompt);
    });
    this.processes.delete(agent.id); this.credentials.delete(token);
    for (const wake of this.waiters) wake(); this.waiters.clear();
    agent.status = result.code === 0 && !spawnError && !providerError ? 'finished' : 'failed';
    agent.finishedAt = new Date().toISOString(); delete agent.pid; delete agent.processStart;
    const failure = spawnError || providerError || (result.code !== 0 ? `${job.provider} exited ${result.code ?? result.signal}. ${redact(stderr).trim()}` : '');
    if (stderr.trim()) this.store.event(job, { type: 'log', text: redact(stderr), agentId: agent.id, role, source: 'stderr' });
    this.store.event(job, { type: failure ? 'error' : 'agent', text: failure || `${role} finished`, agentId: agent.id, role, source: 'runner' });
    if (failure) throw new Error(failure);
    if (!lines) throw new Error(`${job.provider} produced no event stream. Check its CLI version and login.`);
    return { agentId: agent.id, sessionId: agent.sessionId, model: agent.model || 'Provider default', result: response.slice(-60000), status: agent.status };
  }
  authorize(token, thread, agentId) {
    const value = this.credentials.get(token);
    return Boolean(value && value.thread === thread && value.agentId === agentId && this.processes.has(agentId));
  }
  async tool(job, agentId, name, args) {
    const role = job.agents.find(item => item.id === agentId)?.role;
    const toolId = randomUUID();
    this.store.event(job, { type: 'tool', name: `video_runner.${name}`, text: `Runner tool: ${name}`, toolId, agentId, role, status: 'running', source: 'runner-bridge' });
    try {
      const result = await this.performTool(job, agentId, name, args);
      this.store.event(job, { type: 'tool', name: `video_runner.${name}`, text: `Runner tool completed: ${name}`, toolId, agentId, role, status: 'completed', source: 'runner-bridge' });
      return result;
    } catch (error) {
      this.store.event(job, { type: 'error', name: `video_runner.${name}`, text: error.message, toolId, agentId, role, status: 'failed', source: 'runner-bridge' });
      throw error;
    }
  }
  async performTool(job, agentId, name, args) {
    const agent = job.agents.find(item => item.id === agentId);
    if (!agent || ['cancelled', 'interrupted'].includes(job.status)) throw new Error('Agent is no longer active');
    if (name === 'feedback') {
      const messages = job.messages.filter(message => message.role === 'You' && !message.deliveredAt);
      for (const message of messages) message.deliveredAt = new Date().toISOString();
      this.store.save(job);
      return { messages, gateDecision: job.gate?.decision || null, status: job.status, runtimeAgentId: agentId };
    }
    if (name === 'progress') {
      if (!Number.isInteger(args.stage) || args.stage < 0 || args.stage > 7 || typeof args.summary !== 'string') throw new Error('Invalid progress report');
      if (agent.role !== 'orchestrator') return { recorded: this.store.event(job, { type: 'progress', text: redact(args.summary), agentId, role: agent.role, source: 'agent-reported' }).id };
      job.stage = args.stage; job.stageSource = 'agent-reported'; job.summary = args.summary.slice(0, 2000); job.role = agent.role;
      this.store.event(job, { type: 'progress', text: redact(args.summary), file: normalizeFile(this.root, args.file || ''), stage: args.stage, agentId, source: 'agent-reported' });
      return { recorded: true };
    }
    if (name === 'delegate') {
      if (agent.role !== 'orchestrator') throw new Error('Only the orchestrator dispatches independent role agents');
      if (!['director', 'builder', 'reviewer', 'script-writer', 'script-reviewer', 'thumbnail-maker', 'thumbnail-reviewer'].includes(args.role)) throw new Error('Unsupported agent role');
      return this.runAgent(job, { role: args.role, prompt: args.prompt, agentId: args.agentId });
    }
    if (agent.role !== 'orchestrator') throw new Error('Only the orchestrator manages checkpoints and delivery');
    if (name === 'checkpoint') {
      if (!['script', 'prototype'].includes(args.kind) || typeof args.summary !== 'string') throw new Error('Invalid checkpoint');
      const enabled = args.kind === 'script' ? job.gateScript : job.gatePrototype;
      if (!enabled || job.approvedGates?.includes(args.kind)) return { paused: false, reason: enabled ? 'Already approved' : 'Checkpoint disabled' };
      job.status = 'gate'; job.gate = { kind: args.kind, summary: args.summary.slice(0, 5000), file: args.file || '', createdAt: new Date().toISOString() };
      this.store.event(job, { type: 'checkpoint', text: args.summary, file: args.file || '', source: 'runner' });
      return { paused: true, instruction: 'Stop the turn now. The UI resumes this thread after a decision.' };
    }
    if (name === 'complete') return this.qualify(job);
    throw new Error('Unknown runner tool');
  }
  async qualify(job) {
    if ([...this.processes.values()].some(item => item.job.id === job.id && item.agent.role !== 'orchestrator')) throw new Error('Cannot deliver while role agents are still running');
    const next = await capture('npm', ['run', 'video', '--', 'next', '--job', job.jobPath], { cwd: this.root, timeout: 120000, maxBytes: 1000000 });
    job.pipeline = { checkedAt: new Date().toISOString(), output: redact(next.stdout + next.stderr), qualified: next.code === 0 && /^STATE:\s*done\s*$/m.test(next.stdout) };
    this.store.save(job);
    if (!job.pipeline.qualified) throw new Error('Pipeline has not independently qualified delivery. ' + job.pipeline.output.slice(-5000));
    const video = await jobFile(this.root, job, `${job.jobPath}/renders/video.mp4`);
    const png = await jobFile(this.root, job, `${job.jobPath}/thumbnail/thumbnail.png`);
    const bytes = await readFile(png.path);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(16) !== 1280 || bytes.readUInt32BE(20) !== 720) throw new Error('Thumbnail must be a real 1280×720 PNG');
    const reportPath = `${job.jobPath}/thumbnail/REVIEW.json`;
    const reportFile = await jobFile(this.root, job, reportPath);
    const review = JSON.parse(await readFile(reportFile.path, 'utf8'));
    const reviewer = job.agents.find(agent => agent.id === review.reviewerAgentId && agent.role === 'thumbnail-reviewer' && agent.status === 'finished');
    if (review.status !== 'pass' || !reviewer || !Array.isArray(review.inspectedFiles) || !review.inspectedFiles.length) throw new Error('A fresh, finished thumbnail reviewer must independently pass the actual thumbnail');
    const files = await listFiles(this.root, job);
    const sources = files.filter(file => file.path.startsWith(`${job.jobPath}/thumbnail/`));
    if (!sources.some(file => /\.(svg|psd|ora|afdesign)$/.test(file.path))) throw new Error('Missing editable thumbnail source');
    if (!sources.some(file => /BRIEF\.md$/.test(file.path))) throw new Error('Missing thumbnail brief');
    for (const file of sources) {
      const archived = `library/thumbnails/${job.slug}/${file.path.slice((`${job.jobPath}/thumbnail/`).length)}`;
      const target = await jobFile(this.root, job, archived);
      const original = await jobFile(this.root, job, file.path);
      const [a, b] = await Promise.all([readFile(original.path), readFile(target.path)]);
      if (!a.equals(b)) throw new Error(`Thumbnail archive does not match ${file.path}`);
    }
    job.status = 'complete'; job.stage = 8; job.stageSource = 'verified'; job.completedAt = new Date().toISOString(); job.error = '';
    job.outputs = { video: `${job.jobPath}/renders/video.mp4`, thumbnail: `${job.jobPath}/thumbnail/thumbnail.png`, thumbnailSource: sources.find(file => file.path.endsWith('.svg'))?.path || '', delivery: `${job.jobPath}/review/delivery.json`, thumbnailReview: reportPath };
    this.store.event(job, { type: 'delivery', text: 'Video pipeline qualified; independently reviewed thumbnail archived and verified', source: 'verified' });
    return { complete: true, outputs: job.outputs, videoBytes: video.info.size };
  }
  async poll() {
    if (this.polling || this.closed) return;
    this.polling = true;
    try {
      for (const job of this.store.all().filter(item => ['running', 'gate', 'paused'].includes(item.status))) {
        const files = await listFiles(this.root, job);
        const previous = this.files.get(job.id);
        const next = new Map(files.map(file => [file.path, `${file.modified}:${file.size}`]));
        this.files.set(job.id, next);
        if (!previous) continue;
        for (const file of files) if (previous.get(file.path) !== next.get(file.path)) {
          job.current = file.path; job.operation = 'changed';
          this.store.event(job, { type: 'file', text: previous.has(file.path) ? 'File changed on disk' : 'File created on disk', file: file.path, source: 'filesystem', status: 'observed' });
        }
        for (const file of previous.keys()) if (!next.has(file)) this.store.event(job, { type: 'file', text: 'File removed from disk', file, source: 'filesystem', status: 'observed' });
      }
    } finally { this.polling = false; }
  }
  async control(job, action, data = {}) {
    const records = [...this.processes.values()].filter(item => item.job.id === job.id);
    if (action === 'pause') {
      if (process.platform === 'win32') throw new Error('Process pause requires Linux or macOS. Cancel and continue is available.');
      if (job.status !== 'running') throw new Error('Only a running thread can be paused');
      for (const record of records) signal(record.child, 'SIGSTOP');
      job.status = 'paused';
    } else if (action === 'resume') {
      if (!['paused', 'interrupted', 'needs_attention', 'failed', 'cancelled'].includes(job.status)) throw new Error('This thread cannot be resumed in its current state');
      if (job.status === 'paused' && records.length) { for (const record of records) signal(record.child, 'SIGCONT'); job.status = 'running'; }
      else { if (this.runningJobs.has(job.id)) throw new Error('The previous agent is still exiting. Try again in a moment.'); job.status = 'queued'; }
      job.error = '';
    } else if (action === 'cancel') {
      if (job.status === 'complete') throw new Error('This delivery is already complete');
      job.status = 'cancelled';
      for (const record of records) { signal(record.child, 'SIGCONT'); signal(record.child, 'SIGTERM'); const timer = setTimeout(() => { if (this.processes.get(record.agent.id) === record) signal(record.child, 'SIGKILL'); }, 5000); timer.unref(); }
    } else if (action === 'approve' || action === 'revise') {
      if (job.status !== 'gate' || !job.gate) throw new Error('No checkpoint is waiting');
      if (this.runningJobs.has(job.id)) throw new Error('The orchestrator is finishing the checkpoint turn. Try again in a moment.');
      if (action === 'revise' && !data.feedback?.trim()) throw new Error('Describe the requested changes');
      if (data.feedback?.trim()) this.store.message(job, 'You', data.feedback.trim());
      job.gate.decision = action;
      if (action === 'approve') { job.approvedGates ||= []; job.approvedGates.push(job.gate.kind); }
      this.store.message(job, 'You', action === 'approve' ? `Approved the ${job.gate.kind} checkpoint. Continue production.` : `Revise the ${job.gate.kind} stage using my feedback. Present this checkpoint again after revision.`);
      job.status = 'queued';
    } else throw new Error('Unknown run action');
    this.store.event(job, { type: 'lifecycle', text: `User action: ${action}`, source: 'user' });
    for (const wake of this.waiters) wake(); this.waiters.clear(); this.pump();
    return job;
  }
  async shutdown() {
    this.closed = true; clearInterval(this.timer);
    for (const { child, job } of this.processes.values()) {
      if (!['gate', 'complete', 'cancelled'].includes(job.status)) job.status = 'interrupted';
      try { this.store.save(job, false); } finally { signal(child, 'SIGCONT'); signal(child, 'SIGTERM'); }
    }
    for (const wake of this.waiters) wake(); this.waiters.clear();
    if (this.processes.size) await new Promise(resolve => {
      const timer = setTimeout(() => { for (const { child } of this.processes.values()) signal(child, 'SIGKILL'); resolve(); }, 4500);
      const check = () => { if (!this.processes.size) { clearTimeout(timer); resolve(); } };
      for (const { child } of this.processes.values()) child.once('close', check);
    });
  }
}
