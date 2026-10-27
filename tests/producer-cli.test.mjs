import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assertIndependentCaptureReviewer} from '../lib/review-pack.mjs';
import {REVIEW_ROLES, loadReviewPack, submitReview, sourceFingerprint} from '../lib/review.mjs';
import {loadPersonality, freezePersonality} from '../lib/personalities.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const exec=promisify(execFile);
const put=(dir,file,value)=>writeFile(path.join(dir,file),JSON.stringify(value,null,2));

/** A reshoot project laid out the way reshoot writes one, with a real clean take. */
async function fakeReshootRun(root){
  const project=path.join(root,'reshoot'), run=path.join(project,'takes','runs','run1'), takes=path.join(run,'takes');
  await mkdir(path.join(takes,'demo.evidence'),{recursive:true});
  await writeFile(path.join(project,'reshoot.toml'),'[take]\nweb = "storyboard.toml"\n');
  await writeFile(path.join(project,'storyboard.toml'),'[[beat]]\nurl = "https://app.example.test/filters"\n');
  // A still, light UI: the capture-visibility gate compares rendered regions with the recorded frames, and a moving
  // test pattern would mismatch on timing alone.
  await exec('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','color=c=0xeef1f4:s=2560x1440:r=30:d=3.2',
    '-vf','drawbox=x=300:y=300:w=900:h=120:color=0x2f6bff:t=fill,drawbox=x=300:y=520:w=1400:h=60:color=0xc9d1dc:t=fill,drawbox=x=300:y=700:w=600:h=60:color=0x101114:t=fill',
    '-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p',path.join(takes,'demo.clean.mp4')],{cwd:ROOT});
  await writeFile(path.join(takes,'demo.evidence','open.png'),'open frame');
  await put(run,'run.json',{ok:true,id:'run1',errors:[],inputs:{reshoot:'0.3.9'}});
  await put(run,'takes/demo.take.json',{schema_version:1,status:'completed',mode:'final',story_id:'fixture',story_sha256:'a'.repeat(64),
    capture:{css_width:1280,css_height:720,pixel_ratio:2,frames:96},
    beats:[{id:'open',start:0.01,end:3.0,screenshot:'demo.evidence/open.png',
      expectations:[{type:'text',status:'passed',actual:'Filters',at:2.9}]}]});
  await put(run,'takes/demo.beats.json',{open:0.01});
  await put(run,'takes/demo.events.json',[{t:0.3,kind:'act',phase:'start',rect:[470,329.19,340,49.75]},
    {t:0.5,kind:'act',phase:'end',rect:[470,329.19,340,49.75]}]);
  return run;
}

