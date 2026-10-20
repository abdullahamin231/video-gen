// HyperFrames lint, run by build so its errors reach `next` (and get repaired) before render rather than stopping render.
// Each finding is attributed to the file an agent wrote (an html scene, a hook, a component) or to the pipeline's own
// generated code (index.html, the world mount script), which no agent may edit.
import {spawn} from 'node:child_process';
import {readFile, rm, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HF = path.join(ROOT, 'node_modules/hyperframes/bin/hyperframes.mjs');

/** Files a render writes and removes; one left by a crashed render makes HyperFrames see two root compositions. */
export const RENDER_TEMP_FILES = ['index.cut.html'];
export const removeRenderTempFiles = job => Promise.all(RENDER_TEMP_FILES.map(f => rm(path.join(job, f), {force: true})));

function runLint(dir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HF, 'lint'], {cwd: dir, env: {...process.env, PWD: dir, NO_COLOR: '1', FORCE_COLOR: '0'}, stdio: ['ignore', 'pipe', 'pipe']});
    let out = '';
    child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { out += c; });
    child.on('error', reject);
    child.on('close', code => resolve({code, out: out.replace(/\x1b\[[0-9;]*m/g, '')}));
  });
}

/** Parse `hyperframes lint` text output: "  ✗ [file:line:col] code: message" then "    Fix: hint". */
export function parseLint(out, job) {
  const findings = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(✗|⚠)\s+(?:\[([^\]]+)\]\s+)?([a-z0-9_]+)(?:\s+\[[^\]]*\])?:\s*(.*)$/.exec(line);
    if (m) {
      let file = 'index.html', at = null;
      if (m[2]) {
        const loc = /^(.*?)(?::(\d+))?(?::\d+)?$/.exec(m[2]);
        file = path.isAbsolute(loc[1]) ? path.relative(job, loc[1]) : loc[1];
        at = loc[2] ? Number(loc[2]) : null;
      }
      findings.push({severity: m[1] === '✗' ? 'error' : 'warning', file: file.replace(/\\/g, '/'), line: at, code: m[3], message: m[4].trim()});
      continue;
    }
    const fix = /^\s+Fix:\s*(.*)$/.exec(line);
    if (fix && findings.length) findings.at(-1).fix = fix[1].trim();
  }
  return findings;
}

// The inline <script> blocks of world.html, by line: authored hooks/components carry a /* file */ marker.
function worldScripts(html) {
  const lines = html.split('\n'), blocks = [];
  let open = null;
  lines.forEach((l, i) => {
    const start = /<script>(?:\/\*\s*(\S+)\s*\*\/)?/.exec(l);
    if (start && !open) open = {from: i + 1, file: start[1] || null};
    if (open && l.includes('</script>')) { blocks.push({...open, to: i + 1}); open = null; }
  });
  return blocks;
}

/**
 * Lint the job and attribute each finding. Returns {errors, warnings, pipeline}: errors/warnings are build messages
 * tagged with the owning scene ([id] or shots/id.*) so repairs reach their owner; pipeline lists errors in generated
 * code, which only a pipeline fix can clear.
 */
export async function lintJob(job, film) {
  await removeRenderTempFiles(job);
  const {code, out} = await runLint(job);
  const findings = parseLint(out, job);
  if (code !== 0 && !findings.some(f => f.severity === 'error'))
    return {errors: [], warnings: [], pipeline: [`HyperFrames lint failed without findings: ${out.trim().slice(-600)}`]};
  const world = await readFile(path.join(job, 'compositions/world.html'), 'utf8').catch(() => '');
  const blocks = worldScripts(world);
  const objects = JSON.parse(await readFile(path.join(job, 'assets/world.json'), 'utf8').catch(() => '{}')).objects || [];
  const scenesUsing = file => {
    const type = /^components\/(.+)\.js$/.exec(file)?.[1];
    return [...new Set(objects.filter(o => o.type === type).map(o => o.scene))];
  };
  const authored = blocks.filter(b => b.file);
  // A finding without a line can come from the generated mount script or from inlined authored code. Lint world.html
  // again with the authored scripts removed: codes that remain are the pipeline's.
  let pipelineCodes = null;
  const unlocated = findings.filter(f => f.file === 'compositions/world.html' && !f.line);
  if (unlocated.length && authored.length) {
    const probe = path.join(job, 'review/lint-probe'), lines = world.split('\n');
    const stripped = lines.filter((_, i) => !authored.some(b => i + 1 >= b.from && i + 1 <= b.to)).join('\n');
    await rm(probe, {recursive: true, force: true}); await mkdir(path.join(probe, 'compositions'), {recursive: true});
    await writeFile(path.join(probe, 'index.html'), await readFile(path.join(job, 'index.html'), 'utf8'));
    await writeFile(path.join(probe, 'compositions/world.html'), stripped);
    try { pipelineCodes = new Set(parseLint((await runLint(probe)).out, probe).filter(f => f.file === 'compositions/world.html' && !f.line).map(f => f.code)); }
    finally { await rm(probe, {recursive: true, force: true}); }
  }
  const owners = file => {
    const hook = /^shots\/([a-z0-9-]+)\.hook\.js$/.exec(file);
    return hook ? [hook[1]] : scenesUsing(file);
  };
  const out2 = {errors: [], warnings: [], pipeline: []};
  for (const f of findings) {
    const text = `${f.code}: ${f.message}${f.fix ? ` Fix: ${f.fix}` : ''}`;
    const scene = film.scenes.find(s => s.kind === 'html' && s.file === f.file);
    let msg = null;
    if (scene) msg = `[${scene.id}] ${f.file}${f.line ? `:${f.line}` : ''}: HyperFrames lint ${text}`;
    else if (f.file === 'compositions/world.html') {
      const block = f.line ? blocks.find(b => f.line >= b.from && f.line <= b.to) : null;
      const files = block ? (block.file ? [block.file] : []) : pipelineCodes?.has(f.code) ? [] : authored.map(b => b.file);
      if (files.length) msg = `${files.flatMap(file => owners(file).map(id => `[${id}]`)).join(' ')} ${files.join(', ')}: HyperFrames lint ${text}`.trim();
    }
    if (msg) (f.severity === 'error' ? out2.errors : out2.warnings).push(msg);
    else if (f.severity === 'error') out2.pipeline.push(`${f.file}${f.line ? `:${f.line}` : ''}: ${text}`);
    else out2.warnings.push(`${f.file}: HyperFrames lint ${text}`);
  }
  return out2;
}
