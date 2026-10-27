import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assertIndependentCaptureReviewer} from '../lib/review-pack.mjs';
import {REVIEW_ROLES, loadReviewPack, submitReview} from '../lib/review.mjs';
import {loadPersonality, freezePersonality} from '../lib/personalities.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const exec=promisify(execFile);

test('CLI app-capture and capture-scene register runner producer identity before their handlers run',async t=>{
  const base=path.join(ROOT,'.cache'); await mkdir(base,{recursive:true});
  const job=await mkdtemp(path.join(base,'producer-cli-')); t.after(()=>rm(job,{recursive:true,force:true}));
  await writeFile(path.join(job,'job.json'),JSON.stringify({review:{producerAgentIds:[],producerAgentRecords:[]}}));
  await assert.rejects(exec(process.execPath,['scripts/video.mjs','app-capture','--job',job,'--plan','missing.json'],{cwd:ROOT,env:{...process.env,VIDEO_AGENT_ROLE:'app-review-builder',VIDEO_AGENT_ID:'runner-app-capture'}}));
  assert.equal(JSON.parse(await readFile(path.join(job,'job.json'),'utf8')).review.producerAgentIds.length,0,
    'script-stage capture must not create or mutate a film job manifest');
  for(const [command,args,role,id] of [
    ['capture-scene',['--capture','capture/missing','--scene','demo'],'app-review-builder','runner-capture-scene'],
  ]){
    await assert.rejects(exec(process.execPath,['scripts/video.mjs',command,'--job',job,...args],{cwd:ROOT,env:{...process.env,VIDEO_AGENT_ROLE:role,VIDEO_AGENT_ID:id}}));
    const manifest=JSON.parse(await readFile(path.join(job,'job.json'),'utf8'));
    assert.ok(manifest.review.producerAgentIds.includes(id),`${command} did not register producer ID`);
    assert.ok(manifest.review.producerAgentRecords.some(r=>r.agentId===id&&r.role===role));
  }
});

