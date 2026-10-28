// Local asset provenance and optional versioned reuse.
import {readFile,writeFile,mkdir,rm,cp,readdir,lstat,realpath,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {createHash} from 'node:crypto';
// Brings an outside file (a product photo, a logo, an icon, a font) into a job's assets/ and records where it came
// from, so films can show real things instead of anonymous rectangles and stay reproducible. Backgrounds are not
// removed here: prefer images that already have none, key out a plain studio background with an image object's
// "knockout", or present the photo in a "frame".

const NAME = /^(?:(?:fonts|sfx|music)\/)?[a-z0-9][a-z0-9._-]*\.(png|jpe?g|webp|gif|svg|woff2?|ttf|otf|mp4|webm|wav|mp3|ogg|flac|m4a)$/;
export const AUDIO = new Set(['wav', 'mp3', 'ogg', 'flac', 'm4a']);
const RASTER = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

/** Raster images from the web are opt-in: set VG_ALLOW_WEB_IMAGES=1 (SVG from the web is always allowed). */
export function webImagesAllowed(env = process.env) {
  return /^(1|true|yes)$/i.test(env.VG_ALLOW_WEB_IMAGES || '');
}

function sniff(buf, name) {
  const head = buf.subarray(0, 16), text = buf.subarray(0, 512).toString('utf8').toLowerCase();
  const ext = path.extname(name).slice(1);
  const ok = {
    png: head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG',
    jpg: head[0] === 0xff && head[1] === 0xd8, jpeg: head[0] === 0xff && head[1] === 0xd8,
    gif: head.toString('latin1', 0, 3) === 'GIF', webp: head.toString('latin1', 8, 12) === 'WEBP',
    svg: text.includes('<svg'), woff2: head.toString('latin1', 0, 4) === 'wOF2', woff: head.toString('latin1', 0, 4) === 'wOFF',
    wav: head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WAVE', ogg: head.toString('latin1', 0, 4) === 'OggS',
    flac: head.toString('latin1', 0, 4) === 'fLaC', m4a: head.toString('latin1', 4, 8) === 'ftyp',
    mp3: head.toString('latin1', 0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0),
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
export async function importAsset(job, root, {src, name, note = '', title = '', tags = '', allowWebImages = false, license = '', source = ''}) {
  if (!src) throw new Error('asset needs --src <url or file path>');
  if (!NAME.test(name || '')) throw new Error('asset needs --name like "dgx-spark.png", "fonts/display.woff2", "sfx/whoosh.wav" or "music/track.mp3" (lowercase, no spaces)');
  if (AUDIO.has(path.extname(name).slice(1).toLowerCase()) && !/^(sfx|music)\//.test(name)) throw new Error(`Audio goes in sfx/ (sound effects, .wav) or music/ (a licensed track): use --name sfx/${path.basename(name)} or music/${path.basename(name)}`);
  if (name.startsWith('sfx/') && !name.endsWith('.wav')) throw new Error('Sound effects must be .wav files (convert with ffmpeg -i in.mp3 out.wav, keeping the original source and licence in --note).');
  const remote = /^https?:\/\//i.test(src);
  if (remote && RASTER.has(path.extname(name).slice(1).toLowerCase()) && !allowWebImages)
    throw new Error(`Downloading raster images from the web is turned off, so ${name} was not fetched. Use an SVG from the web, a local file, or a library item (library-search). A person can allow raster downloads with VG_ALLOW_WEB_IMAGES=1.`);
  const dest = path.join(job, 'assets', name);
  await mkdir(path.dirname(dest), {recursive: true});
  let buf;
  if (remote) buf = await download(src, dest + '.download');
  else buf = await readFile(path.resolve(root, src));
  sniff(buf, name);
  await writeFile(dest, buf);
  const final = dest;
  const sha256 = createHash('sha256').update(await readFile(final)).digest('hex');
  const ledgerFile = path.join(job, 'assets/SOURCES.json');
  const ledger = JSON.parse(await readFile(ledgerFile, 'utf8').catch(() => '[]')).filter(e => e.name !== path.relative(path.join(job, 'assets'), final));
  const entry = {name: path.relative(path.join(job, 'assets'), final), src, ...(source ? {source} : {}), ...(license ? {license} : {}), sha256, note, title, tags: String(tags || '').split(',').map(t => t.trim()).filter(Boolean)};
  ledger.push(entry);
  await writeFile(ledgerFile, JSON.stringify(ledger, null, 2) + '\n');
  return {...entry, path: path.relative(job, final)};
}

const readJSON = async file => JSON.parse(await readFile(file, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const slug = /^[a-z0-9][a-z0-9-]*$/;
const version = /^\d+\.\d+\.\d+$/;
const kinds = ['primitive', 'component', 'sequence', 'asset'];
const inside = (root, file) => file.startsWith(root + path.sep);
const exists = async file => {try {await access(file); return true;} catch {return false;}};

export function itemPath(root, item) {
  const [id, rev, extra] = (item || '').split('@');
  if (!slug.test(id || '') || !version.test(rev || '') || extra !== undefined)
    throw new Error('Use an explicit library item id@major.minor.patch.');
  return path.join(root, id, rev);
}

export async function inspectBundle(dir) {
  const root = await realpath(dir), manifest = await readJSON(path.join(root, 'artifact.json'));
  itemPath(root, `${manifest.id}@${manifest.version}`);
  if (manifest.schemaVersion !== 1 || !kinds.includes(manifest.kind)) throw new Error('Unsupported artifact schema or kind.');
  for (const field of ['title', 'description', 'usage'])
    if (typeof manifest[field] !== 'string' || !manifest[field].trim()) throw new Error(`Missing ${field}.`);
  if (!Array.isArray(manifest.tags) || !manifest.tags.length || manifest.tags.some(t => typeof t !== 'string' || !t.trim()))
    throw new Error('Artifact needs searchable tags.');
  if (!manifest.origin?.source || !manifest.origin?.license) throw new Error('Record origin.source and origin.license.');
  if (!['draft', 'reviewed'].includes(manifest.review?.status)) throw new Error('Review status must be draft or reviewed.');
  if (!Array.isArray(manifest.files) || !manifest.files.length || new Set(manifest.files).size !== manifest.files.length)
    throw new Error('Declare a nonempty, unique file list.');
  if (manifest.entry && !manifest.files.includes(manifest.entry)) throw new Error('Entry must be a declared file.');
  if (manifest.review.status === 'reviewed' && (!Array.isArray(manifest.review.evidence) || !manifest.review.evidence.length))
    throw new Error('Reviewed artifacts need local review evidence.');
  for (const evidence of manifest.review.evidence || [])
    if (!manifest.files.includes(evidence)) throw new Error('Review evidence must be frozen in the bundle.');
  const hashes = {};
  for (const file of manifest.files) {
    if (typeof file !== 'string' || file.includes('\\') || file === 'artifact.json' || path.isAbsolute(file) || file.split('/').includes('..'))
      throw new Error(`Unsafe artifact path: ${file}`);
    const resolved = path.resolve(root, file);
    if (!inside(root, resolved) || !inside(root, await realpath(resolved)) || !(await lstat(resolved)).isFile())
      throw new Error(`Artifact file must stay inside its bundle: ${file}`);
    hashes[file] = hash(await readFile(resolved));
  }
  return {manifest, hashes};
}

async function copyBundle(source, destination, bundle) {
  // Exclusive directory creation: published versions and job copies never overwrite.
  await mkdir(path.dirname(destination), {recursive: true});
  await mkdir(destination);
  for (const file of bundle.manifest.files) {
    await mkdir(path.dirname(path.join(destination, file)), {recursive: true});
    await cp(path.join(source, file), path.join(destination, file));
  }
  await writeFile(path.join(destination, 'artifact.json'), JSON.stringify(bundle.manifest, null, 2) + '\n');
}

export async function publishBundle(root, source) {
  const bundle = await inspectBundle(source);
  const destination = itemPath(root, `${bundle.manifest.id}@${bundle.manifest.version}`);
  await copyBundle(source, destination, bundle);
  return {item: `${bundle.manifest.id}@${bundle.manifest.version}`, status: bundle.manifest.review.status, path: destination};
}

export async function searchLibrary(root, query = '', limit = 8) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be an integer from 1 to 100.');
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) || [];
  const matches = [];
  // Read metadata only; do not load animation code or inspect past jobs.
  for (const id of await readdir(root, {withFileTypes: true}).catch(e => {if (e.code === 'ENOENT') return []; throw e;})) {
    if (!id.isDirectory() || !slug.test(id.name)) continue;
    for (const rev of await readdir(path.join(root, id.name), {withFileTypes: true})) {
      if (!rev.isDirectory() || !version.test(rev.name)) continue;
      const m = await readJSON(path.join(root, id.name, rev.name, 'artifact.json'));
      const words = `${m.id} ${m.title} ${m.description} ${(m.tags || []).join(' ')}`.toLowerCase();
      const score = terms.reduce((n, t) => n + (words.includes(t) ? 1 : 0), 0);
      if (!terms.length || score) matches.push({item: `${id.name}@${rev.name}`, kind: m.kind,
        title: m.title, description: m.description, tags: m.tags, status: m.review.status, score});
    }
  }
  matches.sort((a, b) => b.score - a.score || a.item.localeCompare(b.item));
  return {total: matches.length, matches: matches.slice(0, limit)};
}

export async function useBundle(root, item, job) {
  const source = itemPath(root, item), bundle = await inspectBundle(source);
  const ledgerFile = path.join(job, 'library.json');
  await access(path.join(job, 'job.json'));
  const ledger = await exists(ledgerFile) ? await readJSON(ledgerFile) : {schemaVersion: 1, items: []};
  if (ledger.items.some(entry => entry.item === item)) throw new Error(`Already installed: ${item}.`);
  const relative = `assets/library/${bundle.manifest.id}/${bundle.manifest.version}`;
  await copyBundle(source, path.join(job, relative), bundle);
  const record = {item, path: relative, manifestSha256: hash(await readFile(path.join(job, relative, 'artifact.json'))),
    files: bundle.hashes, entry: bundle.manifest.entry || null};
  ledger.items.push(record);
  await writeFile(ledgerFile, JSON.stringify(ledger, null, 2) + '\n');
  return {...record, status: bundle.manifest.review.status, usage: bundle.manifest.usage,
    note: 'Files are frozen locally. Wire the entry into the scene; installation does not add shots or timeline actions.'};
}

export async function verifyLibraryCopies(job) {
  const ledgerFile = path.join(job, 'library.json');
  if (!await exists(ledgerFile)) return [];
  const ledger = await readJSON(ledgerFile), errors = [];
  const root = await realpath(job);
  for (const record of ledger.items) {
    const expected = `assets/library/${record.item.replace('@', '/')}`;
    if (record.path !== expected || !slug.test(record.item.split('@')[0]) || !version.test(record.item.split('@')[1]))
      throw new Error('Invalid library ledger path.');
    for (const [file, expectedHash] of Object.entries({...record.files, 'artifact.json': record.manifestSha256})) {
      const target = path.resolve(root, record.path, file);
      try {
        if (!inside(root, target) || !inside(root, await realpath(target)) || hash(await readFile(target)) !== expectedHash)
          errors.push(`${record.item}: frozen file changed: ${file}`);
      } catch {errors.push(`${record.item}: frozen file missing: ${file}`);}
    }
  }
  return errors;
}

// ---------------------------------------------------------------- saving what films make
// Every asset a film brings in or creates (images, drawings, fonts, components, Manim scenes) is saved to the library,
// so later films can find it with library-search. Saving is content-addressed: an identical file is saved once.
const PIPELINE_ASSETS = /^assets\/(kit\/|library\/|manim\/|cues\.js$|narration\.wav$|media-plan\.json$|motion\.js$|gsap\.min\.js$|SOURCES\.json$)|\.download$|\.beats\.json$/;
const SAVEABLE = [{dir: 'assets', kind: 'asset'}, {dir: 'components', kind: 'component', ext: /\.js$/}, {dir: 'manim', kind: 'component', ext: /\.py$/}];
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'png', 'jpg', 'jpeg', 'svg', 'webp', 'woff2', 'js', 'py', 'wav', 'mp3', 'sfx', 'music', 'assets', 'components', 'manim', 'fonts']);
const words = text => [...new Set(String(text).toLowerCase().match(/[a-z0-9]+/g) || [])].filter(w => w.length > 2 && !STOP.has(w));
const slugOf = file => path.basename(file).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';

async function walk(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, {withFileTypes: true}).catch(() => [])) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full, base)); else if (e.isFile()) out.push(full);
  }
  return out;
}
async function libraryHashes(root) {
  const seen = new Map();
  for (const id of await readdir(root, {withFileTypes: true}).catch(() => [])) {
    if (!id.isDirectory() || !slug.test(id.name)) continue;
    for (const rev of await readdir(path.join(root, id.name), {withFileTypes: true})) {
      if (!rev.isDirectory() || !version.test(rev.name)) continue;
      try { const {hashes} = await inspectBundle(path.join(root, id.name, rev.name)); for (const h of Object.values(hashes)) seen.set(h, `${id.name}@${rev.name}`); } catch {}
    }
  }
  return seen;
}

