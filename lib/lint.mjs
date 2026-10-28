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

export async function lintJob(job,film) {
  await removeRenderTempFiles(job);
  const {code,out}=await runLint(job), findings=parseLint(out,job);
  const result={errors:[],warnings:[],pipeline:[]};
  for(const finding of findings) {
    const owner=film.scenes.find(scene=>scene.file===finding.file);
    const text=`${owner ? `[${owner.id}] ` : ''}${finding.file}: ${finding.code}: ${finding.message}${finding.fix ? ` Fix: ${finding.fix}` : ''}`;
    (finding.severity==='warning' ? result.warnings : owner ? result.errors : result.pipeline).push(text);
  }
  if(code!==0&&!findings.some(f=>f.severity==='error')) result.pipeline.push(out.trim().slice(-1000)||'HyperFrames lint failed without diagnostics');
  return result;
}
