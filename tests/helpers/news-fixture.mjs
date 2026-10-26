import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {freezePersonality,loadPersonality} from '../../lib/personalities.mjs';
import {command,ingestNews} from '../../lib/news.mjs';
import {fileHash} from '../../lib/review.mjs';
const save=(f,v)=>writeFile(f,JSON.stringify(v,null,2)+'\n');
// Original synthetic calibration signals and test card, explicitly not real news or a fabricated event.
export async function fixture(job,profile='news-financial',vertical=false) {
  for(const d of ['assets','inputs','review','renders','shots','components']) await mkdir(path.join(job,d),{recursive:true});
  const ff=args=>command('ffmpeg',['-nostdin','-v','error','-y','-threads','1','-filter_threads','1',...args]);
  await ff(['-f','lavfi','-i','sine=frequency=430:sample_rate=48000:duration=2','-c:a','pcm_s16le',path.join(job,'assets/narration.wav')]);
  await ff(['-f','lavfi','-i','testsrc2=size=640x360:rate=24:duration=3','-f','lavfi','-i','aevalsrc=0.18*sin(2*PI*(300*t+100*t*t)):s=48000:d=3','-vf',"drawtext=text='ORIGINAL TEST FIXTURE - NOT NEWS':fontcolor=white:fontsize=22:x=10:y=100",'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',path.join(job,'original.mp4')]);
  await ff(['-i',path.join(job,'original.mp4'),'-frames:v','1',path.join(job,'original.png')]);
  await writeFile(path.join(job,'inputs/rights.md'),'Original locally generated calibration card and tones for software tests; no third-party footage, images, identity or real factual claims. Owner: video-gen fixture author. Reproduction and editing permitted.');
  const productionProfile=await freezePersonality(job,loadPersonality(profile));
  const manifest={version:1,name:path.basename(job),duration:2,format:vertical?'vertical':'landscape',width:vertical?1080:1280,height:vertical?1920:720,fps:24,workflow:'news-edit',productionProfile,status:'prepared',audio:{source:'fixture tones',sourceStart:0,sha256:await fileHash(path.join(job,'assets/narration.wav'))},review:{producerAgentIds:['/root']}};
  await save(path.join(job,'job.json'),manifest);
  await save(path.join(job,'alignment.json'),{matchRatio:1,words:[{text:'Original',start:.1,end:.7},{text:'commentary.',start:.8,end:1.8}]});
  await writeFile(path.join(job,'SCRIPT.md'),'Original commentary.\n');
  await writeFile(path.join(job,'inputs/source-script.md'),'Original commentary.\n');
  const source=(id,kind)=>({id,kind,url:'fixture://original/'+id,holder:'Fixture author',date:'2026-10-26',attribution:'Original software fixture',rights:{basis:'owned',reuse:true,edit:true,evidence:'inputs/rights.md'}});
  const clip=source('clip','video');
  clip.transcript={reviewed:true,reviewer:'fixture-author',note:'Calibration tone intervals, labels are test markers rather than spoken news.',speechRanges:[{start:1.1,end:2.8}],words:[{text:'Retained',start:1.1,end:1.8},{text:'source.',start:1.9,end:2.8}]};
  await save(path.join(job,'news-sources.json'),{version:1,sources:[source('still','image'),clip],claims:[{id:'test',text:'This is a software calibration fixture, not news.',type:'opinion',evidence:[{url:'fixture://original',date:'2026-10-26',context:'Local generator source in tests/helpers/news-fixture.mjs'}]}]});
  await ingestNews(job,'still',path.join(job,'original.png'));
  await ingestNews(job,'clip',path.join(job,'original.mp4'));
  const edit={version:1,title:'Original adapter calibration',duration:4,prototype:'still',scenes:[{id:'still',at:0,duration:2,source:'still',claims:['test'],context:'Calibration still',treatment:'Still with original commentary'},{id:'excerpt',at:2,duration:2,source:'clip',in:1,claims:['test'],context:'Calibration excerpt',treatment:'Real file excerpt, source offset one second'}],audio:[{id:'analysis',source:'commentary',in:0,out:2,at:0,speaker:'Editor',claims:['test']},{id:'quote',source:'clip',in:1,out:3,at:2,speaker:'Fixture',claims:['test']}]};
  if(profile==='news-political') edit.presenter={source:'clip',identity:'Calibration card (not a person)',authorizedIdentity:true,context:'Tests circular video mask only; not a fabricated presenter',at:2,in:1,duration:2};
  await save(path.join(job,'news.json'),edit);
  return {manifest,edit};
}