/** Files in a job that a film brought in or made and that the library does not hold yet (job-relative paths). */
export async function unsavedFiles(root, job) {
  const seen = await libraryHashes(root), out = [];
  for (const {dir, ext} of SAVEABLE) for (const full of await walk(path.join(job, dir))) {
    const rel = path.relative(job, full).split(path.sep).join('/');
    if (PIPELINE_ASSETS.test(rel) || (ext && !ext.test(rel)) || (dir === 'manim' && rel.split('/').length > 2)) continue;
    if (!seen.has(hash(await readFile(full)))) out.push(rel);
  }
  return out;
}

function usageFor(kind,file,item) {
  return `library-use copies this asset into assets/library/${item.replace('@','/')}/. Reference ${path.basename(file)} from the native composition or pipeline soundtrack; preserve its provenance and licence.`;
}

/** Save one job file to the library as a new bundle (or report the bundle that already holds identical content). */
export async function saveToLibrary(root, job, {file, title, tags, note = '', id, origin = '', license = ''}) {
  const rel = String(file || '').replace(/^\.?\//, ''), full = path.resolve(job, rel);
  if (!inside(path.resolve(job), full) || !(await lstat(full).catch(() => null))?.isFile()) throw new Error(`save needs --file <a file inside the job>, e.g. components/gpu-card.js; got ${file}`);
  const kind = rel.startsWith('components/') || rel.startsWith('manim/') ? 'component' : 'asset', digest = hash(await readFile(full));
  const existing = (await libraryHashes(root)).get(digest);
  if (existing) return {item: existing, saved: false};
  const name = id || slugOf(rel);
  if (!slug.test(name)) throw new Error(`--id must be lowercase letters, digits and dashes; got ${name}`);
  const versions = (await readdir(path.join(root, name)).catch(() => [])).filter(v => version.test(v)).map(v => v.split('.').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const last = versions.at(-1), next = last ? `${last[0]}.${last[1]}.${last[2] + 1}` : '1.0.0', item = `${name}@${next}`;
  const tagList = (Array.isArray(tags) ? tags : String(tags || '').split(',')).map(t => t.trim().toLowerCase()).filter(Boolean);
  const finalTags = tagList.length ? tagList : words(`${name} ${title || ''} ${note}`).slice(0, 8);
  const candidate = path.join(job, 'library-candidates', `${name}-${next}`);
  await mkdir(candidate, {recursive: true});
  await cp(full, path.join(candidate, path.basename(rel)));
  const manifest = {schemaVersion: 1, id: name, version: next, kind, title: title || name.replace(/-/g, ' '), description: note || title || name.replace(/-/g, ' '),
    tags: finalTags.length ? finalTags : [name], entry: path.basename(rel), files: [path.basename(rel)], usage: usageFor(kind, rel, item),
    origin: {source: [`${path.basename(job)}/${rel}`, origin].filter(Boolean).join(' from '), license: license || 'not recorded'}, review: {status: 'draft', evidence: []}};
  await writeFile(path.join(candidate, 'artifact.json'), JSON.stringify(manifest, null, 2) + '\n');
  await publishBundle(root, candidate);
  return {item, saved: true};
}

/** Save everything a job made that the library does not hold yet, with metadata derived from the job's records. */
export async function saveAll(root, job) {
  const sources = await readJSON(path.join(job, 'assets/SOURCES.json')).catch(() => []);
  const film = await readJSON(path.join(job, 'film.json')).catch(() => ({}));
  const out = [];
  for (const rel of await unsavedFiles(root, job)) {
    const src = sources.find(s => `assets/${s.name}` === rel);
    let note = src?.note || '';
    if (!note && /\.(js|py)$/.test(rel)) note = ((await readFile(path.join(job, rel), 'utf8')).match(/^\s*(?:\/\/|#|\/\*+)\s*(.+)/)?.[1] || '').replace(/\*\/\s*$/, '').trim();
    const title = src?.title || slugOf(rel).replace(/-/g, ' ');
    out.push({file: rel, ...await saveToLibrary(root, job, {file: rel, title, note: note || `${title} (from the film "${film.title || path.basename(job)}")`,
      tags: src?.tags || words(`${slugOf(rel)} ${note} ${film.title || ''}`).slice(0, 8), origin: src?.source || src?.src || '', license: src?.license || ''})});
  }
  return out;
}
