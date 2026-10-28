import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { cacheDir } from '../lib/cache.mjs';
import { spawnTts } from '../lib/tts-process.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEXT = 'Every time you open a website, your browser asks a server for information. The server checks the request, finds the right data, and sends a response. Most of this happens in a fraction of a second. Good engineering makes those steps reliable. Clear error messages help us find the cause, fix the problem, and keep the system running. The voice reads this passage. We measure generation time and memory, then compare their clarity, pacing, pronunciation, and natural delivery.';
async function run(command, args, { env = process.env, output } = {}) {
  const log = output ? await open(output, 'w') : null;
  try {
    await new Promise((resolve, reject) => {
      const { child } = spawnTts(command, args, { cwd: ROOT, env, stdio: ['ignore', log ? log.fd : 'inherit', log ? log.fd : 'inherit'] });
      child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}; see ${output || 'output'}`)));
    });
  } finally { await log?.close(); }
}
async function probe(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]);
    let text = ''; child.stdout.on('data', data => text += data); child.on('error', reject);
    child.on('close', code => { try { if (code) throw new Error('ffprobe failed'); resolve(JSON.parse(text)); } catch (error) { reject(error); } });
  });
}
export async function benchmark(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--out', '--engine', '--example'].includes(args[i]) || !args[i+1]) throw new Error('Benchmark options: --out <repository folder> --engine ming --example expressive');
    options[args[i].slice(2)] = args[i+1];
  }
  if (options.example && options.example !== 'expressive') throw new Error('Supported example: expressive');
  const taggedText = options.example === 'expressive' ? '[Surprise-oh] Wait... why is the server still running? I thought we shut it down. [Breathing] Someone is still connected. Okay, stay calm. Disconnect the network first. Then check the logs. [Sigh] There. The connection is gone. We caught it in time. [Laughter] Next time, let us test the shutdown button before we celebrate.' : TEXT;
  const text = taggedText.replace(/\[[^\]]+\]\s*/g, '');
  const out = path.resolve(ROOT, options.out || 'outputs/tts-benchmarks/ming');
  if (path.relative(ROOT, out).startsWith('..') || (options.engine && options.engine !== 'ming')) throw new Error('Choose a repository output folder and ming.');
  await mkdir(out, { recursive: true });
  const script = path.join(out, 'SCRIPT.txt');
  await writeFile(script, text + '\n');
  const mingScript = path.join(out, 'MING-SCRIPT.txt');
  await writeFile(mingScript, taggedText + '\n');
  const cache = cacheDir(), ming = path.join(cache, 'ming-benchmark');
  const env = { ...process.env, TMPDIR: path.join(ming, 'tmp'), XDG_CACHE_HOME: cache,
    HF_HOME: path.join(cache, 'huggingface'), HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1',
    OMP_NUM_THREADS: '8', MKL_NUM_THREADS: '8', OPENBLAS_NUM_THREADS: '8', TOKENIZERS_PARALLELISM: 'false' };
  await mkdir(env.TMPDIR, { recursive: true });
  const resultsFile = path.join(out, 'results.json');
  let results;
  try { results = JSON.parse(await readFile(resultsFile, 'utf8')); } catch { results = { script: text, words: text.split(/\s+/).length,
    host: { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalRamBytes: os.totalmem(), gpu: false },
    method: 'One sequential run per engine; downloaded weights cached; process startup and model loading included. Peak RSS is the largest process, not aggregate process-tree RAM. Clips use the first 30 seconds, padded if shorter; complete native recordings are retained.', engines: {} }; }
  if (results.script !== text) results = { ...results, script: text, words: text.split(/\s+/).length, engines: {} };
  results.mingScript = taggedText;
  results.example = options.example || 'plain';
  const engines = ['ming'];
  for (const engine of engines) {
    const raw = path.join(out, `${engine}-full.wav`), metrics = path.join(out, `${engine}-process.json`);
    const command = path.join(ming,'env/bin/python');
    const commandArgs=[path.join(ROOT,'scripts/benchmark-ming.py'),'--source',path.join(ming,'source'),'--model',path.join(ming,'model'),
      '--script',mingScript,'--output',raw,'--metrics',path.join(out,'ming-stages.json')];
    console.log(`Benchmarking ${engine}; log: ${path.relative(ROOT, path.join(out, `${engine}.log`))}`);
    await run('/usr/bin/time', ['-f', '{"elapsedSeconds":%e,"peakRssKb":%M,"userSeconds":%U,"systemSeconds":%S,"exitCode":%x}', '-o', metrics, command, ...commandArgs], { env, output: path.join(out, `${engine}.log`) });
    const timing = JSON.parse((await readFile(metrics, 'utf8')).trim().split('\n').at(-1));
    const audio = await probe(raw), nativeDurationSeconds = Number(audio.format.duration);
    const clip = path.join(out, `${engine}-30s.wav`);
    await run('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-af', 'apad,atrim=duration=30', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', clip]);
    results.engines[engine] = { model:'Ming-3.0-tts-0.5b',voice:'US_James',
      ...timing, nativeDurationSeconds, realTimeFactor: timing.elapsedSeconds/nativeDurationSeconds,
      nativeSampleRate: Number(audio.streams[0].sample_rate), clipDurationSeconds: 30, clipEndsEarly: nativeDurationSeconds > 30,
      fullRecording: path.basename(raw), clip: path.basename(clip), ...(engine === 'ming' ? { stages: JSON.parse(await readFile(path.join(out, 'ming-stages.json'), 'utf8')) } : {}) };
    await writeFile(resultsFile, JSON.stringify(results, null, 2) + '\n');
    console.log(JSON.stringify(results.engines[engine]));
  }
}
