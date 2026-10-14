import {readFile, mkdir, cp, readdir, lstat, realpath, access, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

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
