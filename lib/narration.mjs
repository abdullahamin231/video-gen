// Ming narration backend. A whole recording shares one acoustic reference and one queued worker.
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rename,rm,realpath,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {cacheDir, probeDuration} from './media.mjs';
import {extractNarration} from './timing.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const DEFAULT_TTS_PROVIDER='ming';
export const TTS_PROVIDERS=['ming'];
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-2000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited ${code}: ${stderr.trim()}`)));
  });
}


async function assemble(parts,output,{work,narration}) {
  const staged=path.join(work,'narration.wav');
  await run('ffmpeg',['-v','error','-y','-i',parts[0],...(narration?['-af','apad=pad_dur=1.5']:[]),
    '-ar','24000','-ac','1','-c:a','pcm_s16le',staged]);
  const next=output+'.next';await writeFile(next,await readFile(staged));await rename(next,output);
}
export async function readTtsStatus(filename) {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function ttsCache(env) {
  const cache = cacheDir(env);
  await mkdir(cache, { recursive: true });
  const root = await realpath(ROOT), allowed = await realpath(path.join(ROOT, '.cache'));
  const actual = await realpath(cache), relative = path.relative(allowed, actual);
  if (allowed !== path.join(root, '.cache') || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error('TTS cache must resolve inside the repository .cache directory.');
  return actual;
}


export async function generateSpeech({text,output,provider='ming',speed=1,narration=false,performance,
  targetSeconds, durationTolerance,
  statusFile=path.join(path.dirname(output),'tts-status.json'),env=process.env},
  {ming=mingSpeech,join=assemble,notify=console.warn}={}) {
  if(provider!=='ming') throw new Error('Ming is the only narration provider.');
  if(!Number.isFinite(speed)||speed<.9||speed>1.25) throw new Error('Narration speed must be between 0.9 and 1.25.');
  if(path.extname(output).toLowerCase()!=='.wav') throw new Error('Narration output must be a .wav file.');
  if(targetSeconds !== undefined && (!Number.isFinite(targetSeconds) || targetSeconds <= 0)) throw new Error('Target seconds must be positive.');
  const tolerance = durationTolerance ?? (targetSeconds === undefined ? null : Math.max(2, targetSeconds * 0.2));
  if(durationTolerance !== undefined && (targetSeconds === undefined || !Number.isFinite(tolerance) || tolerance < 0)) throw new Error('Duration tolerance needs a target and a nonnegative number of seconds.');
  const spoken=(narration?extractNarration(text):text).trim();
  if(!spoken) throw new Error('The script has no narration text.');
  mingPlan(spoken,performance,speed);
  await mkdir(path.dirname(output),{recursive:true});await mkdir(path.dirname(statusFile),{recursive:true});
  const work=await mkdtemp(path.join(await ttsCache(env),'tts-'));
  const status={requestedProvider:'ming',usedProvider:'ming',status:'generating',output,
    model:'Ming-3.0-tts-0.5B',voice:'US_James',continuityMode:'fixed-acoustic-reference-v2',
    ...(targetSeconds === undefined ? {} : {targetSeconds, durationTolerance: tolerance})};
  const save=async()=>{status.updatedAt=new Date().toISOString();await writeFile(statusFile+'.next',JSON.stringify(status,null,2)+'\n');await rename(statusFile+'.next',statusFile);};
  const raw=path.join(work,'ming.wav');
  try {
    await save();
    await ming(spoken,raw,{speed,env,performance,onProgress:async event=>{
      Object.assign(status,event);await save();if(event.status==='queued') notify(`Ming narration queued${Number.isInteger(event.queuePosition)?` · ${event.queuePosition} job(s) ahead`:''}.`);
    }});
    const candidate=path.join(work,'candidate.wav');
    await join([raw],candidate,{work,narration});
    status.durationSeconds = await probeDuration(candidate);
    if (!Number.isFinite(status.durationSeconds) || status.durationSeconds <= 0) throw new Error('Ming output has no measurable duration.');
    if (targetSeconds !== undefined && Math.abs(status.durationSeconds - targetSeconds) > tolerance) {
      status.rejectedOutput=output.replace(/\.wav$/i,'.rejected.wav');
      await writeFile(status.rejectedOutput, await readFile(candidate));
      throw new Error(`Narration is ${status.durationSeconds.toFixed(2)}s; target is ${targetSeconds}s ±${tolerance}s. Check for missing speech before adjusting pacing or revising the script; do not stretch a partial take to fit.`);
    }
    const next=output+'.next';await writeFile(next,await readFile(candidate));await rename(next,output);
    status.status='complete';delete status.phase;delete status.queuePosition;
    await save();return status;
  } catch(error) {
    if (!status.rejectedOutput && error.code !== 'TTS_CANCELLED') {
      const partial=await readFile(raw).catch(()=>null);
      if (partial?.length) {
        status.rejectedOutput=output.replace(/\.wav$/i,'.rejected.wav');
        await writeFile(status.rejectedOutput,partial);
      }
    }
    status.status=error.code==='TTS_CANCELLED'?'cancelled':'failed';status.error=error.message;
    delete status.phase;delete status.queuePosition;await save();throw error;
  } finally {await rm(work,{recursive:true,force:true});}
}

export async function ttsCommand(args) {
  if(args[0]==='--setup-ming') {await (await import('../scripts/setup-ming.mjs')).setupMing();return;}
  let input,performanceFile,statusFile=process.env.VIDEO_TTS_STATUS;
  const options={provider:process.env.VIDEO_TTS_PROVIDER||'ming',speed:1,narration:false};
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(arg==='--narration') options.narration=true;
    else if(['--provider','--performance','--status','--target-seconds','--duration-tolerance','-s','--speed','-o','--output'].includes(arg)) {
      const value=args[++i];if(!value||value.startsWith('-')) throw new Error(`${arg} needs a value`);
      if(arg==='--provider') options.provider=value;
      else if(arg==='--performance') performanceFile=value;
      else if(arg==='--status') statusFile=value;
      else if(arg==='--target-seconds') options.targetSeconds=Number(value);
      else if(arg==='--duration-tolerance') options.durationTolerance=Number(value);
      else if(arg==='-s'||arg==='--speed') options.speed=Number(value);
      else options.output=path.resolve(value);
    } else if(arg.startsWith('-')||input) throw new Error(`Unsupported TTS argument: ${arg}`);
    else input=arg;
  }
  if(!input) throw new Error('Pass a script file to generate narration.');
  if(options.provider!=='ming') throw new Error('Ming is the only narration provider.');
  options.output ||= path.resolve(path.dirname(input),'narration.wav');
  const automatic=path.join(path.dirname(input),'ming-performance.json');
  if(!performanceFile&&await access(automatic).then(()=>true,()=>false)) performanceFile=automatic;
  if(performanceFile) options.performance=JSON.parse(await readFile(performanceFile,'utf8'));
  const result=await generateSpeech({...options,text:await readFile(input,'utf8'),...(statusFile?{statusFile:path.resolve(statusFile)}:{})});
  console.log(`Narration saved: ${options.output} (${result.usedProvider}, ${result.durationSeconds.toFixed(2)}s). Generation complete; speech fidelity still needs checking against the full script.`);

}

const TAGS = new Set(['Breathing', 'Cough', 'Sigh', 'Laughter', 'Uhm', 'Surprise-ah', 'Surprise-oh', 'Dissatisfaction-hnn', 'Confirmation-en', 'Question-ei', 'Question-ah', 'Question-en', 'Question-oh', 'Question-huh']);
const clean = text => {
  if (/[<>]/.test(text)) throw new Error('Ming does not support angle-bracket delivery tags. Use documented cues in the performance sidecar.');
  const spoken = text.replace(/\[([^\]]+)\]/g, (_, tag) => {
    if (!TAGS.has(tag)) throw new Error(`Unsupported Ming cue [${tag}]. See docs/audio.md.`);
    return '';
  }).replace(/\s+/g, ' ').trim();
  if (/[\[\]]/.test(spoken)) throw new Error('Malformed Ming vocal cue. Use the documented bracket syntax.');
  return spoken;
};
export function mingPlan(text, performance, speed = 1) {
  const plan = performance || { segments: [{ text, speed: 1, pauseAfter: 0 }] };
  if (!Array.isArray(plan.segments) || !plan.segments.length || plan.segments.length > 200) throw new Error('Ming performance needs 1–200 segments.');
  if (Object.hasOwn(plan, 'voiceInstruction')) throw new Error('Ming uses US_James. Remove voiceInstruction from the performance sidecar.');
  const segments = plan.segments.map((segment, index) => {
    if (!segment || typeof segment.text !== 'string' || !clean(segment.text)) throw new Error(`Ming segment ${index + 1} needs spoken text.`);
    if (Object.hasOwn(segment, 'instruction')) throw new Error(`Ming uses US_James. Remove instruction from segment ${index + 1}; use text, speed and pauseAfter.`);
    if (clean(segment.text).split(/\s+/).length > 150) throw new Error(`Ming segment ${index + 1} exceeds 150 words; split it into natural thought groups.`);
    const rate = segment.speed ?? 1, pause = segment.pauseAfter ?? 0.25;
    if (!Number.isFinite(rate) || rate < 0.9 || rate > 1.15 || !Number.isFinite(pause) || pause < 0 || pause > 2) throw new Error(`Ming segment ${index + 1}: speed must be 0.9–1.15 and pauseAfter 0–2 seconds.`);
    return { text: segment.text, speed: rate * speed, pauseAfter: pause };
  });
  if (clean(segments.map(s => s.text).join(' ')) !== text.replace(/\s+/g, ' ').trim()) throw new Error('Ming performance must contain the exact reviewed narration, in order, with only supported vocal cues added. Keep cues out of SCRIPT.md.');
  return { segments };
}
export async function mingSpeech(text, output, { speed, env, performance, onProgress = async () => {} }) {
  const plan = mingPlan(text, performance, speed);
  const cache = cacheDir(env), home = path.join(cache, 'ming');
  const python = path.join(home, 'env/bin/python');
  try { await Promise.all([access(python), access(path.join(home, 'source/ming_tts.py')), access(path.join(home, 'model/config.json'))]); }
  catch { throw new Error('Ming is not installed in this checkout. Run npm run video -- tts --setup-ming first (see docs/audio.md).'); }
  const input = output + '.json';
  await writeFile(input, JSON.stringify(plan));
  await mkdir(path.join(cache, 'tmp'), { recursive: true });
  await onProgress({ status: 'queued', queuePosition: null, phase: 'waiting-for-ming' });
  await new Promise((resolve, reject) => {
    const { child, isCancelled } = spawnTts(python, [path.join(ROOT, 'scripts/tts-ming.py'), '--source', path.join(home, 'source'), '--model', path.join(home, 'model'), '--plan', input, '--output', output], { cwd: ROOT,
      env: { ...env, HF_HOME: path.join(cache, 'huggingface'), HF_HUB_OFFLINE: '1', XDG_CACHE_HOME: cache, TMPDIR: path.join(cache, 'tmp'), OMP_NUM_THREADS: '8', MKL_NUM_THREADS: '8', OPENBLAS_NUM_THREADS: '8', TOKENIZERS_PARALLELISM: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let progress = Promise.resolve();
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (!line.startsWith('MING_EVENT ')) { console.log(line); return; }
      let event;
      try { event = JSON.parse(line.slice(11)); }
      catch { return; }
      progress = progress.then(() => onProgress(event));
      // Attach a handler immediately; propagate persistence errors after exit.
      progress.catch(() => child.kill('SIGTERM'));
    });
    let error = ''; child.stderr.on('data', bytes => { error = (error + bytes).slice(-3000); });
    child.on('error', reject);
    child.on('close', async code => {
      lines.close();
      try {
        await progress;
        if (isCancelled()) throw Object.assign(new Error('Ming narration cancelled.'), { code: 'TTS_CANCELLED' });
        if (code !== 0) throw new Error(`Ming generation failed (${code}): ${error}`);
        resolve();
      } catch (failure) { reject(failure); }
    });
  });
}

// A Stop must reach the model (and ffmpeg), not leave an orphan burning CPU.
export function spawnTts(command, args, options) {
  const child = spawn(command, args, { ...options, detached: process.platform !== 'win32' });
  let cancelled = false, escalation;
  const kill = signal => {
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const stop = () => {
    cancelled = true;
    kill('SIGTERM');
    escalation ||= setTimeout(() => kill('SIGKILL'), 5000);
    escalation.unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  const cleanup = () => {
    clearTimeout(escalation);
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  };
  child.once('close', cleanup);
  child.once('error', cleanup);
  return { child, isCancelled: () => cancelled };
}
