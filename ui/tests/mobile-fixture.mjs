import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from '../backend/server.mjs';

export async function mobileFixture() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const directory = await mkdtemp(path.join(root,'.video/mobile-qa-'));
  // No CLI processes, real jobs, credentials or production artifacts are touched.
  const app = await createApp({root,directory,runnerFactory:() => ({
    async initialize() {}, async shutdown() {}, usage:{async snapshot() {return [];}},
  })});
  const jobs = ['A long mobile conversation about making a clear and useful explainer video','Another conversation'].map(title => {
    const job = app.store.create({title,prompt:title,provider:'Codex',models:{},format:'landscape'});
    job.status = 'paused';
    for (let i=0;i<45;i++) app.store.message(job,i%2 ? 'orchestrator' : 'You',`Message ${i+1}. ${'This is a realistic conversation with enough text to wrap onto several lines on a phone. '.repeat(3)}`);
    app.store.save(job);
    return job;
  });
  const url = await app.start(0);
  return {app,jobs,url,async close() {await app.close();app.store.flush();await rm(directory,{recursive:true,force:true});}};
}
if (process.argv.includes('--serve')) {
  const fixture = await mobileFixture();
  console.log(fixture.url);
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async () => {await fixture.close();process.exit();});
}
