import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';

const fields = ['input', 'output', 'cached', 'cacheWrite', 'reasoning', 'total'];
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

/**
 * Read the UI's existing per-agent records. This is deliberately read-only: no second ledger, no extra writes, and
 * nothing here changes routing. Explicit config/project overrides remain the authority.
 */
export async function modelReport(root, {project = null} = {}) {
  const directory = path.join(root, '.video/ui');
  const entries = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const jobs = [];
  for (const name of entries.filter(name => /^[a-f0-9-]+\.json$/.test(name))) {
    let job;
    try { job = JSON.parse(await readFile(path.join(directory, name), 'utf8')); } catch { continue; }
    if (project?.thread && job.id !== project.thread) continue;
    jobs.push(job);
  }
  const groups = new Map(), totals = {agents: 0, runs: 0, input: 0, output: 0, cached: 0, cacheWrite: 0, reasoning: 0,
    total: 0, failedTools: 0, reportedCostUSD: 0, costReported: false};
  for (const job of jobs) for (const agent of job.agents || []) {
    if (!agent?.role) continue;
    const usage = agent.usage || {};
    const provider = agent.provider || job.provider || 'unknown';
    const model = agent.actualModel || agent.model || 'CLI default';
    const key = JSON.stringify([provider, model, agent.role]);
    const row = groups.get(key) || {provider, model, role: agent.role, agents: 0, runs: 0, input: 0, output: 0,
      cached: 0, cacheWrite: 0, reasoning: 0, total: 0, failedTools: 0, reportedCostUSD: 0, costReported: false, status: {}};
    const runs = number(agent.runs) || 1;
    row.agents++; row.runs += runs; row.failedTools += number(agent.failedTools);
    for (const field of fields) row[field] += number(usage[field]);
    row.reportedCostUSD += number(usage.reportedCostUSD);
    row.costReported ||= usage.costReported === true;
    row.status[agent.status || 'unknown'] = (row.status[agent.status || 'unknown'] || 0) + 1;
    totals.agents++; totals.runs += runs; totals.failedTools += number(agent.failedTools);
    for (const field of fields) totals[field] += number(usage[field]);
    totals.reportedCostUSD += number(usage.reportedCostUSD);
    totals.costReported ||= usage.costReported === true;
    groups.set(key, row);
  }
  const rows = [...groups.values()].map(row => ({...row, avgInputPerRun: row.runs ? row.input / row.runs : 0,
    avgOutputPerRun: row.runs ? row.output / row.runs : 0}))
    .sort((a, b) => a.role.localeCompare(b.role) || b.total - a.total || a.model.localeCompare(b.model));
  return {threads: jobs.length, jobs: jobs.map(job => ({id: job.id, title: job.title || '', path: job.jobPath || ''})),
    rows, totals: {...totals, avgInputPerRun: totals.runs ? totals.input / totals.runs : 0,
      avgOutputPerRun: totals.runs ? totals.output / totals.runs : 0}};
}

const count = value => Math.round(value).toLocaleString('en-US');
const money = (row, total = false) => row.costReported ? `$${row.reportedCostUSD.toFixed(total ? 2 : 3)}` : '—';
const statusText = status => Object.entries(status).sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} ${n}`).join(', ');

export function formatModelReport(report, {project = null} = {}) {
  if (!report.rows.length) return `MODEL REPORT${project ? ` (${project.slug})` : ''}: no agent usage found in .video/ui.`;
  const lines = [`MODEL REPORT${project ? ` (${project.slug}${project.thread ? ` · thread ${project.thread}` : ''})` : ''}`,
    `${report.threads} thread(s) · ${report.totals.agents} agent(s) · ${count(report.totals.runs)} run(s) · ${count(report.totals.total)} tokens · failed tools ${report.totals.failedTools} · cost ${money(report.totals, true)}`];
  let role = '';
  for (const row of report.rows) {
    if (row.role !== role) { role = row.role; lines.push('', role); }
    lines.push(`  ${`${row.provider}/${row.model}`.padEnd(34)} ${`${row.agents} agent(s)`.padEnd(12)} ${`${row.runs} run(s)`.padEnd(11)} input ${count(row.input).padStart(12)}  output ${count(row.output).padStart(10)}  cached ${count(row.cached).padStart(12)}  failed ${String(row.failedTools).padStart(2)}  cost ${money(row).padStart(8)}  ${statusText(row.status)}`);
  }
  lines.push('', 'Routing stays explicit: compare a role across models, then set video.config/chat.config profiles or `project-set --model role=provider:model`. Token count is cost evidence, not a quality score.');
  return lines.join('\n');
}
