import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, glob, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { createApp } from '../backend/server.mjs';
import { Runner } from '../backend/runner.mjs';
import { totalUsage } from '../backend/usage.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
await mkdir(path.join(root,'.video/ui-qa'),{recursive:true});
const directory=await mkdtemp(path.join(root,'.video/ui-browser-'));
let executable=process.env.UI_BROWSER_EXECUTABLE;
if(!executable)for await(const filename of glob(path.join(os.homedir(),'.cache/hyperframes/chrome/**/chrome-headless-shell'))) { if((await stat(filename)).isFile()){executable=filename;break;} }
if(!executable)throw new Error('Set UI_BROWSER_EXECUTABLE to your installed Chrome/Chromium binary.');
const app=await createApp({root,directory,runnerFactory:options=>{
  const runner=new Runner({...options,spawnProcess:(_command,_args,settings)=>spawn(process.execPath,[path.join(root,'ui/tests/fake-cli.mjs')],{...settings,env:{...settings.env,FAKE_CALLBACK:'1'}})});
  runner.usage.snapshot=async jobs=>['Codex','Claude','OpenCode'].map(name=>({name,available:name==='Codex',checkedAt:new Date().toISOString(),source:'Browser test fixture',windows:name==='Codex'?[{label:'Test quota',kind:'primary',windowMinutes:300,remainingPercent:75}]:[],detail:'Not exposed in this fixture',usage:totalUsage(jobs.flatMap(j=>j.agents.filter(a=>a.provider===name)))}));
  return runner;
}});
const url=await app.start(0);
const browser=await puppeteer.launch({executablePath:executable,headless:true,args:['--no-sandbox']});
const errors=[];
try{
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});
  await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForSelector('.welcome');
  assert.equal(await page.$('.brand'),null);assert.equal(await page.$('.workspace-switch'),null);
  await page.click('.new-job');await page.select('select[name=format]','vertical');await page.type('#new-prompt','A test fixture video about power grids.');await page.type('input[name=title]','Browser integration fixture');
  await page.type('input[name=main]','fixture-main');await page.type('input[name=sub]','fixture-builder');await page.click('#new-job-form button[type=submit]');
  await page.waitForSelector('.status-badge.needs_attention',{timeout:20000});
  assert.equal(app.store.all().length,1);const job=app.store.all()[0];assert.equal(job.main,'fixture-main');assert.equal(job.sub,'fixture-builder');assert.equal(job.format,'vertical');
  assert(job.agents[0].sessionId);assert.equal(job.usage.total,15);
  await page.click('[data-action=configure]');await page.waitForSelector('#configure-form');await page.$eval('input[name=main]',input=>input.value='updated-main');await page.click('#configure-form button[type=submit]');await page.waitForFunction(()=>!document.querySelector('.modal'));assert.equal(job.main,'updated-main');
  await writeFile(path.join(root,job.scriptPath,'SCRIPT.md'),'# Fixture script\n\nThis is an interface test, not a production video.');app.store.event(job,{type:'file',file:job.scriptPath+'/SCRIPT.md',text:'Fixture script created',source:'filesystem'});
  await page.click('[data-action=tab][data-tab=files]');await page.waitForSelector('.file-row');await page.click('.file-row');await page.waitForSelector('.code-view');assert((await page.$eval('.code-view',node=>node.textContent)).includes('interface test'));await page.click('[data-action=close]');
  await page.click('[data-action=tab][data-tab=thread]');await page.type('#message-input','Use fewer labels.');await page.click('.send-button');await page.waitForFunction(()=>document.querySelector('.thread-content').textContent.includes('Use fewer labels.'));
  job.status='gate';job.gate={kind:'script',summary:'Review the fixture script',file:job.scriptPath+'/SCRIPT.md'};app.store.save(job);
  await page.waitForSelector('.gate-card');await page.type('#gate-feedback','Keep this visual.');await page.click('[data-action=approve]');await page.waitForSelector('.status-badge.needs_attention',{timeout:20000});assert(job.approvedGates.includes('script'));assert.equal(job.usage.total,30);
  await page.click('[data-action=usage]');await page.waitForSelector('.usage-providers');assert((await page.$eval('.usage-providers',n=>n.textContent)).includes('75% remaining'));await page.click('[data-action=close]');
  await page.screenshot({path:path.join(root,'.video/ui-qa/desktop.png'),fullPage:true});
  await page.click('[data-action=tab][data-tab=outputs]');await page.waitForSelector('.output-await');assert.equal(await page.$('video'),null);
  await page.setViewport({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.click('[data-action=sidebar]');await page.waitForSelector('.sidebar-open .sidebar');await page.click('.new-job');await page.waitForSelector('#new-job-form');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.click('[data-action=close]');
  await page.screenshot({path:path.join(root,'.video/ui-qa/mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['empty state','minimal sidebar','create real thread via fixture CLI','model settings','file inspector','feedback','checkpoint and resume','token counts','provider quotas','outputs empty state','mobile layout'],runtimeErrors:errors,screenshots:'.video/ui-qa/'}));
}finally{
  await browser.close();await app.close();
  for(const job of app.store.all()){await rm(path.join(root,job.scriptPath),{recursive:true,force:true});await rm(path.join(root,job.jobPath),{recursive:true,force:true});}
  await rm(directory,{recursive:true,force:true});
}
