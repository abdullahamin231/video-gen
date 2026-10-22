import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
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
export const MING_STYLE = 'One consistent adult American English narrator with a warm, clear mid-low voice. Conversational, engaged and understated. Use natural sentence pauses, purposeful emphasis and varied cadence. Avoid theatrical acting and a repetitive announcer rhythm.';
export function mingPlan(text, performance, speed = 1) {
  const plan = performance || { segments: [{ text, instruction: 'Explain this naturally to one interested listener.', speed: 1, pauseAfter: 0 }] };
  if (!Array.isArray(plan.segments) || !plan.segments.length || plan.segments.length > 200) throw new Error('Ming performance needs 1–200 segments.');
  if (plan.voiceInstruction !== undefined && (typeof plan.voiceInstruction !== 'string' || plan.voiceInstruction.length > 1000)) throw new Error('Ming voiceInstruction must be text of at most 1000 characters.');
  const segments = plan.segments.map((segment, index) => {
    if (!segment || typeof segment.text !== 'string' || !clean(segment.text)) throw new Error(`Ming segment ${index + 1} needs spoken text.`);
    if (segment.instruction !== undefined && (typeof segment.instruction !== 'string' || segment.instruction.length > 1000)) throw new Error(`Invalid Ming instruction in segment ${index + 1}.`);
    if (clean(segment.text).split(/\s+/).length > 150) throw new Error(`Ming segment ${index + 1} exceeds 150 words; split it into natural thought groups.`);
    const rate = segment.speed ?? 1, pause = segment.pauseAfter ?? 0.25;
    if (!Number.isFinite(rate) || rate < 0.9 || rate > 1.15 || !Number.isFinite(pause) || pause < 0 || pause > 2) throw new Error(`Ming segment ${index + 1}: speed must be 0.9–1.15 and pauseAfter 0–2 seconds.`);
    return { text: segment.text, instruction: `${MING_STYLE} ${plan.voiceInstruction || ''} ${segment.instruction || 'Speak naturally and clearly.'}`, speed: rate * speed, pauseAfter: pause };
  });
  if (clean(segments.map(s => s.text).join(' ')) !== text.replace(/\s+/g, ' ').trim()) throw new Error('Ming performance must contain the exact reviewed narration, in order, with only supported vocal cues added. Keep cues out of SCRIPT.md.');
  return { segments };
}
export async function mingSpeech(text, output, { speed, env, performance }) {
  const plan = mingPlan(text, performance, speed);
  const cache = cacheDir(env), home = path.join(cache, 'ming-benchmark');
  const python = path.join(home, 'env/bin/python');
  try { await Promise.all([access(python), access(path.join(home, 'source/ming_tts.py')), access(path.join(home, 'model/config.json'))]); }
  catch { throw new Error('Ming is not installed in this checkout. Run npm run video -- tts --setup-ming first (see docs/tts.md).'); }
  const input = output + '.json';
  await writeFile(input, JSON.stringify(plan));
  await mkdir(path.join(cache, 'tmp'), { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(ROOT, 'scripts/tts-ming.py'), '--source', path.join(home, 'source'), '--model', path.join(home, 'model'), '--plan', input, '--output', output], { cwd: ROOT,
      env: { ...env, HF_HOME: path.join(cache, 'huggingface'), HF_HUB_OFFLINE: '1', XDG_CACHE_HOME: cache, TMPDIR: path.join(cache, 'tmp'), OMP_NUM_THREADS: '8', MKL_NUM_THREADS: '8', OPENBLAS_NUM_THREADS: '8', TOKENIZERS_PARALLELISM: 'false' }, stdio: ['ignore', 'inherit', 'pipe'] });
    let error = ''; child.stderr.on('data', bytes => { error = (error + bytes).slice(-3000); });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`Ming generation failed (${code}): ${error}`)));
  });
}
