import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../backend/store.mjs';
import { Runner, modelFor } from '../backend/runner.mjs';
import { invocation } from '../backend/providers.mjs';
import { normalize, redact } from '../backend/events.mjs';
import { jobFile, parseRange } from '../backend/files.mjs';
import { createApp } from '../backend/server.mjs';
import { tokens, applyUsage, totalUsage, codexWindows } from '../backend/usage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaults = { title: 'Runner integration', prompt: 'A test fixture only', provider: 'Codex', main: '', sub: '', directorModel: '', reviewerModel: '', format: 'landscape', duration: 60, gateScript: false, gatePrototype: false };
const testFolders = [];
after(async () => { for (const folder of testFolders) await rm(folder, { recursive: true, force: true }); });
async function workspace(t) {
  await mkdir(path.join(root, '.video'), { recursive: true });
  const folder = await mkdtemp(path.join(root, '.video/ui-test-'));
  testFolders.push(folder); return folder;
}
async function until(fn, message = 'condition') {
  const deadline = Date.now() + 7000;
  while (!fn()) { if (Date.now() > deadline) throw new Error(`Timed out waiting for ${message}`); await new Promise(resolve => setTimeout(resolve, 20)); }
}
function fakeRunner({ store, root }, behavior = '', callback = false) {
  return new Runner({ root, store, spawnProcess: (_command, _args, options) => spawn(process.execPath, [path.join(root, 'ui/tests/fake-cli.mjs')], { ...options, env: { ...options.env, FAKE_BEHAVIOR: behavior, FAKE_CALLBACK: callback ? '1' : '' } }) });
}

test('normalizers preserve actual file paths, tool failures, and provider fatal errors', () => {
  const code = normalize('Codex', { type: 'item.completed', item: { id: 'a', type: 'file_change', changes: [{ kind: 'update', path: 'jobs/test/shots/a.json' }] } });
  assert.equal(code[0].file, 'jobs/test/shots/a.json');
  assert.equal(normalize('Codex', {type:'turn.failed',error:{message:'bad login'}})[0].fatal, true);
  const claude = normalize('Claude', {type:'assistant',message:{content:[{type:'tool_use',id:'tool-a',name:'Edit',input:{file_path:'shots/1.json'}}]}});
  assert.equal(claude[0].operation,'editing');
  const recoveredTool = normalize('Claude', {type:'user',message:{content:[{type:'tool_result',tool_use_id:'tool-a',is_error:true,content:'retry'}]}});
  assert.equal(recoveredTool[0].type,'error'); assert.equal(recoveredTool[0].fatal,undefined);
  const open = normalize('OpenCode', {type:'tool_use',sessionID:'session',part:{tool:'write',callID:'call',state:{status:'completed',input:{filePath:'a.md'},output:'saved'}}});
  assert.equal(open[1].file,'a.md'); assert.equal(open[1].status,'completed');
  assert.equal(redact('api_key=secret-key-here'), 'api_key=[redacted]');
});

test('job token accounting reconciles Claude placeholders and resumed costs without double counting', () => {
  assert.deepEqual(tokens('Codex',{input_tokens:100,cached_input_tokens:40,output_tokens:20}),{input:100,output:20,cached:40,cacheWrite:0,reasoning:0,total:120});
  assert.equal(tokens('Claude',{input_tokens:10,cache_read_input_tokens:80,cache_creation_input_tokens:10,output_tokens:5}).total,105);
  const agent={};
  const partial={usage:{input_tokens:10,cache_read_input_tokens:80,output_tokens:1},usageKey:'message:1',fromAssistant:true};
  applyUsage(agent,'Claude',partial,'run1',1,false);applyUsage(agent,'Claude',partial,'run1',2,true);
  assert.equal(agent.usage.total,91);
  applyUsage(agent,'Claude',{usage:{input_tokens:10,cache_read_input_tokens:80,output_tokens:20},fallbackOnly:true,cost:.1},'run1',3,true);
  assert.equal(agent.usage.total,110);assert.equal(agent.usage.reportedCostUSD,.1);
  applyUsage(agent,'Claude',{usage:{input_tokens:20,output_tokens:30},fallbackOnly:true,cost:.15},'run2',1,false);
  assert.equal(agent.usage.total,160);assert(Math.abs(agent.usage.reportedCostUSD-.15)<.00001);
  const open={};const step={usage:{input:100,output:10,cache:{read:30}},usageKey:'step:1',cost:.02};
  applyUsage(open,'OpenCode',step,'o',1,false);applyUsage(open,'OpenCode',step,'o',2,false);
  assert.equal(open.usage.total,140);assert.equal(open.usage.reportedCostUSD,.02);
  assert.equal(totalUsage([agent,open]).total,300);
  const windows=codexWindows({rateLimitsByLimitId:{codex:{limitId:'codex',primary:{usedPercent:25,windowDurationMins:300,resetsAt:1800000000}}}});
  assert.equal(windows[0].remainingPercent,75);assert.equal(windows[0].windowMinutes,300);
  assert.equal(codexWindows({}).length,0);
});