test('script-stage app capture provenance survives prepare and enforces the capture review gate',async t=>{
  const base=path.join(ROOT,'.cache'); await mkdir(base,{recursive:true});
  const project=await mkdtemp(path.join(base,'app-review-e2e-'));
  const slug=`app-review-e2e-${randomUUID().replaceAll('-','').slice(0,8)}`;
  const scriptDir=path.join(project,'script'); await mkdir(scriptDir,{recursive:true});
  const job=path.join(ROOT,'jobs',slug);
  t.after(async()=>{
    await rm(job,{recursive:true,force:true});
    await rm(project,{recursive:true,force:true});
  });
  const script=path.join(scriptDir,'SCRIPT.md'), audio=path.join(project,'narration.wav');
  await writeFile(script,'# Demo\n\nThe setting is visible.');
  const profile=await loadPersonality('app-review');
  const productionProfile=await freezePersonality(scriptDir,profile);
  await writeFile(path.join(scriptDir,'project.json'),JSON.stringify({slug:'fixture',productionProfile}));
  // The two IDs below enter through the same runner environment consumed by the CLI.
  const plan=path.join(project,'plan.json');
  await writeFile(plan,JSON.stringify({task:'screen',url:`file://${path.join(ROOT,'tests/fixtures/app-capture/app.html')}`,
    viewport:[1440,900],steps:[{do:'click',target:'#new-filter',why:'open the filter dialog'},{do:'wait',seconds:1,why:'inspect the open dialog'}]}));
  const run=async(args,env={})=>exec(process.execPath,['scripts/video.mjs',...args],{cwd:ROOT,env:{...process.env,...env}}).catch(error=>{error.message+=`\nstdout:\n${error.stdout||''}\nstderr:\n${error.stderr||''}`;throw error;});
  await run(['app-capture','--job',scriptDir,'--plan',plan],{VIDEO_AGENT_ROLE:'app-review-builder',VIDEO_AGENT_ID:'runner-app-capture'});
  const capture=path.join(scriptDir,'capture/screen');
  const cm=JSON.parse(await readFile(path.join(capture,'manifest.json'),'utf8'));
  await writeFile(path.join(capture,'edits.json'),JSON.stringify({scene:'demo',edits:[{id:'capture-demo',phrase:'The setting is visible.',source:[0,Math.min(3.5,cm.duration)],feature:'demo',result:'visible'}]}));
  await run(['capture-scene','--job',scriptDir,'--capture','capture/screen','--scene','demo'],{VIDEO_AGENT_ROLE:'app-review-builder',VIDEO_AGENT_ID:'runner-capture-scene'});
  const words=path.join(project,'words.json');
  await writeFile(words,JSON.stringify([{text:'The',start:0.1,end:0.3},{text:'setting',start:0.35,end:0.7},{text:'is',start:0.75,end:0.85},{text:'visible.',start:0.9,end:1.2}]));
  await exec('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=4','-c:a','pcm_s16le',audio],{cwd:ROOT});
  await run(['prepare','--name',slug,'--audio',audio,'--script',script,'--profile','app-review','--words',words,'--no-latest']);
  const manifest=JSON.parse(await readFile(path.join(job,'job.json'),'utf8'));
  assert.equal(manifest.productionProfile.id,'app-review');
  await run(['capture-scene','--job',job,'--capture','capture/screen','--scene','demo'],{VIDEO_AGENT_ROLE:'app-review-builder',VIDEO_AGENT_ID:'runner-job-capture-scene'});
  const withScene=JSON.parse(await readFile(path.join(job,'job.json'),'utf8'));
  assert.deepEqual(withScene.review.producerAgentRecords.map(r=>[r.agentId,r.role]),[
    ['runner-app-capture','app-review-builder'],['runner-capture-scene','app-review-builder'],['runner-job-capture-scene','app-review-builder']]);
  assert.deepEqual(withScene.review.producerAgentIds,['runner-app-capture','runner-capture-scene','runner-job-capture-scene']);
  await assert.rejects(assertIndependentCaptureReviewer(job,{agentId:'runner-app-capture',independent:true}),/cannot submit an independent/);
  await assert.rejects(assertIndependentCaptureReviewer(job,{agentId:'runner-capture-scene',independent:true}),/cannot submit an independent/);
  await assertIndependentCaptureReviewer(job,{agentId:'runner-independent-reviewer',independent:true},{agentId:'runner-independent-reviewer',role:'reviewer'});
  const gate=await run(['next','--job',job]);
  assert.match(gate.stdout,/^STATE: the script writer plans the visuals/,
    'the CLI must reach the app-review visual-plan state before scene building');
  assert.equal(manifest.status,'prepared');

  // Continue through the real encoded-render capture-visibility gate. Keep every
  // fixture input and output in this isolated test tree; the test library is
  // isolated too, so save-all cannot mutate the shared library.
  const fixtureEnv={VG_LIBRARY:path.join(project,'library')};
  const reviewDir=path.join(job,'review'); await mkdir(reviewDir,{recursive:true});
  const visuals=['# Visual plan: fixture','','## Concept','Show the fixture application actual filter flow.','','## Theme','Clean browser-app review.','','```json','{"name":"Fixture","description":"Actual captured app UI","bg":"#f6f7f9","colors":{"white":"#ffffff"}}','```','','## Prototype','demo — the actual captured interaction.','','## Scenes','','### demo — captured filter dialog','- Starts at: "The setting is visible."','- Idea: Show the real browser capture.','- Layout: Recorded interface fills the frame.','- Hero: The actual filter dialog.','- Events:','  1. "visible" → the recorded browser interaction plays with its logged pointer.','- Payoff: The captured interface remains visible.','','## Thumbnail','- Headline: FILTERS',''].join('\n');
  await mkdir(path.join(job,'inputs'),{recursive:true});
  await writeFile(path.join(job,'inputs/visuals.md'),visuals);
  const planGate=await run(['next','--job',job],fixtureEnv);
  assert.match(planGate.stdout,/STATE: plan/,planGate.stdout);
  await writeFile(path.join(job,'film.json'),JSON.stringify({version:2,title:'Fixture app review',concept:'Show the recorded interaction.',theme:{name:'Fixture',description:'A clean browser interface fills the frame. Use readable typography and restrained blue accents. Keep the recorded product state clear while motion stays subtle.',bg:'#f6f7f9',colors:{white:'#ffffff',blue:'#2f6bff',yellow:'#ffd43b'}},prototype:'demo',scenes:[{id:'demo',start:{boundary:'start'},idea:'The recorded app interaction.',owner:'builder'}]}));
  assert.match((await run(['next','--job',job],fixtureEnv)).stdout,/STATE: build and check/);
  await run(['build','--job',job],fixtureEnv);
  await run(['save-all','--job',job],fixtureEnv);
  const prototypeStep=await run(['next','--job',job],fixtureEnv);
  assert.match(prototypeStep.stdout,/STATE: freeze prototype review evidence/);
  await run(['review-pack','--job',job,'--stage','prototype','--start','0','--end',String(manifest.duration)],fixtureEnv);
  const prototype=await loadReviewPack(job,'prototype');
  for(const role of REVIEW_ROLES) await submitReview(job,{version:1,stage:'prototype',role,sourceHash:prototype.pack.sourceHash,
    videoSha256:null,packSha256:prototype.packSha256,reviewer:{agentId:`fixture-reviewer-${role}`,independent:true},
    inspection:{mode:'frame-sequence',visual:'viewed',evidence:prototype.pack.evidence.filter(e=>e.kind==='frames').map(e=>e.path),limitations:['Integration fixture review of the generated evidence.'],...(role==='narration-fidelity'?{audio:'signal-verified'}:{})},
    initialObservation:'The captured browser interaction is represented in the prototype evidence.',coverage:[prototype.pack.interval],verdict:'pass',findings:[]},
    {agentId:`fixture-reviewer-${role}`,role:'reviewer'});
  assert.match((await run(['next','--job',job],fixtureEnv)).stdout,/STATE: render the complete app-review film/);
  await run(['render','--job',job,'--reuse-build','true'],fixtureEnv);
  await run(['verify','--job',job],fixtureEnv);
  let next=await run(['next','--job',job],fixtureEnv);
  assert.match(next.stdout,/STATE: generate canonical paired source\/render frames/);
  await run(['capture-visibility','--job',job,'--generate'],fixtureEnv);
  next=await run(['next','--job',job],fixtureEnv);
  assert.match(next.stdout,/STATE: independent visual inspection of unverified app-capture/);
  const dispositions=JSON.parse(await readFile(path.join(reviewDir,'capture-visibility-dispositions.json'),'utf8'));
  assert.ok(dispositions.dispositions.length>0);
  const current=dispositions.dispositions[0], captureId=current.captureId, sceneId=current.sceneId;
  const decodedActivity=async item=>{
    const bytes=(await exec('ffmpeg',['-v','error','-i',path.join(job,item.path),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:16*1024*1024})).stdout;
    let active=0; for(let i=0;i+2<bytes.length;i+=3) if(bytes[i]+bytes[i+1]+bytes[i+2]>90) active++;
    return {pixels:bytes.length/3,activeRatio:active/(bytes.length/3)};
  };
  const paired=current.evidence.reduce((pairs,item)=>{(pairs[item.kind]||=[]).push(item);return pairs;},{});
  assert.equal(paired['source-frame'].length,3); assert.equal(paired['render-frame'].length,3);
  const activity=[];
  for(let i=0;i<3;i++) activity.push({source:await decodedActivity(paired['source-frame'][i]),render:await decodedActivity(paired['render-frame'][i])});
  const visible=activity.every(pair=>pair.source.activeRatio>0.25&&pair.render.activeRatio>0.25);
  const report=path.join(job,'review/independent-verdict.json');
  await writeFile(report,JSON.stringify({sourceHash:dispositions.sourceHash,videoSha256:dispositions.videoSha256,
    reviewer:{agentId:'runner-independent-reviewer',independent:true},
    dispositions:[{captureId,sceneId,decision:visible?'acceptable':'reject',observation:`Compared all three generated source/render frame pairs. Active-pixel ratios were ${activity.map(pair=>`${pair.source.activeRatio.toFixed(2)}/${pair.render.activeRatio.toFixed(2)}`).join(', ')}; ${visible?'the app interface remains visibly present in every rendered sample.':'at least one rendered sample lacks visible image content.'}`}]}));
  // The submission transport is runner-bound, while the evidence and subsequent
  // gate remain the actual pipeline's generated and decoded media.
  await run(['capture-visibility','--job',job,'--record',report],{...fixtureEnv,VIDEO_AGENT_ROLE:'reviewer',VIDEO_AGENT_ID:'runner-independent-reviewer'});
  const recorded=JSON.parse(await readFile(path.join(reviewDir,'capture-visibility-dispositions.json'),'utf8'));
  assert.deepEqual(recorded.dispositions[0].authenticatedReviewer,{agentId:'runner-independent-reviewer',role:'reviewer'});
  assert.equal(recorded.dispositions[0].status,'visually-inspected');
  // Bad, missing and stale verdicts cannot unlock the final pack.
  const saved=JSON.stringify(recorded);
  await writeFile(path.join(reviewDir,'capture-visibility-dispositions.json'),JSON.stringify({...recorded,dispositions:[{...recorded.dispositions[0],decision:'reject'}]}));
  next=await run(['next','--job',job],fixtureEnv);
  assert.match(next.stdout,/STATE: repair \(1 problem\(s\) from independent capture-visibility inspection/,
    'a rejected inspection must route the state machine to repair');
  await assert.rejects(run(['review-pack','--job',job,'--stage','final','--from','render'],fixtureEnv));
  await rm(path.join(reviewDir,'capture-visibility-dispositions.json'));
  await assert.rejects(run(['review-pack','--job',job,'--stage','final','--from','render'],fixtureEnv));
  await writeFile(path.join(reviewDir,'capture-visibility-dispositions.json'),JSON.stringify({...recorded,sourceHash:'stale'}));
  await assert.rejects(run(['review-pack','--job',job,'--stage','final','--from','render'],fixtureEnv));
  await writeFile(path.join(reviewDir,'capture-visibility-dispositions.json'),saved);
  next=await run(['next','--job',job],fixtureEnv);
  assert.match(next.stdout,/STATE: freeze final review evidence from the encoded render/);
  await run(['review-pack','--job',job,'--stage','final','--from','render'],fixtureEnv);
  assert.ok(JSON.parse(await readFile(path.join(reviewDir,'final/pack.json'),'utf8')));
});
