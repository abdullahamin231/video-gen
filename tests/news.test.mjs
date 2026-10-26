import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,copyFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers/news-fixture.mjs';
import {transcribeNews,newsPlan,ingestNews,shiftedWords,captionCues,checkRights,requireNewsDelivery,verifyNews,command} from '../lib/news.mjs';
import {compareNarration} from '../lib/audio-verification.mjs';
import {buildFilm,nextStep,filmAudit,writeProductionReport,renderFilm} from '../lib/film.mjs';
process.env.VG_LIBRARY=path.resolve('.cache/tests/news-library');
const {thumbnailDimensions,thumbnailStep,exportThumbnail,thumbnailStatus,recordVerdict,chooseThumbnail}=await import('../lib/thumbnails.mjs');
import {readPersonality,assertRenderReady} from '../lib/personalities.mjs';
import {createReviewPack} from '../lib/review-pack.mjs';
const save=(f,v)=>writeFile(f,JSON.stringify(v,null,2)+'\n');
async function setup(t,profile,vertical) {
  await mkdir('.cache/tests',{recursive:true});
  const job=await mkdtemp(path.resolve('.cache/tests/news-'));
  t.after(()=>rm(job,{recursive:true,force:true}));
  await fixture(job,profile,vertical);
  return job;
}

test('source in points map caption words onto the edit clock and reject cut words',()=>{
  const words=[{text:'Before',start:0,end:.5},{text:'Actual',start:1.1,end:1.5},{text:'quote',start:1.6,end:1.9}];
  const shifted=shiftedWords(words,{id:'quote',in:1,out:2,at:7,speaker:'Speaker'});
  assert.equal(shifted[0].start,7.1); assert.equal(shifted[1].end,7.9);
  assert.throws(()=>shiftedWords(words,{in:1.2,out:2,at:0}),/splits a word/);
  assert.equal(captionCues(shifted,true)[0].text,'Actual quote');
});

test('rights fail before ingestion, including citation-only, expired and unapproved commercial media',async t=>{
  const job=await setup(t);
  const file=path.join(job,'news-sources.json'),ledger=JSON.parse(await readFile(file));
  const source=ledger.sources[0];
  delete source.rights; await save(file,ledger);
  await assert.rejects(ingestNews(job,'still',path.join(job,'original.png')),/document reuse AND editing permission/);
  source.rights={basis:'licensed',reuse:true,edit:true,evidence:'inputs/rights.md'};
  await assert.rejects(checkRights(job,source),/explicit user authorization/);
  source.rights.authorization='User permits licensed reuse'; source.rights.expires='2000-01-01';
  await assert.rejects(checkRights(job,source),/expired/);
  delete source.rights.expires;source.rights.evidence='../elsewhere';
  await assert.rejects(checkRights(job,source),/missing local rights evidence/);
});

test('news plan enforces commentary completeness, source transcripts, exact audio offsets and claim evidence',async t=>{
  const job=await setup(t),file=path.join(job,'news.json');
  const original=JSON.parse(await readFile(file));
  assert.equal((await newsPlan(job)).captions.length,2);
  const mutate=async fn=>{const edit=structuredClone(original);fn(edit);await save(file,edit);};
  await mutate(e=>e.audio[0].out=.75);
  await assert.rejects(newsPlan(job),/all supplied commentary words/);
  await mutate(e=>e.audio[1].at=1);
  await assert.rejects(newsPlan(job),/speech overlaps/);
  await mutate(e=>e.scenes[1].in=2);
  await assert.rejects(newsPlan(job),/invalid source in\/out/);
  await mutate(e=>e.audio[1].in=.9);
  await assert.rejects(newsPlan(job),/extends past edit|retain source speech/);
  await mutate(e=>e.scenes[0].claims=['imaginary']);
  await assert.rejects(newsPlan(job),/cite valid claim/);
  await save(file,original);
  const lf=path.join(job,'news-sources.json'),ledger=JSON.parse(await readFile(lf));
  ledger.sources[1].transcript.words=[];await save(lf,ledger);
  await assert.rejects(newsPlan(job),/reviewed word timestamps/);
});

test('asset tampering and missing transcript speech coverage block builds',async t=>{
  const job=await setup(t),lf=path.join(job,'news-sources.json'),ledger=JSON.parse(await readFile(lf));
  ledger.sources[1].transcript.words.pop();await save(lf,ledger);
  await assert.rejects(buildFilm(job),/missing speech coverage/);
  ledger.sources[1].transcript.speechRanges=[];delete ledger.sources[1].transcript.reviewed;await save(lf,ledger);
  await assert.rejects(buildFilm(job),/full source transcript/);
  await writeFile(path.join(job,'assets/news/still.png'),'changed');
  await assert.rejects(newsPlan(job),/asset\/rights changed/);
});

