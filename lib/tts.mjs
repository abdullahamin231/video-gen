import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rename,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cacheDir} from './cache.mjs';
import {mingSpeech,mingPlan} from './ming.mjs';
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
  statusFile=path.join(path.dirname(output),'tts-status.json'),env=process.env},
  {ming=mingSpeech,join=assemble,notify=console.warn}={}) {
  if(provider!=='ming') throw new Error('Ming is the only narration provider.');
  if(!Number.isFinite(speed)||speed<.9||speed>1.25) throw new Error('Narration speed must be between 0.9 and 1.25.');
  if(path.extname(output).toLowerCase()!=='.wav') throw new Error('Narration output must be a .wav file.');
  const spoken=(narration?extractNarration(text):text).trim();
  if(!spoken) throw new Error('The script has no narration text.');
  mingPlan(spoken,performance,speed);
  await mkdir(path.dirname(output),{recursive:true});await mkdir(path.dirname(statusFile),{recursive:true});
  const work=await mkdtemp(path.join(await ttsCache(env),'tts-'));
  const status={requestedProvider:'ming',usedProvider:'ming',status:'generating',output,
    model:'Ming-3.0-tts-0.5B',voice:'US_James',continuityMode:'fixed-acoustic-reference-v1'};
  const save=async()=>{status.updatedAt=new Date().toISOString();await writeFile(statusFile+'.next',JSON.stringify(status,null,2)+'\n');await rename(statusFile+'.next',statusFile);};
  try {
    await save();const raw=path.join(work,'ming.wav');
    await ming(spoken,raw,{speed,env,performance,onProgress:async event=>{
      Object.assign(status,event);await save();if(event.status==='queued') notify(`Ming narration queued${Number.isInteger(event.queuePosition)?` · ${event.queuePosition} job(s) ahead`:''}.`);
    }});
    await join([raw],output,{work,narration});status.status='complete';delete status.phase;delete status.queuePosition;
    await save();return status;
  } catch(error) {
    status.status=error.code==='TTS_CANCELLED'?'cancelled':'failed';status.error=error.message;
    delete status.phase;delete status.queuePosition;await save();throw error;
  } finally {await rm(work,{recursive:true,force:true});}
}
