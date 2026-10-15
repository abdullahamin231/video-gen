// Brings an outside file (a product photo, a logo, an icon, a font) into a job's assets/ and records where it came
// from, so films can show real things instead of anonymous rectangles and stay reproducible. Backgrounds are not
// removed here: prefer images that already have none, key out a plain studio background with an image object's
// "knockout", or present the photo in a "frame".
import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';

const NAME = /^(?:fonts\/)?[a-z0-9][a-z0-9._-]*\.(png|jpe?g|webp|gif|svg|woff2?|ttf|otf|mp4|webm)$/;

function sniff(buf, name) {
  const head = buf.subarray(0, 16), text = buf.subarray(0, 512).toString('utf8').toLowerCase();
  const ext = path.extname(name).slice(1);
  const ok = {
    png: head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG',
    jpg: head[0] === 0xff && head[1] === 0xd8, jpeg: head[0] === 0xff && head[1] === 0xd8,
    gif: head.toString('latin1', 0, 3) === 'GIF', webp: head.toString('latin1', 8, 12) === 'WEBP',
    svg: text.includes('<svg'), woff2: head.toString('latin1', 0, 4) === 'wOF2', woff: head.toString('latin1', 0, 4) === 'wOFF',
  }[ext];
  if (ok === false) throw new Error(`The downloaded file is not a .${ext} (starts with ${JSON.stringify(text.slice(0, 40))}). Use a direct link to the file itself, not a web page.`);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {stdio: ['ignore', 'pipe', 'pipe']});
    let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} failed:\n${out.slice(-800)}`)));
  });
}

const AGENT = 'video-gen/1.0 (asset import for a narrated explainer)';
async function download(url, tmp) { // curl follows redirects and honours proxy settings; fetch is the fallback
  try {
    await run('curl', ['-fsSL', '--max-time', '90', '-A', AGENT, '-o', tmp, url]);
    const buf = await readFile(tmp); await rm(tmp, {force: true}); return buf;
  } catch (error) {
    await rm(tmp, {force: true});
    if (error.code !== 'ENOENT') throw new Error(`download failed for ${url}: ${error.message.split('\n').slice(-2).join(' ').trim()}`);
  }
  const res = await fetch(url, {headers: {'user-agent': AGENT}, redirect: 'follow'});
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Copy or download src into <job>/assets/<name> and record its source. */
export async function importAsset(job, root, {src, name, note = ''}) {
  if (!src) throw new Error('asset needs --src <url or file path>');
  if (!NAME.test(name || '')) throw new Error('asset needs --name like "dgx-spark.png" or "fonts/display.woff2" (lowercase, no spaces)');
  const dest = path.join(job, 'assets', name);
  await mkdir(path.dirname(dest), {recursive: true});
  let buf;
  if (/^https?:\/\//i.test(src)) buf = await download(src, dest + '.download');
  else buf = await readFile(path.resolve(root, src));
  sniff(buf, name);
  await writeFile(dest, buf);
  const final = dest;
  const sha256 = createHash('sha256').update(await readFile(final)).digest('hex');
  const ledgerFile = path.join(job, 'assets/SOURCES.json');
  const ledger = JSON.parse(await readFile(ledgerFile, 'utf8').catch(() => '[]')).filter(e => e.name !== path.relative(path.join(job, 'assets'), final));
  const entry = {name: path.relative(path.join(job, 'assets'), final), src, sha256, note};
  ledger.push(entry);
  await writeFile(ledgerFile, JSON.stringify(ledger, null, 2) + '\n');
  return {...entry, path: path.relative(job, final)};
}
