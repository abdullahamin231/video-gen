import { icon } from './icons.mjs';
import { ROLES, DELEGATE_ROLES, routeModel, roleModels } from './shared/routing.mjs';
import { durationFromPrompt, formatDuration } from './shared/duration.mjs';

// ---------- helpers ----------
const $ = (selector, parent = document) => parent.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const names = ['Codex', 'Claude', 'OpenCode', 'Pi'];
const marks = { Codex: '✳', Claude: '✺', OpenCode: '⌘', Pi: 'π' };
const labels = { queued: 'Queued', running: 'In progress', paused: 'Paused', gate: 'Needs your input', complete: 'Delivered', failed: 'Failed', needs_attention: 'Needs attention', interrupted: 'Interrupted', cancelled: 'Cancelled' };
const roleLabel = role => role === 'You' ? 'You' : ROLES.find(item => item.role === role)?.label.replace(/s$/, '') || String(role || '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const time = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const count = value => new Intl.NumberFormat().format(Math.round(value || 0));
const span = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`; };
const ago = at => at ? `${span(Date.now() - Date.parse(at))} ago` : '';
const since = at => at ? `<span data-since="${esc(at)}">${span(Date.now() - Date.parse(at))}</span>` : '';
const sinceAgo = at => at ? `<span data-ago="${esc(at)}">${ago(at)}</span>` : '';
const format = j => j.format === 'vertical' ? '9:16' : '16:9';
const duration = j => !j.duration ? 'length: agent’s call' : j.duration >= 60 ? `${Math.floor(j.duration / 60)}m${j.duration % 60 ? ` ${j.duration % 60}s` : ''}` : `${j.duration}s`;
const elapsedMs = j => (j.elapsedMs || 0) + (j.runStartedAt ? Date.now() - j.runStartedAt : 0);
const short = (file, job) => String(file || '').replace(`${job.jobPath}/`, '').replace(`${job.scriptPath}/`, 'script/');
const live = agent => ['running', 'starting', 'waiting'].includes(agent.status);
const statusIcon = status => ({ done: icon('check'), skipped: icon('check'), current: '<span class="running-ring"></span>', repair: icon('retry'), blocked: icon('x'), waiting: icon('pause') }[status] || '');

// ---------- state ----------
const state = {
  jobs: new Map(), selected: null, job: null, messages: [], events: [], files: [], providers: [], usage: [],
  settings: { concurrency: 1, defaultFormat: 'landscape' },
  tab: 'thread', inspectorTab: 'overview', connected: false, loading: true, showArchived: false,
  activityFilter: 'all', activityAgent: '', olderLoaded: false, drawer: null,
  view: 'threads', ideas: null, ideaFilter: 'new', ideasBusy: false,
};
try { state.selected = localStorage.getItem('video-workspace-selected'); } catch {}
let toastTimer, lastFocus, renderQueued = false, filesTimer, filesRequest = 0;

function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500); }
async function api(url, { method = 'GET', data, raw } = {}) {
  const response = await fetch(url, { method, headers: { ...(method !== 'GET' ? { 'X-Video-Client': '1' } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: raw || (data !== undefined ? JSON.stringify(data) : undefined) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}
const artifact = (p, download = false) => `/api/jobs/${state.job.id}/artifact?path=${encodeURIComponent(p)}${download ? '&download=1' : ''}`;
const agentById = id => state.job?.agents.find(agent => agent.id === id);

// ---------- data ----------
async function loadJobs() {
  const list = await api('/api/jobs');
  state.jobs = new Map(list.map(job => [job.id, job]));
  const visible = [...state.jobs.values()].filter(job => !job.archived);
  if (!state.selected || !state.jobs.has(state.selected)) state.selected = visible[0]?.id || null;
  await loadDetail();
}
async function loadDetail() {
  if (!state.selected) { state.job = null; state.messages = []; state.events = []; state.loading = false; return schedule(); }
  const id = state.selected, detail = await api(`/api/jobs/${id}`);
  if (id !== state.selected) return;
  const { messages, events, ...job } = detail;
  Object.assign(state, { job, messages, events, olderLoaded: false, loading: false });
  state.jobs.set(id, job);
  try { localStorage.setItem('video-workspace-selected', id); } catch {}
  if (state.tab === 'files' || state.tab === 'outputs') await loadFiles();
  schedule();
}
async function loadFiles() {
  if (!state.job) return;
  const request = ++filesRequest;
  const id = state.job.id, files = await api(`/api/jobs/${id}/files`);
  if (state.job?.id === id && request === filesRequest) { state.files = files; schedule(); }
}
function applyUpdate(update) {
  for (const id of update.removed) { state.jobs.delete(id); if (state.selected === id) { state.selected = null; void loadJobs(); } }
  for (const job of update.jobs) { state.jobs.set(job.id, job); if (job.id === state.selected) state.job = job; }
  const lastSeq = state.events.at(-1)?.seq ?? 0;
  for (const event of update.events) if (event.jobId === state.selected && event.seq > lastSeq) state.events.push(event);
  if (state.events.length > 1500) state.events.splice(0, state.events.length - 1500);
  for (const message of update.messages) {
    if (message.jobId !== state.selected) continue;
    const index = state.messages.findIndex(item => item.id === message.id);
    if (index >= 0) state.messages[index] = message; else state.messages.push(message);
  }
  if (update.events.some(event => event.jobId === state.selected && event.type === 'file') && ['files', 'outputs'].includes(state.tab)) {
    clearTimeout(filesTimer); filesTimer = setTimeout(() => loadFiles().catch(() => {}), 1200);
  }
  if (state.drawer) refreshDrawer(update.events.filter(event => event.agentId === state.drawer));
  schedule();
}

// ---------- rendering ----------
// Regions are replaced only when their HTML changes, so a playing video or an open menu is left alone.
function set(element, html) {
  if (!element || element._html === html) return false;
  const drafts = [...element.querySelectorAll('textarea[id],input[id]')].map(input => ({ id: input.id, value: input.value, focused: document.activeElement === input, start: input.selectionStart, end: input.selectionEnd }));
  const open = [...element.querySelectorAll('details[data-key][open]')].map(item => item.dataset.key);
  element.innerHTML = html; element._html = html;
  for (const draft of drafts) {
    const input = element.querySelector('#' + CSS.escape(draft.id)); if (!input) continue;
    input.value = draft.value;
    if (draft.focused && !$('.modal')) { input.focus(); try { input.setSelectionRange(draft.start, draft.end); } catch {} }
  }
  for (const key of open) { const item = element.querySelector(`details[data-key="${CSS.escape(key)}"]`); if (item) item.open = true; }
  return true;
}
function schedule() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); }
function render() {
  if (!$('#sidebar')) $('#app').innerHTML = '<aside id="sidebar" class="sidebar" aria-label="Video threads"></aside><main class="main-panel" id="main"><div id="topbar"></div><div id="heading"></div><div class="content-scroll" id="content-scroll"></div><div id="footer"></div></main><aside id="inspector" class="inspector" aria-label="Job inspector"></aside>';
  $('#app').classList.toggle('no-job', !state.job || state.view === 'ideas');
  set($('#sidebar'), sidebar());
  set($('#topbar'), topbar());
  const scroller = $('#content-scroll');
  if (state.view === 'ideas') { set($('#heading'), ''); set(scroller, ideasView()); set($('#footer'), ''); set($('#inspector'), ''); return; }
  const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80, top = scroller.scrollTop;
  if (!state.job) { set($('#heading'), ''); set(scroller, welcome()); set($('#footer'), ''); set($('#inspector'), ''); return; }
  set($('#heading'), heading());
  const changed = set(scroller, { thread, progress: progressView, agents: agentsView, activity, files: fileView, outputs }[state.tab]());
  if (changed) scroller.scrollTop = state.tab === 'thread' && atBottom ? scroller.scrollHeight : top;
  set($('#footer'), state.tab === 'thread' ? composer() : `<div class="view-footer">${icon('info')}Local artifacts · ${esc(state.job.jobPath)}</div>`);
  set($('#inspector'), inspector());
}
// Live clocks update in place every second instead of re-rendering.
setInterval(() => {
  for (const node of document.querySelectorAll('[data-since]')) node.textContent = span(Date.now() - Date.parse(node.dataset.since));
  for (const node of document.querySelectorAll('[data-ago]')) node.textContent = ago(node.dataset.ago);
  const clock = $('#elapsed'); if (clock && state.job) clock.textContent = span(elapsedMs(state.job));
}, 1000);

// ---------- chrome ----------
function sidebar() {
  const all = [...state.jobs.values()], archivedCount = all.filter(job => job.archived).length;
  const list = all.filter(job => Boolean(job.archived) === state.showArchived);
  const fresh = state.ideas?.cards.filter(card => card.status === 'new').length || 0;
  return `<button class="new-job" data-action="new">${icon('plus')}New video<span class="keycap">N</span></button>
  <button class="ideas-nav ${state.view === 'ideas' ? 'selected' : ''}" data-action="ideas" ${state.view === 'ideas' ? 'aria-current="page"' : ''}>${icon('bulb')}Ideas${fresh ? `<span class="tab-count">${fresh}</span>` : ''}</button>
  <nav class="job-list" aria-label="Threads">${list.map(job => {
    const progress = job.progress, current = progress?.current;
    const sub = job.status === 'running' && current ? current.label : labels[job.status] || job.status;
    const selected = job.id === state.selected && state.view === 'threads';
    return `<button class="job-item ${selected ? 'selected' : ''}" data-action="select" data-id="${job.id}" ${selected ? 'aria-current="page"' : ''}>
      <span class="job-state ${esc(job.status)}">${jobIcon(job)}</span>
      <span class="job-item-copy"><strong>${esc(job.title)}</strong><small>${esc(sub)}</small>${progress ? `<span class="mini-progress"><span style="width:${(progress.done / progress.total * 100).toFixed(1)}%"></span></span>` : ''}</span>
      ${job.status === 'gate' ? '<span class="notification-dot"></span>' : ''}</button>`;
  }).join('') || `<div class="empty-search">${state.showArchived ? 'No archived threads.' : 'Your video threads will appear here.'}</div>`}</nav>
  ${archivedCount || state.showArchived ? `<button class="sidebar-archive text-button" data-action="toggle-archived">${icon('archive')}${state.showArchived ? 'Back to threads' : `Archived (${archivedCount})`}</button>` : ''}`;
}
const jobIcon = job => job.status === 'running' ? '<span class="running-ring"></span>' : icon(job.status === 'complete' ? 'check' : ['failed', 'interrupted', 'needs_attention'].includes(job.status) ? 'warning' : job.status === 'queued' ? 'clock' : job.status === 'gate' ? 'question' : 'pause');
const badge = job => `<span class="status-badge ${esc(job.status)}">${jobIcon(job)}${labels[job.status] || job.status}</span>`;
function topbar() {
  return `<header class="topbar"><button class="icon-button mobile-menu" data-action="sidebar" aria-label="Toggle threads">${icon('menu')}</button><div class="breadcrumbs"><span>video-gen</span>${state.view === 'ideas' ? `${icon('chevron')}<span>Ideas</span>` : state.job ? `${icon('chevron')}<span>${esc(state.job.title)}</span>` : ''}</div><div class="topbar-right"><span class="connection-label ${state.connected ? 'connected' : ''}"><span class="tiny-dot"></span>${state.connected ? 'Live' : 'Reconnecting…'}</span><button class="text-button usage-trigger" data-action="usage">${icon('pulse')}Usage</button><button class="icon-button" data-action="settings" aria-label="Workspace settings">${icon('sliders')}</button></div></header>`;
}
function welcome() {
  return `<div class="welcome"><div class="welcome-content"><span class="welcome-symbol">${icon('film')}</span><h1>What are we making?</h1><p>Give your agent an idea. Follow every step, every agent and every file, from the first brief to the final video.</p><button class="primary-button" data-action="new">${icon('plus')}New video</button><div class="welcome-features"><span>${icon('terminal')}Your CLI, your models</span><span>${icon('layers')}Every pipeline step</span><span>${icon('users')}Every sub-agent</span></div>${state.loading ? '<p class="muted">Loading your workspace…</p>' : ''}</div></div>`;
}
function heading() {
  const job = state.job, liveAgents = job.agents.filter(live).length;
  const tabs = [['thread', 'chat', 'Thread'], ['progress', 'layers', 'Progress'], ['agents', 'users', 'Agents', liveAgents ? `${liveAgents} live` : job.agents.length || ''], ['activity', 'pulse', 'Activity', job.eventSeq || ''], ['files', 'folder', 'Files'], ['outputs', 'grid', 'Outputs']];
  return `<div class="job-heading"><div><div class="eyebrow">VIDEO THREAD <span>/ ${job.id.slice(0, 6)}</span></div><h1>${esc(job.title)}</h1><div class="job-meta"><span>${icon('film')}${format(job)} · ${duration(job)}</span><span class="meta-separator"></span><span>${marks[job.provider]} ${job.provider}</span><span class="meta-separator"></span><span>${icon('pulse')}${job.usage?.reports ? count(job.usage.total) + ' tokens' : 'Tokens pending'}</span><span class="meta-separator"></span><span>${icon('clock')}<span id="elapsed">${span(elapsedMs(job))}</span></span></div></div><div class="heading-actions">${badge(job)}<button class="icon-button inspector-toggle" data-action="inspector" aria-label="Toggle inspector">${icon('sliders')}</button></div></div>
  <nav class="content-tabs" aria-label="Thread views">${tabs.map(([key, image, label, n]) => `<button class="content-tab ${state.tab === key ? 'active' : ''}" data-action="tab" data-tab="${key}" ${state.tab === key ? 'aria-current="page"' : ''}>${icon(image)}${label}${n ? `<span class="tab-count">${esc(n)}</span>` : ''}</button>`).join('')}<span class="tab-spacer"></span><a class="text-button" href="/api/jobs/${job.id}/log" download aria-label="Download full event log">${icon('download')}</a></nav>`;
}

// ---------- thread ----------
function thread() {
  const job = state.job, orchestrator = job.orchestratorId;
  const shown = new Set(['lifecycle', 'pipeline', 'checkpoint', 'delivery']);
  const items = [
    ...state.messages.filter(m => m.role === 'You' || m.agentId === orchestrator || m.role === 'orchestrator').map(m => ({ ...m, kind: 'message' })),
    ...state.events.filter(e => shown.has(e.type) || (e.type === 'progress' && e.agentId === orchestrator) || (e.type === 'agent' && e.role !== 'orchestrator') || (e.type === 'error' && e.source === 'runner')).map(e => ({ ...e, kind: 'event' })),
  ].sort((a, b) => a.at.localeCompare(b.at)).slice(-300);
  return `<div class="thread-content"><div class="thread-date"><span></span>${new Date(job.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }).toUpperCase()}<span></span></div>${items.map(item => item.kind === 'message' ? message(item) : threadEvent(item)).join('')}${nowCard()}${job.error && !['running', 'gate'].includes(job.status) ? `<div class="run-error">${icon('warning')}<div><strong>${labels[job.status] || job.status}</strong><p>${esc(job.error)}</p>${['interrupted', 'failed', 'needs_attention', 'cancelled'].includes(job.status) ? `<button class="secondary-button small" data-action="resume">${icon('retry')}Continue from saved state</button>` : ''}</div></div>` : ''}${job.status === 'gate' && job.gate && !job.gate.decision ? gate() : ''}${job.status === 'complete' ? `<div class="delivery-notice">${icon('check')}Video and reviewed thumbnail are ready.<button class="text-button accent" data-action="tab" data-tab="outputs">View outputs ${icon('arrow')}</button></div>` : ''}</div>`;
}
function message(item) {
  const user = item.role === 'You';
  const pending = user && !item.deliveredAt && item !== state.messages[0] && !['complete', 'cancelled'].includes(state.job.status);
  return `<article class="message ${user ? 'user-message' : ''}"><div class="avatar ${user ? 'user-avatar' : 'agent-avatar'}">${user ? 'Y' : icon('bolt')}</div><div class="message-body"><div class="message-heading"><strong>${user ? 'You' : 'Orchestrator'}</strong>${user ? '' : `<span class="agent-label">${esc(agentById(item.agentId)?.model || state.job.provider)}</span>`}<time>${time(item.at)}</time></div><p class="message-text">${esc(item.text)}</p>${pending ? '<span class="feedback-pending">Queued for the orchestrator’s next feedback check</span>' : ''}</div></article>`;
}
function threadEvent(event) {
  if (event.type === 'agent') {
    const agent = agentById(event.agentId);
    return `<button class="thread-event agent-event ${esc(event.status || '')}" data-action="agent" data-id="${esc(event.agentId)}">${icon('branch')}<span><strong>${esc(roleLabel(event.role))}</strong> · ${esc(event.text)}${event.status && agent && !live(agent) && agent.finishedAt && agent.startedAt ? ` <span class="muted">(${span(Date.parse(agent.finishedAt) - Date.parse(agent.startedAt))})</span>` : ''}</span><time>${time(event.at)}</time></button>`;
  }
  const image = { delivery: 'check', checkpoint: 'question', pipeline: 'layers', error: 'warning', progress: 'bolt' }[event.type] || 'pulse';
  return `<div class="thread-event ${event.type === 'error' ? 'error' : ''} ${event.type === 'pipeline' ? 'pipeline-event' : ''}">${icon(image)}<span>${esc(event.text)}</span><time>${time(event.at)}</time></div>`;
}
// The live answer to "what is happening right now?"
function nowCard() {
  const job = state.job, current = job.progress?.current, health = job.health;
  const working = job.agents.filter(live);
  // A stopped run already has its own error card; the live card is for live work.
  if (!['running', 'paused', 'gate', 'queued'].includes(job.status) && !working.length) return '';
  return `<section class="now-card health-${esc(health?.level || 'idle')}"><div class="now-top"><div class="task-indicator ${esc(job.status)}">${jobIcon(job)}</div><div><span class="eyebrow">NOW</span><strong>${esc(current ? current.label : labels[job.status])}</strong><small>${esc(current?.detail || health?.headline || '')}</small></div><button class="text-button" data-action="tab" data-tab="progress">All steps ${icon('arrow')}</button></div>
  ${working.length ? `<div class="now-agents">${working.map(agentLine).join('')}</div>` : `<div class="now-empty muted">${job.status === 'queued' ? 'Waiting for a runner slot.' : 'No agent is running.'}</div>`}
  <div class="now-health"><span class="health-dot"></span>${esc(health?.headline || '')}${health?.lastEventAt ? ` · last activity ${sinceAgo(health.lastEventAt)}` : ''}</div></section>`;
}
function agentLine(agent) {
  const waiting = agent.status === 'waiting' ? { agents: 'waiting for its sub-agents', you: 'waiting for you', pause: 'held by pause' }[agent.waitingFor] || 'waiting' : '';
  return `<button class="agent-line" data-action="agent" data-id="${agent.id}"><span class="agent-dot ${esc(agent.status)}"></span><span class="agent-line-main"><strong>${esc(roleLabel(agent.role))}</strong><span>${esc(agent.task || '')}</span></span><span class="agent-line-file">${waiting ? `<em>${esc(waiting)}</em>` : agent.current ? `<span class="file-operation">${esc(String(agent.operation || 'file').toUpperCase())}</span><code>${esc(short(agent.current, state.job))}</code>` : `<em>${esc(agent.lastTool?.text || 'starting…')}</em>`}</span><span class="agent-line-time">${since(agent.startedAt)}</span></button>`;
}
function gate() {
  const g = state.job.gate;
  if (g.kind === 'question') return `<div class="gate-card question"><div class="gate-icon">${icon('question')}</div><div class="gate-content"><span class="eyebrow">THE AGENT ASKS</span><h3>${esc(g.summary)}</h3>${g.file ? `<button class="file-pill" data-action="file" data-file="${esc(g.file)}">${icon('file')}${esc(g.file)}${icon('arrow')}</button>` : ''}${g.options?.length ? `<div class="gate-options">${g.options.map(option => `<button class="secondary-button small" data-action="answer-option" data-answer="${esc(option)}">${esc(option)}</button>`).join('')}</div>` : ''}<label class="sr-only" for="gate-answer">Your answer</label><textarea id="gate-answer" class="gate-feedback" rows="3" maxlength="20000" placeholder="Your answer…"></textarea><div class="gate-actions"><button class="primary-button small" data-action="answer">${icon('send')}Send answer</button></div><small class="muted">The agent is paused on this question until you answer.</small></div></div>`;
  return `<div class="gate-card"><div class="gate-icon">${icon('pause')}</div><div class="gate-content"><span class="eyebrow">YOUR CHECKPOINT</span><h3>${g.kind === 'script' ? 'Review the script before production' : 'Review the prototype before the full build'}</h3><p>${esc(g.summary)}</p>${g.file ? `<button class="file-pill" data-action="file" data-file="${esc(g.file)}">${icon('file')}${esc(g.file)}${icon('arrow')}</button>` : ''}<label class="sr-only" for="gate-feedback">Feedback for the agent</label><textarea id="gate-feedback" class="gate-feedback" placeholder="Optional notes, or the changes you want…" rows="3" maxlength="20000"></textarea><div class="gate-actions"><button class="primary-button small" data-action="approve">${icon('check')}Approve & continue</button><button class="secondary-button small" data-action="revise">Request changes</button></div><small class="muted">The agent waits here. Your approval never replaces the independent reviews.</small></div></div>`;
}
function composer() {
  return `<div class="composer-area"><form id="message-form" class="composer"><label class="sr-only" for="message-input">Send direction to this thread</label><textarea id="message-input" placeholder="Add direction or leave feedback…" rows="1" maxlength="20000"></textarea><div class="composer-toolbar"><button type="button" class="text-button provider-trigger" data-action="configure"><span class="provider-mark">${marks[state.job.provider]}</span>${state.job.provider}${icon('down')}</button><span class="composer-hint">Delivered at the orchestrator’s next feedback check</span><button class="send-button" type="submit" aria-label="Send">${icon('send')}</button></div></form></div>`;
}

// ---------- ideas ----------
const IDEA_FILTERS = [['new', 'New'], ['saved', 'Saved'], ['used', 'Made'], ['rejected', 'Rejected'], ['all', 'All']];
const REJECT_REASONS = ['Wrong audience', 'Already covered', 'Weak evidence', 'Wrong angle', 'Too expensive to make'];
async function loadIdeas() { state.ideas = await api('/api/ideas'); schedule(); }
function ideasView() {
  const data = state.ideas;
  if (!data) return '<div class="view-content"><div class="empty-state"><p>Loading ideas…</p></div></div>';
  const counts = Object.fromEntries(IDEA_FILTERS.map(([key]) => [key, key === 'all' ? data.cards.length : data.cards.filter(card => card.status === key).length]));
  const list = data.cards.filter(card => state.ideaFilter === 'all' || card.status === state.ideaFilter);
  const run = data.lastRun, failed = run?.sources.filter(source => !source.ok) || [];
  const busy = state.ideasBusy || data.running;
  return `<div class="view-content ideas-view"><div class="view-title"><div><h2>Ideas worth making.</h2><p>Pulled from Hugging Face, r/LocalLLaMA, Hacker News, GitHub and reference channels’ outlier videos, then ranked by momentum and by how close they are to the questions that do best: what to buy, whether your machine is enough, what it costs. Every search brings only ideas you have not seen.</p></div><span class="subtle-tag">${esc(data.niche.toUpperCase())}</span></div>
  <form id="ideas-form" class="ideas-ask"><label class="sr-only" for="idea-focus">What should the next ideas be about?</label><input id="idea-focus" name="focus" maxlength="200" placeholder="Ask for more, e.g. “Mac hardware”, “coding models”, “cheap GPUs”. Leave empty for anything new." ${busy ? 'disabled' : ''}><button class="primary-button" type="submit" ${busy ? 'disabled' : ''}>${busy ? '<span class="running-ring"></span>Looking…' : `${icon('search')}Find more ideas`}</button></form>
  ${run ? `<div class="ideas-run">${icon('clock')}<span>Last search ${sinceAgo(run.at)}${run.focus ? ` for “${esc(run.focus)}”` : ''}: ${run.found} new idea${run.found === 1 ? '' : 's'} from ${run.considered} candidate${run.considered === 1 ? '' : 's'}.</span><details data-key="idea-sources"><summary>${run.sources.length - failed.length}/${run.sources.length} sources answered</summary><ul>${run.sources.map(source => `<li class="${source.ok ? '' : 'failed'}">${icon(source.ok ? 'check' : 'warning')}${esc(source.name)} · ${source.ok ? `${source.count} item${source.count === 1 ? '' : 's'}${source.cached ? ' (cached)' : ''}` : esc(source.error)}</li>`).join('')}</ul></details></div>` : ''}
  ${failed.length ? `<div class="inline-error">${icon('warning')}${failed.length} of ${run.sources.length} sources did not answer in the last search (see the source list above). The ideas come from the rest.</div>` : ''}
  <div class="activity-filters">${IDEA_FILTERS.map(([key, label]) => `<button class="chip ${state.ideaFilter === key ? 'active' : ''}" data-action="idea-filter" data-filter="${key}">${label}${counts[key] ? ` · ${counts[key]}` : ''}</button>`).join('')}</div>
  ${list.length ? `<div class="idea-grid">${list.map(ideaCard).join('')}</div>` : `<div class="empty-state"><p>${!data.cards.length ? 'No ideas yet. Find some: the first search takes a few seconds.' : state.ideaFilter === 'new' ? 'You have been through every new idea. Ask for more above.' : 'Nothing here yet.'}</p>${!data.cards.length && !busy ? `<button class="primary-button" data-action="ideas-find">${icon('search')}Find ideas</button>` : ''}</div>`}</div>`;
}
function ideaCard(card) {
  const sources = card.sources || [];
  const actions = card.status === 'rejected' ? `<button class="secondary-button small" data-action="idea-status" data-id="${card.id}" data-status="new">${icon('retry')}Restore</button>`
    : `<button class="primary-button small" data-action="idea-make" data-id="${card.id}">${icon('film')}Make video</button>${card.status === 'saved' ? `<button class="secondary-button small" data-action="idea-status" data-id="${card.id}" data-status="new">Unsave</button>` : `<button class="secondary-button small" data-action="idea-status" data-id="${card.id}" data-status="saved">${icon('star')}Save</button>`}<button class="text-button" data-action="idea-reject" data-id="${card.id}">${icon('x')}Not for us</button>`;
  return `<article class="idea-card ${esc(card.status)}"><div class="idea-top"><span class="eyebrow">${esc(card.form.toUpperCase())}</span><span class="idea-score" title="${esc(Object.entries(card.scoreParts || {}).map(([key, value]) => `${key} ${value}`).join(' · '))}">${Math.round(card.score * 100)}</span></div><h3>${esc(card.title)}</h3><p>${esc(card.promise)}</p>${card.reasons?.length ? `<ul class="idea-reasons">${card.reasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul>` : ''}<details class="idea-sources" data-key="src-${card.id}"><summary>${sources.length} source${sources.length === 1 ? '' : 's'} · ${esc([...new Set(sources.map(source => source.label))].join(', '))}</summary><ul>${sources.map(source => `<li><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)}${icon('arrow')}</a><small>${esc(source.label)}${source.metric ? ` · ${esc(source.metric)}` : ''}</small></li>`).join('')}</ul></details>${card.status === 'used' ? `<small class="muted">A video thread was started from this idea.</small>` : ''}${card.status === 'rejected' && card.reason ? `<small class="muted">Rejected: ${esc(card.reason)}</small>` : ''}<div class="idea-actions">${actions}</div></article>`;
}
// The new-video form, filled in from an idea: its angle, plus the sources the script writer should start from.
// No length: the agent chooses one that fits, unless the user adds one before starting.
function ideaPrompt(card) {
  const links = [...new Set((card.sources || []).flatMap(source => [source.url, source.link]).filter(Boolean))];
  return `An explainer: ${card.title}\n\n${card.promise}\n\nStart from these sources and check every claim against primary evidence:\n${links.map(link => `- ${link}`).join('\n')}`;
}
async function findIdeas(focus = '') {
  state.ideasBusy = true; schedule();
  try { const result = await api('/api/ideas', { method: 'POST', data: { focus } }); state.ideas = result; state.ideaFilter = 'new'; toast(result.found.length ? `${result.found.length} new idea${result.found.length === 1 ? '' : 's'}.` : focus ? `No new ideas about “${focus}”. Try other words.` : 'No new ideas right now. Try again later or ask for a topic.'); }
  finally { state.ideasBusy = false; schedule(); }
}
async function ideaStatus(id, status, reason = '') {
  const card = await api(`/api/ideas/${id}`, { method: 'PATCH', data: { status, reason } });
  const index = state.ideas?.cards.findIndex(item => item.id === id) ?? -1; if (index >= 0) state.ideas.cards[index] = card; schedule();
}

// ---------- progress ----------
function progressView() {
  const job = state.job, progress = job.progress;
  if (!progress) return '<div class="view-content"><div class="empty-state"><p>Working out where this job is…</p></div></div>';
  const film = progress.phases.find(phase => phase.id === 'film');
  return `<div class="view-content progress-view"><div class="view-title"><div><h2>Every step, from brief to delivery.</h2><p>Read from the pipeline’s own state, the job’s files and the running processes — not from the agent’s say-so.</p></div><span class="subtle-tag">${progress.done} / ${progress.total} STEPS</span></div>
  <div class="overall"><div class="progress-track"><span style="width:${(progress.done / progress.total * 100).toFixed(1)}%"></span></div>${pipelineSays()}</div>
  ${job.pipelineError ? `<div class="inline-error">${icon('warning')}Could not read pipeline status: ${esc(job.pipelineError)}</div>` : ''}
  ${progress.phases.map(phase => `<section class="phase"><div class="phase-head"><h3>${esc(phase.label)}</h3><span>${phase.steps.filter(step => ['done', 'skipped'].includes(step.status)).length}/${phase.steps.length}</span></div><ol class="steps">${phase.steps.map(stepRow).join('')}</ol>${phase.id === 'film' ? scenesGrid(film) + reviewsTable(film) : ''}</section>`).join('')}</div>`;
}
function pipelineSays() {
  const job = state.job, pipeline = job.pipeline, told = job.lastNext;
  const next = pipeline?.next;
  const nextText = !next ? '' : next.command ? `run <code>video ${esc(next.command)}</code>` : `${esc(roleLabel(next.role))}${next.briefs?.length > 1 ? ` ×${next.briefs.length}` : ''} → ${next.briefs.map(brief => `<button class="link-file" data-action="file" data-file="${esc(brief)}">${esc(brief.split('/').at(-1))}</button>`).join(', ')}`;
  return `<div class="pipeline-says"><div><span class="eyebrow">PIPELINE STATE</span><strong>${esc(pipeline?.state || 'not started')}</strong>${nextText ? `<small>Next: ${nextText}</small>` : ''}</div>${told ? `<div><span class="eyebrow">LAST TOLD THE AGENT</span><strong>STATE: ${esc(told.state)}</strong><small>${esc(told.actions.find(action => action.kind === 'DO')?.text || '')} · ${sinceAgo(told.at)}</small></div>` : ''}</div>`;
}
function stepRow(step) {
  const agents = (step.agents || []).map(agentById).filter(Boolean);
  return `<li class="step ${esc(step.status)}"><span class="step-marker">${statusIcon(step.status)}</span><div class="step-body"><div class="step-line"><strong>${esc(step.label)}</strong>${step.status === 'repair' ? '<span class="step-tag repair">repairing</span>' : step.status === 'blocked' ? '<span class="step-tag blocked">blocked</span>' : step.status === 'waiting' ? '<span class="step-tag waiting">your turn</span>' : ''}</div>${step.detail ? `<small>${step.file && step.status === 'done' ? `<button class="link-file" data-action="file" data-file="${esc(step.file)}">${esc(step.detail)}</button>` : esc(step.detail)}</small>` : ''}${step.running ? `<div class="step-running"><span class="running-ring"></span>Running <code>video ${esc(step.running.command)}</code> · ${since(step.running.startedAt)}</div>` : ''}${agents.length ? `<div class="agent-chips">${agents.slice(-8).map(agent => `<button class="agent-chip ${esc(agent.status)}" data-action="agent" data-id="${agent.id}"><span class="agent-dot ${esc(agent.status)}"></span>${esc(agent.scene || roleLabel(agent.role))}</button>`).join('')}${agents.length > 8 ? `<span class="muted">+${agents.length - 8}</span>` : ''}</div>` : ''}${step.errors?.length ? `<details class="step-errors" data-key="errors-${esc(step.id)}"><summary>${step.errors.length} problem(s)</summary><ul>${step.errors.map(error => `<li>${esc(error)}</li>`).join('')}</ul></details>` : ''}</div></li>`;
}
function scenesGrid(film) {
  if (!film.scenes?.length) return '';
  const building = new Map(state.job.agents.filter(agent => live(agent) && agent.scene).map(agent => [agent.scene, agent]));
  const total = film.scenes.at(-1).end || 1;
  return `<div class="scenes"><div class="section-label">SCENES<span>${film.scenes.filter(scene => scene.built).length}/${film.scenes.length} built · ★ prototype</span></div><div class="scene-strip">${film.scenes.map(scene => {
    const problems = scene.buildErrors + scene.pixelErrors + scene.findings, agent = building.get(scene.id);
    const cls = agent ? 'building' : problems ? 'problem' : scene.built ? 'built' : 'pending';
    const width = scene.end != null ? Math.max(2, (scene.end - scene.start) / total * 100) : 100 / film.scenes.length;
    return `<button class="scene ${cls} ${scene.prototypeCut ? 'proto-cut' : ''}" style="flex-basis:${width.toFixed(2)}%" data-action="${agent ? 'agent' : 'file'}" ${agent ? `data-id="${agent.id}"` : `data-file="${esc(scene.built ? scene.spec : scene.briefs[0] || scene.spec)}"`} title="${esc(`${scene.id} · ${scene.start?.toFixed?.(1) ?? '?'}–${scene.end?.toFixed?.(1) ?? '?'}s · ${scene.owner}${agent ? ' · being built' : ''}${problems ? ` · ${problems} problem(s)` : ''}`)}"><span>${scene.prototype ? '★ ' : ''}${esc(scene.id)}</span><small>${scene.owner === 'director' ? 'D' : 'B'}${problems ? ` · ${problems}!` : ''}</small></button>`;
  }).join('')}</div><div class="scene-legend"><span class="pending">Not built</span><span class="building">Being built</span><span class="built">Built</span><span class="problem">Has problems</span><span>D director · B builder</span></div></div>`;
}
function reviewsTable(film) {
  if (!film.reviews) return '';
  return `<div class="reviews">${['prototype', 'final'].map(stage => {
    const review = film.reviews[stage];
    if (!review) return '';
    return `<div class="review-stage"><div class="section-label">${stage.toUpperCase()} REVIEW<span>${review.accepted ? 'accepted' : review.ok ? 'passed' : review.pack ? `evidence frozen${review.rounds ? ` · round ${review.rounds}` : ''}` : 'not started'}</span></div>${review.roles.map(role => `<div class="review-role"><span>${esc(role.role.replace(/-/g, ' '))}</span><span class="verdict ${role.valid ? esc(role.verdict) : role.verdict ? 'stale' : 'none'}">${role.valid ? esc(role.verdict) : role.verdict ? 'stale' : '—'}</span><small>${role.blocking ? `${role.blocking} blocking · ` : ''}${role.advisory ? `${role.advisory} advisory` : ''}${role.error ? esc(role.error.slice(0, 120)) : ''}</small>${role.findings.length ? `<details data-key="f-${stage}-${esc(role.role)}"><summary>Findings</summary><ul>${role.findings.map(f => `<li><strong>${esc(f.subject)}</strong> ${f.start != null ? `(${Number(f.start).toFixed(1)}–${Number(f.end).toFixed(1)}s)` : ''}<br>${esc(f.observed)}<br><em>→ ${esc(f.repair)}</em></li>`).join('')}</ul></details>` : ''}</div>`).join('')}</div>`;
  }).join('')}</div>`;
}

// ---------- agents ----------
function agentsView() {
  const job = state.job;
  if (!job.agents.length) return '<div class="view-content"><div class="empty-state"><p>No agents yet. The orchestrator starts when a runner slot is free.</p></div></div>';
  const children = id => job.agents.filter(agent => agent.parentId === id);
  const roots = job.agents.filter(agent => !agent.parentId || !agentById(agent.parentId));
  const tree = (agent, depth) => `${agentCard(agent, depth)}${children(agent.id).map(child => tree(child, depth + 1)).join('')}`;
  const liveCount = job.agents.filter(live).length;
  return `<div class="view-content"><div class="view-title"><div><h2>Every agent, live.</h2><p>Each sub-agent is a separate CLI process: its brief, model, current file, tools and tokens.</p></div><span class="subtle-tag">${liveCount} LIVE · ${job.agents.length} TOTAL</span></div><div class="agent-tree">${roots.map(agent => tree(agent, 0)).join('')}</div></div>`;
}
function agentCard(agent, depth) {
  const usage = agent.usage?.reports ? `${count(agent.usage.total)} tok` : '';
  const ran = agent.startedAt ? (live(agent) ? since(agent.startedAt) : agent.finishedAt ? span(Date.parse(agent.finishedAt) - Date.parse(agent.startedAt)) : '') : '';
  return `<button class="agent-card ${esc(agent.status)}" style="--depth:${Math.min(depth, 3)}" data-action="agent" data-id="${agent.id}"><div class="agent-card-top"><span class="agent-dot ${esc(agent.status)}"></span><strong>${esc(roleLabel(agent.role))}</strong><span class="agent-task">${esc(agent.task || '')}</span><span class="subtle-tag">${esc(agent.status === 'waiting' ? `waiting · ${agent.waitingFor || ''}` : agent.status)}</span></div>
  <div class="agent-card-grid"><span>${icon('file')}${agent.current ? `<code>${esc(short(agent.current, state.job))}</code> <em>${esc(agent.operation || '')}</em>` : '<em>no file yet</em>'}</span><span>${icon('terminal')}<em>${esc(agent.lastTool?.text || '—')}</em></span><span>${icon('bolt')}${esc(agent.model || 'CLI default')} <em>${esc(agent.modelSource || '')}</em></span><span>${icon('clock')}${ran} · ${agent.toolCount || 0} tools${agent.failedTools ? ` · ${agent.failedTools} failed` : ''}${usage ? ` · ${usage}` : ''}</span></div>${agent.note ? `<div class="agent-note">“${esc(agent.note)}”</div>` : ''}${agent.error ? `<div class="agent-error">${esc(agent.error.slice(0, 300))}</div>` : ''}</button>`;
}
async function openAgent(id) {
  const agent = agentById(id); if (!agent) return;
  state.drawer = id;
  openModal(`<div id="agent-drawer"></div>`, true, () => { state.drawer = null; });
  drawerEvents = [];
  renderDrawer();
  try { drawerEvents = await api(`/api/jobs/${state.job.id}/events?agent=${encodeURIComponent(id)}&limit=300`); renderDrawer(); } catch (error) { toast(error.message); }
}
let drawerEvents = [];
function refreshDrawer(events) { if (!events.length) return; const last = drawerEvents.at(-1)?.seq ?? 0; drawerEvents.push(...events.filter(event => event.seq > last)); renderDrawer(); }
function renderDrawer() {
  const agent = agentById(state.drawer), host = $('#agent-drawer'); if (!agent || !host) return;
  const messages = state.messages.filter(m => m.agentId === agent.id).slice(-6);
  set(host, `${modalHeading(`${esc(roleLabel(agent.role))} · ${esc(agent.task || '')}`, `${esc(agent.status)} · ${esc(agent.model || 'CLI default')} (${esc(agent.modelSource || '')}) · ${agent.runs || 1} run(s)`)}
  <div class="drawer-grid"><div><span class="field-label">Brief</span>${agent.brief ? `<button class="file-pill" data-action="file" data-file="${esc(agent.brief)}">${icon('file')}${esc(agent.brief)}</button>` : `<p class="muted">${agent.role === 'orchestrator' ? 'The thread brief' : 'No brief file'}</p>`}</div><div><span class="field-label">Now</span><p>${agent.current ? `<button class="link-file" data-action="file" data-file="${esc(agent.current)}">${esc(agent.current)}</button> · ${esc(agent.operation || '')}` : '—'}</p></div><div><span class="field-label">Pipeline step</span><p>${esc(agent.step || '—')}${agent.scene ? ` · scene ${esc(agent.scene)}` : ''}</p></div><div><span class="field-label">Session</span><p><code>${esc(agent.sessionId || '—')}</code><br><small class="muted">runner id ${esc(agent.id)}</small></p></div></div>
  ${agent.promptPreview ? `<details data-key="prompt"><summary>Prompt</summary><pre class="pre">${esc(agent.promptPreview)}</pre></details>` : ''}
  ${agent.error ? `<div class="inline-error">${icon('warning')}${esc(agent.error)}</div>` : ''}
  ${messages.length ? `<span class="field-label">Messages</span>${messages.map(m => `<div class="drawer-message"><time>${time(m.at)}</time>${esc(m.text.slice(0, 1500))}</div>`).join('')}` : ''}
  <span class="field-label">Activity</span><div class="activity-list compact">${drawerEvents.slice(-200).reverse().map(eventRow).join('') || '<p class="muted">Loading…</p>'}</div>`);
}

// ---------- activity ----------
const filters = { all: () => true, tools: e => e.type === 'tool', files: e => e.type === 'file' || Boolean(e.file), pipeline: e => Boolean(e.pipeline) || e.type === 'pipeline', problems: e => e.type === 'error' || e.status === 'failed' };
function activity() {
  const job = state.job;
  const list = state.events.filter(filters[state.activityFilter]).filter(e => !state.activityAgent || e.agentId === state.activityAgent);
  return `<div class="view-content"><div class="view-title"><div><h2>Every event, in the open.</h2><p>Tool calls from every agent, pipeline commands, and file changes seen on disk.</p></div><a class="secondary-button small" href="/api/jobs/${job.id}/log" download>${icon('download')}Full log</a></div>
  <div class="activity-filters">${Object.keys(filters).map(key => `<button class="chip ${state.activityFilter === key ? 'active' : ''}" data-action="filter" data-filter="${key}">${key}</button>`).join('')}<select id="activity-agent" aria-label="Filter by agent"><option value="">All agents</option>${job.agents.map(agent => `<option value="${agent.id}" ${state.activityAgent === agent.id ? 'selected' : ''}>${esc(roleLabel(agent.role))} · ${esc((agent.scene || agent.task || '').slice(0, 40))}</option>`).join('')}</select></div>
  <div class="activity-list">${list.slice(-400).reverse().map(eventRow).join('') || '<div class="empty-state"><p>No matching events yet.</p></div>'}</div>${state.events[0]?.seq > 1 && !state.olderLoaded ? `<button class="secondary-button small load-older" data-action="older">Load older events</button>` : ''}</div>`;
}
function eventRow(e) {
  const failed = e.type === 'error' || e.status === 'failed';
  const kind = e.type === 'tool' ? (e.pipeline ? `VIDEO ${e.pipeline.command}` : e.status === 'running' ? 'TOOL' : e.status === 'failed' ? 'FAILED' : 'DONE') : e.type === 'file' ? 'DISK' : e.type.toUpperCase();
  return `<div class="activity-row ${failed ? 'error' : ''} ${e.pipeline ? 'pipeline' : ''}"><span class="activity-time">${time(e.at)}</span><span class="activity-node">${icon(failed ? 'warning' : e.type === 'file' ? 'file' : e.type === 'agent' ? 'branch' : e.pipeline ? 'layers' : 'terminal')}</span><div><strong>${esc(String(e.text || e.name || '').slice(0, 400))}</strong>${e.next ? `<div class="next-told">STATE: ${esc(e.next.state)}${e.next.spawns?.length ? ` → ${e.next.spawns.map(s => esc(`${s.role} ${s.brief.split('/').at(-1)}`)).join(', ')}` : ''}</div>` : ''}${e.file ? `<button class="activity-file" data-action="file" data-file="${esc(e.file)}">${icon('file')}${esc(e.file)}${icon('arrow')}</button>` : ''}<div class="event-provenance">${esc(e.source || 'runner')}${e.role ? ' · ' + esc(roleLabel(e.role)) : ''}${e.agentId && agentById(e.agentId)?.scene ? ' · ' + esc(agentById(e.agentId).scene) : ''}${e.status ? ' · ' + esc(e.status) : ''}</div>${e.output ? `<details class="tool-output" data-key="out-${e.id}"><summary>Output${e.truncated ? ` (${count(e.outputSize)} chars)` : ''}</summary><pre>${esc(e.output)}</pre>${e.truncated ? `<button class="text-button" data-action="full-output" data-id="${e.id}">Show full output</button>` : ''}</details>` : ''}</div><span class="activity-type">${esc(kind)}</span></div>`;
}

// ---------- files & outputs ----------
function fileView() {
  const job = state.job;
  return `<div class="view-content"><div class="view-title"><div><h2>The work, down to the file.</h2><p>The key files from this thread’s script and job folders, in pipeline order.</p></div><button class="text-button" data-action="refresh-files">${icon('retry')}Refresh</button></div><div class="files-toolbar"><span>${icon('folder')}${esc(job.jobPath)}/</span><span class="muted">${state.files.length} files</span></div><div class="file-table"><div class="file-table-header"><span>FILE</span><span>CHANGED</span><span>SIZE</span></div>${state.files.map(file => `<button class="file-row" data-action="file" data-file="${esc(file.path)}"><span>${icon(file.type.startsWith('video') ? 'film' : file.type.startsWith('image') ? 'image' : 'file')}<span class="file-name"><strong>${esc(file.label || short(file.path, job))}</strong><code>${esc(short(file.path, job))}</code></span></span><span class="file-state">${sinceAgo(new Date(file.modified).toISOString())}</span><span class="file-state">${file.size > 1048576 ? (file.size / 1048576).toFixed(1) + ' MB' : Math.ceil(file.size / 1024) + ' KB'}</span></button>`).join('') || '<div class="empty-state"><p>No artifacts yet. Files appear here as the agents work.</p></div>'}</div></div>`;
}
function outputs() {
  const job = state.job, files = state.files, complete = job.status === 'complete';
  const find = p => files.find(f => f.path === p)?.path;
  const video = job.outputs?.video || find(`${job.jobPath}/renders/video.mp4`);
  const thumbnail = job.outputs?.thumbnail || find(`${job.jobPath}/thumbnail/thumbnail.png`);
  const preview = job.outputs?.thumbnailPreview || files.find(f => f.path.startsWith(`${job.jobPath}/thumbnail/`) && /320x180|feed|preview/i.test(f.path) && f.path.endsWith('.png'))?.path;
  const delivery = find(`${job.jobPath}/review/delivery.json`);
  return `<div class="view-content"><div class="view-title"><div><h2>${complete ? 'The final cut.' : 'Your video takes shape here.'}</h2><p>${complete ? 'Qualified video, independently reviewed thumbnail, and delivery evidence.' : 'Renders stay drafts until both the video and thumbnail qualify.'}</p></div><span class="subtle-tag">${complete ? 'VERIFIED DELIVERY' : 'IN PRODUCTION'}</span></div>${video ? `<div class="output-hero"><video class="real-video" src="${artifact(video)}" ${thumbnail ? `poster="${artifact(thumbnail)}"` : ''} controls preload="metadata"></video><div class="output-caption"><div><strong>${esc(job.title)}</strong><small>${format(job)} · ${complete ? 'Qualified final output' : 'Unqualified draft render'}</small></div><a class="secondary-button small" href="${artifact(video, true)}" download>${icon('download')}${complete ? 'Download video' : 'Download draft'}</a></div></div>` : `<div class="output-await"><span>${icon('film')}</span><h3>Waiting for the first render</h3><p>The MP4 appears here when the pipeline renders it.</p></div>`}<div class="output-cards"><div class="output-card">${thumbnail ? `<button class="thumbnail-button" data-action="file" data-file="${esc(thumbnail)}"><img class="real-thumbnail" src="${artifact(thumbnail)}" alt="Thumbnail for ${esc(job.title)}"></button>` : '<div class="thumbnail-await">' + icon('image') + '</div>'}<span class="eyebrow">THUMBNAIL</span><strong>${thumbnail ? 'Your thumbnail' : 'Created after the film qualifies'}</strong><small>${complete ? 'Independently reviewed and archived' : thumbnail ? 'Review pending — not qualified for delivery' : 'PNG + editable source + feed preview'}</small>${preview ? `<div class="feed-preview"><img src="${artifact(preview)}" alt="Feed-size preview" width="160" height="90"><small>Feed size</small></div>` : ''}${thumbnail ? `<a class="text-button" href="${artifact(thumbnail, true)}" download>Download PNG ${icon('download')}</a>` : ''}${job.outputs?.thumbnailSource ? `<a class="text-button source-download" href="${artifact(job.outputs.thumbnailSource, true)}" download>Editable source ${icon('download')}</a>` : ''}</div><div class="output-card review-output">${icon(complete ? 'check' : 'clock')}<span class="eyebrow">DELIVERY EVIDENCE</span><strong>${complete ? 'Checks passed. Evidence retained.' : 'Independent reviews required.'}</strong><p>Video qualification, audio measurements, limitations, headphone check timestamps, and thumbnail review.</p>${delivery ? `<button class="text-button" data-action="file" data-file="${esc(delivery)}">Read delivery report ${icon('arrow')}</button><button class="text-button source-download" data-action="measurements">Audio measurements & limitations ${icon('volume')}</button>` : '<span class="muted">Delivery report pending</span>'}${job.outputs?.thumbnailReview ? `<button class="text-button source-download" data-action="file" data-file="${esc(job.outputs.thumbnailReview)}">Thumbnail review ${icon('arrow')}</button>` : ''}</div></div></div>`;
}

// ---------- inspector ----------
function inspector() {
  const job = state.job;
  return `<div class="inspector-tabs"><button data-action="inspector-tab" data-tab="overview" class="${state.inspectorTab === 'overview' ? 'active' : ''}">Overview</button><button data-action="inspector-tab" data-tab="models" class="${state.inspectorTab === 'models' ? 'active' : ''}">Models</button></div><div class="inspector-scroll">${state.inspectorTab === 'models' ? modelsPanel() : overviewPanel()}</div><div class="inspector-footer">${footerActions()}</div>`;
}
function overviewPanel() {
  const job = state.job, health = job.health, progress = job.progress;
  const working = job.agents.filter(agent => live(agent) && agent.role !== 'orchestrator');
  return `<section class="health-block health-${esc(health?.level || 'idle')}"><div class="section-label">RUN HEALTH<span>${esc(health?.level || '—')}</span></div><div class="health-headline"><span class="health-dot"></span>${esc(health?.headline || 'Checking…')}</div>${health?.lastEventAt ? `<small class="health-note">Last activity ${sinceAgo(health.lastEventAt)}</small>` : ''}${(health?.items || []).filter(item => item.text !== health.headline).slice(0, 4).map(item => `<div class="health-item ${esc(item.level)}">${esc(item.text)}</div>`).join('')}</section>
  ${progress ? `<section><div class="section-label">PROGRESS<span>${progress.done} / ${progress.total}</span></div><div class="progress-track"><span style="width:${(progress.done / progress.total * 100).toFixed(1)}%"></span></div><ol class="phase-mini">${progress.phases.map(phase => { const current = phase.steps.find(step => ['current', 'repair', 'blocked', 'waiting'].includes(step.status)); const done = phase.steps.filter(step => ['done', 'skipped'].includes(step.status)).length; return `<li class="${done === phase.steps.length ? 'done' : current ? 'current' : 'pending'}"><button data-action="tab" data-tab="progress"><span class="stage-marker">${done === phase.steps.length ? icon('check') : current ? '<span class="running-ring"></span>' : ''}</span><span><strong>${esc(phase.label)}</strong><small>${current ? esc(current.label) : `${done}/${phase.steps.length}`}</small></span></button></li>`; }).join('')}</ol></section>` : ''}
  <section><div class="section-label">${working.length ? 'WORKING NOW' : 'LAST FILE TOUCHED'}<span>${working.length} sub-agent${working.length === 1 ? '' : 's'} live</span></div>${working.length ? working.map(agent => `<button class="inspector-file" data-action="agent" data-id="${agent.id}"><span class="agent-dot ${esc(agent.status)}"></span><span>${esc(agent.scene || roleLabel(agent.role))}<small>${esc(agent.current ? short(agent.current, job) : agent.task || '')}</small></span>${icon('arrow')}</button>`).join('') : job.current ? `<button class="inspector-file" data-action="file" data-file="${esc(job.current)}">${icon('file')}<span>${esc(job.current.split('/').at(-1))}<small>${esc(roleLabel(job.role || ''))} · ${esc(job.current.slice(0, job.current.lastIndexOf('/') + 1))}</small></span>${icon('arrow')}</button>` : '<p class="inspector-note">No sub-agent running.</p>'}</section>
  ${jobUsage()}
  <section><div class="section-label">YOUR CHECKPOINTS<button class="text-button" data-action="configure">Edit ${icon('arrow')}</button></div><div class="checkpoint-row"><span>After script review</span><span>${job.approvedGates?.includes('script') ? 'Approved' : job.gateScript ? 'On' : 'Off'}</span></div><div class="checkpoint-row"><span>After prototype review</span><span>${job.approvedGates?.includes('prototype') ? 'Approved' : job.gatePrototype ? 'On' : 'Off'}</span></div><p class="inspector-note">The agent can also ask you a question at any time. Independent reviews always stay mandatory.</p></section>`;
}
function footerActions() {
  const job = state.job, s = job.status;
  const primary = s === 'running' ? `<button class="secondary-button" data-action="pause">${icon('pause')}Pause at next step</button>`
    : s === 'gate' ? `<button class="secondary-button" data-action="gate">${icon('question')}Answer the agent</button>`
    : ['paused', 'failed', 'interrupted', 'needs_attention', 'cancelled'].includes(s) ? `<button class="secondary-button" data-action="resume">${icon('play')}Continue run</button>`
    : s === 'complete' ? `<button class="secondary-button" data-action="tab" data-tab="outputs">${icon('grid')}View outputs</button>` : '<span class="muted">Waiting for a runner slot</span>';
  // Anything that is not running, queued or waiting on you can be archived or deleted outright.
  const active = ['running', 'queued', 'gate'].includes(s);
  const secondary = active ? '<button class="cancel-run" data-action="cancel">Cancel run</button>'
    : `<div class="footer-row"><button class="cancel-run" data-action="${job.archived ? 'unarchive' : 'archive'}">${job.archived ? 'Unarchive' : 'Archive'}</button><button class="cancel-run" data-action="delete">Delete thread</button></div>`;
  return primary + secondary;
}
// Deletion takes the thread's whole footprint with it, so the dialog names every folder first.
function confirmDelete() {
  const job = state.job;
  const items = [[`${job.jobPath}/`, 'the job: renders, shots, briefs and review evidence'], [`${job.scriptPath}/`, 'the script, research, sources and narration'],
    [`library/thumbnails/${job.slug}/`, 'the archived thumbnail set'], ['', 'the thread, its full event log and any uploaded recording or script']];
  openModal(`${modalHeading('Delete this thread?', 'This cannot be undone.')}<ul class="delete-list">${items.map(([folder, what]) => `<li>${icon('trash')}<span>${folder ? `<code>${esc(folder)}</code> — ` : ''}${esc(what)}</span></li>`).join('')}</ul><p class="model-caveat">Assets this film saved to the reusable library stay, so other threads can still find them.</p><div class="modal-footer"><button class="secondary-button" data-action="close">Keep it</button><button class="danger-button" data-action="confirm-delete">${icon('trash')}Delete everything</button></div>`);
}
function modelsPanel() {
  const job = state.job, pins = state.providers.find(p => p.name === 'Claude')?.pins || {};
  return `<section class="agent-panel"><div class="section-label">MODEL ROUTING<button class="text-button" data-action="configure">Configure ${icon('arrow')}</button></div>${routingTable(job, pins)}<p class="inspector-note">Each sub-agent is a separate ${esc(job.provider)} process. ${job.provider === 'Claude' ? 'Claude roles run as this repository’s agent types (.claude/agents).' : job.provider === 'Pi' ? 'Pi roles get the instructions and pinned Anthropic models of this repository’s agent types (.claude/agents).' : ''} Changes apply to agents started afterwards.</p></section>`;
}
function routingTable(job, pins) {
  return `<div class="routing">${ROLES.map(item => { const route = routeModel(job, item.role, pins); return `<div class="routing-row"><span>${esc(item.label)}</span><code>${esc(route.model || 'CLI default')}</code><small>${esc(route.source)}</small></div>`; }).join('')}</div>`;
}
function jobUsage() {
  const usage = state.job.usage, quota = state.usage.find(p => p.name === state.job.provider);
  return `<section class="usage-section"><div class="section-label">TOKENS<button class="text-button" data-action="usage">All providers ${icon('arrow')}</button></div><div class="usage-total">${usage?.reports ? count(usage.total) : '—'}<small>${usage?.reports ? 'reported by the CLI, all agents' : 'Waiting for provider usage'}</small></div>${usage?.reports ? `<div class="token-breakdown"><span>Input<strong>${count(usage.input)}</strong></span><span>Output<strong>${count(usage.output)}</strong></span><span>Cached<strong>${count(usage.cached)}</strong></span></div>` : ''}${usage?.costReported ? `<div class="usage-cost">CLI-reported estimate <strong>$${usage.reportedCostUSD.toFixed(4)}</strong></div>` : ''}${quota?.windows?.length ? quota.windows.map(w => `<div class="quota-mini"><span>${quotaWindow(w)}</span><strong>${typeof w.remainingPercent === 'number' ? w.remainingPercent.toFixed(0) + '% left' : 'Status only'}</strong></div>`).join('') : ''}</section>`;
}
function quotaWindow(window) {
  const minutes = window.windowMinutes;
  return esc(window.label || 'Account') + (minutes ? ` · ${minutes >= 1440 ? (minutes / 1440).toFixed(0) + ' day' : minutes >= 60 ? (minutes / 60).toFixed(1).replace('.0', '') + ' hour' : minutes + ' min'}` : window.kind ? ' · ' + esc(window.kind) : '');
}

// ---------- modals ----------
let onModalClose = null;
function openModal(content, wide = false, onClose = null) { lastFocus = document.activeElement; onModalClose = onClose; $('#overlay').innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? 'wide-modal' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">${content}</section></div>`; ($('textarea,input,select', $('.modal')) || $('.modal')).focus(); }
function closeModal() { $('#overlay').innerHTML = ''; onModalClose?.(); onModalClose = null; if (lastFocus?.isConnected) lastFocus.focus(); }
const modalHeading = (title, description) => `<div class="modal-heading"><div><h2 id="modal-title">${title}</h2><p>${description}</p></div><button class="icon-button" data-action="close" aria-label="Close dialog">${icon('close')}</button></div>`;
function modelFields(j = {}) {
  const provider = j.provider || state.providers.find(p => p.installed)?.name || 'Codex';
  const models = state.providers.find(p => p.name === provider)?.models || [];
  return `<div class="field-label">CLI provider</div><div class="provider-options">${names.map(name => { const p = state.providers.find(item => item.name === name); return `<label class="provider-option"><input type="radio" name="provider" value="${name}" ${name === provider ? 'checked' : ''} ${(p && !p.installed) || (j.agents?.length && name !== j.provider) ? 'disabled' : ''}><span class="provider-option-content"><span class="provider-large">${marks[name]}</span>${name}<span class="provider-radio"></span></span></label>`; }).join('')}</div><div class="provider-install-note">${state.providers.length ? state.providers.map(p => `${p.name}: ${p.installed ? p.version || 'installed' : 'not available'}`).map(esc).join(' · ') : 'Checking installed CLIs…'}</div>
  <div class="field-label" style="margin-top:14px">Model for each role</div><div class="role-models" data-provider="${esc(provider)}">${roleRows({ provider, ...j })}</div><datalist id="model-options">${models.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
  <div class="model-caveat">Uses your existing CLI login. Model IDs are passed straight to the CLI (OpenCode and Pi use provider/model).${j.agents?.length ? ' The provider is fixed for this thread; model changes apply to agents started afterwards.' : ''}</div><div class="form-divider"></div><div class="new-gates"><label><input type="checkbox" name="gateScript" ${j.gateScript ? 'checked' : ''}>Pause for me after script review</label><label><input type="checkbox" name="gatePrototype" ${j.gatePrototype ? 'checked' : ''}>Pause for me after prototype review</label></div>`;
}
// One editable row per role. A blank field shows, as its placeholder, what the role falls back to.
function roleRows(job) {
  const pins = state.providers.find(p => p.name === 'Claude')?.pins || {}, models = roleModels(job);
  return ROLES.map(item => {
    const name = item.role === 'orchestrator' ? 'main' : `model:${item.role}`, value = item.role === 'orchestrator' ? job.main || '' : models[item.role];
    const fallback = routeModel({ ...job, main: item.role === 'orchestrator' ? '' : job.main, models: { ...models, [item.role]: '' } }, item.role, pins), route = routeModel({ ...job, models }, item.role, pins);
    return `<label class="role-model"><span class="role-name"><strong>${esc(item.label)}</strong><small>${esc(item.hint)}</small></span><input type="text" name="${name}" list="model-options" placeholder="${esc(fallback.model || 'CLI default')}" value="${esc(value)}" maxlength="120" aria-label="${esc(item.label)} model"><small class="role-route" data-role="${item.role}">${esc(route.model || 'CLI default')} · ${esc(route.source)}</small></label>`;
  }).join('');
}
// Model IDs belong to one harness. Switching keeps what you typed for each harness and shows the new one's own choices (blank: its defaults).
const typedModels = new WeakMap();
function switchRoleModels(form, provider) {
  const rows = form && $('.role-models', form); if (!rows) return;
  const memory = typedModels.get(form) || {}; typedModels.set(form, memory);
  const inputs = [...rows.querySelectorAll('input')];
  memory[rows.dataset.provider] = Object.fromEntries(inputs.map(input => [input.name, input.value]));
  for (const input of inputs) input.value = memory[provider]?.[input.name] || '';
  rows.dataset.provider = provider;
}
function updateRoutingPreview(form) {
  const job = readConfig(form), pins = state.providers.find(p => p.name === 'Claude')?.pins || {};
  for (const item of ROLES) {
    const input = form.elements[item.role === 'orchestrator' ? 'main' : `model:${item.role}`], note = $(`.role-route[data-role="${item.role}"]`, form);
    const fallback = routeModel({ ...job, main: item.role === 'orchestrator' ? '' : job.main, models: { ...job.models, [item.role]: '' } }, item.role, pins), route = routeModel(job, item.role, pins);
    if (input) input.placeholder = fallback.model || 'CLI default';
    if (note) note.textContent = `${route.model || 'CLI default'} · ${route.source}`;
  }
}

