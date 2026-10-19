import { spawn } from 'node:child_process';
import { executable } from './providers.mjs';
import { redact } from './events.mjs';

const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
export const emptyUsage = () => ({ input: 0, output: 0, cached: 0, cacheWrite: 0, reasoning: 0, total: 0, reports: 0, reportedCostUSD: 0, costReported: false });
export function tokens(provider, raw = {}) {
  const cached = number(raw.cached_input_tokens ?? raw.cache_read_input_tokens ?? raw.cache?.read);
  const cacheWrite = number(raw.cache_creation_input_tokens ?? raw.cache?.write);
  const baseInput = number(raw.input_tokens ?? raw.input);
  const input = baseInput + (provider === 'Codex' ? 0 : cached + cacheWrite);
  const output = number(raw.output_tokens ?? raw.output);
  return { input, output, cached, cacheWrite, reasoning: number(raw.reasoning_output_tokens ?? raw.reasoning), total: input + output };
}
const fields = ['input','output','cached','cacheWrite','reasoning','total'];
export function applyUsage(agent, provider, event, runId, sequence, hasAssistantUsage) {
  agent.usage ||= emptyUsage(); agent.usageLedger ||= {};
  if (event.model) agent.actualModel = event.model;
  if (provider === 'Claude' && event.fallbackOnly && event.usage) {
    // Per-step output counts can be placeholders. Reconcile to this turn's final
    // usage; unlike cost, result.usage does not include earlier resumed turns.
    agent.claudeRunTotals ||= {};
    const previous = agent.claudeRunTotals[runId] || {};
    const value = tokens(provider, event.usage);
    for (const field of fields) agent.usage[field] = Math.max(0, agent.usage[field] + value[field] - (previous[field] || 0));
    agent.claudeRunTotals[runId] = value;
    agent.usage.reports++;
  } else if (event.usage) {
    const key = event.usageKey || `${runId}:${sequence}`;
    const value = tokens(provider, event.usage);
    const previous = agent.usageLedger[key] || {};
    const deltas = {};
    for (const field of fields) { deltas[field] = Math.max(0, value[field] - (previous[field] || 0)); agent.usage[field] += deltas[field]; }
    if (provider === 'Claude') {
      agent.claudeRunTotals ||= {}; agent.claudeRunTotals[runId] ||= {};
      for (const field of fields) agent.claudeRunTotals[runId][field] = (agent.claudeRunTotals[runId][field] || 0) + deltas[field];
    }
    if (!agent.usageLedger[key]) agent.usage.reports++;
    agent.usageLedger[key] = Object.fromEntries(fields.map(field => [field, Math.max(value[field], previous[field] || 0)]));
    agent.lastContextTokens = value.total;
  }
  if (typeof event.cost === 'number' && Number.isFinite(event.cost) && event.cost >= 0) {
    if (provider === 'Claude') {
      // Claude's result reports cumulative conversation cost, including resumed turns.
      const baseline = agent.sessionCostTotal || 0;
      agent.usage.reportedCostUSD += Math.max(0, event.cost - baseline);
      agent.sessionCostTotal = Math.max(baseline, event.cost);
    } else {
      agent.costLedger ||= {};
      const key = event.usageKey || `${runId}:${sequence}`;
      agent.usage.reportedCostUSD += Math.max(0, event.cost - (agent.costLedger[key] || 0));
      agent.costLedger[key] = Math.max(event.cost, agent.costLedger[key] || 0);
    }
    agent.usage.costReported = true;
  }
  if (event.contextWindow && Number.isFinite(event.contextWindow)) {
    agent.context = { limit: event.contextWindow, used: agent.lastContextTokens ?? null, remaining: agent.lastContextTokens === undefined ? null : Math.max(0, event.contextWindow - agent.lastContextTokens), at: new Date().toISOString() };
  }
  if (event.contextLimits) {
    const names = Object.keys(event.contextLimits);
    const model = event.contextLimits[agent.actualModel] || (names.length === 1 ? event.contextLimits[names[0]] : null);
    if (model?.contextWindow) agent.context = { limit: model.contextWindow, used: agent.lastContextTokens ?? null, remaining: agent.lastContextTokens === undefined ? null : Math.max(0, model.contextWindow - agent.lastContextTokens), at: new Date().toISOString() };
  }
  agent.usage.updatedAt = new Date().toISOString();
}
export function totalUsage(agents) {
  const result = emptyUsage();
  for (const agent of agents) if (agent.usage) {
    for (const field of [...fields,'reports','reportedCostUSD']) result[field] += agent.usage[field] || 0;
    result.costReported ||= agent.usage.costReported;
  }
  return result;
}
export function codexWindows(result) {
  const buckets = result.rateLimitsByLimitId ? Object.values(result.rateLimitsByLimitId) : result.rateLimits ? [result.rateLimits] : [];
  return buckets.flatMap(bucket => ['primary','secondary'].flatMap(kind => {
    const window = bucket[kind];
    if (!window || typeof window.usedPercent !== 'number') return [];
    return [{ label: bucket.limitName || bucket.limitId || 'Codex', kind, usedPercent: window.usedPercent, remainingPercent: Math.max(0, Math.min(100, 100 - window.usedPercent)), windowMinutes: window.windowDurationMins ?? null, resetsAt: window.resetsAt ? new Date(window.resetsAt * 1000).toISOString() : null }];
  }));
}

