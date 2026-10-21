import { realpath, stat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const types = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.md': 'text/plain', '.json': 'application/json', '.txt': 'text/plain', '.html': 'text/plain', '.js': 'text/plain', '.mjs': 'text/plain', '.css': 'text/plain', '.py': 'text/plain' };
export function inside(root, filename) { const rel = path.relative(root, filename); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); }

export async function jobFile(root, job, requested) {
  if (typeof requested !== 'string' || requested.includes('\0') || path.isAbsolute(requested)) throw Object.assign(new Error('Invalid artifact path'), { status: 400 });
  const roots = [job.jobPath, job.scriptPath, `library/thumbnails/${job.slug}`];
  const candidate = path.resolve(root, requested);
  if (!roots.some(folder => inside(path.resolve(root, folder), candidate))) throw Object.assign(new Error('File is outside this thread’s artifacts'), { status: 403 });
  const actual = await realpath(candidate);
  if (!inside(await realpath(root), actual) || !roots.some(folder => inside(path.resolve(root, folder), actual))) throw Object.assign(new Error('Artifact symlink leaves this thread'), { status: 403 });
  const info = await stat(actual);
  if (!info.isFile()) throw Object.assign(new Error('Not a file'), { status: 400 });
  return { path: actual, info, type: types[path.extname(actual).toLowerCase()] || 'application/octet-stream' };
}

// The Files tab shows only the files people open, in pipeline order; job folders hold thousands of build files.
const keyFiles = [
  ['script', 'SCRIPT.md', 'Script'],
  ['script', 'VISUALS.md', 'Visual plan (script writer)'],
  ['script', 'research.md', 'Research notes'],
  ['script', 'review.md', 'Script review'],
  ['script', 'narration.wav', 'Narration'],
  ['script', 'tts-status.json', 'Narration provider'],
  ['job', 'inputs/visuals.md', 'Visual plan'],
  ['job', 'film.json', 'Film plan'],
  ['job', 'review/REPORT.md', 'Build report'],
  ['job', 'review/delivery.json', 'Delivery report'],
  ['job', 'renders/video.mp4', 'Final video'],
  ['job', 'thumbnail/BRIEF.md', 'Thumbnail brief'],
  ['job', 'thumbnail/thumbnail.png', 'Thumbnail'],
  ['job', 'thumbnail/thumbnail.svg', 'Thumbnail source'],
  ['job', 'thumbnail/REVIEW.json', 'Thumbnail review'],
];

export async function listFiles(root, job) {
  const folders = { script: job.scriptPath, job: job.jobPath };
  const found = await Promise.all(keyFiles.map(async ([where, name, label]) => {
    if (!folders[where]) return null;
    const filename = path.posix.join(folders[where], name);
    try {
      const info = await stat(path.join(root, filename));
      return info.isFile() ? { path: filename, label, size: info.size, modified: info.mtimeMs, type: types[path.extname(filename).toLowerCase()] || 'application/octet-stream' } : null;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }));
  // The job copies the script's VISUALS.md into inputs/visuals.md; show one of them.
  const files = found.filter(Boolean);
  return files.some(file => file.label === 'Visual plan') ? files.filter(file => file.label !== 'Visual plan (script writer)') : files;
}

// Every file under one repository folder (recursively), for checks that must see all of it, not just the key files.
export async function folderFiles(root, folder) {
  const out = [];
  async function walk(rel) {
    for (const entry of await readdir(path.join(root, rel), { withFileTypes: true }).catch(() => [])) {
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) { const info = await stat(path.join(root, child)); out.push({ path: child, size: info.size, modified: info.mtimeMs, type: types[path.extname(child).toLowerCase()] || 'application/octet-stream' }); }
    }
  }
  if (folder) await walk(folder);
  return out;
}

export async function readJson(filename) { try { return JSON.parse(await readFile(filename, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }

export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) throw Object.assign(new Error('Invalid byte range'), { status: 416 });
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) throw Object.assign(new Error('Unsatisfiable range'), { status: 416 });
  return { start, end };
}
