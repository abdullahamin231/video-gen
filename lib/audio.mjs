// Pipeline soundtrack: decode, cue placement, mix, verification and listening evidence.
import {readFile,writeFile,rename,mkdir,rm,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cacheDir} from './media.mjs';
// Sound effects: WAV files placed on cues next to the narration (never instead of it).
// A shot lists them in "sounds"; the build places each one and checks it against the voice; the mixer (lib/mix.mjs)
// lays them under the narration, which is never processed (only the whole mix gets one gain).


export const SOUND_ALIGN = ['start', 'peak', 'end'];
export const DEFAULT_VOLUME = 0.3;
const FRAME = 0.05;          // seconds per loudness frame for the masking check
const SPEECH_DB = -40;       // narration frames louder than this count as speech
const MARGIN_DB = 6;         // a sound must stay this far under the voice while it speaks

/** Decode a PCM (16/24/32-bit) or float32 WAV into a mono Float32Array. Throws a readable error otherwise. */
export function decodeWav(buf, name = 'file') {
  if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE')
    throw new Error(`${name} is not a WAV file (RIFF/WAVE header missing)`);
  let fmt = null, data = null;
  for (let p = 12; p + 8 <= buf.length;) {
    const id = buf.toString('latin1', p, p + 4), size = buf.readUInt32LE(p + 4), body = p + 8;
    if (id === 'fmt ') {
      let format = buf.readUInt16LE(body);
      if (format === 0xfffe && size >= 26) format = buf.readUInt16LE(body + 24);
      fmt = {format, channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14)};
    } else if (id === 'data') data = buf.subarray(body, Math.min(buf.length, body + size));
    p = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${name}: WAV has no fmt or data chunk`);
  const {format, channels, sampleRate, bits} = fmt, bytes = bits / 8;
  const read = format === 3 && bits === 32 ? (o => data.readFloatLE(o))
    : format === 1 && bits === 16 ? (o => data.readInt16LE(o) / 32768)
    : format === 1 && bits === 24 ? (o => data.readIntLE(o, 3) / 8388608)
    : format === 1 && bits === 32 ? (o => data.readInt32LE(o) / 2147483648) : null;
  if (!read || !channels || !sampleRate) throw new Error(`${name}: unsupported WAV encoding (format ${format}, ${bits}-bit). Use 16/24-bit PCM or 32-bit float.`);
  const frames = Math.floor(data.length / (bytes * channels)), mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += read((i * channels + c) * bytes);
    mono[i] = s / channels;
  }
  return {sampleRate, channels, frames, duration: frames / sampleRate, mono};
}

/** ITU-R BS.1770 K-weighting (high shelf +4 dB above ~1.7 kHz, high-pass ~38 Hz), so levels compare the way
 * LUFS does: a sub-bass thump is not counted as loud as its raw RMS suggests. */
function biquad(x, [b0, b1, b2, a1, a2]) {
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
function shelf(sr) { // pre-filter of BS.1770 (derived for any sample rate)
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196, K = Math.tan(Math.PI * f0 / sr), Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  const a0 = 1 + K / Q + K * K;
  return [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
}
function highpass(sr) {
  const f0 = 38.13547087602444, Q = 0.5003270373238773, K = Math.tan(Math.PI * f0 / sr), a0 = 1 + K / Q + K * K;
  return [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
}
export const kWeight = (mono, sr) => biquad(biquad(mono, shelf(sr)), highpass(sr));

/** K-weighted RMS per FRAME-second window, in dB (silence = -120). */
function frameDb(mono, sampleRate, from = 0, to = mono.length) {
  mono = kWeight(from || to !== mono.length ? mono.subarray(from, to) : mono, sampleRate); to -= from; from = 0;
  const n = Math.max(1, Math.round(FRAME * sampleRate)), out = [];
  for (let i = from; i < to; i += n) {
    let e = 0; const end = Math.min(to, i + n);
    for (let j = i; j < end; j++) e += mono[j] * mono[j];
    out.push(10 * Math.log10(e / Math.max(1, end - i) + 1e-12));
  }
  return out;
}

/** Length, loudest moment (for "peak" alignment) and level of one sound file. */
export function soundInfo(decoded) {
  const db = frameDb(decoded.mono, decoded.sampleRate);
  let peak = 0;
  for (let i = 1; i < db.length; i++) if (db[i] > db[peak]) peak = i;
  return {duration: Number(decoded.duration.toFixed(3)), peakTime: Number(Math.min(decoded.duration, (peak + 0.5) * FRAME).toFixed(3)), db};
}

/** Where a sound starts so that its start, loudest moment or end lands on time t. */
export function placeSound(t, align, info) {
  const start = align === 'end' ? t - info.duration : align === 'peak' ? t - info.peakTime : t;
  return Number(start.toFixed(3));
}

/** The narration's level around each FRAME (energy average over +-150 ms: a voice is heard as syllables, not 50 ms
 * slices) and the speech threshold (20 dB under its loud passages, and above SPEECH_DB). Cached per decoded file. */
const voiceCache = new WeakMap();
export function voiceLevels(narration) {
  if (voiceCache.has(narration)) return voiceCache.get(narration);
  const db = frameDb(narration.mono, narration.sampleRate), w = Math.round(0.15 / FRAME);
  const smooth = db.map((_, k) => { let e = 0, c = 0; for (let j = Math.max(0, k - w); j <= Math.min(db.length - 1, k + w); j++) { e += 10 ** (db[j] / 10); c++; } return 10 * Math.log10(e / c); });
  const sorted = smooth.slice().sort((x, y) => x - y), loud = sorted[Math.floor(sorted.length * 0.9)] ?? -120;
  const out = {db: smooth, threshold: Math.max(SPEECH_DB, loud - 20)};
  voiceCache.set(narration, out);
  return out;
}

/** Where a placed sound comes within MARGIN_DB of the narration while the narrator speaks.
 * Returns null when it stays clear, else {at, overDb, maxVolume}: the worst moment and the volume that would clear it. */
export function maskingAgainst(narration, sound, info, start, volume) {
  const gain = 20 * Math.log10(volume), voice = voiceLevels(narration);
  let worst = null;
  info.db.forEach((db, k) => {
    const t = start + k * FRAME, f = Math.round(t / FRAME);
    if (f < 0 || f >= voice.db.length || db < -60 || voice.db[f] < voice.threshold) return;
    const over = db + gain - (voice.db[f] - MARGIN_DB);
    if (over > 0 && (!worst || over > worst.overDb)) worst = {at: Number(t.toFixed(2)), overDb: Number(over.toFixed(1))};
  });
  if (worst) worst.maxVolume = Number((volume * 10 ** (-worst.overDb / 20)).toFixed(3));
  return worst;
}

export async function readSound(file) { return decodeWav(await readFile(file), path.basename(file)); }

/** The dedicated Python environment for beat analysis and audio evidence plots. */
export function audioEnv(env = process.env) { return path.join(cacheDir(env), 'audio-env'); }
export async function audioPython(env = process.env) {
  const py = path.join(audioEnv(env), 'bin/python');
  return access(py).then(() => py, () => null);
}

// The film's soundtrack, mixed by the pipeline so every level is measured, not guessed.
// Buses: the supplied narration (never processed), sound effects (placed by the build, see lib/sfx.mjs) and an
// optional licensed music track (film.json "music"), ducked while the narrator speaks. One master gain then aims at
// TARGET_LUFS with true peaks at or under PEAK_DB, measured on the exported MP4 itself (after AAC, and in mono).

export const SR = 48000;
export const TARGET_LUFS = -16;
export const PEAK_DB = -4;
export const MUSIC_DEFAULTS = {level: -10, duck: -12, fadeIn: 0.5, fadeOut: 2, attack: 0.12, release: 0.6, hold: 0.3};
const CTRL = 0.01; // seconds per gain-envelope step

function ffmpeg(args, {capture = false} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-hide_banner', ...args], {stdio: ['ignore', 'pipe', 'pipe']});
    const out = []; let err = '';
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => { err = capture ? err + d : (err + d).slice(-6000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({stdout: Buffer.concat(out), stderr: err}) : reject(new Error(`ffmpeg failed (${code}): ${err.slice(-1500)}`)));
  });
}

async function channels(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', file], {stdio: ['ignore', 'pipe', 'pipe']});
    let out = ''; child.stdout.on('data', d => { out += d; }); child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Number(out.trim()) || 2) : reject(new Error(`ffprobe cannot read ${file}`)));
  });
}
/** Decode any audio file to interleaved stereo float32 at 48 kHz (seek/limit in seconds). A mono file is copied to
 * both channels at full level (ffmpeg's own upmix would lower it by 3 dB, which would change the narration). */
export async function decodeStereo(file, {seek = 0, duration = null} = {}) {
  const pan = await channels(file) === 1 ? 'pan=stereo|c0=c0|c1=c0' : 'pan=stereo|c0=c0|c1=c1';
  const args = ['-loglevel', 'error', ...(seek > 0 ? ['-ss', String(seek)] : []), '-i', file, ...(duration ? ['-t', String(duration)] : []),
    '-map', '0:a:0', '-vn', '-af', `${pan},aresample=${SR}`, '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'];
  const {stdout} = await ffmpeg(args);
  return new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 4));
}

/** K-weighted RMS (as in LUFS) in dB per CTRL step of an interleaved stereo buffer (mono sum). */
function levels(buf, frames) {
  const n = Math.round(CTRL * SR), out = new Float32Array(Math.ceil(frames / n)), mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) mono[i] = (buf[2 * i] + buf[2 * i + 1]) / 2;
  const w = kWeight(mono, SR);
  for (let k = 0; k < out.length; k++) {
    let e = 0; const a = k * n, b = Math.min(frames, a + n);
    for (let i = a; i < b; i++) e += w[i] * w[i];
    out[k] = 10 * Math.log10(e / Math.max(1, b - a) + 1e-12);
  }
  return out;
}
const smoothDb = (db, win) => db.map((_, k) => { let e = 0, c = 0; for (let j = Math.max(0, k - win); j <= Math.min(db.length - 1, k + win); j++) { e += 10 ** (db[j] / 10); c++; } return 10 * Math.log10(e / c); });

/** Speech frames of the narration: louder than its loud passages minus 25 dB (and above -50 dBFS), held briefly. */
export function speechMask(voiceDb, hold = MUSIC_DEFAULTS.hold) {
  const sorted = Array.from(voiceDb).sort((a, b) => a - b), p90 = sorted[Math.floor(sorted.length * 0.9)] ?? -120;
  const thr = Math.max(-50, p90 - 25), smooth = smoothDb(Array.from(voiceDb), 5), mask = smooth.map(d => d > thr);
  const h = Math.round(hold / CTRL), out = mask.slice();
  for (let k = 0; k < mask.length; k++) if (mask[k]) for (let j = Math.max(0, k - h); j <= Math.min(mask.length - 1, k + h); j++) out[j] = true;
  return {mask: out, threshold: thr};
}

/** Music gain per CTRL step: base level, ducked by `duck` dB under speech, with attack/release smoothing and fades. */
function duckEnvelope(mask, {duck, attack, release, fadeIn, fadeOut}, startStep, endStep) {
  const env = new Float32Array(mask.length), down = CTRL / Math.max(CTRL, attack), up = CTRL / Math.max(CTRL, release);
  let g = 0; // dB
  for (let k = 0; k < mask.length; k++) {
    const target = mask[k] ? duck : 0;
    g += (target - g) * (target < g ? down : up);
    let fade = 1;
    if (k < startStep || k >= endStep) fade = 0;
    else {
      if (fadeIn > 0) fade = Math.min(fade, (k - startStep) * CTRL / fadeIn);
      if (fadeOut > 0) fade = Math.min(fade, (endStep - k) * CTRL / fadeOut);
    }
    env[k] = 10 ** (g / 20) * Math.max(0, Math.min(1, fade));
  }
  return env;
}

function wavFloat(buf) {
  const data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength), h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 8, 28); h.writeUInt16LE(8, 32); h.writeUInt16LE(32, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** ffmpeg ebur128 on a file's first audio stream: integrated loudness, true peak, sample peak (stereo and mono). */
export async function loudness(file) {
  const read = async filter => {
    const {stderr} = await ffmpeg(['-loglevel', 'info', '-nostats', '-i', file, '-map', '0:a:0', '-af', filter, '-f', 'null', '-'], {capture: true});
    const sum = stderr.slice(stderr.lastIndexOf('Summary:'));
    const num = re => Number(sum.match(re)?.[1]);
    return {integrated: num(/I:\s*(-?[\d.]+|-inf)\s*LUFS/), range: num(/LRA:\s*(-?[\d.]+)\s*LU/),
      truePeak: num(/True peak:\s*Peak:\s*(-?[\d.]+|-inf)/), samplePeak: num(/Sample peak:\s*Peak:\s*(-?[\d.]+|-inf)/)};
  };
  const stereo = await read('ebur128=peak=true+sample'), mono = await read('pan=mono|c0=0.5*c0+0.5*c1,ebur128=peak=true+sample');
  return {...stereo, mono};
}
const worstPeak = m => Math.max(m.truePeak, m.samplePeak, m.mono.truePeak, m.mono.samplePeak);

/** Mix the buses into renders/mix-premaster.wav and return the buffers' measurements (before the master gain). */
export async function mixBuses(job, {world, film, duration}) {
  const frames = Math.round(duration * SR), voice = await decodeStereo(path.join(job, 'assets/narration.wav'), {duration});
  const mix = new Float32Array(frames * 2), sfxBus = new Float32Array(frames * 2), musicBus = new Float32Array(frames * 2);
  for (let i = 0; i < Math.min(voice.length, mix.length); i++) mix[i] = voice[i];
  const voiceDb = levels(voice, Math.min(frames, voice.length / 2));
  const {mask, threshold} = speechMask(voiceDb);
  // sound effects
  for (const s of world.sounds || []) {
    const buf = await decodeStereo(path.join(job, s.src), {duration: s.playDuration ?? s.duration});
    const at = Math.round(s.start * SR);
    for (let i = 0; i < buf.length / 2 && at + i < frames; i++) { sfxBus[2 * (at + i)] += buf[2 * i] * s.volume; sfxBus[2 * (at + i) + 1] += buf[2 * i + 1] * s.volume; }
  }
  // music, levelled against the voice: `level` dB under the voice's speech loudness between sentences, `duck` dB lower while it speaks
  let music = null;
  if (film.music) {
    const m = {...MUSIC_DEFAULTS, ...film.music}, filmStart = m.filmStart ?? 0, trackStart = m.trackStart ?? 0;
    const length = Math.max(0, (m.filmEnd ?? duration) - filmStart);
    const raw = await decodeStereo(path.join(job, m.src), {seek: trackStart, duration: length});
    const rawDb = levels(raw, raw.length / 2), speechDb = 10 * Math.log10(voiceDb.reduce((e, d, k) => e + (mask[k] ? 10 ** (d / 10) : 0), 0) / Math.max(1, mask.filter(Boolean).length) + 1e-12);
    const musicRms = 10 * Math.log10(rawDb.reduce((e, d) => e + 10 ** (d / 10), 0) / Math.max(1, rawDb.length) + 1e-12);
    const base = 10 ** ((speechDb + m.level - musicRms) / 20) * (m.gain ?? 1);
    const startStep = Math.round(filmStart / CTRL), endStep = Math.round((filmStart + Math.min(length, raw.length / 2 / SR)) / CTRL);
    const env = duckEnvelope(mask, m, startStep, endStep), at = Math.round(filmStart * SR), n = Math.round(CTRL * SR);
    for (let i = 0; i < raw.length / 2 && at + i < frames; i++) {
      const k = Math.min(env.length - 1, Math.floor((at + i) / n)), k2 = Math.min(env.length - 1, k + 1), f = ((at + i) % n) / n;
      const g = base * (env[k] * (1 - f) + env[k2] * f);
      musicBus[2 * (at + i)] = raw[2 * i] * g; musicBus[2 * (at + i) + 1] = raw[2 * i + 1] * g;
    }
    music = {src: m.src, trackStart, filmStart, levelDb: m.level, duckDb: m.duck, baseGainDb: Number((20 * Math.log10(base)).toFixed(2)), speechDb: Number(speechDb.toFixed(1))};
  }
  for (let i = 0; i < mix.length; i++) mix[i] += sfxBus[i] + musicBus[i];
  // balance checks: the voice is the loudest thing while it speaks; each sound effect sits above the music
  const sfxDb = levels(sfxBus, frames), musicDb = levels(musicBus, frames), otherDb = levels(sfxBus.map((v, i) => v + musicBus[i]), frames);
  // Masked: effects + music louder than the voice while it speaks. Close: within 3 dB under it, which a short whoosh
  // or a hit often is without hiding a word; that is for the headphone checks, not a repair.
  const overVoice = [], closeToVoice = [];
  const vSmooth = smoothDb(Array.from(voiceDb), 15), oSmooth = smoothDb(Array.from(otherDb), 5);
  for (let k = 0; k < mask.length && k < otherDb.length; k++) if (mask[k] && vSmooth[k] > threshold && oSmooth[k] > vSmooth[k] - 3) {
    const list = oSmooth[k] >= vSmooth[k] ? overVoice : closeToVoice;
    if (!list.length || k * CTRL - list.at(-1).at > 0.5) list.push({at: Number((k * CTRL).toFixed(2)), marginDb: Number((vSmooth[k] - oSmooth[k]).toFixed(1))});
  }
  const underMusic = [];
  if (music) for (const s of world.sounds || []) {
    const a = Math.floor(s.start / CTRL), b = Math.min(sfxDb.length, Math.ceil((s.start + (s.playDuration ?? s.duration)) / CTRL));
    let peak = -120, k0 = a; for (let k = a; k < b; k++) if (sfxDb[k] > peak) { peak = sfxDb[k]; k0 = k; }
    if (peak > -70 && peak < musicDb[k0] + 3) underMusic.push({id: s.id, at: Number(s.at.toFixed(2)), marginDb: Number((peak - musicDb[k0]).toFixed(1))});
  }
  await mkdir(path.join(job, 'renders'), {recursive: true});
  return {mix, frames, speechThreshold: Number(threshold.toFixed(1)), music, overVoice, closeToVoice, underMusic};
}

/** Mix, master and mux: renders/picture.mp4 + soundtrack → renders/video.mp4. Re-measures the MP4 until peaks fit. */
export async function mixdown(job, {world, film, manifest}) {
  const {mix, music, overVoice, closeToVoice, underMusic, speechThreshold} = await mixBuses(job, {world, film, duration: manifest.duration});
  const premaster = path.join(job, 'renders/mix-premaster.wav');
  await writeFile(premaster, wavFloat(mix));
  const pre = await loudness(premaster);
  if (!Number.isFinite(pre.integrated) || !Number.isFinite(worstPeak(pre))) throw new Error(`The mix measured as silent or unreadable (${pre.integrated} LUFS); check assets/narration.wav and the sound files.`);
  let gainDb = Math.min(TARGET_LUFS - pre.integrated, PEAK_DB - 0.3 - worstPeak(pre));
  const tries = [];
  let measured = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const g = 10 ** (gainDb / 20), out = new Float32Array(mix.length);
    for (let i = 0; i < mix.length; i++) out[i] = mix[i] * g;
    await writeFile(path.join(job, 'renders/mix.wav'), wavFloat(out));
    const tmp = path.join(job, 'renders/video.tmp.mp4');
    await ffmpeg(['-loglevel', 'error', '-y', '-i', path.join(job, 'renders/picture.mp4'), '-i', path.join(job, 'renders/mix.wav'),
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', String(SR), '-t', String(manifest.duration),
      // The index goes first so a browser can start playing and seeking before the whole file has arrived.
      '-movflags', '+faststart', tmp]);
    measured = await loudness(tmp);
    tries.push({gainDb: Number(gainDb.toFixed(2)), integrated: measured.integrated, worstPeak: worstPeak(measured)});
    await rename(tmp, path.join(job, 'renders/video.mp4'));
    if (!Number.isFinite(worstPeak(measured))) throw new Error('The exported MP4 audio could not be measured (ebur128).');
    if (worstPeak(measured) <= PEAK_DB) break;
    gainDb -= worstPeak(measured) - PEAK_DB + 0.3; // AAC overshoot: come down and measure again
  }
  const report = {version: 1, measuredOn: 'renders/video.mp4 (AAC 192k, decoded by ffmpeg ebur128)', target: {integratedLufs: TARGET_LUFS, peakDb: PEAK_DB},
    integratedLufs: measured.integrated, loudnessRange: measured.range, truePeakDb: measured.truePeak, samplePeakDb: measured.samplePeak,
    mono: measured.mono, gainDb: tries.at(-1).gainDb, limitedBy: TARGET_LUFS - pre.integrated <= PEAK_DB - 0.3 - worstPeak(pre) ? 'loudness target' : 'peak ceiling',
    peaksOk: worstPeak(measured) <= PEAK_DB, attempts: tries, narration: 'unprocessed; only the master gain applies', speechThresholdDb: speechThreshold,
    soundEffects: (world.sounds || []).length, music, voiceMasked: overVoice, voiceClose: closeToVoice, soundsUnderMusic: underMusic};
  await writeFile(path.join(job, 'review/mix.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

// Sound evidence for reviewers and the person: cue sheets from the exported MP4 (frame before / after every cue with
// its waveform) and five timestamps to check with headphones, each chosen by a measured risk, never by taste.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = async f => JSON.parse(await readFile(f, 'utf8'));
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {stdio: ['ignore', 'pipe', 'pipe']});
    let err = ''; child.stderr.on('data', d => { err = (err + d).slice(-3000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} failed (${code}): ${err}`)));
  });
}

