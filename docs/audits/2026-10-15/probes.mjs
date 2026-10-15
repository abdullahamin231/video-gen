import {cp, mkdir, mkdtemp, readFile, writeFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Run from any cwd with `node docs/audits/2026-10-15/probes.mjs`.
// Uses isolated /tmp copies only. Requires installed dependencies and working Chrome.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const {nextStep, buildFilm} = await import(root + '/lib/film.mjs');
const {sourceFingerprint, fileHash, validateReview} = await import(root + '/lib/review.mjs');
const {compileFilm} = await import(root + '/lib/spec.mjs');
const {installKit, writeWorld} = await import(root + '/lib/world.mjs');
const {inspectFilm} = await import(root + '/lib/inspect.mjs');
await mkdir('/tmp/workflow-audit', {recursive:true});
const original = root + '/jobs/can-9-year-old-gpu-beats-today-s-latest--2';
const base = await mkdtemp('/tmp/workflow-audit/probes-');
const json = async p => JSON.parse(await readFile(p, 'utf8'));
const emit = (probe, result) => console.log(JSON.stringify({probe, ...result}));
async function files(dir, prefix = '') {
  const out = {};
  for (const e of await readdir(dir, {withFileTypes:true})) {
    if (!prefix && ['review','renders','briefs','.hyperframes'].includes(e.name)) continue;
    const key = prefix + e.name;
    if (e.isDirectory()) Object.assign(out, await files(path.join(dir,e.name), key + '/'));
    else if(e.isFile()) out[key] = createHash('sha256').update(await readFile(path.join(dir,e.name))).digest('hex');
  }
  return out;
}

const receipt = await json(original+'/review/render-source.json');
const technical = await json(original+'/review/render-verification.json');
const actual = await fileHash(original+'/renders/video.mp4');
emit('current-artifact', {actual, renderReceipt:receipt.videoSha256, technical:technical.sha256, source:await sourceFingerprint(original)});

const job = base+'/job';
await cp(original,job,{recursive:true});
for(let i=0;i<3;i++) {
  await buildFilm(job,{inspect:false,print:false});
  const before=await files(job);
  const source=await sourceFingerprint(job);
  const next=await nextStep(job);
  const after=await files(job);
  emit('build-then-next', {iteration:i,state:next.state,sourceBefore:source,sourceAfter:await sourceFingerprint(job),changed:Object.keys(after).filter(k=>after[k]!==before[k])});
}

const roundManifest = await json(job+'/job.json');
const beforeRounds = await sourceFingerprint(job);
roundManifest.reviewRounds = {...roundManifest.reviewRounds, prototype:(roundManifest.reviewRounds?.prototype || 0)+1};
await writeFile(job+'/job.json', JSON.stringify(roundManifest));
emit('round-bookkeeping-changes-source', {before:beforeRounds,after:await sourceFingerprint(job),next:(await nextStep(job)).state});

const old = root+'/jobs/can-9-year-old-gpu-beats-today-s-latest-';
const dep = base+'/prototype-dependencies';
await mkdir(dep+'/shots',{recursive:true});await mkdir(dep+'/inputs');
await cp(old+'/shots/prices.json',dep+'/shots/prices.json');
await cp(old+'/inputs/narration.txt',dep+'/inputs/narration.txt');
try {
  await compileFilm(dep,await json(old+'/film.json'),await json(old+'/alignment.json'),await json(old+'/job.json'),{allowMissing:true});
  emit('prototype-dependencies',{accepted:true});
} catch(e) {emit('prototype-dependencies',{accepted:false,errors:e.errors || [e.message]});}

const h='a'.repeat(64), context={packSha256:h,pack:{stage:'prototype',sourceHash:h,videoSha256:h,interval:{start:0,end:6},evidence:[{kind:'motion',path:'motion.md'}]}};
try {
  validateReview({version:1,stage:'prototype',role:'visual-mechanism',sourceHash:h,videoSha256:h,packSha256:h,
    reviewer:{agentId:'audit-synthetic-only',independent:true},inspection:{mode:'frame-sequence',limitations:['No images or video viewed; read only the motion transcript.']},
    initialObservation:'Read the generated action transcript only.',coverage:[{start:0,end:6}],findings:[],verdict:'pass'},context);
  emit('text-only-pass',{accepted:true});
}catch(e){emit('text-only-pass',{accepted:false,error:e.message});}

const done=base+'/done';await mkdir(done);await writeFile(done+'/job.json',JSON.stringify({status:'complete'}));
emit('done-without-artifacts',await nextStep(done));

const camera = base+'/camera-only';await mkdir(camera+'/assets',{recursive:true});await installKit(camera);
const manifest={width:1920,height:1080,duration:6};
const world={...manifest,theme:{},camera:{center:[960,540],zoom:1},scenes:[{id:'camera',start:0,end:6,cues:{}}],
  objects:[{id:'left',type:'circle',at:[500,400],r:100,visible:true,scene:'camera'},
    {id:'right',type:'circle',at:[1420,400],r:100,visible:true,scene:'camera'},
    {id:'bottom',type:'circle',at:[960,800],r:100,visible:true,scene:'camera'}],
  actions:[{do:'camera',center:[1040,540],zoom:1,t:0,dur:6,scene:'camera',order:0}],hooks:[],componentSrc:[],media:[]};
await writeWorld(camera,world,manifest);
try{const result=await inspectFilm(camera,manifest,{scenes:[{id:'camera',start:0,end:6,holds:[]}]});emit('camera-only-inspection',result);}
catch(e){emit('camera-only-inspection',{error:e.message});process.exitCode=2;}
emit('fixture-directory',{path:base});