test('CLI capture-ingest and capture-scene register runner producer identity before their handlers run',async t=>{
  const base=path.join(ROOT,'.cache'); await mkdir(base,{recursive:true});
  const job=await mkdtemp(path.join(base,'producer-cli-')); t.after(()=>rm(job,{recursive:true,force:true}));
  await writeFile(path.join(job,'job.json'),JSON.stringify({review:{producerAgentIds:[],producerAgentRecords:[]}}));
  for(const [command,args,role,id] of [
    ['capture-ingest',['--run','.cache/does-not-exist','--task','screen'],'app-review-builder','runner-capture-ingest'],
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
  const run=async(args,env={})=>exec(process.execPath,['scripts/video.mjs',...args],{cwd:ROOT,env:{...process.env,...env}}).catch(error=>{error.message+=`\nstdout:\n${error.stdout||''}\nstderr:\n${error.stderr||''}`;throw error;});
  const reshootRun=await fakeReshootRun(project);
  await run(['capture-ingest','--job',scriptDir,'--run',reshootRun,'--task','screen'],{VIDEO_AGENT_ROLE:'app-review-builder',VIDEO_AGENT_ID:'runner-capture-ingest'});
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
    ['runner-capture-ingest','app-review-builder'],['runner-capture-scene','app-review-builder'],['runner-job-capture-scene','app-review-builder']]);
  assert.deepEqual(withScene.review.producerAgentIds,['runner-capture-ingest','runner-capture-scene','runner-job-capture-scene']);
  await assert.rejects(assertIndependentCaptureReviewer(job,{agentId:'runner-capture-ingest',independent:true}),/cannot submit an independent/);
  await assert.rejects(assertIndependentCaptureReviewer(job,{agentId:'runner-capture-scene',independent:true}),/cannot submit an independent/);
  await assertIndependentCaptureReviewer(job,{agentId:'runner-independent-reviewer',independent:true},{agentId:'runner-independent-reviewer',role:'reviewer'});
  const gate=await run(['next','--job',job]);
  assert.match(gate.stdout,/^STATE: the script writer plans the visuals/,
    'the CLI must reach the app-review visual-plan state before scene building');
  assert.equal(manifest.status,'prepared');

  // Continue through the real encoded-render evidence gates. Keep every fixture input and output in this isolated
  // test tree; the test library is isolated too, so save-all cannot mutate the shared library.
  const fixtureEnv={VG_LIBRARY:path.join(project,'library')};
  const reviewDir=path.join(job,'review'); await mkdir(reviewDir,{recursive:true});
  const visuals=['# Visual plan: fixture','','## Concept','Show the fixture application actual filter flow.','','## Theme','Clean browser-app review.','','```json','{"name":"Fixture","description":"Actual captured app UI","bg":"#f6f7f9","colors":{"white":"#ffffff"}}','```','','## Scenes','','### demo — captured filter dialog','- Starts at: "The setting is visible."','- Idea: Show the real browser capture.','- Layout: Recorded interface fills the frame.','- Hero: The actual filter dialog.','- Events:','  1. "visible" → the recorded browser interaction plays with its recorded cursor.','- Payoff: The captured interface remains visible.','','## Thumbnail','- Headline: FILTERS',''].join('\n');
  await mkdir(path.join(job,'inputs'),{recursive:true});
  await writeFile(path.join(job,'inputs/visuals.md'),visuals);
  const planGate=await run(['next','--job',job],fixtureEnv);
  assert.match(planGate.stdout,/STATE: plan/,planGate.stdout);
  await writeFile(path.join(job,'film.json'),JSON.stringify({version:2,title:'Fixture app review',concept:'Show the recorded interaction.',theme:{name:'Fixture',description:'A clean browser interface fills the frame. Use readable typography and restrained blue accents. Keep the recorded product state clear while motion stays subtle.',bg:'#f6f7f9',colors:{white:'#ffffff',blue:'#2f6bff',yellow:'#ffd43b'}},scenes:[{id:'demo',start:{boundary:'start'},idea:'The recorded app interaction.',owner:'builder'}]}));
  assert.match((await run(['next','--job',job],fixtureEnv)).stdout,/STATE: build and check/);
  await run(['build','--job',job],fixtureEnv);
  await run(['save-all','--job',job],fixtureEnv);
  const renderStep=await run(['next','--job',job],fixtureEnv);
  assert.match(renderStep.stdout,/STATE: render the complete app-review film/);
  await run(['render','--job',job,'--reuse-build','true'],fixtureEnv);
  await run(['verify','--job',job],fixtureEnv);
  let next=await run(['next','--job',job],fixtureEnv);
  // The cursor is composited into the footage, so no second pointer overlaps the capture. The rendered region matches
  // its source, the interval needs no unverified-inspection round, and the flow goes straight to freezing evidence.
  const pixels=JSON.parse(await readFile(path.join(reviewDir,'pixels.json'),'utf8'));
  assert.equal(pixels.captureVisibility.captures.length,1);
  assert.equal(pixels.captureVisibility.captures[0].status,'verified',pixels.captureVisibility.captures[0].reason);
  assert.match(next.stdout,/STATE: freeze final review evidence from the encoded render/);
  const omissionsFile=path.join(job,'capture/screen/omissions.json');
  const omissions=await readFile(omissionsFile,'utf8');
  const refreshReviewSourceHash=async()=>{
    const sourceHash=await sourceFingerprint(job);
    for(const rel of ['review/pixels.json','review/render-source.json']){
      const file=path.join(job,rel),doc=JSON.parse(await readFile(file,'utf8'));doc.sourceHash=sourceHash;await writeFile(file,JSON.stringify(doc));
    }
  };
  await rm(omissionsFile);
  await refreshReviewSourceHash();
  await assert.rejects(run(['review-pack','--job',job,'--stage','final','--from','render'],fixtureEnv),/missing capture\/screen\/omissions\.json/);
  await writeFile(omissionsFile,omissions);
  await refreshReviewSourceHash();
  const ledger=JSON.parse(omissions);
  await writeFile(omissionsFile,JSON.stringify({...ledger,actionsSha256:'stale'}));
  await refreshReviewSourceHash();
  await assert.rejects(run(['review-pack','--job',job,'--stage','final','--from','render'],fixtureEnv),/omissions\.json is stale or malformed/);
  await writeFile(omissionsFile,JSON.stringify({...ledger,records:[{scene:'demo',actionIndex:999,reason:'invalid',evidence:[]}]}));
  await refreshReviewSourceHash();
  await assert.rejects(run(['review-pack','--job',job,'--stage','final','--from','render'],fixtureEnv),/missing or invalid scene-bound omission records/);
  await writeFile(omissionsFile,omissions);
  const editsFile=path.join(job,'capture/screen/edits.json'), editsText=await readFile(editsFile,'utf8');
  const edited=JSON.parse(editsText); edited.edits[0].source=[0,0.1];
  await writeFile(editsFile,JSON.stringify(edited)); await refreshReviewSourceHash();
  await assert.rejects(run(['review-pack','--job',job,'--stage','final','--from','render'],fixtureEnv),/missing or invalid scene-bound omission records/,
    'review-pack recomputes the complete expected omissions from current edits.json');
  await writeFile(editsFile,editsText); await refreshReviewSourceHash();
  await refreshReviewSourceHash();
  const finalStep=await run(['next','--job',job],fixtureEnv);
  assert.match(finalStep.stdout,/STATE: freeze final review evidence from the encoded render/);
  await run(['review-pack','--job',job,'--stage','final','--from','render'],fixtureEnv);
    const final=await loadReviewPack(job,'final');
  for(const role of REVIEW_ROLES) await submitReview(job,{version:1,stage:'final',role,sourceHash:final.pack.sourceHash,
    videoSha256:final.pack.videoSha256,packSha256:final.packSha256,reviewer:{agentId:`fixture-reviewer-${role}`,independent:true},
    inspection:{mode:'mixed',visual:'viewed',evidence:final.pack.evidence.filter(e=>['frames','clip'].includes(e.kind)).map(e=>e.path),playbackAssertion:'reviewer-asserted-not-authenticated',limitations:['Integration fixture review of the generated evidence; playback is asserted, not authenticated.'],...(role==='narration-fidelity'?{audio:'signal-verified'}:{})},
    initialObservation:'The captured browser interaction is represented in the final evidence.',coverage:[final.pack.interval],verdict:'pass',findings:[]},
    {agentId:`fixture-reviewer-${role}`,role:'reviewer'});
  next=await run(['next','--job',job],fixtureEnv);
  assert.match(next.stdout,/STATE: rendered from the reviewed film/);
  const finalPack=JSON.parse(await readFile(path.join(reviewDir,'final/pack.json'),'utf8'));
  const omissionEvidence=finalPack.evidence.find(item=>item.kind==='capture-omissions');
  assert.ok(omissionEvidence,'the final pack freezes the omission ledger');
  assert.match(await readFile(path.join(job,omissionEvidence.path),'utf8'),/"sourceHash"/);
  assert.match(await readFile(path.join(job,'briefs/review-final-narration-fidelity.md'),'utf8'),/capture-omissions.*action-log hash.*capture-manifest hash/s,
    'independent reviewers are explicitly directed to inspect the frozen omissions and hashes');
  // Keep every provenance hash current: the final pack must reject the malformed action itself,
  // not merely notice that someone changed the evidence files.
  const actionFile=path.join(job,'capture/screen/actions.jsonl');
  const malformedActions=(await readFile(actionFile,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  delete malformedActions.find(action=>action.type==='click').t;
  const malformedLog=malformedActions.map(action=>JSON.stringify(action)).join('\n')+'\n';
  await writeFile(actionFile,malformedLog);
  const badHash=createHash('sha256').update(malformedLog).digest('hex');
  const captureManifestFile=path.join(job,'capture/screen/manifest.json');
  const captureManifest=JSON.parse(await readFile(captureManifestFile,'utf8'));
  captureManifest.files.actions.sha256=badHash;
  await writeFile(captureManifestFile,JSON.stringify(captureManifest));
  const currentLedger=JSON.parse(await readFile(omissionsFile,'utf8'));
  currentLedger.actionsSha256=badHash;
  for(const entry of currentLedger.scenes) entry.actionsSha256=badHash;
  await writeFile(omissionsFile,JSON.stringify(currentLedger));
  await refreshReviewSourceHash();
  await assert.rejects(run(['review-pack','--job',job,'--stage','final','--from','render'],fixtureEnv),/action \d+ \(click\) has invalid timestamp/);
});