/** Loudest 400 ms of the MP4 (mono), in film seconds. */
async function loudestMoment(video) {
  const x = await decodeStereo(video), n = Math.round(0.4 * SR), frames = x.length / 2;
  let best = {t: 0, db: -120};
  for (let a = 0; a + n <= frames; a += Math.round(n / 4)) {
    let e = 0; for (let i = a; i < a + n; i++) { const m = (x[2 * i] + x[2 * i + 1]) / 2; e += m * m; }
    const db = 10 * Math.log10(e / n + 1e-12);
    if (db > best.db) best = {t: (a + n / 2) / SR, db};
  }
  return {t: Number(best.t.toFixed(2)), db: Number(best.db.toFixed(1))};
}

/** Five headphone checks, highest measured risk first, at least 2 s apart. */
export function pickListening(candidates, duration, count = 5) {
  const out = [], sorted = candidates.slice().sort((a, b) => a.priority - b.priority || a.t - b.t);
  const take = c => { if (out.length < count && c.t >= 0 && c.t <= duration && !out.some(o => Math.abs(o.t - c.t) < 2)) out.push({t: Number(c.t.toFixed(2)), check: c.check, because: c.because}); };
  // one of each kind of risk first (the worst of it), then the rest by priority
  for (const kind of [...new Set(sorted.map(c => c.check))]) take(sorted.find(c => c.check === kind && c.t >= 0 && c.t <= duration && !out.some(o => Math.abs(o.t - c.t) < 2)) || {t: -1});
  for (const c of sorted) take(c);
  return out.sort((a, b) => a.t - b.t);
}

