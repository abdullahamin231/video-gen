import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { generateSpeech } from '../lib/tts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await delay(20);
  }
  throw new Error('Timed out waiting for worker state');
}
const json = file => readFile(file, 'utf8').then(JSON.parse).catch(() => null);

async function fixture(t) {
  const dir = await mkdtemp(path.join(root, '.cache/ming-process-test-'));
  const home = path.join(dir, 'ming');
  await Promise.all(['env/bin', 'source', 'model'].map(folder => mkdir(path.join(home, folder), { recursive: true })));
  await writeFile(path.join(home, 'model/config.json'), '{}');
  await writeFile(path.join(home, 'source/ming_tts.py'), '# Fixture only\n');
  // Model-free executable in place of the venv Python. Use the actual queue,
  // launcher-death monitor and stdout protocol, with a private fixture queue.
  await writeFile(path.join(home, 'env/bin/python'), `#!/usr/bin/env python3
import sys, time, wave
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(path.join(root, 'scripts'))})
from ming_queue import acquire_worker_slot, queue_event
lease = acquire_worker_slot(${JSON.stringify(path.join(dir, 'queue'))})
output = Path(sys.argv[sys.argv.index('--output') + 1])
queue_event({'status': 'generating', 'queuePosition': 0, 'phase': 'synthesizing', 'phrase': 1, 'phrases': 1})
while not Path(${JSON.stringify(path.join(dir, 'release'))}).exists():
    time.sleep(0.02)
with wave.open(str(output), 'wb') as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(24000)
    audio.writeframes(b'\\0' * 4800)
lease.close()
`, { mode: 0o755 });
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, env: { ...process.env, VG_CACHE: dir } };
}

test('real Ming adapter persists waiting position and model progress, then completes both jobs', async t => {
  const { dir, env } = await fixture(t);
  const options = name => ({ text: 'Fixture narration.', provider: 'ming', output: path.join(dir, name + '.wav'),
    statusFile: path.join(dir, name + '.json'), env });
  const first = generateSpeech(options('first'));
  await until(async () => (await json(path.join(dir, 'first.json')))?.phrase === 1);
  const second = generateSpeech(options('second'));
  const queued = await until(async () => {
    const status = await json(path.join(dir, 'second.json'));
    return status?.status === 'queued' && status.queuePosition === 1 && status;
  });
  assert.equal(queued.phase, 'waiting-for-ming');
  assert.equal(await access(path.join(dir, 'second.wav')).then(() => true, () => false), false);
  await writeFile(path.join(dir, 'release'), '');
  const completed = await Promise.all([first, second]);
  assert(completed.every(status => status.status === 'complete' && status.usedProvider === 'ming'));
});

test('stopping a launcher cancels its worker, preserves output and lets the next job start', async t => {
  const { dir, env } = await fixture(t);
  const output = path.join(dir, 'original.wav'), statusFile = path.join(dir, 'cancel.json');
  await writeFile(output, 'previous recording');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { generateSpeech } from ${JSON.stringify(new URL('../lib/tts.mjs', import.meta.url).href)};
    try { await generateSpeech(${JSON.stringify({ text: 'Fixture narration.', provider: 'ming', output, statusFile, env })}); }
    catch { process.exitCode = 1; }
  `], { cwd: root, stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const exit = once(child, 'exit');
  await until(async () => (await json(statusFile))?.phrase === 1);
  child.kill('SIGTERM');
  await exit;
  assert.equal((await json(statusFile)).status, 'cancelled');
  assert.equal(await readFile(output, 'utf8'), 'previous recording');
  await writeFile(path.join(dir, 'release'), '');
  const next = await generateSpeech({ text: 'Next narration.', provider: 'ming', output: path.join(dir, 'next.wav'), env });
  assert.equal(next.status, 'complete');
});

test('forcibly killing the launcher makes its model worker exit and frees the slot', async t => {
  const { dir, env } = await fixture(t);
  const statusFile = path.join(dir, 'killed.json');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { generateSpeech } from ${JSON.stringify(new URL('../lib/tts.mjs', import.meta.url).href)};
    await generateSpeech(${JSON.stringify({ text: 'Fixture narration.', provider: 'ming', output: path.join(dir, 'killed.wav'), statusFile, env })});
  `], { cwd: root, stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const exit = once(child, 'exit');
  await until(async () => (await json(statusFile))?.phrase === 1);
  child.kill('SIGKILL');
  await exit;
  const nextStatus = path.join(dir, 'next.json');
  const next = generateSpeech({ text: 'Next narration.', provider: 'ming', output: path.join(dir, 'next.wav'), statusFile: nextStatus, env });
  // Do not release the fixture gate until the orphan has exited and the next
  // worker has entered: otherwise normal completion could mask an orphan.
  await until(async () => (await json(nextStatus))?.phrase === 1);
  await writeFile(path.join(dir, 'release'), '');
  assert.equal((await next).status, 'complete');
});