export async function readCodexLimits(root, spawnProcess = spawn) {
  const command = await executable('Codex');
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, ['app-server','--stdio'], { cwd: root, stdio: ['pipe','pipe','pipe'], detached: process.platform !== 'win32', env: { ...process.env, NO_COLOR:'1' } });
    let buffer = '', finished = false, stderr = '';
    const send = message => child.stdin.write(JSON.stringify(message)+'\n');
    const finish = (error, result) => {
      if (finished) return; finished = true; clearTimeout(timer);
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid,'SIGTERM'); } catch {}
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(()=>finish(new Error('Codex quota query timed out')),12000);
    child.stdin.on('error',error=>finish(error));
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000);});
    child.stdout.setEncoding('utf8'); child.stdout.on('data',chunk=>{
      buffer+=chunk;let index;
      while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);let item;try{item=JSON.parse(line);}catch{continue;}
        if(item.id===1){if(item.error)return finish(new Error(item.error.message));send({method:'initialized',params:{}});send({id:2,method:'account/rateLimits/read',params:{}});}
        if(item.id===2){if(item.error)return finish(new Error(item.error.message));return finish(null,{windows:codexWindows(item.result || {}),credits:item.result?.rateLimits?.credits || null});}
      }
    });
    child.once('error',error=>finish(error));child.once('close',()=>{if(!finished)finish(new Error(redact(stderr)||'Codex quota process exited before returning limits'));});
    send({id:1,method:'initialize',params:{clientInfo:{name:'video_workspace',title:'Local video workspace',version:'1.0.0'},capabilities:{experimentalApi:true}}});
  });
}
export class UsageService {
  constructor(root) { this.root=root;this.states=new Map();this.pending=null; }
  observe(provider,event) {
    if(event.type!=='quota')return;
    this.states.set(provider,{name:provider,source:'CLI rate-limit event',checkedAt:new Date().toISOString(),windows:event.windows || [],detail:event.detail || 'Provider reported a rate-limit status',available:true});
  }
  async snapshot(jobs,refresh=false) {
    const current=this.states.get('Codex');
    if(refresh || !current || Date.now()-Date.parse(current.checkedAt)>60000){
      if(!this.pending)this.pending=readCodexLimits(this.root).then(result=>this.states.set('Codex',{name:'Codex',source:'Codex account/rateLimits/read',checkedAt:new Date().toISOString(),available:result.windows.length>0,...result,detail:result.windows.length?'':'Account quotas were not returned for this login.'})).catch(error=>this.states.set('Codex',{name:'Codex',available:false,checkedAt:new Date().toISOString(),windows:[],detail:redact(error.message)})).finally(()=>{this.pending=null;});
      await this.pending;
    }
    return ['Codex','Claude','OpenCode'].map(name=>({...this.states.get(name),name,...(!this.states.has(name)?{available:false,windows:[],detail:'The CLI has not exposed an account balance. Usage is still counted per job.'}:{}),usage:totalUsage(jobs.flatMap(job=>job.agents.filter(agent=>agent.provider===name)))}));
  }
}