// What the description says about length, shown live under it; the submit check uses the same parser.
// A length is optional: without one the agent decides how long the video should be.
function durationHint(prompt) {
  const target = durationFromPrompt(prompt);
  const text = target.error ? target.error
    : target.seconds ? `${icon('clock')}Target duration: ${formatDuration(target.seconds)}`
    : `${icon('clock')}The agent will choose a length that fits the topic. To set one, say it, e.g. “a 3-minute explainer” or “90 seconds”.`;
  return `<p id="duration-hint" class="duration-hint${target.seconds && !target.error ? ' found' : ''}${target.error ? ' missing' : ''}" aria-live="polite">${text}</p>`;
}
function newJob(idea = null) {
  const base = state.job || {};
  openModal(`${modalHeading('What are we making?', 'One prompt. One thread. The entire production.')}<form id="new-job-form"><label class="field-label" for="new-prompt">Describe your video</label><textarea id="new-prompt" name="prompt" rows="4" placeholder="An explainer about why batteries degrade. Make it visual and accessible… (add a length only if you want one)" required maxlength="20000" aria-describedby="duration-hint"></textarea>${durationHint('')}<div class="form-grid"><label>Title (optional)<input name="title" placeholder="Name this thread" maxlength="150"></label><label>Format<select name="format"><option value="landscape" ${state.settings.defaultFormat === 'landscape' ? 'selected' : ''}>Landscape · 16:9</option><option value="vertical" ${state.settings.defaultFormat === 'vertical' ? 'selected' : ''}>Portrait · 9:16</option></select></label></div><details class="advanced-options input-options"><summary>Use an existing script or recording ${icon('down')}</summary><div class="form-grid"><label>Script file<input type="file" name="scriptFile" accept=".md,.txt"><input name="inputScript" placeholder="Or repository-relative path"></label><label>Recording<input type="file" name="audioFile" accept="audio/*,.webm,.mp4"><input name="audioPath" placeholder="Or repository-relative path"></label></div><p class="model-caveat">A supplied recording is kept unchanged. Without one, the agent generates narration from the reviewed script. Uploads stay inside this repository (250 MB per file).</p></details><div class="form-divider"></div>${modelFields({ provider: base.provider, main: base.main || '', models: roleModels(base) })}<div class="modal-footer"><span>${icon('terminal')}Runs real CLI agents and production tools</span><button class="primary-button" type="submit">Start video ${icon('arrow')}</button></div><div id="form-error" class="form-error" role="alert"></div></form>`, true);
  if (idea) {
    const form = $('#new-job-form'), prompt = ideaPrompt(idea);
    form.dataset.idea = idea.id; form.elements.prompt.value = prompt; form.elements.title.value = idea.title.slice(0, 150);
    $('#duration-hint').outerHTML = durationHint(prompt);
  }
}
function configure() { if (!state.job) return newJob(); openModal(`${modalHeading('Your production crew.', 'Route models by role and choose your checkpoints.')}<form id="configure-form">${modelFields(state.job)}<div class="modal-footer"><button class="secondary-button" type="button" data-action="close">Cancel</button><button class="primary-button" type="submit">Save configuration ${icon('check')}</button></div><div id="form-error" class="form-error" role="alert"></div></form>`, true); }
async function inspectFile(file) {
  const type = state.files.find(f => f.path === file)?.type || (/\.(png|jpe?g|svg)$/i.test(file) ? 'image/' : /\.(mp4|webm)$/i.test(file) ? 'video/' : /\.(wav|mp3)$/i.test(file) ? 'audio/' : '');
  if (/^(image|video|audio)\//.test(type)) {
    const url = artifact(file);
    openModal(`${modalHeading(esc(file.split('/').at(-1)), esc(file))}${type.startsWith('image') ? `<img class="media-preview" src="${url}" alt="${esc(file)}">` : type.startsWith('video') ? `<video class="real-video" src="${url}" controls preload="metadata"></video>` : `<audio class="real-audio" src="${url}" controls></audio>`}<div class="modal-footer"><span>${state.job.status === 'complete' ? 'Verified delivery' : 'Working artifact · qualification pending'}</span><a class="secondary-button" href="${artifact(file, true)}" download>${icon('download')}Download</a></div>`, true); return;
  }
  openModal(`${modalHeading(esc(file.split('/').at(-1)), 'Reading the actual file…')}<div class="file-loading">Loading…</div>`, true);
  try { const result = await api(`/api/jobs/${state.job.id}/file?path=${encodeURIComponent(file)}`); if (!$('.file-loading')) return; $('.file-loading').outerHTML = `<div class="file-location">${icon('folder')}${esc(file)}</div><div class="code-view">${result.text.split('\n').map((line, i) => `<div><span>${i + 1}</span><code>${esc(line) || ' '}</code></div>`).join('')}</div><div class="modal-footer"><span>Read-only artifact</span><a class="secondary-button" href="${artifact(file, true)}" download>${icon('download')}Download</a></div>`; } catch (error) { if ($('.file-loading')) $('.file-loading').textContent = error.message; }
}
async function settings() { const s = await api('/api/settings'); state.settings = s; openModal(`${modalHeading('Workspace settings', 'Local execution using your installed CLI accounts.')}<form id="settings-form"><div class="setting-block"><h3>New video defaults</h3><div class="form-grid"><label>Orientation<select name="defaultFormat"><option value="landscape" ${s.defaultFormat === 'landscape' ? 'selected' : ''}>Landscape · 16:9</option><option value="vertical" ${s.defaultFormat === 'vertical' ? 'selected' : ''}>Portrait · 9:16</option></select></label></div></div><div class="setting-block"><label class="field-label" for="concurrency">Simultaneous video jobs</label><select name="concurrency" id="concurrency">${[1, 2, 3].map(n => `<option value="${n}" ${n === s.concurrency ? 'selected' : ''}>${n}${n === 1 ? ' · recommended for local rendering' : ''}</option>`).join('')}</select><p class="model-caveat">Additional threads queue automatically. Each active job runs up to four CLI processes, including its orchestrator.</p></div><div class="setting-block"><h3>Existing CLI logins</h3><p>${state.providers.map(p => `${esc(p.name)}: ${p.installed ? esc(p.version) : esc(p.error)}`).join('<br>')}</p><button type="button" class="secondary-button" data-action="refresh-providers">${icon('retry')}Recheck providers</button></div><div class="setting-block"><h3>Local persistence</h3><p>Threads and full event logs are saved in <code>.video/ui/</code>. Videos, thumbnails and scripts stay in their job folders until you delete the thread, which removes them too. Restarted runs are marked interrupted; continue them explicitly.</p></div><div class="modal-footer"><button type="button" class="secondary-button" data-action="close">Close</button><button type="submit" class="primary-button">Save settings</button></div></form>`); }
function readConfig(form) { const data = new FormData(form); return { provider: data.get('provider'), main: (data.get('main') || '').trim(), models: Object.fromEntries(DELEGATE_ROLES.map(role => [role, (data.get(`model:${role}`) || '').trim()])), gateScript: data.has('gateScript'), gatePrototype: data.has('gatePrototype') }; }
async function control(action, extra = {}) { const job = await api(`/api/jobs/${state.job.id}/control`, { method: 'POST', data: { action, ...extra } }); state.jobs.set(job.id, job); if (state.job?.id === job.id) state.job = job; schedule(); return job; }
async function measurements() {
  const data = await api(`/api/jobs/${state.job.id}/file?path=${encodeURIComponent(`${state.job.jobPath}/review/delivery.json`)}`); let report; try { report = JSON.parse(data.text); } catch { return inspectFile(`${state.job.jobPath}/review/delivery.json`); }
  openModal(`${modalHeading('Measurements & review limits', 'Read from the actual delivery report.')}<div class="measurement-content"><h3>Soundtrack measurements</h3><pre>${esc(JSON.stringify(report.soundtrack || 'Not recorded in this report', null, 2))}</pre><h3>Headphone checks</h3><pre>${esc(JSON.stringify(report.headphoneChecks || 'Not recorded in this report', null, 2))}</pre><h3>Limitations and findings</h3><pre>${esc(JSON.stringify({ limitations: report.limitations, advisoryFindings: report.advisoryFindings, findings: report.findings }, null, 2))}</pre><p class="muted">Measurements do not establish subjective audio quality.</p></div>`, true);
}
function usageContent() {
  return `${modalHeading('Tokens & provider limits.', 'Job usage and account quota are tracked separately.')}<div class="usage-providers">${state.usage.map(p => `<div class="usage-provider"><div class="usage-provider-heading"><span class="provider-large">${marks[p.name]}</span><h3>${p.name}</h3><span class="subtle-tag">${p.usage?.reports ? count(p.usage.total) + ' TOKENS TRACKED' : 'NO JOB USAGE YET'}</span></div>${p.windows?.length ? p.windows.map(w => `<div class="quota-window"><div><span>${quotaWindow(w)}</span><strong>${typeof w.remainingPercent === 'number' ? w.remainingPercent.toFixed(1).replace('.0', '') + '% remaining' : 'Status only'}</strong></div>${typeof w.remainingPercent === 'number' ? `<div class="quota-track"><span style="width:${Math.max(0, Math.min(100, w.remainingPercent))}%"></span></div>` : ''}${w.resetsAt ? `<small>Resets ${new Date(w.resetsAt).toLocaleString()}</small>` : ''}</div>`).join('') : `<p class="quota-unavailable">${esc(p.detail || 'Remaining balance not exposed by this CLI.')}</p>`}<small class="quota-source">${p.source ? esc(p.source) + ' · ' : ''}${p.checkedAt ? 'Checked ' + new Date(p.checkedAt).toLocaleTimeString() : 'Account quota not available'}</small></div>`).join('')}</div>${state.job ? `<div class="job-usage-detail"><h3>This job · ${esc(state.job.title)}</h3><div class="usage-job-table"><div><strong>Agent</strong><strong>Input</strong><strong>Output</strong><strong>Total</strong></div>${state.job.agents.map(a => `<div><span>${esc(roleLabel(a.role))}<small>${esc(a.scene || a.actualModel || a.model || 'CLI default')}</small></span><span>${a.usage?.reports ? count(a.usage.input) : '—'}</span><span>${a.usage?.reports ? count(a.usage.output) : '—'}</span><strong>${a.usage?.reports ? count(a.usage.total) : '—'}</strong></div>`).join('') || '<p class="muted">No sessions yet.</p>'}</div></div>` : ''}<div class="info-note">${icon('info')}Quota percentages use provider-reported windows. CLI-reported costs are estimates, not billing records. Unknown balances stay unknown.</div><div class="modal-footer"><button class="secondary-button" data-action="refresh-usage">${icon('retry')}Refresh limits</button><button class="primary-button" data-action="close">Done</button></div>`;
}
async function loadUsage(refresh = false) { state.usage = await api('/api/usage' + (refresh ? '?refresh=1' : '')); if ($('.usage-providers')) $('.modal').innerHTML = usageContent(); schedule(); }
async function showUsage(refresh = false) { openModal(`${modalHeading('Tokens & provider limits.', 'Reading quota from the providers that expose it.')}<div class="usage-loading">${icon('clock')}Checking provider limits…</div>`, true); try { await loadUsage(refresh); if ($('.usage-loading')) $('.modal').innerHTML = usageContent(); } catch (error) { if ($('.usage-loading')) $('.usage-loading').textContent = error.message; } }
function confirm(title, text, action, label) { openModal(`${modalHeading(title, text)}<div class="modal-footer"><button class="secondary-button" data-action="close">Keep it</button><button class="danger-button" data-action="${action}">${label}</button></div>`); }

