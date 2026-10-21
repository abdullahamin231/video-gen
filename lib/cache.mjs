// Every tool environment the pipeline creates (TTS voice, audio analysis, Manim) lives in the repository's
// .cache/video-gen, never in ~/.cache: sandboxed harnesses (Codex workspace-write) can only write inside the
// repository, and one location means one copy. VG_CACHE may move it within the repository .cache.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function cacheDir(env = process.env) {
  const allowed = path.join(ROOT, '.cache');
  const selected = env.VG_CACHE ? path.resolve(ROOT, env.VG_CACHE) : path.join(allowed, 'video-gen');
  const relative = path.relative(allowed, selected);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error('VG_CACHE must be inside the repository .cache directory.');
  return selected;
}
