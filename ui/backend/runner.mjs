import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, access, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { executable, invocation, capture, agentPins } from './providers.mjs';
import { normalize, normalizeFile, redact, parseNext, describeTask } from './events.mjs';
import { listFiles, jobFile, readJson, inside } from './files.mjs';
import { orchestratorPrompt } from './prompt.mjs';
import { UsageService, applyUsage, totalUsage } from './usage.mjs';
import { computeProgress, computeHealth, scriptDisposition } from './progress.mjs';
import { routeModel, CLAUDE_AGENT_TYPES, DELEGATE_ROLES } from '../shared/routing.mjs';

const LIVE = new Set(['starting', 'running', 'waiting']);
const MAX_PROCESSES = 4; // per job, including the orchestrator: enough for three parallel reviewers
const STATUS_INTERVAL = 5000;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function signal(child, name) { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
function pngSize(bytes) { return bytes.subarray(0, 8).equals(PNG) ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null; }
const exists = file => access(file).then(() => true, () => false);
// Delete a thread's folder, but never anything outside the repository and never the repository itself.
async function removeFolder(root, folder) {
  if (typeof folder !== 'string' || !folder || path.isAbsolute(folder)) return;
  const target = path.resolve(root, folder);
  if (target === path.resolve(root) || !inside(root, target)) return;
  const info = await lstat(target).catch(() => null);
  if (!info) return; // nothing there
  if (info.isSymbolicLink()) return rm(target, { force: true }); // the link itself, never what it points at
  await rm(target, { recursive: true, force: true });
}
export function modelFor(job, role, pins = {}) { return routeModel(job, role, pins).model; }

// Which pipeline step a delegated agent works on: what `status` said when it was launched, refined by its brief.
function stepFor(job, role, task) {
  if (task.stage) return `${task.stage}-review`;
  if (/\/(director|director-revision)\.md$/.test(task.brief)) return 'plan';
  const current = job.pipeline?.current;
  if (task.scene) {
    if (current && current !== 'prepare' && current !== 'deliver') return current;
    return job.pipeline?.scenes?.find(scene => scene.id === task.scene)?.prototypeCut ? 'prototype-scenes' : 'scenes';
  }
  return { 'script-writer': 'script', 'script-reviewer': 'script-review', 'thumbnail-maker': 'thumbnail-art', 'thumbnail-reviewer': 'thumbnail-review' }[role] || current || '';
}

export class Runner {
  constructor({ root, store, spawnProcess = spawn, statusCommand }) {
    this.root = root; this.store = store; this.spawn = spawnProcess;
    this.processes = new Map(); this.runningJobs = new Set(); this.credentials = new Map(); this.waiters = new Set();
    this.files = new Map(); this.slots = new Map(); this.gates = new Map(); this.status = new Map();
    this.url = ''; this.closed = false; this.polling = false; this.pins = {};
    this.bridge = path.join(root, 'ui/backend/mcp.mjs');
    this.usage = new UsageService(root);
    this.statusCommand = statusCommand || (job => capture(process.execPath, [path.join(root, 'scripts/video.mjs'), 'status', '--json', '--job', job.jobPath], { cwd: root, timeout: 120000, maxBytes: 8000000 }));
  }
  wake() { for (const wake of this.waiters) wake(); this.waiters.clear(); }
  wait() { return new Promise(resolve => this.waiters.add(resolve)); }
  startClock(job) { job.runStartedAt ??= Date.now(); }
  stopClock(job) { if (job.runStartedAt) { job.elapsedMs = (job.elapsedMs || 0) + Date.now() - job.runStartedAt; delete job.runStartedAt; } }

  async initialize(url) {
    this.url = url;
    this.pins = await agentPins(this.root);
    for (const job of this.store.all()) {
      // A new server must never imply that a previously running process survived.
      for (const agent of job.agents) if (LIVE.has(agent.status) || agent.status === 'paused') {
        if (agent.pid && agent.processStart) {
          try {
            const proc = await readFile(`/proc/${agent.pid}/stat`, 'utf8');
            if (proc.slice(proc.lastIndexOf(')') + 2).split(' ')[19] === agent.processStart) { process.kill(-agent.pid, 'SIGCONT'); process.kill(-agent.pid, 'SIGTERM'); }
          } catch { /* PID absent or no longer ours. */ }
        }
        agent.status = 'interrupted'; delete agent.pid; delete agent.processStart;
      }
      job.activeCommands = [];
      delete job.runStartedAt;
      if (['running', 'paused'].includes(job.status)) { job.status = 'interrupted'; job.error = 'Server stopped during this run. Continue to resume the saved CLI session from the job’s artifacts.'; }
      // A checkpoint survives a restart: deciding it queues the orchestrator, which reads the decision.
      if (job.status === 'gate' && job.gate) job.gate.detached = true;
      this.store.save(job, false);
    }
    this.timer = setInterval(() => this.poll().catch(error => console.error('Artifact poll:', error.message)), 2500);
    this.timer.unref();
    void (async () => { for (const job of this.store.all().filter(item => !item.archived)) { if (this.closed) return; await this.refresh(job, { force: true }).catch(() => {}); } })();
    this.pump();
  }
  async create(input) {
    await executable(input.provider);
    const job = this.store.create(input);
    await mkdir(path.join(this.root, job.scriptPath), { recursive: true });
    this.store.message(job, 'You', job.prompt);
    this.store.event(job, { type: 'lifecycle', text: 'Thread queued', source: 'runner' });
    await this.refresh(job, { force: true }).catch(() => {});
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
      void this.run(job).finally(() => { this.runningJobs.delete(job.id); this.wake(); this.pump(); });
    }
  }
  async run(job) {
    job.status = 'running'; job.error = ''; this.startClock(job);
    if (!this.files.has(job.id)) this.files.set(job.id, new Map());
    this.store.event(job, { type: 'lifecycle', text: job.orchestratorId ? 'Orchestrator resumed' : 'Orchestrator started', source: 'runner' });
    try {
      // A saved session already holds the brief; resuming it only needs a short continuation.
      // A first turn that failed before doing anything (e.g. a billing error) still needs the full brief.
      const previous = job.agents.find(agent => agent.id === job.orchestratorId);
      const resume = Boolean(previous?.sessionId && (previous.toolCount || previous.lastMessage));
      await this.runAgent(job, { role: 'orchestrator', prompt: orchestratorPrompt(job, { resume }), agentId: job.orchestratorId });
      if (job.status === 'running') {
        job.status = 'needs_attention';
        job.error = 'The orchestrator stopped before the runner verified delivery. Send feedback or continue the run.';
        this.store.event(job, { type: 'lifecycle', text: job.error, source: 'runner' });
      }
    } catch (error) {
      if (!['cancelled', 'interrupted', 'gate', 'complete', 'paused'].includes(job.status)) {
        job.status = 'failed'; job.error = redact(error.message);
        this.store.event(job, { type: 'error', text: job.error, source: 'runner' });
      }
    } finally {
      this.stopClock(job);
      this.store.save(job);
      void this.refresh(job, { force: true }).catch(() => {});
    }
  }
  async runAgent(job, { role, prompt, agentId, parentId = '' }) {
    while ((this.slots.get(job.id) || 0) >= MAX_PROCESSES || (job.status === 'paused' && role !== 'orchestrator')) {
      await this.wait();
      if (this.closed || ['cancelled', 'interrupted'].includes(job.status)) throw new Error('Run stopped');
    }
    this.slots.set(job.id, (this.slots.get(job.id) || 0) + 1);
    try { return await this.executeAgent(job, { role, prompt, agentId, parentId }); }
    finally { this.slots.set(job.id, this.slots.get(job.id) - 1); this.wake(); }
  }
  async executeAgent(job, { role, prompt, agentId, parentId }) {
    if (this.closed || ['cancelled', 'interrupted'].includes(job.status)) throw new Error('Run stopped');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 150000) throw new Error('Invalid agent prompt');
    let agent = agentId ? job.agents.find(item => item.id === agentId) : null;
    if (agentId && (!agent || agent.role !== role)) throw new Error('Cannot resume an agent of another role or thread');
    if (agent && this.processes.has(agent.id)) throw new Error('This agent is already running');
    const task = role === 'orchestrator' ? describeTask(role, '') : describeTask(role, prompt);
    if (task.brief) task.brief = normalizeFile(this.root, task.brief);
    if (!agent) {
      agent = { id: randomUUID(), role, parentId, provider: job.provider, status: 'starting', createdAt: new Date().toISOString(), runs: 0, toolCount: 0, failedTools: 0, current: '', operation: '' };
      job.agents.push(agent);
      if (role === 'orchestrator') job.orchestratorId = agent.id;
    }
    const route = routeModel(job, role, this.pins);
    Object.assign(agent, { ...task, step: role === 'orchestrator' ? '' : stepFor(job, role, task), promptPreview: role === 'orchestrator' ? '' : prompt.slice(0, 600),
      model: route.model, modelSource: route.source, provider: job.provider, status: 'starting', runs: (agent.runs || 0) + 1, error: '', note: '' });
    const agentType = ['Claude', 'Pi'].includes(job.provider) ? CLAUDE_AGENT_TYPES[role] || '' : '';
    const command = await executable(job.provider);
    if (this.closed || ['cancelled', 'interrupted'].includes(job.status)) throw new Error('Run stopped');
    const token = randomUUID() + randomUUID();
    this.credentials.set(token, { thread: job.id, agentId: agent.id });
    const options = invocation(job.provider, { model: agent.model, session: agent.sessionId || '', bridge: this.bridge, root: this.root, agentType,
      env: { VIDEO_RUNNER_URL: this.url, VIDEO_RUNNER_TOKEN: token, VIDEO_THREAD_ID: job.id, VIDEO_AGENT_ID: agent.id, VIDEO_AGENT_ROLE: role } });
    this.store.event(job, { type: 'agent', text: `${agent.task || role} — ${role} ${agent.runs > 1 ? 'resumed' : 'started'}`, agentId: agent.id, role, model: agent.model || 'CLI default', brief: agent.brief || '', source: 'runner' });
    const child = this.spawn(command, options.args, { cwd: this.root, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const record = { child, job, agent, token };
    this.processes.set(agent.id, record);
    Object.assign(agent, { status: 'running', pid: child.pid, startedAt: new Date().toISOString(), lastEventAt: new Date().toISOString() });
    delete agent.finishedAt;
    // Install stream/exit listeners in this tick. Awaiting /proc here can miss a fast exit.
    void readFile(`/proc/${child.pid}/stat`, 'utf8').then(proc => {
      if (this.processes.get(agent.id) === record) { agent.processStart = proc.slice(proc.lastIndexOf(')') + 2).split(' ')[19]; this.store.save(job, false); }
    }).catch(() => {});
    this.store.save(job);
    let buffer = '', stderr = '', response = '', providerError = '', spawnError = '', lines = 0, hasAssistantUsage = false;
    const runId = randomUUID(), starts = new Map();
    const consume = line => {
      if (!line.trim()) return;
      lines++;
      let raw;
      try { raw = JSON.parse(line); } catch { this.store.event(job, { type: 'log', text: redact(line), agentId: agent.id, role, source: 'stdout' }); return; }
      agent.lastEventAt = new Date().toISOString();
      for (const item of normalize(job.provider, raw)) {
        if (item.type === 'session') { agent.sessionId = item.sessionId; this.store.save(job, false); continue; }
        if (item.type === 'message') { response += item.text + '\n'; agent.lastMessage = item.text.slice(0, 600); this.store.message(job, role, item.text, agent.id); continue; }
        if (item.type === 'usage' || item.type === 'context') {
          applyUsage(agent, job.provider, item, runId, lines, hasAssistantUsage);
          if (item.fromAssistant) hasAssistantUsage = true;
          job.usage = totalUsage(job.agents);
          this.store.save(job);
          continue;
        }
        if (item.type === 'quota') { this.usage.observe(job.provider, item); continue; }
        if (item.fatal) providerError = item.text || 'Provider reported an error';
        if (item.type === 'tool') this.trackTool(job, agent, item, starts);
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
    job.activeCommands = (job.activeCommands || []).filter(item => item.agentId !== agent.id);
    this.wake();
    const failure = spawnError || providerError || (result.code !== 0 ? `${job.provider} exited ${result.code ?? result.signal}. ${redact(stderr).trim()}` : '') || (!lines ? `${job.provider} produced no event stream. Check its CLI version and login.` : '');
    agent.status = job.status === 'cancelled' ? 'cancelled' : this.closed ? 'interrupted' : failure ? 'failed' : 'finished';
    agent.finishedAt = new Date().toISOString(); agent.result = response.slice(-6000); agent.error = failure.slice(0, 2000);
    if (agent.current && agent.operation) agent.operation = 'last';
    delete agent.pid; delete agent.processStart;
    if (stderr.trim() && failure) this.store.event(job, { type: 'log', text: redact(stderr), agentId: agent.id, role, source: 'stderr' });
    this.store.event(job, { type: failure && agent.status === 'failed' ? 'error' : 'agent', text: failure && agent.status === 'failed' ? `${agent.task || role} failed: ${failure.slice(0, 400)}` : `${agent.task || role} — ${role} ${agent.status}`, agentId: agent.id, role, status: agent.status, source: 'runner' });
    this.store.save(job);
    if (failure) throw new Error(failure);
    return { agentId: agent.id, role, task: agent.task, sessionId: agent.sessionId, model: agent.model || 'CLI default', status: agent.status, result: response.slice(-20000) };
  }
  // Tool events carry what each agent is touching: files, pipeline commands, and what `next` told it.
  trackTool(job, agent, item, starts) {
    if (item.status === 'running') {
      starts.set(item.toolId, { name: item.name, file: item.file, text: item.text, pipeline: item.pipeline });
      agent.toolCount = (agent.toolCount || 0) + 1;
      if (item.pipeline) job.activeCommands = [...(job.activeCommands || []).filter(command => command.toolId !== item.toolId), { toolId: item.toolId, ...item.pipeline, agentId: agent.id, role: agent.role, startedAt: new Date().toISOString() }];
    } else {
      const start = starts.get(item.toolId);
      // Some CLIs (OpenCode) report a tool only once it has finished; count it then.
      if (!start && !(item.toolId && starts.has(`done:${item.toolId}`))) { agent.toolCount = (agent.toolCount || 0) + 1; if (item.toolId) starts.set(`done:${item.toolId}`, true); }
      if (start) { item.name ||= start.name; item.file ||= start.file; if (item.text === 'Tool completed' || item.text === 'Tool failed') item.text = start.text; item.pipeline ||= start.pipeline; starts.delete(item.toolId); }
      if (item.status === 'failed') agent.failedTools = (agent.failedTools || 0) + 1;
      job.activeCommands = (job.activeCommands || []).filter(command => command.toolId !== item.toolId);
      if (item.pipeline) {
        this.markDirty(job);
        if (item.pipeline.command === 'next' && item.status === 'completed') {
          const told = parseNext(item.output);
          if (told) { job.lastNext = { ...told, at: new Date().toISOString(), agentId: agent.id }; item.next = told; }
        }
      }
    }
    if (item.file) {
      item.file = normalizeFile(this.root, item.file);
      Object.assign(agent, { current: item.file, operation: item.operation || 'changed' });
      Object.assign(job, { current: item.file, operation: item.operation || 'changed', role: agent.role, currentAgentId: agent.id });
    }
    agent.lastTool = { name: item.name || 'Tool', text: String(item.text || '').slice(0, 300), status: item.status, at: new Date().toISOString() };
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
      this.store.event(job, { type: 'tool', name: `video_runner.${name}`, text: error.message, toolId, agentId, role, status: 'failed', source: 'runner-bridge' });
      throw error;
    }
  }
  // Pause holds every runner call at the next step; work already in flight finishes its current tool call.
  async holdWhilePaused(job, agent) {
    if (job.status !== 'paused') return;
    const before = agent.status; agent.status = 'waiting'; agent.waitingFor = 'pause'; this.store.save(job);
    while (job.status === 'paused') { await this.wait(); if (this.closed) break; }
    agent.status = before === 'waiting' ? 'running' : before; delete agent.waitingFor; this.store.save(job);
    if (['cancelled', 'interrupted'].includes(job.status) || this.closed) throw new Error('Run stopped');
  }
  async performTool(job, agentId, name, args) {
    const agent = job.agents.find(item => item.id === agentId);
    if (!agent || ['cancelled', 'interrupted'].includes(job.status)) throw new Error('Agent is no longer active');
    await this.holdWhilePaused(job, agent);
    if (name === 'note' || (name === 'progress' && agent.role !== 'orchestrator')) {
      if (typeof args.summary !== 'string' || !args.summary.trim()) throw new Error('Invalid note');
      agent.note = redact(args.summary).slice(0, 600);
      this.store.event(job, { type: 'progress', text: agent.note, file: normalizeFile(this.root, args.file || ''), agentId, role: agent.role, source: 'agent-reported' });
      return { recorded: true };
    }
    // Feedback, delegation, checkpoints and delivery belong to the orchestrator alone. Reviewers in
    // particular must not read the user's notes, or they stop being independent.
    if (agent.role !== 'orchestrator') throw new Error(`The ${name} tool is only available to the orchestrator`);
    if (name === 'feedback') {
      const messages = job.messages.filter(message => message.role === 'You' && !message.deliveredAt && message !== job.messages[0]);
      for (const message of messages) { message.deliveredAt = new Date().toISOString(); this.store.touchMessage(job, message); }
      return { messages: messages.map(({ text, at }) => ({ text, at })), status: job.status, runtimeAgentId: agentId };
    }
    if (name === 'progress') {
      if (typeof args.summary !== 'string') throw new Error('Invalid progress report');
      job.summary = redact(args.summary).slice(0, 2000); agent.note = job.summary.slice(0, 600);
      this.store.event(job, { type: 'progress', text: job.summary, file: normalizeFile(this.root, args.file || ''), agentId, role: agent.role, source: 'agent-reported' });
      return { recorded: true, pipelineState: job.pipeline?.state || null };
    }
    if (name === 'delegate') return this.delegate(job, agent, args);
    if (name === 'delegate_parallel') {
      if (!Array.isArray(args.tasks) || !args.tasks.length || args.tasks.length > 8) throw new Error('Give 1–8 tasks');
      agent.status = 'waiting'; agent.waitingFor = 'agents'; this.store.save(job);
      try {
        const settled = await Promise.allSettled(args.tasks.map(task => this.delegate(job, agent, task, false)));
        return { results: settled.map(item => item.status === 'fulfilled' ? { ok: true, ...item.value } : { ok: false, error: item.reason.message }) };
      } finally { if (agent.status === 'waiting') agent.status = 'running'; delete agent.waitingFor; this.store.save(job); }
    }
    if (name === 'checkpoint') {
      if (!['script', 'prototype'].includes(args.kind) || typeof args.summary !== 'string') throw new Error('Invalid checkpoint');
      // A decision made while the orchestrator was not running is returned before anything else.
      if (job.gate?.kind === args.kind && job.gate.decision && !job.gate.consumed) return this.consume(job);
      const enabled = args.kind === 'script' ? job.gateScript : job.gatePrototype;
      if (!enabled || job.approvedGates?.includes(args.kind)) return { decision: 'continue', reason: enabled ? 'Already approved' : 'Checkpoint disabled' };
      return this.waitForHuman(job, agent, { kind: args.kind, summary: args.summary.slice(0, 5000), file: normalizeFile(this.root, args.file || '') });
    }
    if (name === 'ask') {
      if (typeof args.question !== 'string' || !args.question.trim()) throw new Error('Ask a question');
      const options = Array.isArray(args.options) ? args.options.filter(option => typeof option === 'string' && option.trim()).slice(0, 6).map(option => option.slice(0, 200)) : [];
      return this.waitForHuman(job, agent, { kind: 'question', summary: args.question.slice(0, 4000), options, file: normalizeFile(this.root, args.file || '') });
    }
    if (name === 'complete') return this.qualify(job);
    throw new Error('Unknown runner tool');
  }
  async delegate(job, parent, args, track = true) {
    if (!DELEGATE_ROLES.includes(args.role)) throw new Error('Unsupported agent role');
    if (args.agentId && /reviewer$/.test(args.role)) throw new Error('Reviewers must be fresh agents; do not resume one');
    if (track) { parent.status = 'waiting'; parent.waitingFor = 'agents'; this.store.save(job); }
    await this.refresh(job, { force: true }).catch(() => {}); // tie the agent to the step the pipeline is on now
    try { return await this.runAgent(job, { role: args.role, prompt: args.prompt, agentId: args.agentId, parentId: parent.id }); }
    finally { if (track && parent.status === 'waiting') { parent.status = 'running'; delete parent.waitingFor; this.store.save(job); } }
  }
  // The agent's tool call stays open until you decide, so it cannot carry on past a checkpoint.
  async waitForHuman(job, agent, gate) {
    // After a restart the orchestrator asks again; a decision made in the meantime is returned at once.
    if (job.gate && job.gate.kind === gate.kind && job.gate.decision && !job.gate.consumed) return this.consume(job);
    job.gate = { id: randomUUID(), ...gate, agentId: agent.id, createdAt: new Date().toISOString(), decision: null };
    job.status = 'gate'; this.stopClock(job);
    agent.status = 'waiting'; agent.waitingFor = 'you';
    this.store.event(job, { type: 'checkpoint', text: gate.kind === 'question' ? `Question: ${gate.summary}` : gate.summary, kind: gate.kind, file: gate.file, agentId: agent.id, role: agent.role, source: 'runner' });
    this.store.save(job);
    try {
      await new Promise((resolve, reject) => this.gates.set(job.id, { resolve, reject }));
      return this.consume(job);
    } finally {
      this.gates.delete(job.id);
      if (agent.status === 'waiting') agent.status = 'running';
      delete agent.waitingFor; this.store.save(job);
    }
  }
  consume(job) {
    const gate = job.gate; gate.consumed = true;
    if (gate.kind === 'question') return { answer: gate.answer };
    return gate.decision === 'approve' ? { decision: 'approve', feedback: gate.feedback || '' }
      : { decision: 'revise', feedback: gate.feedback, instruction: `Revise the ${gate.kind} using this feedback, have it independently reviewed again, then call checkpoint again.` };
  }
  decide(job, fields) {
    Object.assign(job.gate, fields, { decidedAt: new Date().toISOString() });
    const waiting = this.gates.get(job.id);
    if (waiting) { job.status = 'running'; this.startClock(job); waiting.resolve(); }
    else { job.status = 'queued'; job.error = ''; } // detached after a restart: the resumed orchestrator reads the decision
  }
  async qualify(job) {
    const fail = message => { job.qualification = { ok: false, error: message, checkedAt: new Date().toISOString() }; this.store.save(job); throw new Error(message); };
    if ([...this.processes.values()].some(item => item.job.id === job.id && item.agent.role !== 'orchestrator')) fail('Cannot deliver while role agents are still running');
    await this.refresh(job, { force: true });
    if (job.pipeline?.state !== 'done') fail(`The pipeline has not qualified delivery. Its state is "${job.pipeline?.state || 'unknown'}": ${job.pipeline?.steps?.find(step => step.id === job.pipeline.current)?.detail || ''}`);
    const thumb = `${job.jobPath}/thumbnail`;
    const video = await jobFile(this.root, job, `${job.jobPath}/renders/video.mp4`).catch(() => fail('Missing renders/video.mp4'));
    const png = await jobFile(this.root, job, `${thumb}/thumbnail.png`).catch(() => fail('Missing thumbnail/thumbnail.png'));
    const size = pngSize(await readFile(png.path));
    if (size?.width !== 1280 || size?.height !== 720) fail('Thumbnail must be a real 1280×720 PNG');
    const files = (await listFiles(this.root, job)).filter(file => file.path.startsWith(`${thumb}/`));
    let preview = '';
    for (const file of files.filter(item => item.path.endsWith('.png'))) { const dims = pngSize(await readFile(path.join(this.root, file.path))); if (dims?.width === 320 && dims?.height === 180) { preview = file.path; break; } }
    if (!preview) fail('Missing the 320×180 feed-size thumbnail preview');
    const review = await readJson(path.join(this.root, `${thumb}/REVIEW.json`)).catch(() => null);
    const reviewer = job.agents.find(agent => agent.id === review?.reviewerAgentId && agent.role === 'thumbnail-reviewer' && agent.status === 'finished');
    if (review?.status !== 'pass' || !reviewer || !Array.isArray(review.inspectedFiles) || !review.inspectedFiles.length) fail('A fresh, finished thumbnail reviewer must independently pass the actual thumbnail in thumbnail/REVIEW.json');
    if (!files.some(file => /\.(svg|psd|ora|afdesign)$/.test(file.path))) fail('Missing editable thumbnail source');
    if (!files.some(file => /BRIEF\.md$/.test(file.path))) fail('Missing thumbnail brief');
    for (const file of files) {
      const archived = `library/thumbnails/${job.slug}/${file.path.slice(thumb.length + 1)}`;
      const target = await jobFile(this.root, job, archived).catch(() => fail(`Thumbnail archive is missing ${archived}`));
      const [a, b] = await Promise.all([readFile(path.join(this.root, file.path)), readFile(target.path)]);
      if (!a.equals(b)) fail(`Thumbnail archive does not match ${file.path}`);
    }
    Object.assign(job, { status: 'complete', completedAt: new Date().toISOString(), error: '', qualification: { ok: true, checkedAt: new Date().toISOString() } });
    job.outputs = { video: `${job.jobPath}/renders/video.mp4`, thumbnail: `${thumb}/thumbnail.png`, thumbnailPreview: preview, thumbnailSource: files.find(file => file.path.endsWith('.svg'))?.path || '', delivery: `${job.jobPath}/review/delivery.json`, thumbnailReview: `${thumb}/REVIEW.json` };
    this.store.event(job, { type: 'delivery', text: 'Delivery verified: the pipeline qualified the film; the independently reviewed thumbnail is archived', source: 'verified' });
    this.stopClock(job);
    await this.refresh(job, { force: true }).catch(() => {});
    return { complete: true, outputs: job.outputs, videoBytes: video.info.size };
  }

  markDirty(job) { const state = this.status.get(job.id) || {}; state.dirty = true; this.status.set(job.id, state); }
  // Reads the pipeline's own state (`status --json`), then recomputes the job's progress and health.
  async refresh(job, { force = false, files } = {}) {
    const state = this.status.get(job.id) || { last: 0 };
    this.status.set(job.id, state);
    if (state.running) { state.dirty = true; return state.running; }
    if (!force && !state.dirty && job.pipeline !== undefined && Date.now() - state.last < 60000) return this.recompute(job, files);
    if (!force && Date.now() - state.last < STATUS_INTERVAL) return this.recompute(job, files);
    state.dirty = false;
    state.running = (async () => {
      try {
        if (!await exists(path.join(this.root, job.jobPath, 'job.json'))) { job.pipeline = null; return; }
        const result = await this.statusCommand(job);
        const line = result.stdout.split('\n').reverse().find(text => text.startsWith('{'));
        if (!line) throw new Error((result.stderr || 'status printed nothing').split('\n').filter(text => !/DeprecationWarning|trace-deprecation/.test(text)).join(' ').slice(-400));
        const pipeline = JSON.parse(line);
        job.pipelineError = '';
        if (JSON.stringify(pipeline) !== JSON.stringify(job.pipeline)) {
          const previous = job.pipeline;
          job.pipeline = pipeline;
          if (previous?.state && previous.state !== pipeline.state) this.store.event(job, { type: 'pipeline', text: `Pipeline: ${pipeline.state}`, state: pipeline.state, step: pipeline.current, source: 'pipeline' });
        }
      } catch (error) { job.pipelineError = redact(error.message).slice(0, 600); }
      finally { state.last = Date.now(); state.running = null; }
    })();
    await state.running;
    return this.recompute(job);
  }
  async recompute(job, files) {
    // A status read that was in flight when the thread was deleted must not write it back.
    if (this.store.jobs.get(job.id) !== job) return;
    files ||= await listFiles(this.root, job).catch(() => []);
    const scriptReviewFile = files.find(file => file.path === `${job.scriptPath}/review.md`);
    const scriptReviewText = scriptReviewFile ? await readFile(path.join(this.root, scriptReviewFile.path), 'utf8').catch(() => '') : '';
    job.scriptReview = scriptReviewFile ? {
      status: scriptDisposition(scriptReviewText),
      stale: files.some(file => (file.path === `${job.scriptPath}/SCRIPT.md` || file.path === `${job.scriptPath}/research.md` || file.path.startsWith(`${job.scriptPath}/sources/`)) && file.modified > scriptReviewFile.modified),
    } : null;
    const review = await readJson(path.join(this.root, job.jobPath, 'thumbnail/REVIEW.json')).catch(() => null);
    job.thumbnailReview = review ? { status: String(review.status || ''), findings: Array.isArray(review.findings) ? review.findings.length : 0 } : null;
    const archived = await readdir(path.join(this.root, 'library/thumbnails', job.slug)).catch(() => []);
    const progress = computeProgress(job, { files, archived });
    const health = computeHealth(job, this.store.events(job.id));
    const changed = JSON.stringify(progress) !== JSON.stringify(job.progress) || JSON.stringify(health) !== JSON.stringify(job.health);
    job.progress = progress; job.health = health;
    if (changed) this.store.save(job);
  }
  async poll() {
    if (this.polling || this.closed) return;
    this.polling = true;
    try {
      for (const job of this.store.all().filter(item => ['running', 'gate', 'paused'].includes(item.status) || this.runningJobs.has(item.id))) {
        const files = await listFiles(this.root, job);
        const previous = this.files.get(job.id);
        const next = new Map(files.map(file => [file.path, `${file.modified}:${file.size}`]));
        this.files.set(job.id, next);
        if (previous) {
          const changed = files.filter(file => previous.get(file.path) !== next.get(file.path)), removed = [...previous.keys()].filter(file => !next.has(file));
          for (const file of changed.slice(0, 40)) {
            job.current = file.path; job.operation = 'changed on disk';
            this.store.event(job, { type: 'file', text: previous.has(file.path) ? 'File changed on disk' : 'File created on disk', file: file.path, source: 'filesystem', status: 'observed' });
          }
          for (const file of removed.slice(0, 20)) this.store.event(job, { type: 'file', text: 'File removed from disk', file, source: 'filesystem', status: 'observed' });
          if (changed.length + removed.length > 60) this.store.event(job, { type: 'file', text: `${changed.length + removed.length - 60} more file changes`, source: 'filesystem', status: 'observed' });
          if ([...changed.map(file => file.path), ...removed].some(file => file.startsWith(job.jobPath + '/'))) this.markDirty(job);
        }
        await this.refresh(job, { files });
      }
    } finally { this.polling = false; }
  }
  async control(job, action, data = {}) {
    const records = [...this.processes.values()].filter(item => item.job.id === job.id);
    if (action === 'pause') {
      if (!['running', 'queued'].includes(job.status)) throw new Error('Only a running or queued thread can be paused');
      job.status = 'paused'; job.pausedAt = new Date().toISOString(); this.stopClock(job);
    } else if (action === 'resume') {
      if (!['paused', 'interrupted', 'needs_attention', 'failed', 'cancelled'].includes(job.status)) throw new Error('This thread cannot be resumed in its current state');
      if (job.status === 'paused' && records.length) { job.status = 'running'; this.startClock(job); }
      else { if (this.runningJobs.has(job.id)) throw new Error('The previous agent is still exiting. Try again in a moment.'); job.status = 'queued'; }
      job.error = ''; delete job.pausedAt;
    } else if (action === 'cancel') {
      if (job.status === 'complete') throw new Error('This delivery is already complete');
      job.status = 'cancelled'; this.stopClock(job);
      this.gates.get(job.id)?.reject(new Error('Run cancelled'));
      for (const record of records) { signal(record.child, 'SIGCONT'); signal(record.child, 'SIGTERM'); const timer = setTimeout(() => { if (this.processes.get(record.agent.id) === record) signal(record.child, 'SIGKILL'); }, 5000); timer.unref(); }
    } else if (['approve', 'revise', 'answer'].includes(action)) {
      if (job.status !== 'gate' || !job.gate || job.gate.decision) throw new Error('Nothing is waiting for your decision');
      const text = String(data.feedback ?? data.answer ?? '').trim();
      if (action === 'answer') {
        if (job.gate.kind !== 'question') throw new Error('This checkpoint needs approve or revise');
        if (!text) throw new Error('Write an answer');
        this.store.message(job, 'You', text, '', { deliveredAt: new Date().toISOString(), answers: job.gate.id });
        this.decide(job, { decision: 'answer', answer: text });
      } else {
        if (job.gate.kind === 'question') throw new Error('Answer the question instead');
        if (action === 'revise' && !text) throw new Error('Describe the changes you want');
        this.store.message(job, 'You', `${action === 'approve' ? `Approved the ${job.gate.kind} checkpoint.` : `Requested changes to the ${job.gate.kind}.`}${text ? `\n\n${text}` : ''}`, '', { deliveredAt: new Date().toISOString() });
        if (action === 'approve') { job.approvedGates ||= []; job.approvedGates.push(job.gate.kind); }
        this.decide(job, { decision: action, feedback: text });
      }
    } else if (action === 'archive' || action === 'unarchive') {
      if (action === 'archive' && (records.length || ['running', 'queued', 'gate'].includes(job.status))) throw new Error('Pause or cancel the run before archiving it');
      job.archived = action === 'archive';
    } else throw new Error('Unknown run action');
    this.store.event(job, { type: 'lifecycle', text: `You: ${action}`, source: 'user' });
    this.store.save(job);
    this.wake(); this.pump();
    void this.refresh(job, { force: true }).catch(() => {});
    return job;
  }
  // Everything this thread made goes with it: the job and script folders, its uploaded inputs,
  // its archived thumbnail, and a pipeline pointer that would otherwise name a deleted job.
  // Reusable bundles in the library stay, because other films search for them there.
  // Disk first, the record last: a failed delete leaves the thread intact and retryable.
  async remove(job) {
    if (this.runningJobs.has(job.id) || [...this.processes.values()].some(item => item.job.id === job.id)) throw new Error('Cancel the run before deleting the thread');
    if (['running', 'queued', 'gate'].includes(job.status)) throw new Error('Cancel the run before deleting the thread');
    for (const folder of [job.jobPath, job.scriptPath, `library/thumbnails/${job.slug}`, ...this.uploadsOf(job)]) await removeFolder(this.root, folder);
    const latest = await readJson(path.join(this.root, '.video/latest.json')).catch(() => null);
    if (latest?.job === job.jobPath) await rm(path.join(this.root, '.video/latest.json'), { force: true });
    this.files.delete(job.id); this.status.delete(job.id);
    this.store.remove(job.id);
  }
  // Uploaded inputs sit in .video/ui/uploads/<id>/; only remove the ones no other thread still points at.
  uploadsOf(job) {
    const shared = new Set();
    for (const other of this.store.all()) {
      if (other.id === job.id) continue;
      for (const input of [other.audioPath, other.inputScript]) if (typeof input === 'string') shared.add(input.replace(/\/[^/]*$/, ''));
    }
    const mine = [];
    for (const input of [job.audioPath, job.inputScript]) {
      if (typeof input !== 'string') continue;
      const folder = input.replace(/\/[^/]*$/, '');
      if (/^\.video\/ui\/uploads\/[0-9a-f-]{36}$/.test(folder) && !shared.has(folder)) mine.push(folder);
    }
    return [...new Set(mine)];
  }
  async shutdown() {
    this.closed = true; clearInterval(this.timer);
    for (const [id, gate] of this.gates) { const job = this.store.jobs.get(id); if (job?.gate) job.gate.detached = true; gate.reject(new Error('Server stopping')); }
    for (const { child, job } of this.processes.values()) {
      if (!['gate', 'complete', 'cancelled'].includes(job.status)) { job.status = 'interrupted'; job.error = 'Server stopped during this run. Continue to resume it.'; }
      this.stopClock(job);
      try { this.store.save(job, false); } finally { signal(child, 'SIGCONT'); signal(child, 'SIGTERM'); }
    }
    this.wake();
    if (this.processes.size) await new Promise(resolve => {
      const timer = setTimeout(() => { for (const { child } of this.processes.values()) signal(child, 'SIGKILL'); resolve(); }, 4500);
      const check = () => { if (!this.processes.size) { clearTimeout(timer); resolve(); } };
      for (const { child } of this.processes.values()) child.once('close', check);
    });
    this.store.flush();
  }
}