export async function soundCheck(job) {
  const manifest = await json(path.join(job, 'job.json')), world = await json(path.join(job, 'assets/media-plan.json'));
  const mix = await json(path.join(job, 'review/mix.json')).catch(() => null), video = path.join(job, 'renders/video.mp4');
  const dir = path.join(job, 'review/sound');
  await rm(dir, {recursive: true, force: true}); await mkdir(dir, {recursive: true});
  const sounds = world.sounds || [], moves = world.moves || [], music = world.music || null;
  const beats = music ? (await json(path.join(job, music.src.replace(/\.[^.]+$/, '.beats.json'))).catch(()=>({beats:[]}))).beats.filter(b => b >= music.trackStart).map(b => Number((music.filmStart + b - music.trackStart).toFixed(3))).filter(b => b <= manifest.duration) : [];
  const cues = [...sounds.map(s => ({t: s.at, label: `${s.src.replace(/^assets\//, '')} (${s.align}, vol ${s.volume})${s.why ? ': ' + s.why : ''}`})),
    ...moves.filter(m => m.kind === 'cut' && !sounds.some(s => Math.abs(s.at - m.t) < 0.05)).map(m => ({t: m.t, label: `${m.what} (no sound)`}))].sort((a, b) => a.t - b.t);
  const result = {version: 1, video: 'renders/video.mp4', cues: cues.length, sheets: [], limitations: []};
  if (cues.length || music) {
    const py = await audioPython();
    if (py) {
      await writeFile(path.join(dir, 'cues.json'), JSON.stringify({fps: manifest.fps, duration: manifest.duration, cues, beats}, null, 1));
      await run(py, ['-I', path.join(ROOT, 'scripts/sfx/cue_sheet.py'), video, path.join(dir, 'cues.json'), dir]);
      result.sheets = [...cues.map((_, i) => `review/sound/cue-${String(i).padStart(3, '0')}.png`), 'review/sound/overview.png'];
    } else result.limitations.push('No cue sheets: librosa/matplotlib are not installed (run npm run video -- setup-audio).');
  }
  // what to listen to, by measured risk
  const cand = [];
  for (const v of mix?.voiceMasked || []) cand.push({t: v.at, priority: 1, check: 'Is every word of the narration clear over the music and effects here?', because: `effects + music are ${Math.max(0, -v.marginDb)} dB louder than the voice while it speaks`});
  for (const v of mix?.voiceClose || []) cand.push({t: v.at, priority: 2, check: 'Is every word of the narration clear over the music and effects here?', because: `effects + music come within ${v.marginDb} dB of the voice while it speaks`});
  for (const s of sounds.filter(s => s.masking)) cand.push({t: s.masking.at, priority: 1, check: 'Is the narration clear over this sound effect?', because: `${s.src.replace(/^assets\//, '')} is ${(6 - s.masking.overDb).toFixed(1)} dB under the voice (6 dB wanted)`});
  for (const u of mix?.soundsUnderMusic || []) cand.push({t: u.at, priority: 2, check: 'Can you hear the sound effect above the music?', because: `the effect peaks only ${u.marginDb} dB above the music`});
  const loud = await loudestMoment(video);
  cand.push({t: loud.t, priority: 2, check: 'Is the loudest moment clean (no distortion, no harsh peak)?', because: `loudest 400 ms of the MP4 (${loud.db} dBFS RMS); peaks measured ${mix ? Math.max(mix.truePeakDb, mix.samplePeakDb, mix.mono.truePeakDb).toFixed(1) : '?'} dB`});
  if (music) {
    const worst = (music.moves || []).filter(m => m.weight === 2).sort((a, b) => Math.abs(b.beatDelta) - Math.abs(a.beatDelta))[0];
    if (worst) cand.push({t: worst.t, priority: 3, check: 'Does this cut feel on the beat?', because: `${worst.what} is ${(worst.beatDelta * 1000).toFixed(0)} ms from the nearest beat`});
    const firstOn = (music.moves || []).find(m => m.weight === 2 && Math.abs(m.beatDelta) <= 0.05);
    if (firstOn) cand.push({t: firstOn.t, priority: 4, check: 'Does the music hit land with the picture?', because: `${firstOn.what} sits on a beat`});
    cand.push({t: Math.max(0, (music.filmStart ?? 0) + 1), priority: 4, check: 'Does the music come in smoothly and sit well under the voice?', because: 'music entry and the first ducking'});
  }
  for (const s of sounds.slice().sort((a, b) => b.volume - a.volume).slice(0, 2)) cand.push({t: s.at, priority: 5, check: 'Does this effect match what happens on screen, at the same moment?', because: `${s.src.replace(/^assets\//, '')} at volume ${s.volume}${s.why ? ` (${s.why})` : ''}`});
  cand.push({t: Math.max(0, manifest.duration - 2), priority: 6, check: 'Does the soundtrack end cleanly (no cut-off tail or click)?', because: 'the last two seconds'});
  cand.push({t: Math.min(manifest.duration, 3), priority: 7, check: 'Is the opening level comfortable next to other videos?', because: `integrated ${mix?.integratedLufs ?? '?'} LUFS (aim -16)`});
  result.listen = pickListening(cand, manifest.duration);
  await writeFile(path.join(dir, 'listen.json'), JSON.stringify(result, null, 2) + '\n');
  await writeFile(path.join(dir, 'listen.md'), ['# Check with headphones', '', 'Picked from measurements, not by ear (the pipeline cannot hear).', '',
    ...result.listen.map(l => `- **${Math.floor(l.t / 60)}:${(l.t % 60).toFixed(1).padStart(4, '0')}** — ${l.check} (${l.because})`), '',
    ...(mix ? [`Measured on renders/video.mp4: ${mix.integratedLufs} LUFS integrated, true peak ${mix.truePeakDb} dBTP, sample peak ${mix.samplePeakDb} dBFS, mono true peak ${mix.mono.truePeak} dBTP (aim -16 LUFS, peaks at or under -4).`] : []),
    ...result.limitations.map(l => `- ${l}`), ''].join('\n'));
  return result;
}