test('CLI arguments use structured flags, model routing and per-process MCP settings', () => {
  const options = { model: 'model; touch /not-a-shell', session: 'session-1', root, bridge: '/repo/bridge.mjs', env: { VIDEO_RUNNER_TOKEN: 'private' } };
  const codex = invocation('Codex', options);
  assert(codex.args.includes(options.model)); assert(codex.args.includes('resume')); assert(codex.args.includes('session-1'));
  assert(!codex.args.join(' ').includes('private')); assert(!codex.args.includes('--dangerously-bypass-approvals-and-sandbox'));
  const claude = invocation('Claude', options); assert(claude.args.includes('--resume')); assert(claude.args.includes('stream-json'));
  const open = invocation('OpenCode', options); assert(open.args.includes('--standalone')); assert.equal(JSON.parse(open.env.OPENCODE_CONFIG_CONTENT).mcp.video_runner.command[1], options.bridge);
  const routing = { main:'strong',sub:'fast',directorModel:'creative',reviewerModel:'judge' };
  assert.equal(modelFor(routing,'builder'),'fast'); assert.equal(modelFor(routing,'director'),'creative'); assert.equal(modelFor(routing,'script-reviewer'),'judge');
});

test('store persists conversations and appends complete event history independently of snapshots', async t => {
  const folder = await workspace(t); const store = new Store(folder); const job = store.create(defaults);
  store.message(job,'You','My brief'); store.event(job,{type:'test',text:'Observed action'});
  const restored = new Store(folder).get(job.id);
  assert.equal(restored.messages[0].text,'My brief'); assert.equal(restored.events[0].text,'Observed action');
  assert.equal(JSON.parse((await readFile(path.join(folder,job.id+'.events.jsonl'),'utf8')).trim()).text,'Observed action');
});

test('artifact access rejects traversal and symlink escapes; video ranges are correct', async t => {
  const folder = await workspace(t); const job = {jobPath:'jobs/one',scriptPath:'jobs/scripts/one',slug:'one'};
  await mkdir(path.join(folder,'jobs/one'),{recursive:true}); await writeFile(path.join(folder,'jobs/one/video.mp4'),'0123456789');
  await writeFile(path.join(folder,'outside.md'),'private'); await symlink(path.join(folder,'outside.md'),path.join(folder,'jobs/one/escape.md'));
  assert.equal((await jobFile(folder,job,'jobs/one/video.mp4')).info.size,10);
  await assert.rejects(jobFile(folder,job,'jobs/one/../../outside.md'), /outside/);
  await assert.rejects(jobFile(folder,job,'jobs/one/escape.md'), /symlink/);
  assert.deepEqual(parseRange('bytes=3-6',10),{start:3,end:6}); assert.deepEqual(parseRange('bytes=-3',10),{start:7,end:9});
  assert.throws(()=>parseRange('bytes=10-',10),/range/); assert.throws(()=>parseRange('bytes=1-2,4-5',10),/range/);
});

test('real process streaming persists messages and never treats an agent saying done as delivery', async t => {
  const folder = await workspace(t); const store = new Store(folder); const runner = fakeRunner({store,root}); t.after(()=>runner.shutdown());
  await runner.initialize('http://127.0.0.1:1'); const job = store.create(defaults); runner.pump();
  await until(()=>job.status==='needs_attention','unqualified agent exit');
  assert.equal(job.agents.length,1); assert(job.agents[0].sessionId.startsWith('fixture-session-'));
  assert(job.messages.some(m=>m.text.includes('says done'))); assert.equal(job.outputs.video,undefined);
  assert(job.events.some(e=>e.name==='Shell' && e.output==='Fixture check passed'));
});

