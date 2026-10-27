import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {modelReport, formatModelReport} from '../lib/model-report.mjs';

async function fixture(t, jobs) {
  const cache = path.resolve('.cache/tests');
  await mkdir(cache, {recursive: true});
  const root = await mkdtemp(path.join(cache, 'model-report-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, '.video/ui'), {recursive: true});
  for (const [id, job] of Object.entries(jobs)) await writeFile(path.join(root, '.video/ui', `${id}.json`), JSON.stringify({id, ...job}));
  return root;
}

const agent = (overrides = {}) => ({role: 'builder', provider: 'Codex', model: 'gpt-6-luna', status: 'finished', runs: 1, failedTools: 0,
  usage: {input: 1000, output: 200, cached: 800, cacheWrite: 0, reasoning: 0, total: 1200, reports: 1, reportedCostUSD: 0, costReported: false},
  ...overrides});

test('model report groups measured usage by provider, actual model and role', async t => {
  const root = await fixture(t, {
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': {title: 'one', jobPath: 'jobs/one', agents: [
      agent(), agent({runs: 2, failedTools: 2, usage: {input: 500, output: 50, total: 550, reports: 2}}),
      agent({role: 'script-writer', model: 'gpt-6.1-sol', actualModel: 'gpt-6.1-sol-2026', usage: {input: 100, output: 10, total: 110, reports: 1, reportedCostUSD: 0.25, costReported: true}})]},
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': {title: 'two', jobPath: 'jobs/two', agents: [agent({role: 'reviewer', status: 'failed', runs: 1})]},
  });
  const report = await modelReport(root);
  assert.equal(report.threads, 2);
  assert.equal(report.totals.agents, 4);
  assert.equal(report.totals.runs, 5);
  assert.equal(report.totals.input, 2600);
  assert.equal(report.totals.failedTools, 2);
  assert.equal(report.totals.reportedCostUSD, 0.25);
  assert.equal(report.totals.costReported, true);
  const builder = report.rows.find(row => row.role === 'builder');
  assert.equal(builder.agents, 2);
  assert.equal(builder.runs, 3);
  assert.equal(builder.input, 1500);
  assert.equal(builder.failedTools, 2);
  assert.equal(builder.cached, 800);
  const writer = report.rows.find(row => row.role === 'script-writer');
  assert.equal(writer.model, 'gpt-6.1-sol-2026', 'a provider-reported actual model wins over the requested model');
  const reviewer = report.rows.find(row => row.role === 'reviewer');
  assert.deepEqual(reviewer.status, {failed: 1});
});

test('a project report uses its recorded thread and says so when nothing is measured', async t => {
  const root = await fixture(t, {
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': {title: 'wanted', agents: [agent()]},
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': {title: 'other', agents: [agent({role: 'director'})]},
  });
  const report = await modelReport(root, {project: {slug: 'demo', thread: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}});
  assert.equal(report.threads, 1);
  assert.deepEqual(report.rows.map(row => row.role), ['builder']);
  assert.match(formatModelReport(report, {project: {slug: 'demo', thread: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}}), /MODEL REPORT \(demo · thread/);
  const empty = await modelReport(root, {project: {slug: 'demo', thread: 'cccccccc-cccc-cccc-cccc-cccccccccccc'}});
  assert.match(formatModelReport(empty, {project: {slug: 'demo'}}), /no agent usage found/);
});

test('a missing UI directory is an empty report, not an error', async t => {
  const cache = path.resolve('.cache/tests');
  await mkdir(cache, {recursive: true});
  const root = await mkdtemp(path.join(cache, 'model-empty-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const report = await modelReport(root);
  assert.equal(report.threads, 0);
  assert.deepEqual(report.rows, []);
  assert.match(formatModelReport(report), /no agent usage found/);
});