const SAMPLE_RATE = 8000;
const METHOD = 'ffmpeg-8khz-mono-waveform-comparison-v2-gain-fitted';
const LIMITATION = 'Heuristic comparison of decoded waveforms, not listening, exact sample preservation, word recognition, or proof of intelligibility. No time-shift correction is applied; a single least-squares gain is fitted because the renderer may change level. Significant mixes or processing may fail despite preserved narration.';

// Buffering keeps the comparison simple and deterministic. One hour of 8 kHz
// float32 audio occupies about 115 MB per input, plus temporary decoding copies.
function decode(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error',
      '-threads', '1', '-i', file, '-map', '0:a:0', '-vn', '-ac', '1',
      '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'],
    {stdio: ['ignore', 'pipe', 'pipe']});
    const chunks = [];
    let diagnostic = '';
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-2000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) :
      reject(new Error(`FFmpeg decode failed (${code}): ${diagnostic.trim()}`)));
  });
}

export async function compareNarration(renderPath, narrationPath) {
  const report = {ok: false, method: METHOD, sampleRate: SAMPLE_RATE,
    correlation: null, normalizedError: null, gain: null, durationDifference: null,
    limitation: LIMITATION};
  try {
    const [render, narration] = await Promise.all([decode(renderPath), decode(narrationPath)]);
    if (render.length % 4 || narration.length % 4) throw new Error('Incomplete float32 decode');
    const renderLength = render.length / 4, narrationLength = narration.length / 4;
    report.durationDifference = Math.abs(renderLength - narrationLength) / SAMPLE_RATE;
    const count = Math.max(renderLength, narrationLength);
    if (!count) throw new Error('No decoded audio samples');
    let renderEnergy = 0, narrationEnergy = 0, product = 0, difference = 0;
    // Missing tail samples are zero-padded for metrics, never discarded. This
    // prevents an unchanged prefix from approving a truncated recording.
    for (let i = 0; i < count; i++) {
      const a = i < renderLength ? render.readFloatLE(i * 4) : 0;
      const b = i < narrationLength ? narration.readFloatLE(i * 4) : 0;
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Nonfinite decoded audio sample');
      renderEnergy += a * a;
      narrationEnergy += b * b;
      product += a * b;
      difference += (a - b) ** 2;
    }
    if (Math.sqrt(renderEnergy / count) <= 1e-5 || Math.sqrt(narrationEnergy / count) <= 1e-5) {
      throw new Error('Silent or near-silent audio cannot verify narration');
    }
    report.correlation = Math.max(-1, Math.min(1, product / Math.sqrt(renderEnergy * narrationEnergy)));
    // Error after the best single gain g (render * g ≈ narration): Σ(g·a − b)² = Σb² − (Σab)²/Σa².
    report.gain = product / renderEnergy;
    report.normalizedError = Math.sqrt(Math.max(0, narrationEnergy - product * product / renderEnergy) / narrationEnergy);
    report.unfittedError = Math.sqrt(difference / narrationEnergy);
    report.ok = report.correlation >= 0.995 && report.normalizedError <= 0.10 && report.durationDifference <= 0.05 && report.gain > 0.25 && report.gain < 4;
    return report;
  } catch (error) {
    report.limitation += ` Comparison unavailable: ${error.message}`;
    return report;
  }
}
