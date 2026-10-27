// Explicitly invoked, minimal real-provider calls. Never produces a film.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createApp } from '../backend/server.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const directory=path.join(root,'.video/ui-live-smoke',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(directory,{recursive:true});
const app=await createApp({root,directory});await app.start(0);
const results=[];
try{
  const selected = process.argv.slice(2);
  for(const provider of selected.length ? selected : ['Codex','Claude','OpenCode','Pi']){
    if(!['Codex','Claude','OpenCode','Pi'].includes(provider))throw new Error('Unsupported provider');
    const job=app.store.create({title:`${provider} connectivity check`,prompt:'Read-only runner connectivity check',provider,main:'',models:{},format:'landscape',duration:10,gateScript:false});
    job.status='running';app.store.save(job);
    const timer=setTimeout(()=>{void app.runner.control(job,'cancel');},90000);
    try{
      const result=await app.runner.runAgent(job,{role:'orchestrator',prompt:'This is ONLY a read-only connectivity check of the local CLI runner. Do not create a video, modify files, run shell commands, or spawn agents. Call the video_runner feedback MCP tool once. Then respond exactly: RUNNER CONNECTION VERIFIED. Your agent identity is supplied by the MCP server. Stop after this one tool call and short response.'});
      const bridgeCalled=app.store.events(job.id).some(event=>event.name?.includes('feedback')&&event.status==='completed');
      results.push({provider,ok:bridgeCalled,response:result.result.trim().slice(-300),usage:job.usage || null,sessionSaved:Boolean(result.sessionId)});
    }catch(error){results.push({provider,ok:false,error:error.message});}
    finally{clearTimeout(timer);job.status='needs_attention';app.store.save(job);}
    console.log(JSON.stringify(results.at(-1)));
  }
}finally{await app.close();}
if(results.some(result=>!result.ok))process.exitCode=1;
