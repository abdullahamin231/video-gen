import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, glob, stat, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { createApp } from '../backend/server.mjs';
import { Runner } from '../backend/runner.mjs';
import { totalUsage } from '../backend/usage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shots = path.join(root, '.video/ui-qa');
await mkdir(shots, { recursive: true });
const directory = await mkdtemp(path.join(root, '.video/ui-browser-'));
let executable = process.env.UI_BROWSER_EXECUTABLE;
if (!executable) for await (const filename of glob(path.join(os.homedir(), '.cache/hyperframes/chrome/**/chrome-headless-shell'))) { if ((await stat(filename)).isFile()) { executable = filename; break; } }
if (!executable) throw new Error('Set UI_BROWSER_EXECUTABLE to your installed Chrome/Chromium binary.');
const app = await createApp({ root, directory, runnerFactory: options => {
  const runner = new Runner({ ...options, statusCommand: async () => ({ stdout: '', stderr: 'fixture', code: 1 }), spawnProcess: (_command, _args, settings) => spawn(process.execPath, [path.join(root, 'ui/tests/fake-cli.mjs')], { ...settings, env: { ...settings.env, FAKE_CALLBACK: '1', FAKE_DELEGATE: '1' } }) });
  runner.usage.snapshot = async jobs => ['Codex', 'Claude', 'OpenCode'].map(name => ({ name, available: name === 'Codex', checkedAt: new Date().toISOString(), source: 'Browser test fixture', windows: name === 'Codex' ? [{ label: 'Test quota', kind: 'primary', windowMinutes: 300, remainingPercent: 75 }] : [], detail: 'Not exposed in this fixture', usage: totalUsage(jobs.flatMap(j => j.agents.filter(a => a.provider === name))) }));
  return runner;
} });
const url = await app.start(0);
const browser = await puppeteer.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
const errors = [];
const click = async (page, selector) => { await page.waitForSelector(selector); await page.$eval(selector, node => node.click()); };
try {
  const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('.welcome');
  await click(page, '.new-job'); await page.select('select[name=format]', 'vertical'); await page.type('#new-prompt', 'A test fixture video about power grids.'); assert(/No length found/.test(await page.$eval('#duration-hint', node => node.textContent)), 'a prompt without a length is flagged'); await page.type('#new-prompt', ' Make it 2 minutes.'); assert((await page.$eval('#duration-hint', node => node.textContent)).includes('2 min'), 'the hint shows the length read from the prompt'); await page.type('input[name=title]', 'Browser integration fixture');
  await page.type('input[name=main]', 'fixture-main'); await page.type('input[name="model:builder"]', 'fixture-builder');
  assert((await page.$eval('.role-route[data-role=builder]', node => node.textContent)).includes('fixture-builder'), 'role row shows the chosen model');
  assert(/weak default|repo pin/.test(await page.$eval('.role-route[data-role=director]', node => node.textContent)), 'unset roles show their default');
  // Model IDs belong to one harness: switching clears this harness's choices and switching back restores them.
  const chooseProvider = name => page.$eval(`input[name=provider][value=${name}]`, node => { node.checked = true; node.dispatchEvent(new Event('change', { bubbles: true })); });
  const firstProvider = await page.$eval('input[name=provider]:checked', node => node.value), otherProvider = firstProvider === 'OpenCode' ? 'Codex' : 'OpenCode';
  await chooseProvider(otherProvider);
  assert.equal(await page.$eval('input[name=main]', node => node.value), '', 'another harness starts without this one\'s orchestrator model');
  assert((await page.$eval('.role-route[data-role=orchestrator]', node => node.textContent)).includes(`${otherProvider} weak default`), 'orchestrator falls back to the new harness default');
  await chooseProvider(firstProvider);
  assert.equal(await page.$eval('input[name=main]', node => node.value), 'fixture-main', 'switching back restores the typed model');
  assert.equal(await page.$eval('input[name="model:builder"]', node => node.value), 'fixture-builder');
  await page.$eval('.role-models', node => node.scrollIntoView()); await page.screenshot({ path: path.join(shots, 'role-models.png') });
  await click(page, '#new-job-form button[type=submit]');
  await page.waitForSelector('.status-badge.needs_attention', { timeout: 20000 });
  const job = app.store.all()[0]; assert.equal(job.main, 'fixture-main'); assert.equal(job.models.builder, 'fixture-builder'); assert.equal(job.models.director, ''); assert.equal(job.format, 'vertical');
  assert.equal(job.agents.filter(agent => agent.role === 'builder').length, 2);
  await page.screenshot({ path: path.join(shots, 'thread.png') });

  await click(page, '[data-action=tab][data-tab=agents]'); await page.waitForSelector('.agent-card');
  assert.equal(await page.$$eval('.agent-card', nodes => nodes.length), 3);
  assert((await page.$eval('.agent-tree', node => node.textContent)).includes('Build scene “a”'));
  await page.screenshot({ path: path.join(shots, 'agents.png') });
  await page.$$eval('.agent-card', nodes => nodes[1].click()); await page.waitForSelector('#agent-drawer .activity-row', { timeout: 5000 });
  assert((await page.$eval('#agent-drawer', node => node.textContent)).includes('jobs/fixture/briefs/build-'));
  await page.screenshot({ path: path.join(shots, 'agent-drawer.png') }); await click(page, '[data-action=close]');

  await click(page, '[data-action=tab][data-tab=progress]'); await page.waitForSelector('.phase');
  assert.equal(await page.$$eval('.phase', nodes => nodes.length), 4);
  assert((await page.$eval('.pipeline-says', node => node.textContent)).includes('build scene "a"'));
  await page.screenshot({ path: path.join(shots, 'progress.png') });

  await click(page, '[data-action=tab][data-tab=activity]'); await page.waitForSelector('.activity-row');
  await click(page, '[data-action=filter][data-filter=problems]');
  assert((await page.$eval('.activity-list', node => node.textContent)).includes('grep missing nothing'));
  await click(page, '[data-action=filter][data-filter=all]');

  await click(page, '[data-action=configure]'); await page.waitForSelector('#configure-form'); await page.$eval('input[name=main]', input => { input.value = 'updated-main'; }); await click(page, '#configure-form button[type=submit]'); await page.waitForFunction(() => !document.querySelector('.modal')); assert.equal(job.main, 'updated-main');
  await writeFile(path.join(root, job.scriptPath, 'SCRIPT.md'), '# Fixture script\n\nThis is an interface test, not a production video.');
  await click(page, '[data-action=tab][data-tab=files]'); await page.waitForSelector('.file-row'); await click(page, '.file-row'); await page.waitForSelector('.code-view'); assert((await page.$eval('.code-view', node => node.textContent)).includes('interface test')); await click(page, '[data-action=close]');

  // An older file poll can finish after a newer refresh; it must not erase the newer files.
  await page.setRequestInterception(true);
  let delayedRequest, releaseStarted;
  const started = new Promise(resolve => { releaseStarted = resolve; });
  const intercept = request => {
    if (request.url().endsWith(`/api/jobs/${job.id}/files`) && !delayedRequest) { delayedRequest = request; releaseStarted(); }
    else void request.continue();
  };
  page.on('request', intercept);
  await click(page, '[data-action=refresh-files]'); await started;
  const refreshed = page.waitForResponse(response => response.url().endsWith(`/api/jobs/${job.id}/files`));
  await click(page, '[data-action=refresh-files]'); await refreshed;
  await page.waitForSelector('.file-row');
  await delayedRequest.respond({ status: 200, contentType: 'application/json', body: '[]' });
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(await page.$$eval('.file-row', nodes => nodes.length), 1, 'an old file poll replaced the newer response');
  page.off('request', intercept); await page.setRequestInterception(false);

  await click(page, '[data-action=tab][data-tab=thread]'); await page.waitForSelector('#message-input'); await page.type('#message-input', 'Use fewer labels.'); await click(page, '.send-button'); await page.waitForFunction(() => document.querySelector('.thread-content').textContent.includes('Use fewer labels.'));
  job.status = 'gate'; job.gate = { id: 'g1', kind: 'question', summary: 'Which grid should the opening show?', options: ['Europe', 'Texas'], decision: null }; app.store.save(job);
  await page.waitForSelector('.gate-card.question'); await page.screenshot({ path: path.join(shots, 'question.png') });
  await page.$$eval('[data-action=answer-option]', nodes => nodes[1].click());
  await page.waitForSelector('.status-badge.needs_attention', { timeout: 20000 }); assert.equal(job.gate.answer, 'Texas');

  await click(page, '[data-action=usage]'); await page.waitForSelector('.usage-providers'); assert((await page.$eval('.usage-providers', n => n.textContent)).includes('75% remaining')); await click(page, '[data-action=close]');

  // The player must survive live updates: regions only re-render when their own HTML changes.
  await mkdir(path.join(root, job.jobPath, 'renders'), { recursive: true }); await writeFile(path.join(root, job.jobPath, 'renders/video.mp4'), 'not a real video');
  await click(page, '[data-action=tab][data-tab=outputs]'); await page.waitForSelector('video');
  await page.$eval('video', video => { video.dataset.marker = 'kept'; });
  for (let i = 0; i < 20; i++) app.store.event(job, { type: 'tool', text: `live event ${i}`, status: 'completed', source: 'test' });
  await page.waitForFunction(() => document.querySelector('[data-tab=activity] .tab-count')?.textContent >= '1', { timeout: 3000 }).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(await page.$eval('video', video => video.dataset.marker), 'kept', 'video element was replaced by a live update');

  // Deleting a thread takes its whole footprint with it: the dialog names every folder first.
  await click(page, '[data-action=tab][data-tab=thread]');
  await click(page, '[data-action=delete]'); await page.waitForSelector('.delete-list');
  assert((await page.$eval('.delete-list', node => node.textContent)).includes(job.jobPath), 'the dialog names the job folder');
  await page.screenshot({ path: path.join(shots, 'delete.png') });
  await click(page, '[data-action=confirm-delete]'); await page.waitForSelector('.welcome', { timeout: 10000 });
  const onDisk = file => access(path.join(root, file)).then(() => true, () => false);
  assert.equal(await onDisk(job.jobPath), false, 'the job folder was deleted'); assert.equal(await onDisk(job.scriptPath), false, 'the script folder was deleted');
  assert.equal(app.store.all().length, 0, 'the thread record was deleted');

  await page.setViewport({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await click(page, '[data-action=sidebar]'); await page.waitForSelector('.sidebar-open .sidebar'); await click(page, '.new-job'); await page.waitForSelector('#new-job-form'); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await click(page, '[data-action=close]');
  await page.screenshot({ path: path.join(shots, 'mobile.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['create thread via fixture CLI', 'routing preview', 'agent tree + drawer', 'progress phases + pipeline state', 'activity filters', 'model settings', 'file inspector', 'feedback', 'agent question + answer', 'token counts + quotas', 'video survives live updates', 'delete thread removes its artifacts', 'mobile layout'], runtimeErrors: errors, screenshots: '.video/ui-qa/' }));
} finally {
  await browser.close(); await app.close();
  for (const job of app.store.all()) { await rm(path.join(root, job.scriptPath), { recursive: true, force: true }); await rm(path.join(root, job.jobPath), { recursive: true, force: true }); }
  await rm(directory, { recursive: true, force: true });
}
