import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {objectLifetimes,compileFilm} from '../lib/spec.mjs';
import {installKit,writeWorld} from '../lib/world.mjs';
import {openInspector,sceneLeaks} from '../lib/inspect.mjs';

const bounds=[{id:'one',start:0,end:2},{id:'two',start:2,end:4},{id:'three',start:4,end:6}];
const film={scenes:bounds.map(s=>({...s,carry:[]}))};
test('cleanup references never extend life; reuse, groups, plot children and persistent objects do',()=>{
  const world={duration:6,objects:[{id:'old',scene:'one'},{id:'reused',scene:'one'},
    {id:'group',scene:'one',children:[{id:'child'}]}, {id:'axes',scene:'one'},
    {id:'graph',scene:'one',of:'axes'},{id:'background',scene:'one',persist:true}],actions:[
    {scene:'two',do:'hide',target:'old'},
    {scene:'two',do:'count',target:'reused.text'},
    {scene:'two',do:'move',target:'child'},
    {scene:'two',do:'trace',target:'graph'},
  ]};
  const ranges=objectLifetimes(world,film,bounds);
  assert.deepEqual(ranges.old,[{start:0,end:2}]);
  for(const id of ['reused','group','axes']) assert.deepEqual(ranges[id],[{start:0,end:4}]);
  assert.deepEqual(ranges.background,[{start:0,end:6}]);
});

test('boundary inspection rejects residue even when no text overlaps',()=>{
  const root={id:'old',scene:'one',opacity:1,box:[10,10,100,80]};
  const label={...root,id:'old-label',parent:'old'};
  const ranges={old:[{start:0,end:2}]};
  assert.deepEqual(sceneLeaks({objects:[root,label]},ranges,1.99),[]);
  assert.equal(sceneLeaks({objects:[root,label]},ranges,2).length,2);
  assert.equal(sceneLeaks({objects:[{...root,id:'runtime-effect'}]},ranges,2,bounds).length,1);
  assert.deepEqual(sceneLeaks({objects:[{...root,opacity:0}]},ranges,2),[]);
});

test('part-counted objects receive a simultaneous exit; later hide does not carry them',async t=>{
  const root=path.resolve('.cache');await mkdir(root,{recursive:true});
  const job=await mkdtemp(path.join(root,'lifecycle-compile-'));t.after(()=>rm(job,{recursive:true,force:true}));
  for(const dir of ['shots','inputs']) await mkdir(path.join(job,dir));
  const theme={name:'Test',description:'Chunky white outlines on a near-black stage, flat saturated fills, hard offset shadows and heavy display type for prices.',bg:'#101010',colors:{white:'#eeeeee',yellow:'#ffdd33'}};
  const scene=(id,start)=>({id,start,idea:'Comparison',mechanism:'Count',states:['a','b'],payoff:'Number',camera:'Static',handoff:'Clear',why_not_basic:'Visible result',alternatives:['A']});
  const plan={version:2,title:'Test',concept:'Count',theme,alternatives:[{concept:'A',rejected:'B'},{concept:'B',rejected:'A'}],subjects:[],scenes:[scene('one',{boundary:'start'}),scene('two',{phrase:'next'})]};
  const alignment={words:[{text:'count',start:0,end:.4},{text:'next',start:2,end:2.4}]};
  await writeFile(path.join(job,'shots/one.json'),JSON.stringify({scene:'one',objects:[{id:'old',type:'counter',at:[100,100],numbers:'Illustrative count'}],actions:[{do:'count',target:'old.text',at:'start',to:42,numbers:'Illustrative count',dur:.5}]}));
  await writeFile(path.join(job,'shots/two.json'),JSON.stringify({scene:'two',objects:[],actions:[{do:'hide',target:'old',at:'end-0.1'}]}));
  const {world}=await compileFilm(job,plan,alignment,{duration:4,width:640,height:360});
  const exit=world.actions.find(a=>a.auto && a.do==='fadeOut');
  assert(exit.target.includes('old'));
  assert.equal(exit.stagger,0);assert(exit.t+exit.dur<=2);
  assert.deepEqual(world.lifetimes.old,[{start:0,end:2}]);
});

test('real timeline gates survive late reveals and reverse/random seeks, including labels and groups',async t=>{
  await mkdir('.cache',{recursive:true});const job=await mkdtemp(path.resolve('.cache/lifecycle-browser-'));
  t.after(()=>rm(job,{recursive:true,force:true}));
  await installKit(job);
  const world={width:640,height:360,duration:6,theme:{bg:'#101010'},scenes:bounds,
    objects:[{id:'old',type:'counter',scene:'one',at:[150,150],size:60,label:'Old label'},
      {id:'group',type:'group',scene:'one',at:[300,150],children:[{id:'child',type:'text',text:'Old child',visible:true,at:[0,0]}]},
      {id:'new',type:'text',scene:'two',at:[400,150],text:'New scene',visible:true}],
    actions:[{do:'count',target:'old.text',t:.2,dur:.4,to:42}, {do:'show',target:'group',t:0,dur:.001},
      // A late opacity tween must never resurrect an object beyond its lifetime.
      {do:'fadeIn',target:'old',t:2.4,dur:.5},
      {do:'circumscribe',target:'old',t:1,dur:4,keep:true,scene:'one'}],
    lifetimes:{old:[{start:0,end:2}],group:[{start:0,end:2}],new:[{start:2,end:4}]}};
  await writeWorld(job,world,{width:640,height:360,duration:6});
  const inspector=await openInspector(job,{width:640,height:360});t.after(()=>inspector.close());
  for(const time of [1,2,2.5,3,1,4,2,0,3,1]) {
    const snapshot=await inspector.seek(time);
    const old=snapshot.objects.find(o=>o.id==='old');
    if(time>=2) for(const id of ['old','old-label','group','child','scene-effect-1']) assert.equal(snapshot.objects.find(o=>o.id===id).opacity,0,`${id} leaked at ${time}`);
    if(time===1) assert(old.opacity>.9,'old scene did not recover when seeking backwards');
    assert.deepEqual(sceneLeaks(snapshot,world.lifetimes,time),[]);
  }
});