for(const [profile,vertical] of [['news-financial',false],['news-political',true]]) {
  test(`${profile}: build, HTML evidence, encoded render verification and required delivery gate`,{timeout:180000},async t=>{
    const job=await setup(t,profile,vertical);
    assert.doesNotThrow(()=>assertRenderReady(readPersonality(job)));
    assert.equal((await buildFilm(job)).ok,true);
    assert.equal((await filmAudit(job)).ok,true);
    const html=await readFile(path.join(job,'index.html'),'utf8');
    assert.match(html,/data-media-start="1"/);
    assert.equal(html.includes('id="presenter"'),profile==='news-political');
    const pack=await createReviewPack(job,{stage:'prototype'});
    assert.ok(pack.evidence.some(e=>e.path==='assets/news-mix.wav'));
    assert.ok(pack.evidence.some(e=>e.kind==='frames'));
    await assert.rejects(requireNewsDelivery(job),/ENOENT|delivery requires/);
    // Real renderer through the repository wrapper. No production projects or upload are involved.
    await command('npm',['run','-s','video','--','render','--job',job,'--workers','1']);
    const receipt=JSON.parse(await readFile(path.join(job,'review/news-verification.json')));
    assert.equal(receipt.ok,true);assert.equal(receipt.subtitles.cues,2);
    assert.ok(receipt.subtitles.samples.some(s=>s.region==='media'));
    assert.ok(receipt.subtitles.samples.length>=10);
    assert.ok(receipt.narrationIntegrity.correlation>.995);
    // Nonstationary chirp: a one-second source offset cannot accidentally match a periodic tone.
    const expectedAudio=path.join(job,'review/source-excerpt.wav'),renderedAudio=path.join(job,'review/rendered-excerpt.wav');
    await command('ffmpeg',['-v','error','-y','-i',path.join(job,'assets/news/clip.mp4'),'-ss','1','-t','2','-vn','-ac','1','-ar','48000',expectedAudio]);
    await command('ffmpeg',['-v','error','-y','-i',path.join(job,'renders/video.mp4'),'-ss','2','-t','2','-vn','-ac','1','-ar','48000',renderedAudio]);
    assert.equal((await compareNarration(renderedAudio,expectedAudio)).ok,true,'source audio must be trimmed at 1s and placed at film 2s');
    await requireNewsDelivery(job);
    if (profile==='news-financial') {
      const video=path.join(job,'renders/video.mp4'),backup=path.join(job,'renders/uncorrupted.mp4'),corrupt=path.join(job,'renders/uncaptioned.mp4');
      await copyFile(video,backup);
      await command('ffmpeg',['-nostdin','-v','error','-y','-threads','1','-filter_threads','1','-i',video,'-vf','drawbox=x=0:y=576:w=1280:h=110:color=0x10141a:t=fill','-c:v','libx264','-preset','ultrafast','-c:a','copy',corrupt]);
      await rename(corrupt,video);
      await assert.rejects(verifyNews(job),/subtitles .*encoded raster differs/);
      await copyFile(backup,video);
    }
    await writeProductionReport(job);
    const edit=JSON.parse(await readFile(path.join(job,'news.json')));edit.title+=' changed';await save(path.join(job,'news.json'),edit);
    await assert.rejects(requireNewsDelivery(job),/current encoded audio\/subtitle verification/);
  });
}

for(const vertical of [false,true]) test(`thumbnail export and briefs preserve ${vertical?'portrait':'landscape'} format`,async t=>{
  const job=await setup(t,'news-financial',vertical),g=await thumbnailDimensions(job);
  await thumbnailStep(job);
  const brief=await readFile(path.join(job,'briefs/thumbnail-v1.md'),'utf8');
  assert.ok(brief.includes(`${g.width}×${g.height}`));assert.ok(brief.includes(g.previewFile));
  const dir=path.join(job,'thumbnail/variants/v1');await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'BRIEF.md'),'Title: Test\nHeadline: Test\n');
  await writeFile(path.join(dir,'thumbnail.svg'),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.width} ${g.height}"><rect width="100%" height="100%" fill="#123456"/></svg>`);
  const exported=await exportThumbnail(job,'v1');
  assert.deepEqual(exported.size,{width:g.width,height:g.height});assert.ok(exported.preview.endsWith(g.previewFile));
  assert.equal((await thumbnailStatus(job)).variants[0].made,true);
  await recordVerdict(job,{variant:'v1',status:'pass',findings:[],reviewer:'fixture-contract',inspected:['thumbnail/variants/v1/thumbnail.png']});
  await chooseThumbnail(job,{variant:'v1'});
  const archived=path.join(process.env.VG_LIBRARY,'thumbnails',path.basename(job));
  t.after(()=>rm(archived,{recursive:true,force:true}));
  assert.deepEqual(await readFile(path.join(archived,g.previewFile)),await readFile(path.join(dir,g.previewFile)));
  assert.deepEqual(await readFile(path.join(job,'thumbnail/thumbnail.png')),await readFile(path.join(dir,'thumbnail.png')));
  if(vertical) {
    await writeFile(path.join(dir,'thumbnail.svg'),'<svg viewBox="0 0 1280 720"></svg>');
    await assert.rejects(exportThumbnail(job,'v1'),/SVG aspect ratio must match/);
  }
});


test('source ASR preserves reviewed transcripts and validates multilingual model selection before invocation',async t=>{
  const job=await setup(t);
  await assert.rejects(transcribeNews(job,'clip'),/reviewed transcript already exists/);
  await assert.rejects(transcribeNews(job,'clip',{replace:true,language:'fr',model:'small.en'}),/multilingual ASR model/);
});
