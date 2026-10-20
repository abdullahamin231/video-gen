// Every tool environment the pipeline creates (TTS voice, audio analysis, Manim) lives in the repository's
// .cache/video-gen, never in ~/.cache: sandboxed harnesses (Codex workspace-write) can only write inside the
// repository, and one location means one copy. VG_CACHE moves it.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const cacheDir = (env = process.env) => env.VG_CACHE ? path.resolve(env.VG_CACHE) : path.join(ROOT, '.cache/video-gen');
