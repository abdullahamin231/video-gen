import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rename, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheDir } from './cache.mjs';
import { extractNarration } from './timing.mjs';
import { request as httpsRequest } from 'node:https';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TTS_PROVIDERS = ['kokoro', 'gemini'];
export const GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts';
export const QUOTA_NOTICE = 'Gemini’s usage limit was reached. Using Kokoro for the entire narration so the voice stays consistent.';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-2000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}: ${stderr.trim()}`)));
  });
}

// Google rejects this host's IPv6 address as an unsupported location while accepting its IPv4 address.
// Scope the route to Gemini requests; global DNS preferences would also affect the UI and every other provider.
export function geminiRequest(url, { method, headers, body, signal }, requestImpl = httpsRequest) {
  return new Promise((resolve, reject) => {
    const request = requestImpl(url, { method, family: 4, headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, signal }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('Gemini response ended before completion.')));
      response.on('end', () => resolve({ status: response.statusCode, ok: response.statusCode >= 200 && response.statusCode < 300,
        json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

export async function geminiSpeech(text, { speed = 1, env = process.env, fetchImpl = geminiRequest,
  retryDelay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!key) throw new Error('Gemini narration needs GEMINI_API_KEY in the server environment or repository .env.');
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      model: env.GEMINI_TTS_MODEL || GEMINI_TTS_MODEL, store: false,
      input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata',
        style: `Clear, natural American English explainer narration. Warm and conversational, with purposeful emphasis. Speak at approximately ${Math.round(170 * speed)} words per minute.` }] }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: env.GEMINI_TTS_VOICE || 'Charon' }] },
    }),
  };
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', { ...options, signal: AbortSignal.timeout(300000) });
    if (![500, 502, 503, 504].includes(response.status) || attempt === 2) break;
    await retryDelay(1000 * (attempt + 1));
  }
  if (response.status === 429) throw Object.assign(new Error('Gemini usage limit reached.'), { code: 'TTS_QUOTA' });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const message = String(detail?.error?.message || '').split(key).join('[redacted]').split(text).join('[transcript]')
      .replace(/AIza[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._-]+/g, '[redacted]').slice(0, 1200);
    throw new Error(`Gemini TTS returned HTTP ${response.status}${message ? `: ${message}` : '. Check the API key, model access and server configuration.'}`);
  }
  const result = await response.json();
  const audio = (result.steps || []).filter(step => step.type === 'model_output')
    .flatMap(step => step.content || []).filter(item => item.type === 'audio').at(-1);
  const bytes = audio?.data ? Buffer.from(audio.data, 'base64') : null;
  if (!bytes || bytes.length <= 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('Gemini TTS did not return a complete WAV recording.');
  return bytes;
}

async function kokoroSpeech(text, output, { speed, voice }) {
  const input = output + '.txt';
  await writeFile(input, text + '\n');
  await run(process.execPath, [path.join(ROOT, 'scripts/tts-kokoro.mjs'), input, '-v', voice, '-s', String(speed), '-o', output]);
}

async function assemble(parts, output, { work, narration }) {
  // Normalise every paragraph before concat: both engines must use the same sample format.
  const names = [];
  for (const [index, file] of parts.entries()) {
    const name = `p${index}.wav`;
    await run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', path.join(work, name)]);
    if (index && narration) names.push("file 'gap.wav'");
    names.push(`file '${name}'`);
  }
  if (narration) await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '0.6', '-c:a', 'pcm_s16le', path.join(work, 'gap.wav')]);
  await writeFile(path.join(work, 'list.txt'), names.join('\n') + '\n');
  const staged = path.join(work, 'narration.wav');
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '1', '-i', path.join(work, 'list.txt'),
    ...(narration ? ['-af', 'apad=pad_dur=1.5'] : []), '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', staged]);
  // The old output stays intact until the complete replacement has been generated.
  const next = output + '.next';
  await writeFile(next, await readFile(staged));
  await rename(next, output);
}

export async function readTtsStatus(filename) {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function ttsCache(env) {
  const cache = cacheDir(env);
  await mkdir(cache, { recursive: true });
  const root = await realpath(ROOT), allowed = await realpath(path.join(ROOT, '.cache'));
  const actual = await realpath(cache), relative = path.relative(allowed, actual);
  if (allowed !== path.join(root, '.cache') || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error('TTS cache must resolve inside the repository .cache directory.');
  return actual;
}

export async function generateSpeech({ text, output, provider = 'kokoro', speed = 1, voice = 'am_michael',
  narration = false, statusFile = path.join(path.dirname(output), 'tts-status.json'), env = process.env },
  { gemini = geminiSpeech, kokoro = kokoroSpeech, join = assemble, notify = console.warn } = {}) {
  if (!TTS_PROVIDERS.includes(provider)) throw new Error('Choose kokoro or gemini for narration.');
  if (!Number.isFinite(speed) || speed < 0.9 || speed > 1.25) throw new Error('Narration speed must be between 0.9 and 1.25.');
  if (path.extname(output).toLowerCase() !== '.wav') throw new Error('Narration output must be a .wav file.');
  const paragraphs = (narration ? extractNarration(text).split(/\n\s*\n/) : [text]).map(p => p.trim()).filter(Boolean);
  if (!paragraphs.length) throw new Error('The script has no narration text.');
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(path.dirname(statusFile), { recursive: true });
  const previous = await readTtsStatus(statusFile);
  // Once quota is exhausted, retries/resumes of this job stay on Kokoro.
  const fallback = provider === 'gemini' && previous?.requestedProvider === 'gemini' && previous?.fallback?.reason === 'quota' ? previous.fallback : null;
  const status = { requestedProvider: provider, usedProvider: fallback ? 'kokoro' : provider, status: 'generating', output,
    fallback, ...(provider === 'gemini' ? { model: env.GEMINI_TTS_MODEL || GEMINI_TTS_MODEL } : {}) };
  const save = async () => {
    status.updatedAt = new Date().toISOString();
    await writeFile(statusFile + '.next', JSON.stringify(status, null, 2) + '\n');
    await rename(statusFile + '.next', statusFile);
  };
  const cache = await ttsCache(env);
  const work = await mkdtemp(path.join(cache, 'tts-'));
  try {
    await save();
    const synthesize = async selected => {
      const files = [];
      for (const [index, paragraph] of paragraphs.entries()) {
        const file = path.join(work, `${selected}-${index}.wav`);
        if (selected === 'gemini') await writeFile(file, await gemini(paragraph, { speed, env }));
        else await kokoro(paragraph, file, { speed, voice });
        files.push(file);
      }
      return files;
    };
    let parts;
    try { parts = await synthesize(status.usedProvider); }
    catch (error) {
      if (status.usedProvider !== 'gemini' || error.code !== 'TTS_QUOTA') throw error;
      status.usedProvider = 'kokoro';
      status.fallback = { reason: 'quota', notice: QUOTA_NOTICE, at: new Date().toISOString() };
      await save();
      notify(QUOTA_NOTICE);
      parts = await synthesize('kokoro');
    }
    await join(parts, output, { work, narration });
    status.status = 'complete';
    await save();
    return status;
  } catch (error) {
    status.status = 'failed';
    await save();
    throw error;
  } finally { await rm(work, { recursive: true, force: true }); }
}
