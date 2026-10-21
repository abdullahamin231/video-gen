// The film's soundtrack, mixed by the pipeline so every level is measured, not guessed.
// Buses: the supplied narration (never processed), sound effects (placed by the build, see lib/sfx.mjs) and an
// optional licensed music track (film.json "music"), ducked while the narrator speaks. One master gain then aims at
// TARGET_LUFS with true peaks at or under PEAK_DB, measured on the exported MP4 itself (after AAC, and in mono).
import {readFile, writeFile, rename, mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {kWeight} from './sfx.mjs';

export const SR = 48000;
export const TARGET_LUFS = -16;
// -1 dBTP is the ceiling YouTube documents; the old -4 cost about 3 dB of loudness on every film.
export const PEAK_DB = -1;
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
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', String(SR), '-t', String(manifest.duration), tmp]);
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
