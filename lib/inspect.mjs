import path from 'node:path';
import os from 'node:os';
import {access,readFile,writeFile,mkdir} from 'node:fs/promises';
import {openNativeInspector,inspectNative} from './native.mjs';
const exists = async f => { try { await access(f); return true; } catch { return false; } };
export async function chromePath() {
  for (const c of [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) if (c && await exists(c)) return c;
  const {readdir} = await import('node:fs/promises');
  const base = path.join(os.homedir(), '.cache/hyperframes/chrome');
  try {
    for (const d of await readdir(base, {recursive: true})) if (/chrome(-headless-shell)?$/.test(d) && !d.endsWith('.app')) return path.join(base, d);
  } catch {}
  throw new Error('No Chrome found for inspection. Set CHROME_PATH or run `npx hyperframes browser ensure`.');
}

export async function openInspector(job,manifest) {
  const {isNews,openNewsInspector}=await import('./news.mjs');
  const {readPersonality}=await import('./personalities.mjs');
  return isNews(readPersonality(job)) ? openNewsInspector(job,manifest) : openNativeInspector(job,manifest);
}
export const inspectFilm=inspectNative;
export async function writeInspection(job, result) {
  await mkdir(path.join(job, 'review'), {recursive: true});
  await writeFile(path.join(job, 'review/inspect.json'), JSON.stringify({errors: result.errors, warnings: result.warnings, report: result.report}, null, 2) + '\n');
  await writeFile(path.join(job, 'review/motion.md'), result.transcript);
}
