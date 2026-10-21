// Compatibility adapter for HyperFrames 0.8.156, which hardcodes homedir()/.cache.
// Run in a dedicated process so the orchestrator's home/auth lookup stays intact.
import os from 'node:os';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {mkdir, realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {cacheDir} from '../lib/cache.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = cacheDir();
await mkdir(path.join(root, '.cache'), {recursive: true});
await mkdir(cache, {recursive: true});
const allowed = await realpath(path.join(root, '.cache'));
if (allowed !== path.join(await realpath(root), '.cache'))
  throw new Error('Repository .cache must not be a symlink outside the repository.');
const actual = await realpath(cache);
const relative = path.relative(allowed, actual);
if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
  throw new Error('TTS cache must resolve inside the repository .cache directory.');

process.env.XDG_CACHE_HOME = actual;
process.env.HF_HOME = path.join(actual, 'huggingface');
process.env.NUMBA_CACHE_DIR = path.join(actual, 'numba');
process.env.TMPDIR = path.join(actual, 'tmp');
await mkdir(process.env.TMPDIR, {recursive: true});
process.env.HYPERFRAMES_PYTHON = path.join(actual, 'tts-env/bin/python');
// HyperFrames appends .cache itself. This stays beneath the repository cache.
os.homedir = () => actual;
syncBuiltinESMExports();
process.argv = [process.execPath, path.join(root, 'node_modules/hyperframes/bin/hyperframes.mjs'), 'tts', ...process.argv.slice(2)];
await import('../node_modules/hyperframes/bin/hyperframes.mjs');
