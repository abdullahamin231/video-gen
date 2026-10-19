import { realpath, stat, readdir, readFile } from 'node:fs/promises';
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

export async function listFiles(root, job) {
  const results = [];
  const roots = [job.scriptPath, job.jobPath];
  async function walk(folder, depth = 0) {
    if (depth > 9 || results.length >= 4000) return;
    let entries;
    try { entries = await readdir(path.join(root, folder), { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || ['node_modules', '__pycache__'].includes(entry.name) || entry.isSymbolicLink()) continue;
      const filename = path.posix.join(folder, entry.name);
      if (entry.isDirectory()) await walk(filename, depth + 1);
      else if (entry.isFile()) {
        try { const info = await stat(path.join(root, filename)); results.push({ path: filename, size: info.size, modified: info.mtimeMs, type: types[path.extname(filename)] || 'application/octet-stream' }); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (results.length >= 4000) break;
    }
  }
  for (const folder of roots) await walk(folder);
  return results.sort((a, b) => b.modified - a.modified);
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
