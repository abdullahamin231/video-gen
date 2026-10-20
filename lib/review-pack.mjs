import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, readFile, realpath, writeFile, rename, rm} from 'node:fs/promises';
import path from 'node:path';
import {sourceFingerprint, localFile} from './review.mjs';

const json = async file => JSON.parse(await readFile(file, 'utf8'));
const hash = file => new Promise((resolve, reject) => {
  const digest = createHash('sha256'), stream = createReadStream(file);
  stream.on('error', reject).on('data', chunk => digest.update(chunk))
    .on('end', () => resolve(digest.digest('hex')));
});
function command(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${binary} failed (${code}): ${stderr}`)));
  });
}
const ffmpeg = args => command('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1', ...args]);
function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative))
    throw new Error('Review output must be a JSON file inside the job review directory.');
}
// Check each existing parent before mkdir: a lexical containment check alone permits symlink escapes.
async function safeOutput(job, output) {
  const review = path.join(job, 'review');
  contained(review, output);
  const parts = path.relative(job, path.dirname(output)).split(path.sep);
  let current = job;
  for (const part of parts) {
    current = path.join(current, part);
    try { await mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (await realpath(current) !== current) throw new Error('Symlinked review directories are not allowed.');
  }
}

// Frame indices on a 30 fps review clock: one a second, plus each side of every scene boundary and beat.
function sampleIndices(timing, start, end, last) {
  const times = new Set();
  const add = at => {
    if (at >= start && at < end) times.add(Math.max(Math.ceil(start * 30), Math.min(Math.floor(last * 30), Math.round(at * 30))));
  };
  for (let at = start; at < end; at += 1) add(at);
  add(last);
  for (const scene of timing.scenes) {
    for (const boundary of [scene.start, scene.end]) for (const delta of [-0.25, 0, 0.25]) add(boundary + delta);
    add(scene.end - 1 / 30);
    for (const beat of scene.beats ?? []) for (const delta of [-0.25, 0, 0.25]) add(beat.at + delta);
  }
  return [...times].sort((a, b) => a - b);
}

// Twelve phone-scale (480 px) frames per sheet; tall frames go 4 across so a sheet stays viewable as one image.
async function contactSheets(run, framesDir, indices, manifest, record) {
  const columns = manifest.height > manifest.width ? 4 : 2;
  for (let i = 0; i < indices.length; i += 12) {
    const count = Math.min(12, indices.length - i), sheet = path.join(run, `sheet-${String(i / 12).padStart(4, '0')}.png`);
    await ffmpeg(['-framerate', '1', '-start_number', String(i), '-i', path.join(framesDir, '%06d.png'),
      '-vf', `scale=480:-2,tile=${columns}x${Math.ceil(count / columns)}:nb_frames=${count}:padding=8:color=0x111820`, '-frames:v', '1', sheet]);
    await record(sheet, 'contact-sheet', indices[i] / 30, indices[i + count - 1] / 30,
      {samples: indices.slice(i, i + count).map(index => index / 30), frameWidth: 480});
  }
}

// The automated check results and motion transcript, as text evidence for every reviewer.
async function textEvidence(job, run, start, end, record, names) {
  for (const [name, kind] of names) {
    let bytes; try { bytes = await readFile(path.join(job, 'review', name)); } catch (error) { if (error.code !== 'ENOENT') throw error; continue; }
    const frozen = path.join(run, name); await writeFile(frozen, bytes); await record(frozen, kind, start, end);
  }
}

function checkInterval(stage, start, end, duration, manifest) {
  if (![start, end].every(Number.isFinite) || start < 0 || end <= start || end > duration)
    throw new Error('Invalid review interval: require 0 <= start < end <= video duration.');
  if (stage === 'final' && (start !== 0 || end !== duration)) throw new Error('Final review must cover the full video.');
  if (stage === 'prototype' && (end - start < Math.min(10, manifest.duration) - 0.05 || end - start > 15.05))
    throw new Error('Prototype review must cover 10–15 seconds (or the entire shorter video).');
}

/** Freeze review evidence. By default the frames come straight from the built HTML (no render): the
 * browser seeks the same timeline the renderer captures. `from: 'render'` reads renders/video.mp4 instead.
 * output is an optional job-relative pack JSON path underneath review/.
 * Samples are rounded to the nearest frame on a 30 fps review clock.
 */
export async function createReviewPack(job, {stage = 'final', start = 0, end, output, from = 'html'} = {}) {
  if (!['prototype', 'final'].includes(stage)) throw new Error('Review stage must be prototype or final.');
  if (from === 'html') return htmlReviewPack(job, {stage, start, end, output});
  if (from !== 'render') throw new Error('Review evidence comes from html or render.');
  job = await realpath(path.resolve(job));
  const packFile = path.resolve(job, output ?? `review/${stage}/pack.json`);
  if (path.extname(packFile) !== '.json') throw new Error('Review output must be a JSON file.');
  contained(path.join(job, 'review'), packFile);
  const [manifest, timing] = await Promise.all([json(path.join(job, 'job.json')), json(path.join(job, 'timing.json'))]);
  if (stage === 'final' && timing.missing?.length)
    throw new Error(`Final review cannot omit scenes: ${timing.missing.join(', ')}. Build the complete film first.`);
  const video = await localFile(job, 'renders/video.mp4');
  const probe = JSON.parse(await command('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video]));
  const duration = Number(probe.format?.duration);
  if (!probe.streams?.some(stream => stream.codec_type === 'video') || !Number.isFinite(duration) || duration <= 0)
    throw new Error('Review requires a valid rendered video.');
  if (!Number.isFinite(manifest.duration) || Math.abs(duration - manifest.duration) > 0.12)
    throw new Error('Rendered duration differs from the job.');
  end ??= duration;
  checkInterval(stage, start, end, duration, manifest);
  const padding = duration - manifest.duration;
  const scenes = timing.scenes.filter(scene => scene.start < end && scene.end > start)
    .map(scene => {
      const range = {id: scene.id, start: Math.max(start, scene.start), end: Math.min(end, scene.end)};
      // Include verified mux padding in the final scene's evidence coverage, while
      // retaining the actual content boundary. Never bridge a missing content scene.
      if (Math.abs(scene.end - manifest.duration) < 0.000001 && padding > 0 && padding <= 0.120001 && end > scene.end) {
        range.contentEnd = scene.end;
        range.end = end;
        range.trailingMuxPadding = end - scene.end;
      }
      return range;
    });
  if (!scenes.length) throw new Error('Review interval has no compiled scenes.');
  const sourceHash = await sourceFingerprint(job), videoSha256 = await hash(video);
  let receipt;
  try { receipt = await json(await localFile(job, 'review/render-source.json')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error('Missing render source receipt; render and verify before review-pack.');
  }
  if (receipt.version !== 1 || receipt.sourceHash !== sourceHash || receipt.videoSha256 !== videoSha256)
    throw new Error('Render source receipt is stale; render and verify current sources before review-pack.');
  await safeOutput(job, packFile);
  const run = path.join(path.dirname(packFile), `evidence-${randomUUID()}`);
  await mkdir(run);
  const framesDir = path.join(run, 'frames');
  await mkdir(framesDir);
  const last = Math.max(start, Math.min(end, duration) - 1 / 30);
  const indices = sampleIndices(timing, start, end, last);
  const select = indices.map(index => `eq(n\\,${index})`).join('+');
  const filterFile = path.join(run, 'frame-filter.txt');
  await writeFile(filterFile, `fps=30,select='${select}',scale='min(960,iw)':-2,drawtext=text='%{pts\\:hms}':x=12:y=12:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.8`);
  await ffmpeg(['-i', video, '-filter_script:v', filterFile,
    '-fps_mode', 'vfr', '-start_number', '0', path.join(framesDir, '%06d.png')]);
  const evidence = [];
  const record = async (file, kind, first, final, extra = {}) => evidence.push({path: path.relative(job, file).split(path.sep).join('/'),
    sha256: await hash(file), kind, start: first, end: final, ...extra});
  await record(await localFile(job, 'assets/narration.wav'), 'audio', 0, duration);
  let verificationBytes;
  try { verificationBytes = await readFile(await localFile(job, 'review/render-verification.json')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (verificationBytes) {
    const verification = JSON.parse(verificationBytes);
    if (verification.ok !== true || verification.sha256 !== videoSha256)
      throw new Error('Render verification is stale; verify the current render before review-pack.');
    const frozen = path.join(run, 'verification.json');
    await writeFile(frozen, verificationBytes);
    await record(frozen, 'verification', 0, duration);
  }
  // Text evidence for reviewers without image input, plus the automated check results.
  await textEvidence(job, run, start, end, record, [['motion.md', 'motion'], ['inspect.json', 'checks'], ['pixels.json', 'checks']]);
  // Sound evidence (the reviewers cannot hear): the sound list, the mix measurements, cue sheets from the MP4.
  const soundFiles = ['review/sounds.md', 'review/mix.json', 'review/sound/listen.md'];
  try { soundFiles.push(...(JSON.parse(await readFile(path.join(job, 'review/sound/listen.json'), 'utf8')).sheets || [])); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const rel of soundFiles) {
    let bytes; try { bytes = await readFile(path.join(job, rel)); } catch (error) { if (error.code !== 'ENOENT') throw error; continue; }
    const frozen = path.join(run, 'sound', path.basename(rel)); await mkdir(path.dirname(frozen), {recursive: true}); await writeFile(frozen, bytes);
    await record(frozen, 'sound', start, end);
  }
  for (let i = 0; i < indices.length; i++)
    await record(path.join(framesDir, `${String(i).padStart(6, '0')}.png`), 'frames', indices[i] / 30, indices[i] / 30);
  await contactSheets(run, framesDir, indices, manifest, record);
  let clipIndex = 0;
  for (const scene of scenes) for (let at = scene.start; at < scene.end - 0.001; at += 11.5) {
    const clipStart = Math.max(start, at - 0.25), until = Math.min(end, Math.min(scene.end, at + 11.5) + 0.25);
    const clip = path.join(run, `clip-${String(clipIndex++).padStart(4, '0')}.mp4`);
    // Re-encode after input seek so clips start accurately rather than at the previous keyframe.
    await ffmpeg(['-ss', String(clipStart), '-i', video, '-t', String(until - clipStart), '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', "scale='min(960,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', clip]);
    await record(clip, 'clip', clipStart, until, {sceneId: scene.id, playbackRate: 1});
  }
  if (sourceHash !== await sourceFingerprint(job) || videoSha256 !== await hash(await localFile(job, 'renders/video.mp4')))
    throw new Error('Production source or video changed while generating review evidence; rerun review-pack.');
  const pack = {version: 1, stage, sourceHash, videoSha256, duration, interval: {start, end}, scenes, evidence, generatedAt: new Date().toISOString()};
  const temporary = path.join(run, 'pack.json');
  await writeFile(temporary, `${JSON.stringify(pack, null, 2)}\n`);
  await rename(temporary, packFile);
  return {...pack, packPath: path.relative(job, packFile).split(path.sep).join('/')};
}

// Review evidence straight from the built HTML: the same seek-safe timeline the renderer captures, without encoding a
// video. Frames, contact sheets, the narration and the build's own checks; no clips (no reviewer agent plays video).
async function htmlReviewPack(job, {stage, start = 0, end, output}) {
  job = await realpath(path.resolve(job));
  const packFile = path.resolve(job, output ?? `review/${stage}/pack.json`);
  if (path.extname(packFile) !== '.json') throw new Error('Review output must be a JSON file.');
  contained(path.join(job, 'review'), packFile);
  const [manifest, timing] = await Promise.all([json(path.join(job, 'job.json')), json(path.join(job, 'timing.json'))]);
  if (stage === 'final' && timing.missing?.length)
    throw new Error(`Final review cannot omit scenes: ${timing.missing.join(', ')}. Build the complete film first.`);
  const sourceHash = await sourceFingerprint(job);
  const build = await json(path.join(job, 'review/build.json')).catch(() => null);
  if (!build?.ok || build.scope !== 'all' || build.sourceHash !== sourceHash)
    throw new Error('Review evidence comes from the current successful build. Run build first.');
  const duration = manifest.duration;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The job has no valid duration.');
  end ??= duration;
  checkInterval(stage, start, end, duration, manifest);
  const built = new Set(timing.scenes.filter(s => !(timing.missing || []).includes(s.id)).map(s => s.id));
  const scenes = timing.scenes.filter(scene => built.has(scene.id) && scene.start < end && scene.end > start)
    .map(scene => ({id: scene.id, start: Math.max(start, scene.start), end: Math.min(end, scene.end)}));
  if (!scenes.length) throw new Error('Review interval has no built scenes.');
  await safeOutput(job, packFile);
  const run = path.join(path.dirname(packFile), `evidence-${randomUUID()}`), framesDir = path.join(run, 'frames'), rawDir = path.join(run, 'raw');
  await mkdir(framesDir, {recursive: true}); await mkdir(rawDir);
  const last = Math.max(start, end - 1 / 30), indices = sampleIndices(timing, start, end, last);
  const {openInspector} = await import('./inspect.mjs');
  const inspector = await openInspector(job, manifest);
  try {
    for (const [i, index] of indices.entries()) {
      const raw = path.join(rawDir, `${String(i).padStart(6, '0')}.png`), t = index / 30;
      await inspector.screenshot(t, raw);
      await ffmpeg(['-i', raw, '-vf', `scale='min(960,iw)':-2,drawtext=text='t=${t.toFixed(2)}s':x=12:y=12:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.8`,
        '-frames:v', '1', path.join(framesDir, `${String(i).padStart(6, '0')}.png`)]);
    }
  } finally { await inspector.close(); }
  await rm(rawDir, {recursive: true, force: true});
  const evidence = [];
  const record = async (file, kind, first, final, extra = {}) => evidence.push({path: path.relative(job, file).split(path.sep).join('/'),
    sha256: await hash(file), kind, start: first, end: final, ...extra});
  await record(await localFile(job, 'assets/narration.wav'), 'audio', 0, duration);
  await textEvidence(job, run, start, end, record, [['motion.md', 'motion'], ['inspect.json', 'checks'], ['sounds.md', 'sound']]);
  for (let i = 0; i < indices.length; i++)
    await record(path.join(framesDir, `${String(i).padStart(6, '0')}.png`), 'frames', indices[i] / 30, indices[i] / 30);
  await contactSheets(run, framesDir, indices, manifest, record);
  if (sourceHash !== await sourceFingerprint(job)) throw new Error('Production sources changed while generating review evidence; rerun review-pack.');
  const pack = {version: 1, stage, source: 'html', sourceHash, videoSha256: null, duration, interval: {start, end}, scenes, evidence, generatedAt: new Date().toISOString()};
  const temporary = path.join(run, 'pack.json');
  await writeFile(temporary, `${JSON.stringify(pack, null, 2)}\n`);
  await rename(temporary, packFile);
  return {...pack, packPath: path.relative(job, packFile).split(path.sep).join('/')};
}
