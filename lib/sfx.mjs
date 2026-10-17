// Sound effects: WAV files placed on cues next to the narration (never instead of it).
// A shot lists them in "sounds"; the build places each one and checks it against the voice; the mixer (lib/mix.mjs)
// lays them under the narration, which is never processed (only the whole mix gets one gain).
import {readFile, access} from 'node:fs/promises';
import path from 'node:path';

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
export function audioEnv(env = process.env) { return path.join(env.HOME || '', '.cache/video-gen/audio-env'); }
export async function audioPython(env = process.env) {
  const py = path.join(audioEnv(env), 'bin/python');
  return access(py).then(() => py, () => null);
}
