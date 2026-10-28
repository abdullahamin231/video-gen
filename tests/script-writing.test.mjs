import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm, realpath} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const skill=path.join(root,'skills/script-writing');
async function workspace(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'script-writing-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));return dir;
}
function lint(dir,...args) {
  return spawnSync(process.execPath,[path.join(skill,'scripts/lint.mjs'),...args,'--json'],{cwd:dir,encoding:'utf8'});
}

test('script lint uses the chosen speaking rate for budget and duration',async t=>{
  const dir=await workspace(t);
  await writeFile(path.join(dir,'2026-script.md'),'This is spoken text. '.repeat(30));
  const good=lint(dir,'2026-script.md','--minutes','1','--wpm','120');
  assert.equal(good.status,0,good.stderr||good.stdout);
  const report=JSON.parse(good.stdout);
  assert.equal(report.words,120);assert.equal(report.estMinutes,1);assert.equal(report.budgetWords,120);
  const over=lint(dir,'2026-script.md','--minutes','1');
  assert.equal(over.status,1);assert.ok(JSON.parse(over.stdout).errors.some(e=>/budget/.test(e)));
});

test('script lint never hides stage directions in deliverable or reference mode',async t=>{
  const dir=await workspace(t);
  await writeFile(path.join(dir,'script.md'),'[pause]\nKeep this sentence natural.');
  for(const args of [[],['--reference-transcript']]) {
    const result=lint(dir,'script.md',...args);assert.equal(result.status,1,result.stderr);
    assert.ok(JSON.parse(result.stdout).ttsHazards['stage directions/timestamps']);
  }
});

test('timestamp removal is explicit and does not hide ordinary narration hazards',async t=>{
  const dir=await workspace(t);
  await writeFile(path.join(dir,'script.md'),'[ 00:01 --> 00:05 ] Keep this sentence natural.');
  assert.equal(lint(dir,'script.md').status,1);
  const reference=lint(dir,'script.md','--reference-transcript');assert.equal(reference.status,0,reference.stderr);
  assert.equal(JSON.parse(reference.stdout).words,4);
  await writeFile(path.join(dir,'script.md'),'## Opening\nRead https://example.com/article aloud.');
  const invalid=JSON.parse(lint(dir,'script.md').stdout);
  assert.equal(invalid.ok,false);assert.ok(invalid.ttsHazards.urls);assert.ok(invalid.ttsHazards['markdown/emoji']);
});

test('script lint rejects empty narration and invalid speaking-rate options',async t=>{
  const dir=await workspace(t);await writeFile(path.join(dir,'script.md'),'');
  assert.equal(lint(dir,'script.md').status,1);
  for(const args of [['--wpm','0'],['--wpm','NaN'],['--wpm'],['--minutes','-1']])
    assert.equal(lint(dir,'script.md',...args).status,2);
});

test('source fetch accepts Reddit post and JSON URLs without duplicating the suffix',async t=>{
  const dir=await workspace(t);
  const payload=[{data:{children:[{data:{title:'A source',subreddit:'example',author:'writer',score:3,created_utc:0,selftext:'The original post.'}}]}},
    {data:{children:[{kind:'t1',data:{author:'reader',score:2,body:'A concrete response.'}}]}}];
  const url=pathToFileURL(path.join(skill,'scripts/fetch.mjs')).href;
  const code=`globalThis.fetch=async u=>{console.log('REQUEST '+u);return new Response(${JSON.stringify(JSON.stringify(payload))},{headers:{'content-type':'application/json'}})};
    process.argv=[process.execPath,'fetch.mjs',...process.argv.slice(1)];await import(${JSON.stringify(url)});`;
  for(const suffix of ['/','.json','.json/','/?context=3']) {
    const source='https://www.reddit.com/r/example/comments/abc/a-post'+suffix;
    const out=path.join(dir,'source.md');
    const result=spawnSync(process.execPath,['--input-type=module','-e',code,source,out],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/REQUEST https:\/\/www\.reddit\.com\/r\/example\/comments\/abc\/a-post\.json\?limit=50&sort=top/);
    assert.doesNotMatch(result.stdout,/\.json\.json/);
    const saved=await readFile(out,'utf8');assert.ok(saved.includes(source));assert.ok(saved.includes('The original post.'));assert.ok(saved.includes('A concrete response.'));
  }
});

test('script-writing tools live in the canonical skill folder',async()=>{
  assert.equal(await realpath(skill), path.join(root, 'skills/script-writing'));
});
