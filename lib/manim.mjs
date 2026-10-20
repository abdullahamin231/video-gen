// Renders Manim objects of a compiled world into transparent WebM clips (assets/manim/<id>.webm).
// Manim runs from a local conda-forge environment created by `npm run video -- setup-manim`.
import {spawn} from 'node:child_process';
import {access, mkdir, readFile, writeFile, copyFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {cacheDir} from './cache.mjs';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MANIM_ENV = process.env.VG_MANIM_ENV || path.join(cacheDir(), 'manim-env');
export const MANIM_VERSION = '0.19.0';
const exists = async f => { try { await access(f); return true; } catch { return false; } };
const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, {stdio: ['ignore', 'pipe', 'pipe'], ...opts});
  let out = '', err = '';
  child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { err = (err + c).slice(-6000); });
  child.on('error', reject); child.on('close', code => code === 0 ? resolve(out) : reject(new Error(`${path.basename(cmd)} exited ${code}\n${err.slice(-3000)}`)));
});

export async function setupManim() {
  const base = path.dirname(MANIM_ENV), mamba = path.join(base, 'bin/micromamba');
  await mkdir(base, {recursive: true});
  if (!await exists(mamba)) await run('bash', ['-c', `cd "${base}" && curl -sL https://micro.mamba.pm/api/micromamba/linux-64/latest | tar -xj bin/micromamba`]);
  // Keep micromamba's package downloads beside the env (not in ~), and drop them once the env exists.
  const mambaEnv = {env: {...process.env, MAMBA_ROOT_PREFIX: path.join(base, 'mamba')}};
  if (!await exists(path.join(MANIM_ENV, 'bin/manim'))) {
    await run(mamba, ['create', '-y', '-q', '-p', MANIM_ENV, '-c', 'conda-forge', 'python=3.12', `manim=${MANIM_VERSION}`], mambaEnv);
    await run(mamba, ['clean', '-a', '-y', '-q'], mambaEnv).catch(() => {});
  }
  return run(path.join(MANIM_ENV, 'bin/manim'), ['--version']);
}

export async function renderManimClips(job, world, manifest) {
  const items = world.objects.filter(o => o.type === 'manim');
  if (!items.length) return [];
  const manim = path.join(MANIM_ENV, 'bin/manim');
  if (!await exists(manim)) throw new Error(`Manim is not installed. Run: npm run video -- setup-manim   (installs ManimCE ${MANIM_VERSION} into ${MANIM_ENV})`);
  await mkdir(path.join(job, 'assets/manim'), {recursive: true});
  const libDir = path.join(job, '.cache/manim/_lib');
  await mkdir(libDir, {recursive: true});
  await copyFile(path.join(ROOT, 'lib/manim/vg_manim.py'), path.join(libDir, 'vg_manim.py'));
  const results = [];
  for (const o of items) {
    const media = world.media.find(m => m.id === o.id) || {};
    const source = await readFile(path.join(job, o.file), 'utf8').catch(() => { throw new Error(`${o.id}: Manim file ${o.file} not found`); });
    const cues = media.cues || {};
    const [w, h] = o.size, scale = o.quality === 'low' ? 0.5 : 1;
    const key = createHash('sha256').update(JSON.stringify({source, cls: o.class, cues, w, h, theme: world.theme, v: MANIM_VERSION})).digest('hex');
    const out = path.join(job, 'assets/manim', `${o.id}.webm`), meta = path.join(job, 'assets/manim', `${o.id}.json`);
    const prev = JSON.parse(await readFile(meta, 'utf8').catch(() => 'null'));
    if (!(prev?.key === key && await exists(out))) {
      const tmp = path.join(job, '.cache/manim', o.id);
      await mkdir(tmp, {recursive: true});
      // Render a uniquely named copy so a scene file named like a stdlib module (wave.py, math.py) cannot shadow it.
      const script = path.join(tmp, `vg_scene_${o.id.replace(/-/g, '_')}.py`);
      await writeFile(script, source);
      try {
        await run(manim, ['render', '--format', 'webm', '--transparent', '--fps', String(manifest.fps), '-r', `${Math.round(w * scale)},${Math.round(h * scale)}`,
          '--media_dir', path.join(tmp, 'media'), '-o', o.id, '--disable_caching', script, o.class],
        {cwd: tmp, env: {...process.env, VG_CUES: JSON.stringify(cues), VG_THEME: JSON.stringify(world.theme || {}), PYTHONPATH: libDir}});
      } catch (error) { throw new Error(`Manim object "${o.id}" (${o.file}, class ${o.class}) failed to render:\n${error.message.split('\n').slice(-25).join('\n')}`); }
      const found = await findFile(tmp, `${o.id}.webm`);
      if (!found) throw new Error(`${o.id}: Manim produced no ${o.id}.webm`);
      await copyFile(found, out);
    }
    const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', out]));
    const duration = Number(probe.format.duration);
    await writeFile(meta, JSON.stringify({key, duration, class: o.class, file: o.file}, null, 2) + '\n');
    results.push({id: o.id, duration});
  }
  return results;
}
async function findFile(dir, name) {
  for (const e of await readdir(dir, {withFileTypes: true, recursive: true})) if (e.isFile() && e.name === name) return path.join(e.parentPath || e.path, e.name);
  return null;
}