// ---------- events ----------
document.addEventListener('click', async e => {
  if (e.target.classList.contains('modal-backdrop')) return closeModal();
  const button = e.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  try {
    switch (action) {
      case 'new': newJob(); break;
      case 'close': closeModal(); break;
      case 'ideas': state.view = 'ideas'; document.body.classList.remove('sidebar-open'); schedule(); await loadIdeas(); if (!state.ideas.cards.length && !state.ideas.lastRun) await findIdeas(); break;
      case 'ideas-find': await findIdeas(); break;
      case 'idea-filter': state.ideaFilter = button.dataset.filter; schedule(); break;
      case 'idea-status': await ideaStatus(button.dataset.id, button.dataset.status); toast(button.dataset.status === 'saved' ? 'Saved.' : 'Moved back to new.'); break;
      case 'idea-reject': openModal(`${modalHeading('Why not this one?', 'The reason is kept with the idea, so it is clear later why it was passed over.')}<div class="reject-reasons">${REJECT_REASONS.map(reason => `<button class="secondary-button" data-action="idea-reject-reason" data-id="${esc(button.dataset.id)}" data-reason="${esc(reason)}">${esc(reason)}</button>`).join('')}</div><div class="modal-footer"><button class="text-button" data-action="idea-reject-reason" data-id="${esc(button.dataset.id)}" data-reason="">Skip the reason</button><button class="secondary-button" data-action="close">Keep it</button></div>`); break;
      case 'idea-reject-reason': await ideaStatus(button.dataset.id, 'rejected', button.dataset.reason); closeModal(); toast('Rejected. It will not come back.'); break;
      case 'idea-make': newJob(state.ideas.cards.find(card => card.id === button.dataset.id)); break;
      case 'select': state.view = 'threads'; state.selected = button.dataset.id; state.tab = 'thread'; state.files = []; document.body.classList.remove('sidebar-open'); await loadDetail(); break;
      case 'toggle-archived': state.showArchived = !state.showArchived; schedule(); break;
      case 'tab': state.tab = button.dataset.tab; if (['files', 'outputs'].includes(state.tab)) await loadFiles(); schedule(); break;
      case 'inspector-tab': state.inspectorTab = button.dataset.tab; schedule(); break;
      case 'file': await inspectFile(button.dataset.file); break;
      case 'agent': await openAgent(button.dataset.id); break;
      case 'filter': state.activityFilter = button.dataset.filter; schedule(); break;
      case 'older': { const older = await api(`/api/jobs/${state.job.id}/events?before=${state.events[0].seq}&limit=500`); state.events = [...older, ...state.events]; state.olderLoaded = older.length < 500; schedule(); break; }
      case 'full-output': { const full = await api(`/api/jobs/${state.job.id}/events/${button.dataset.id}`); openModal(`${modalHeading('Full tool output', esc(full.text?.slice(0, 160) || ''))}<pre class="pre">${esc(full.output)}</pre>`, true); break; }
      case 'refresh-files': await loadFiles(); break;
      case 'configure': configure(); break;
      case 'settings': await settings(); break;
      case 'usage': await showUsage(); break;
      case 'refresh-usage': await showUsage(true); break;
      case 'pause': await control('pause'); toast('Pausing: agents finish their current tool call, then wait.'); break;
      case 'resume': await control('resume'); break;
      case 'approve': case 'revise': await control(action, { feedback: $('#gate-feedback')?.value || '' }); toast(action === 'approve' ? 'Approved. Production continues.' : 'Change request sent.'); break;
      case 'answer': await control('answer', { answer: $('#gate-answer')?.value || '' }); toast('Answer sent.'); break;
      case 'answer-option': await control('answer', { answer: button.dataset.answer }); toast('Answer sent.'); break;
      case 'cancel': confirm('Cancel this run?', 'The CLI processes stop. The thread, logs and artifacts are kept; you can continue later.', 'confirm-cancel', 'Cancel run'); break;
      case 'confirm-cancel': await control('cancel'); closeModal(); break;
      case 'archive': case 'unarchive': await control(action); toast(action === 'archive' ? 'Thread archived.' : 'Thread restored.'); break;
      case 'delete': confirmDelete(); break;
      case 'confirm-delete': {
        const id = state.job.id;
        await api(`/api/jobs/${id}`, { method: 'DELETE' });
        closeModal(); state.jobs.delete(id); if (state.selected === id) state.selected = null;
        state.job = null; state.files = []; state.events = []; state.messages = [];
        await loadJobs(); toast('Thread deleted, with its job, script, uploads and thumbnail archive.');
        break;
      }
      case 'gate': state.tab = 'thread'; schedule(); requestAnimationFrame(() => $('.gate-card')?.scrollIntoView({ block: 'center' })); break;
      case 'sidebar': document.body.classList.toggle('sidebar-open'); break;
      case 'inspector': document.body.classList.toggle('inspector-open'); break;
      case 'refresh-providers': button.disabled = true; state.providers = await api('/api/providers?refresh=1'); await settings(); toast('Provider status refreshed.'); break;
      case 'measurements': await measurements(); break;
    }
  } catch (error) { toast(error.message); button.disabled = false; }
});
document.addEventListener('submit', async e => {
  if (e.target.id === 'ideas-form') { e.preventDefault(); try { await findIdeas($('#idea-focus').value.trim()); } catch (error) { toast(error.message); } return; }
  if (!['new-job-form', 'configure-form', 'message-form', 'settings-form'].includes(e.target.id)) return;
  e.preventDefault(); const form = e.target, button = $('button[type=submit]', form); if (button) button.disabled = true;
  try {
    const data = new FormData(form);
    if (form.id === 'new-job-form') {
      // A length in the description must be in range; no length at all is fine (the agent chooses).
      const target = durationFromPrompt(data.get('prompt'));
      if (target.error) { $('#form-error', form).textContent = target.error; const hint = $('#duration-hint', form); hint.textContent = target.error; hint.classList.add('missing'); $('#new-prompt', form).focus(); return; }
      const input = { ...readConfig(form), title: data.get('title'), prompt: data.get('prompt'), format: data.get('format'), audioPath: data.get('audioPath') || '', inputScript: data.get('inputScript') || '' };
      for (const [field, target] of [['audioFile', 'audioPath'], ['scriptFile', 'inputScript']]) { const file = data.get(field); if (file?.size) { button.textContent = 'Uploading…'; input[target] = (await api(`/api/uploads?name=${encodeURIComponent(file.name)}`, { method: 'POST', raw: file })).path; } }
      button.textContent = 'Starting…'; const created = await api('/api/jobs', { method: 'POST', data: input }); state.selected = created.id; state.tab = 'thread'; state.view = 'threads';
      if (form.dataset.idea) await ideaStatus(form.dataset.idea, 'used').catch(() => {});
      closeModal(); await loadJobs();
    } else if (form.id === 'configure-form') { await api(`/api/jobs/${state.job.id}`, { method: 'PATCH', data: readConfig(form) }); closeModal(); await loadDetail(); toast('Saved. New agents will use these models.'); }
    else if (form.id === 'settings-form') { state.settings = await api('/api/settings', { method: 'PATCH', data: { concurrency: Number(data.get('concurrency')), defaultFormat: data.get('defaultFormat') } }); closeModal(); toast('Workspace settings saved.'); }
    else { const input = $('#message-input'); if (!input.value.trim()) return; await api(`/api/jobs/${state.job.id}/messages`, { method: 'POST', data: { text: input.value } }); input.value = ''; toast('Queued for the orchestrator’s next feedback check.'); }
  } catch (error) { const target = $('#form-error', form); if (target) target.textContent = error.message; else toast(error.message); if (button) button.textContent = form.id === 'new-job-form' ? 'Start video' : 'Save'; }
  finally { if (button) button.disabled = false; }
});
document.addEventListener('change', e => {
  if (e.target.name === 'provider') { const models = state.providers.find(p => p.name === e.target.value)?.models || []; const list = $('#model-options'); if (list) list.innerHTML = models.map(m => `<option value="${esc(m)}">`).join(''); switchRoleModels(e.target.form, e.target.value); }
  if (e.target.id === 'activity-agent') { state.activityAgent = e.target.value; schedule(); }
  if (e.target.form && ['new-job-form', 'configure-form'].includes(e.target.form.id)) updateRoutingPreview(e.target.form);
});
document.addEventListener('input', e => { if (e.target.id === 'new-prompt') { $('#duration-hint').outerHTML = durationHint(e.target.value); const error = $('#form-error', e.target.form); if (error) error.textContent = ''; } if (e.target.form && ['new-job-form', 'configure-form'].includes(e.target.form.id) && (e.target.name === 'main' || e.target.name.startsWith('model:'))) updateRoutingPreview(e.target.form); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if ($('.modal')) closeModal(); else document.body.classList.remove('sidebar-open', 'inspector-open'); }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.id === 'message-input') { e.preventDefault(); $('#message-form').requestSubmit(); }
  if ($('.modal') && e.key === 'Tab') { const items = [...$('.modal').querySelectorAll('button,input,textarea,select,summary,a[href]')].filter(item => !item.disabled && item.getClientRects().length); const first = items[0], last = items.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
  if (!e.target.matches('input,textarea,select,[contenteditable]') && !$('.modal') && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newJob(); }
});

// ---------- start ----------
render();
loadIdeas().catch(() => {});
api('/api/settings').then(result => { state.settings = result; }).catch(error => toast(error.message));
api('/api/providers').then(result => { state.providers = result; schedule(); }).catch(error => toast(error.message));
loadUsage().catch(() => {});
setInterval(() => { if (!document.hidden) loadUsage().catch(() => {}); }, 60000);
const stream = new EventSource('/api/stream');
// Every (re)connection reloads the full picture, so nothing is lost while disconnected.
stream.addEventListener('connected', () => { state.connected = true; loadJobs().catch(error => { state.loading = false; toast(error.message); schedule(); }); });
stream.addEventListener('update', event => applyUpdate(JSON.parse(event.data)));
stream.onerror = () => { state.connected = false; schedule(); };
