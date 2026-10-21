import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {installKit,writeWorld} from '../lib/world.mjs';
import {inspectFilm} from '../lib/inspect.mjs';

test('painted text collisions fail the build; intentional readable layering stays visible for review',async t=>{
  await mkdir('.cache',{recursive:true});const job=await mkdtemp(path.resolve('.cache/readability-'));
  t.after(()=>rm(job,{recursive:true,force:true}));await installKit(job);
  const manifest={width:640,height:360,duration:2,fps:30};
  const scene={id:'one',start:0,end:2,beats:[],holds:[]};
  const world={...manifest,theme:{bg:'#101010'},scenes:[scene],actions:[],
    objects:[{id:'first',type:'text',scene:'one',at:[300,180],text:'MEASUREMENT',size:44,visible:true},
      {id:'second',type:'text',scene:'one',at:[310,185],text:'SOURCE',size:40,visible:true}],
    lifetimes:{first:[{start:0,end:2}],second:[{start:0,end:2}]}};
  await writeWorld(job,world,manifest);
  const blocked=await inspectFilm(job,manifest,{scenes:[scene],missing:[]});
  assert(blocked.errors.some(error=>error.startsWith('Readability:')));
  assert.equal(blocked.report.readability.violations.length,1);
  world.objects[1].at=[310,280];
  await writeWorld(job,world,manifest);
  const clear=await inspectFilm(job,manifest,{scenes:[scene],missing:[]});
  assert(!clear.errors.some(error=>error.startsWith('Readability:')));
  world.objects[1].at=[630,280];
  await writeWorld(job,world,manifest);
  const clipped=await inspectFilm(job,manifest,{scenes:[scene],missing:[]});
  assert(clipped.errors.some(error=>error.startsWith('Readability:') && error.includes('clipped')));
  world.objects[1].at=[310,280];
  world.objects.push({id:'cover',type:'rect',scene:'one',at:[300,180],size:[400,90],fill:'#222222',fillOpacity:1,visible:true});
  await writeWorld(job,world,manifest);
  const covered=await inspectFilm(job,manifest,{scenes:[scene],missing:[]});
  assert(covered.errors.some(error=>error.startsWith('Readability:') && error.includes('obscured by figure')));
  world.objects.pop();
  world.objects[1].at=[310,185];
  world.intentionalOverlaps=[{scene:'one',objects:['first','second'],reason:'Intentional offset type treatment; independent review must confirm readability.',textReadable:true}];
  await writeWorld(job,world,manifest);
  const declared=await inspectFilm(job,manifest,{scenes:[scene],missing:[]});
  assert(declared.warnings.some(warning=>warning.includes('Declared intentional:')));
  // An annotation is visible evidence for reviewers, never a waiver for an
  // independent reviewer who finds the text actually unreadable.
  assert.equal(declared.report.readability.violations.length,0);
});
