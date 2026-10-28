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