test('provider failure is surfaced, cancellation stops a process, and queued work starts afterward', async t => {
  const folder = await workspace(t); const store = new Store(folder); const runner = fakeRunner({store,root},'hold'); t.after(()=>runner.shutdown()); await runner.initialize('http://127.0.0.1:1');
  const first = store.create(defaults); const second = store.create({...defaults,title:'Second'}); runner.pump();
  await until(()=>runner.processes.size===1); assert.equal(second.status,'queued');
  await runner.control(first,'pause'); assert.equal(first.status,'paused'); await runner.control(first,'resume'); assert.equal(first.status,'running');
  await runner.control(first,'cancel'); await until(()=>second.status==='running' && [...runner.processes.values()].some(p=>p.job.id===second.id),'next queued job');
  assert.equal(first.status,'cancelled'); await runner.control(second,'cancel'); await until(()=>runner.processes.size===0,'cancelled processes exit');
  const errorStore = new Store(path.join(folder,'errors')); const errors = fakeRunner({store:errorStore,root},'error'); t.after(()=>errors.shutdown()); await errors.initialize('http://127.0.0.1:1'); const failed=errorStore.create(defaults); errors.pump(); await until(()=>failed.status==='failed'); assert.match(failed.error,/authentication/);
});

test('API streams updates, authorizes bridge tools, rejects cross-origin writes, and serves byte ranges', async t => {
  const folder = await workspace(t);
  const app = await createApp({root,directory:path.join(folder,'state'),runnerFactory: options=>fakeRunner(options,'',true)});
  const url = await app.start(0); t.after(()=>app.close());
  const post = (pathname,data,headers={})=>fetch(url+pathname,{method:'POST',headers:{'Content-Type':'application/json','X-Video-Client':'1',...headers},body:JSON.stringify(data)});
  assert.equal((await post('/api/jobs',defaults,{Origin:'https://evil.example'})).status,403);
  assert.equal((await fetch(url+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(defaults)})).status,403);
  const sse = await fetch(url+'/api/stream'); const reader=sse.body.getReader(); assert.match(new TextDecoder().decode((await reader.read()).value),/connected/); await reader.cancel();
  const response = await post('/api/jobs',defaults); assert.equal(response.status,201); const created=await response.json(); const job=app.store.get(created.id);
  await until(()=>job.status==='needs_attention'); assert.equal(job.stage,2); assert.equal(job.stageSource,'agent-reported');
  const forbidden = await post('/api/internal/tool',{thread:job.id,agentId:job.orchestratorId,name:'complete'}); assert.equal(forbidden.status,403);
  await mkdir(path.join(root,job.jobPath),{recursive:true}); t.after(()=>rm(path.join(root,job.jobPath),{recursive:true,force:true})); t.after(()=>rm(path.join(root,job.scriptPath),{recursive:true,force:true}));
  await writeFile(path.join(root,job.jobPath,'test.mp4'),'0123456789');
  const media=await fetch(url+`/api/jobs/${job.id}/artifact?path=${encodeURIComponent(job.jobPath+'/test.mp4')}`,{headers:{Range:'bytes=2-5'}}); assert.equal(media.status,206); assert.equal(media.headers.get('content-range'),'bytes 2-5/10'); assert.equal(await media.text(),'2345');
  const feedback=await post(`/api/jobs/${job.id}/messages`,{text:'Make it shorter'});assert.equal(feedback.status,201);assert(app.store.get(job.id).messages.some(m=>m.text==='Make it shorter'));
});

test('checkpoint choices persist and interrupted runs do not silently restart', async t => {
  const folder = await workspace(t); const store=new Store(folder); const job=store.create({...defaults,gateScript:true});
  job.status='running'; const agent={id:'orchestrator',role:'orchestrator',status:'finished'};job.agents.push(agent);store.save(job);
  const runner=new Runner({root,store}); runner.closed=true;
  assert.deepEqual(await runner.tool(job,agent.id,'checkpoint',{kind:'script',summary:'Review script'}),{paused:true,instruction:'Stop the turn now. The UI resumes this thread after a decision.'});
  assert.equal(job.status,'gate'); await runner.control(job,'approve'); assert.equal(job.status,'queued'); assert(job.approvedGates.includes('script'));
  job.status='running';store.save(job);const restoredStore=new Store(folder);const restored=new Runner({root,store:restoredStore});t.after(()=>restored.shutdown());await restored.initialize('http://127.0.0.1:1');assert.equal(restoredStore.get(job.id).status,'interrupted');
});
