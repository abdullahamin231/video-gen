// Reference-only downloads and frame sampling. Never registers assets in a production job/library.
import {access, mkdir, readFile, writeFile, readdir, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {createHash} from 'node:crypto';

function run(command, args, env, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {env, stdio: ['ignore', capture ? 'pipe' : 'inherit', 'pipe']});
    let output = '', error = '';
    child.stdout?.on('data', b => { output += b; });
    child.stderr.on('data', b => { error = (error + b).slice(-6000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(`${path.basename(command)} exited ${code}: ${error.trim()}`)));
  });
}

export async function referenceStudy(root, opts) {
  const home = path.join(root, '.cache/video-gen/reference-studies');
  const name = opts.name;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name || '')) throw new Error('reference-study needs --name <lowercase-slug>.');
  const out = path.join(home, name);
  const env = {...process.env, TMPDIR: path.join(root, '.cache/video-gen/tmp'), XDG_CACHE_HOME: path.join(root, '.cache/video-gen'),
    PIP_CACHE_DIR: path.join(root, '.cache/video-gen/pip')};
  await mkdir(env.TMPDIR, {recursive: true});
  await mkdir(out, {recursive: true});
  let source;
  if (opts.video) source = path.resolve(root, opts.video);
  else {
    let url;
    try { url = new URL(opts.url); } catch { throw new Error('Pass --url <YouTube video> or --video <repository file>.'); }
    if (!['www.youtube.com', 'youtube.com', 'youtu.be'].includes(url.hostname) || url.protocol !== 'https:')
      throw new Error('Reference downloads require an HTTPS YouTube video URL.');
    const python = path.join(root, '.cache/video-gen/reference-env/bin/python');
    try { await access(python); }
    catch {
      await run('python3', ['-m', 'venv', path.dirname(path.dirname(python))], env);
      await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', 'yt-dlp[default]'], env);
    }
    const completed = await readdir(out);
    const existing = completed.find(f => /^source\.(mp4|webm|mkv)$/.test(f));
    if (existing) source = path.join(out, existing);
    else {
      source = await run(python, ['-m', 'yt_dlp', '--no-playlist', '--quiet', '--js-runtimes', `node:${process.execPath}`,
        '--cache-dir', path.join(home, '.downloader-cache'), '--socket-timeout', '25', '--retries', '1',
        '-f', 'bv[height<=720][ext=mp4]/bv[height<=720]/b[height<=720]', '--write-info-json',
        '--print', 'after_move:filepath', '-o', path.join(out, 'source.%(ext)s'), url.href], env, true);
    }
    const rawInfo = path.join(out, 'source.info.json');
    try {
      const info = JSON.parse(await readFile(rawInfo, 'utf8'));
      await writeFile(path.join(out, 'source.json'), JSON.stringify({id: info.id, title: info.title, url: info.webpage_url,
        channel: info.channel, duration: info.duration, width: info.width, height: info.height, fps: info.fps,
        downloadedAt: new Date().toISOString(), usage: 'Reference analysis only. Never reuse footage/audio/frames in production.'}, null, 2) + '\n');
      await rm(rawInfo);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const relative = path.relative(root, source);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Reference files must remain inside the repository.');
  const every = Number(opts.every || 15);
  if (!Number.isFinite(every) || every < 0.1) throw new Error('--every must be at least 0.1 seconds.');
  const metadata = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', source], env, true));
  const stream = metadata.streams.find(s => s.codec_type === 'video');
  const start = Number(opts.start || 0), length = opts.length ? Number(opts.length) : Number(metadata.format.duration) - start;
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(length) || length <= 0) throw new Error('Invalid sample range.');
  const tags = [].concat(opts.tag || 'overview');
  if (tags.length !== 1) throw new Error('reference-study accepts one --tag.');
  const tag = tags[0];
  if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Invalid sample tag.');
  const frames = path.join(out, tag);
  await mkdir(frames, {recursive: true});
  // Explicit seeks avoid fps-filter midpoint sampling being mislabelled as t=0,15,...
  for (const file of await readdir(frames)) if (/^\d{4}\.jpg$/.test(file)) await rm(path.join(frames, file));
  const times = [];
  for (let time = start; time < Math.min(start + length, Number(metadata.format.duration)); time += every) {
    times.push(Number(time.toFixed(3)));
    if (times.length > 600) throw new Error('Limit a study to 600 frames; select a shorter --length.');
  }
  for (const [i, time] of times.entries()) await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-ss', String(time), '-i', source,
    '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '3', path.join(frames, `${String(i + 1).padStart(4, '0')}.jpg`)], env);
  const files = (await readdir(frames)).filter(f => /\.jpg$/.test(f)).sort();
  const columns = 4, rows = Math.ceil(files.length / columns);
  if (files.length) await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-framerate', '1', '-i', path.join(frames, '%04d.jpg'),
    '-vf', `scale=360:-2,drawtext=text='%{expr\\:${start}+n*${every}}s':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.8,tile=${columns}x${rows}:padding=6:margin=6:color=0x181818`,
    '-frames:v', '1', '-q:v', '2', path.join(out, `${tag}-sheet.jpg`)], env);
  const result = {source: relative, sourceSha256: createHash('sha256').update(await readFile(source)).digest('hex'), duration: Number(metadata.format.duration), width: stream.width, height: stream.height,
    start, every, sampleCount: files.length, samples: files.map((file, i) => ({file: `${tag}/${file}`, time: times[i]})),
    contactSheet: `${tag}-sheet.jpg`, usage: 'Reference analysis only'};
  await writeFile(path.join(out, `${tag}.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({...result, samples: undefined, directory: path.relative(root, out)}, null, 2));
}
