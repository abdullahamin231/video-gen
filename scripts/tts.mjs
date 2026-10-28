// Ming narration CLI. One invocation holds one acoustic reference across the complete recording.
import {readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {generateSpeech} from '../lib/tts.mjs';
try {
  const args=process.argv.slice(2);
  if(args[0]==='--setup-ming') {await (await import('./setup-ming.mjs')).setupMing();process.exit(0);}
  if(args[0]==='--benchmark') {await (await import('./tts-benchmark.mjs')).benchmark(args.slice(1));process.exit(0);}
  let input,performanceFile,statusFile=process.env.VIDEO_TTS_STATUS;
  const options={provider:process.env.VIDEO_TTS_PROVIDER||'ming',speed:1,narration:false};
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(arg==='--narration') options.narration=true;
    else if(['--provider','--performance','--status','-s','--speed','-o','--output'].includes(arg)) {
      const value=args[++i];if(!value||value.startsWith('-')) throw new Error(`${arg} needs a value`);
      if(arg==='--provider') options.provider=value;
      else if(arg==='--performance') performanceFile=value;
      else if(arg==='--status') statusFile=value;
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
  console.log(`Narration saved: ${options.output} (${result.usedProvider}).`);
} catch(error) {console.error(error.message);process.exitCode=1;}
