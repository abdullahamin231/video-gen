// Sound evidence for reviewers and the person: cue sheets from the exported MP4 (frame before / after every cue with
// its waveform) and five timestamps to check with headphones, each chosen by a measured risk, never by taste.
import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {audioPython} from './sfx.mjs';
import {decodeStereo, SR} from './mix.mjs';

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
  const manifest = await json(path.join(job, 'job.json')), world = await json(path.join(job, 'assets/world.json'));
  const mix = await json(path.join(job, 'review/mix.json')).catch(() => null), video = path.join(job, 'renders/video.mp4');
  const dir = path.join(job, 'review/sound');
  await rm(dir, {recursive: true, force: true}); await mkdir(dir, {recursive: true});
  const sounds = world.sounds || [], moves = world.moves || [], music = world.music || null;
  const beats = music ? (await json(path.join(job, music.src.replace(/\.[^.]+$/, '.beats.json')))).beats.filter(b => b >= music.trackStart).map(b => Number((music.filmStart + b - music.trackStart).toFixed(3))).filter(b => b <= manifest.duration) : [];
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
  for (const v of mix?.voiceMasked || []) cand.push({t: v.at, priority: 1, check: 'Is every word of the narration clear over the music and effects here?', because: v.marginDb >= 0 ? `effects + music come within ${v.marginDb} dB of the voice while it speaks` : `effects + music are ${-v.marginDb} dB louder than the voice while it speaks`});
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
