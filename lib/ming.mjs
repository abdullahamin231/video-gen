import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnTts } from './tts-process.mjs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { cacheDir } from './cache.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAGS = new Set(['Breathing', 'Cough', 'Sigh', 'Laughter', 'Uhm', 'Surprise-ah', 'Surprise-oh', 'Dissatisfaction-hnn', 'Confirmation-en', 'Question-ei', 'Question-ah', 'Question-en', 'Question-oh', 'Question-huh']);
const clean = text => {
  if (/[<>]/.test(text)) throw new Error('Ming does not support angle-bracket delivery tags. Use documented cues in the performance sidecar.');
  const spoken = text.replace(/\[([^\]]+)\]/g, (_, tag) => {
    if (!TAGS.has(tag)) throw new Error(`Unsupported Ming cue [${tag}]. See docs/tts.md.`);
    return '';
  }).replace(/\s+/g, ' ').trim();
  if (/[\[\]]/.test(spoken)) throw new Error('Malformed Ming vocal cue. Use the documented bracket syntax.');
  return spoken;
};
export function mingPlan(text, performance, speed = 1) {
  const plan = performance || { segments: [{ text, speed: 1, pauseAfter: 0 }] };
  if (!Array.isArray(plan.segments) || !plan.segments.length || plan.segments.length > 200) throw new Error('Ming performance needs 1–200 segments.');
  if (Object.hasOwn(plan, 'voiceInstruction')) throw new Error('Ming uses US_James. Remove voiceInstruction from the performance sidecar.');
  const segments = plan.segments.map((segment, index) => {
    if (!segment || typeof segment.text !== 'string' || !clean(segment.text)) throw new Error(`Ming segment ${index + 1} needs spoken text.`);
    if (Object.hasOwn(segment, 'instruction')) throw new Error(`Ming uses US_James. Remove instruction from segment ${index + 1}; use text, speed and pauseAfter.`);
    if (clean(segment.text).split(/\s+/).length > 150) throw new Error(`Ming segment ${index + 1} exceeds 150 words; split it into natural thought groups.`);
    const rate = segment.speed ?? 1, pause = segment.pauseAfter ?? 0.25;
    if (!Number.isFinite(rate) || rate < 0.9 || rate > 1.15 || !Number.isFinite(pause) || pause < 0 || pause > 2) throw new Error(`Ming segment ${index + 1}: speed must be 0.9–1.15 and pauseAfter 0–2 seconds.`);
    return { text: segment.text, speed: rate * speed, pauseAfter: pause };
  });
  if (clean(segments.map(s => s.text).join(' ')) !== text.replace(/\s+/g, ' ').trim()) throw new Error('Ming performance must contain the exact reviewed narration, in order, with only supported vocal cues added. Keep cues out of SCRIPT.md.');
  return { segments };
}
export async function mingSpeech(text, output, { speed, env, performance, onProgress = async () => {} }) {
  const plan = mingPlan(text, performance, speed);
  const cache = cacheDir(env), home = path.join(cache, 'ming-benchmark');
  const python = path.join(home, 'env/bin/python');
  try { await Promise.all([access(python), access(path.join(home, 'source/ming_tts.py')), access(path.join(home, 'model/config.json'))]); }
  catch { throw new Error('Ming is not installed in this checkout. Run npm run video -- tts --setup-ming first (see docs/tts.md).'); }
  const input = output + '.json';
  await writeFile(input, JSON.stringify(plan));
  await mkdir(path.join(cache, 'tmp'), { recursive: true });
  await onProgress({ status: 'queued', queuePosition: null, phase: 'waiting-for-ming' });
  await new Promise((resolve, reject) => {
    const { child, isCancelled } = spawnTts(python, [path.join(ROOT, 'scripts/tts-ming.py'), '--source', path.join(home, 'source'), '--model', path.join(home, 'model'), '--plan', input, '--output', output], { cwd: ROOT,
      env: { ...env, HF_HOME: path.join(cache, 'huggingface'), HF_HUB_OFFLINE: '1', XDG_CACHE_HOME: cache, TMPDIR: path.join(cache, 'tmp'), OMP_NUM_THREADS: '8', MKL_NUM_THREADS: '8', OPENBLAS_NUM_THREADS: '8', TOKENIZERS_PARALLELISM: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let progress = Promise.resolve();
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (!line.startsWith('MING_EVENT ')) { console.log(line); return; }
      let event;
      try { event = JSON.parse(line.slice(11)); }
      catch { return; }
      progress = progress.then(() => onProgress(event));
      // Attach a handler immediately; propagate persistence errors after exit.
      progress.catch(() => child.kill('SIGTERM'));
    });
    let error = ''; child.stderr.on('data', bytes => { error = (error + bytes).slice(-3000); });
    child.on('error', reject);
    child.on('close', async code => {
      lines.close();
      try {
        await progress;
        if (isCancelled()) throw Object.assign(new Error('Ming narration cancelled.'), { code: 'TTS_CANCELLED' });
        if (code !== 0) throw new Error(`Ming generation failed (${code}): ${error}`);
        resolve();
      } catch (failure) { reject(failure); }
    });
  });
}
