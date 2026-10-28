// Real-media news adapter. Inputs are local, rights-cleared originals; edit and caption clocks are seconds.
import {readFile, writeFile, mkdir, copyFile, realpath, stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {fileHash, localFile, sourceFingerprint} from './review.mjs';
import {readPersonality, assertRenderReady} from './personalities.mjs';
import {lintJob} from './native.mjs';
import {installRuntime} from './composition.mjs';
import {cacheDir} from './media.mjs';
import {compareNarration} from './audio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = async f => JSON.parse(await readFile(f, 'utf8'));
const save = (f, v) => writeFile(f, JSON.stringify(v, null, 2) + '\n');
const text = v => typeof v === 'string' && !!v.trim();
const num = v => typeof v === 'number' && Number.isFinite(v);
const idOK = v => /^[a-z][a-z0-9-]*$/.test(v || '');
const esc = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const isNews = snapshot => ['news-financial', 'news-political'].includes(snapshot.profile.id);
export function command(bin, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {stdio: ['ignore', 'pipe', 'pipe'], ...options});
    let out = '', err = '';
    child.stdout.on('data', c => {out += c;}); child.stderr.on('data', c => {err = (err + c).slice(-12000);});
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(out) : reject(new Error(`${bin} (${code}): ${err}`)));
  });
}
const ff = args => command('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1', ...args]);
const probe = async f => JSON.parse(await command('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]));
function fail(message) { throw new Error(`News source/timeline blocker: ${message}`); }

/** Evidence is required before even copying a supplied file. A citation URL is never a licence. */
export async function checkRights(job, source) {
  if (!idOK(source.id) || !text(source.url) || !text(source.holder) || (!text(source.date) || !Number.isFinite(Date.parse(source.date))) || !text(source.attribution))
    fail(`${source.id || '(source)'} needs id, url, holder, date and attribution.`);
  const r = source.rights;
  if (!r || !['owned', 'licensed', 'public-domain', 'permission'].includes(r.basis) || r.reuse !== true || r.edit !== true || !text(r.evidence))
    fail(`${source.id}: document reuse AND editing permission in rights {basis, reuse:true, edit:true, evidence:<local file>}. Public availability/CNBC citation is not clearance.`);
  const evidence = await localFile(job, r.evidence).catch(() => fail(`${source.id}: missing local rights evidence ${r.evidence}.`));
  if (!(await readFile(evidence, 'utf8')).trim()) fail(`${source.id}: rights evidence is empty.`);
  if (['licensed','permission'].includes(r.basis) && !text(r.authorization))
    fail(`${source.id}: retain explicit user authorization for this licensed/permitted third-party acquisition in rights.authorization.`);
  if (r.expires && (!Number.isFinite(Date.parse(r.expires)) || Date.parse(r.expires) < Date.now())) fail(`${source.id}: reuse permission expired; obtain current permission.`);
  return evidence;
}

/** No downloader or recorder: rights review precedes local ingestion of supplied/cleared files. */
export async function ingestNews(job, sourceId, input) {
  if (!isNews(readPersonality(job))) fail('news-ingest requires a news profile.');
  const ledgerFile = path.join(job, 'news-sources.json'), ledger = await json(ledgerFile);
  const s = ledger.sources?.find(s => s.id === sourceId);
  if (!s) fail(`add ${sourceId} to news-sources.json before ingestion.`);
  await checkRights(job, s);
  if (!input || /^https?:/i.test(input)) fail('supply --file <repository-local cleared original>; downloading/recording commercial references is disabled.');
  const source = await realpath(path.resolve(ROOT, input)), repo = await realpath(ROOT);
  if (!source.startsWith(repo + path.sep) || !(await stat(source)).isFile()) fail('ingestion input must be a file inside the repository.');
  const ext = path.extname(source).toLowerCase();
  if (!['.mp4','.mov','.webm','.mkv','.png','.jpg','.jpeg','.webp','.wav','.mp3','.m4a'].includes(ext)) fail('use a supported image, video or audio file.');
  const destination = `assets/news/${s.id}${ext}`;
  await mkdir(path.join(job, 'assets/news'), {recursive:true});
  // Originals and previous ingests remain immutable: new bytes require a new source id.
  const target = path.join(job, destination);
  if (await realpath(path.dirname(target)) !== path.join(await realpath(job),'assets/news')) fail('assets/news must be a local directory, not a symlink.');
  try { await copyFile(source, target, 1); }
  catch (e) { if (e.code !== 'EEXIST' || await fileHash(target) !== await fileHash(source)) throw e; }
  s.file = destination; s.sha256 = await fileHash(target);
  s.ingestion = {input: path.relative(ROOT, source), rightsSha256: await fileHash(await checkRights(job, s))};
  await save(ledgerFile, ledger);
  return {id:s.id, file:s.file, sha256:s.sha256};
}

/** Local ASR measures the original-file clock. Editorial review is explicit, never inferred from ASR. */
export async function transcribeNews(job, sourceId, {model='small.en', language='en', replace=false}={}) {
  if(!isNews(readPersonality(job))) fail('news-transcribe requires a news profile.');
  const ledgerFile=path.join(job,'news-sources.json'),ledger=await json(ledgerFile);
  const source=ledger.sources?.find(s=>s.id===sourceId);
  if(!source) fail(`unknown source ${sourceId}.`);
  await checkRights(job,source);
  const file=await localFile(job,source.file);
  if(source.sha256!==await fileHash(file)) fail('source bytes changed; re-ingest first.');
  if(source.transcript?.reviewed&&!replace) fail('reviewed transcript already exists; pass --replace true only to intentionally replace it, then review again.');
  if(language!=='en'&&model.endsWith('.en')) fail('use a multilingual ASR model for non-English speech.');
  const cache=cacheDir();await mkdir(path.join(job,'inputs'),{recursive:true});
  const output=path.join(job,`inputs/${sourceId}-words.json`);
  await command('uv',['run','--locked','--script',path.join(ROOT,'scripts/transcribe.py'),file,output,'--model',model,'--language',language],{env:{...process.env,UV_CACHE_DIR:path.join(cache,'uv'),HF_HOME:path.join(cache,'huggingface'),XDG_CACHE_HOME:cache}});
  const words=await json(output),speechRanges=[];
  for(const w of words) {
    if(!speechRanges.length||w.start-speechRanges.at(-1).end>.45) speechRanges.push({start:w.start,end:w.end});
    else speechRanges.at(-1).end=w.end;
  }
  source.transcript={reviewed:false,reviewer:'',note:'ASR draft: compare every audible speaker and word with the original before accepting.',words,speechRanges};
  await save(ledgerFile,ledger);
  return {source:sourceId,words:words.length,reviewed:false,next:'Review words, speechRanges, speaker identities and original speech, then set transcript.reviewed:true, reviewer and note in news-sources.json.'};
}

function range(r, limit, name) {
  if (!num(r?.in) || !num(r?.out) || r.in < 0 || r.out <= r.in || r.out > limit + .025) fail(`${name}: invalid source in/out (source duration ${limit}s).`);
}
function wordsValid(words, limit, label) {
  if (!Array.isArray(words) || !words.length) fail(`${label}: reviewed word timestamps are required for every audible speaker.`);
  let end = -1;
  for (const w of words) {
    if (!text(w.text) || !num(w.start) || !num(w.end) || w.start < 0 || w.end <= w.start || w.end > limit + .025 || w.start < end - .025)
      fail(`${label}: invalid/overlapping word timestamps.`);
    end = w.end;
  }
}

export function shiftedWords(words, segment) {
  // Do not cut a spoken word in half: the editor must adjust the source range instead.
  if (words.some(w => w.start < segment.in - .025 && w.end > segment.in + .025 || w.start < segment.out - .025 && w.end > segment.out + .025))
    fail(`${segment.id}: source cut splits a word; move in/out to a word boundary.`);
  return words.filter(w => w.start >= segment.in - .025 && w.end <= segment.out + .025).map(w =>
    ({text:w.text, start:Math.max(segment.at, segment.at + w.start - segment.in), end:segment.at + w.end - segment.in, speaker:segment.speaker, segment:segment.id}));
}
export function captionCues(words, vertical = false) {
  const cues = []; let batch = [];
  const flush = () => { if (batch.length) { cues.push({start:batch[0].start, end:batch.at(-1).end, text:batch.map(w=>w.text).join(' '), speaker:batch[0].speaker, segment:batch[0].segment}); batch=[]; } };
  for (const w of words) {
    if (batch.length && (batch.length >= (vertical ? 5 : 8) || batch.map(x=>x.text).join(' ').length + w.text.length > (vertical ? 36 : 64) || w.segment !== batch[0].segment || w.start - batch.at(-1).end > .45)) flush();
    batch.push(w);
  }
  flush(); return cues;
}

export async function newsPlan(job) {
  const snapshot = readPersonality(job);
  assertRenderReady(snapshot);
  if (!isNews(snapshot)) fail('this adapter only accepts financial/political profiles.');
  const manifest = await json(path.join(job, 'job.json'));
  const ledger = await json(path.join(job,'news-sources.json')).catch(() => fail('write news-sources.json with cleared sources and dated claim evidence; see docs/news.md.'));
  const edit = await json(path.join(job, 'news.json')).catch(() => fail('write news.json with actual-media scenes and commentary/source-speech tracks; see docs/news.md.'));
  if (ledger.version !== 1 || edit.version !== 1 || !text(edit.title) || !num(edit.duration) || edit.duration <= 0 || !Array.isArray(ledger.sources)) fail('schema version 1, title, duration and sources are required.');
  const sources = new Map(), claims = new Map();
  for (const s of ledger.sources) {
    if (sources.has(s.id)) fail(`duplicate source ${s.id}.`);
    await checkRights(job, s);
    const f = await localFile(job, s.file).catch(()=>fail(`${s.id}: ingest a cleared local original using news-ingest.`));
    if (!s.ingestion || s.sha256 !== await fileHash(f) || s.ingestion.rightsSha256 !== await fileHash(await checkRights(job,s))) fail(`${s.id}: asset/rights changed or missing ingestion receipt; re-ingest cleared source.`);
    if (!['image','video','audio'].includes(s.kind)) fail(`${s.id}: kind must be image, video or audio.`);
    const metadata = await probe(f), streams = metadata.streams || [];
    if (s.kind === 'video' && !streams.some(x=>x.codec_type==='video') || s.kind === 'audio' && !streams.some(x=>x.codec_type==='audio') || s.kind === 'image' && !streams.some(x=>x.codec_type==='video')) fail(`${s.id}: media kind does not match file.`);
    if (s.kind !== 'image' && (!Number.isFinite(Number(metadata.format.duration)) || Number(metadata.format.duration)<=0)) fail(`${s.id}: media needs a measured positive duration.`);
    sources.set(s.id, {...s, metadata, duration:Number(metadata.format.duration)});
  }
  for (const c of ledger.claims || []) {
    if (!idOK(c.id) || claims.has(c.id) || !text(c.text) || !['reporting','opinion','quotation','allegation','disputed'].includes(c.type) || !Array.isArray(c.evidence) || !c.evidence.length || c.evidence.some(e=>!text(e.url)||!text(e.date)||!text(e.context))) fail(`${c.id || 'claim'}: record text, type and dated evidence {url,date,context}; citations are separate from media rights.`);
    claims.set(c.id,c);
  }
  if (!Array.isArray(edit.scenes) || !edit.scenes.length) fail('at least one real-media scene is required.');
  const sceneIds = new Set(); let cursor=0;
  const cite = (ids, name) => {if (!Array.isArray(ids) || !ids.length || ids.some(id=>!claims.has(id))) fail(`${name}: cite valid claim ids.`);};
  for (const s of edit.scenes) {
    if (!idOK(s.id) || sceneIds.has(s.id) || !num(s.at) || !num(s.duration) || s.duration<=0 || Math.abs(s.at-cursor)>.001) fail(`${s.id}: scenes must form an ordered, gapless timeline.`);
    sceneIds.add(s.id); const source=sources.get(s.source);
    if (!source || !['image','video'].includes(source.kind)) fail(`${s.id}: choose an ingested actual image/article view/video.`);
    if (!text(s.context) || !text(s.treatment)) fail(`${s.id}: describe event context and why this actual media supports the commentary.`);
    cite(s.claims,s.id);
    if (!['contain','cover'].includes(s.fit || 'contain') || s.fit === 'cover' && !text(s.cropReason)) fail(`${s.id}: use contain, or cover with cropReason explaining preserved context.`);
    if (s.position && (!Array.isArray(s.position) || s.position.length!==2 || s.position.some(x=>!num(x)||x<0||x>100))) fail(`${s.id}: position is [x%,y%] within 0–100.`);
    if (source.kind==='video') range({in:s.in,out:s.in+s.duration},source.duration,s.id);
    cursor=s.at+s.duration;
  }
  if (Math.abs(cursor-edit.duration)>.001) fail('scene coverage does not match edit duration.');
  const alignment = await json(path.join(job,'alignment.json'));
  const narration = await localFile(job,'assets/narration.wav');
  if (manifest.audio?.sha256 && manifest.audio.sha256 !== await fileHash(narration)) fail('supplied narration changed; restore original or prepare a new job.');
  const narrationDuration=Number((await probe(narration)).format.duration);
  wordsValid(alignment.words,narrationDuration,'commentary alignment');
  if (alignment.matchRatio < .85 && !(alignment.review?.approved && text(alignment.review.note))) fail('review commentary alignment discrepancies with alignment-approve.');
  if (!Array.isArray(edit.audio) || !edit.audio.length) fail('audio needs original commentary and any retained source speech.');
  const audio=[], allWords=[], audioIds=new Set(); let lastEnd=0, originalWordIndices=[];
  for (const a of [...edit.audio].sort((a,b)=>a.at-b.at)) {
    if (!idOK(a.id)||audioIds.has(a.id)||!num(a.at)||a.at<0||!text(a.speaker)) fail('audio needs unique id, at and speaker.');
    audioIds.add(a.id);
    const commentary=a.source==='commentary', source=commentary?null:sources.get(a.source);
    if (!commentary && (!source || !source.metadata.streams.some(x=>x.codec_type==='audio'))) fail(`${a.id}: source has no audio.`);
    const limit=commentary?narrationDuration:source.duration;
    range(a,limit,a.id); const end=a.at+a.out-a.in;
    if (end>edit.duration+.001 || a.at<lastEnd-.001) fail(`${a.id}: speech overlaps or extends past edit; separate commentary from source speech.`);
    lastEnd=end;
    cite(a.claims,a.id);
    let words;
    if (commentary) {
      words=alignment.words;
      originalWordIndices.push(...words.map((w,i)=>w.start>=a.in-.025&&w.end<=a.out+.025?i:-1).filter(i=>i>=0));
    } else {
      const tr=source.transcript;
      if (!tr || tr.reviewed!==true || !text(tr.reviewer) || !text(tr.note) || (!Array.isArray(tr.speechRanges) || !tr.speechRanges.length)) fail(`${a.id}: full source transcript needs reviewed:true, reviewer, note and speechRanges.`);
      words=tr.words; wordsValid(words,limit,a.id);
      if (words.some(w=>!tr.speechRanges.some(r=>w.start>=r.start-.025&&w.end<=r.end+.025))) fail(`${a.id}: speechRanges must cover all transcript words.`);
      for (const r of tr.speechRanges) {
        if (!num(r.start)||!num(r.end)||r.end<=r.start||r.start<0||r.end>limit+.025) fail(`${a.id}: invalid speechRanges.`);
        const selected=words.filter(w=>w.end>r.start&&w.start<r.end);
        if (!selected.length || selected[0].start-r.start>.25 || r.end-selected.at(-1).end>.25 || selected.some((w,i)=>i>0&&w.start-selected[i-1].end>.75)) fail(`${a.id}: transcript has missing speech coverage; align all audible speech or split speechRanges at real pauses.`);
      }
    }
    const shifted=shiftedWords(words,a);
    if (!shifted.length) fail(`${a.id}: audible segment has no subtitles.`);
    allWords.push(...shifted);
    audio.push({...a,file:commentary?'assets/narration.wav':source.file,end});
  }
  if (originalWordIndices.length!==alignment.words.length || new Set(originalWordIndices).size!==alignment.words.length) fail('all supplied commentary words must be retained exactly once; do not omit or duplicate recording speech.');
  // A visible source excerpt with speech is audible in sync by default. Silent B-roll must be declared explicitly.
  for (const s of edit.scenes) if (sources.get(s.source).kind==='video') {
    const source=sources.get(s.source), retained=audio.find(a=>a.source===s.source&&Math.abs(a.at-s.at)<.001&&Math.abs(a.in-s.in)<.001&&Math.abs(a.out-(s.in+s.duration))<.001);
    if (source.metadata.streams.some(x=>x.codec_type==='audio') && !retained && !(s.silentBroll===true&&text(s.silentReason))) fail(`${s.id}: retain source speech with matching audio in/out/at, or explicitly document silentBroll/silentReason (never silent replacement of a quotation).`);
  }
  if (edit.presenter) {
    const p=edit.presenter, source=sources.get(p.source);
    if (!source || source.kind!=='video' || !text(p.identity) || p.authorizedIdentity!==true || !text(p.context)) fail('presenter requires a cleared actual video, authorizedIdentity:true, identity and context; never invent a presenter.');
    if (!num(p.at)||!num(p.duration)||p.at<0||p.duration<=0||p.at+p.duration>edit.duration+.001) fail('presenter has invalid timeline range.');
    range({in:p.in,out:p.in+p.duration},source.duration,'presenter');
    if (source.metadata.streams.some(x=>x.codec_type==='audio') && !audio.some(a=>a.source===p.source&&a.at===p.at&&a.in===p.in&&Math.abs(a.out-(p.in+p.duration))<.001) && !(p.silentBroll===true&&text(p.silentReason))) fail('presenter audio must be captioned and retained or explicitly declared silent with a reason.');
  }
  return {edit,ledger,sources,claims,manifest,audio,words:allWords,captions:captionCues(allWords,manifest.height>manifest.width),snapshot};
}

const stamp = t => {const n=Math.round(t*1000); return `${String(Math.floor(n/3600000)).padStart(2,'0')}:${String(Math.floor(n/60000)%60).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')},${String(n%1000).padStart(3,'0')}`;};
export async function newsMix(job, plan, output='assets/news-mix.wav') {
  const args=[], filters=[];
  plan.audio.forEach((a,i)=> {
    args.push('-i',path.join(job,a.file));
    filters.push(`[${i}:a]atrim=start=${a.in}:end=${a.out},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=mono,adelay=${Math.round(a.at*48000)}S:all=1[a${i}]`);
  });
  filters.push(`${plan.audio.map((_,i)=>`[a${i}]`).join('')}amix=inputs=${plan.audio.length}:normalize=0:duration=longest,apad,atrim=duration=${plan.edit.duration}[out]`);
  await ff([...args,'-filter_complex',filters.join(';'),'-map','[out]','-c:a','pcm_s16le',path.join(job,output)]);
}

function newsHTML(plan, {inspection=false}={}) {
  const {manifest:m,edit,sources,captions}=plan, vertical=m.height>m.width;
  const W=m.width,H=m.height, x=vertical?.06*W:.05*W, right=vertical?.87*W:.95*W, top=vertical?.12*H:.06*H;
  const captionY=vertical?.70*H:.80*H, captionH=vertical?.09*H:.13*H, font=Math.round(vertical?W*.042:H*.042);
  const style=`@font-face{font-family:Inter;src:url('assets/kit/fonts/inter-600.woff2')}html,body{margin:0;background:#10141a;width:${inspection?W+'px':'100%'};height:${inspection?H+'px':'100%'};overflow:hidden}#root{position:relative;width:100%;height:100%;overflow:hidden;color:white;font-family:Inter,sans-serif}.clip:not(video):not(audio){position:absolute;inset:0}.scene{position:absolute;inset:0}.photo{position:absolute;left:${x}px;top:${top+font*2}px;width:${right-x}px;height:${captionY-top-font*3}px}.credit{position:absolute;left:${x}px;top:${top}px;width:${right-x}px;font-size:${font*.72}px;height:${font*2}px;overflow:hidden;background:#10141a;padding:6px;box-sizing:border-box}.caption{position:absolute;left:${x}px;top:${captionY}px;width:${right-x}px;height:${captionH}px;display:flex;align-items:center;justify-content:center;text-align:center;box-sizing:border-box;padding:8px 14px;background:#10141a;font-size:${font}px;line-height:1.25;white-space:normal;overflow:hidden}.presenter{position:absolute;left:${x}px;top:${captionY-Math.min(W*.20,H*.22)-20}px;width:${Math.min(W*.20,H*.22)}px;height:${Math.min(W*.20,H*.22)}px;border-radius:50%;object-fit:cover;border:3px solid white}.mode{font-size:${font*.62}px}`;
  const timed=(id,at,duration,track)=>`id="${id}" class="clip" data-start="${at}" data-duration="${duration}" data-track-index="${track}"`;
  const nodes=[];
  for (const s of edit.scenes) {
    const src=sources.get(s.source), pos=s.position||[50,50];
    const label=`${src.attribution} • ${src.date} • ${s.context}`;
    const visual=src.kind==='image'?`<img class="photo" src="${esc(src.file)}" style="object-fit:${s.fit||'contain'};object-position:${pos[0]}% ${pos[1]}%" alt="${esc(s.context)}">`:'';
    nodes.push(`<div ${timed('scene-'+s.id,s.at,s.duration,1)}><div class="scene" id="inner-${s.id}">${visual}<div class="credit">${esc(label)}</div></div></div>`);
    if(src.kind==='video') nodes.push(`<video ${timed('media-'+s.id,s.at,s.duration,2)} src="${esc(src.file)}" data-media-start="${s.in}" muted playsinline data-volume="0" style="left:${x}px;top:${top+font*2}px;width:${right-x}px;height:${captionY-top-font*3}px;position:absolute;object-fit:${s.fit||'contain'};object-position:${pos[0]}% ${pos[1]}%"></video>`);
  }
  if(edit.presenter) {
    const p=edit.presenter;
    nodes.push(`<video ${timed('presenter',p.at,p.duration,3)} src="${esc(sources.get(p.source).file)}" data-media-start="${p.in}" muted playsinline data-volume="0" style="position:absolute;left:${x}px;top:${captionY-Math.min(W*.20,H*.22)-20}px;width:${Math.min(W*.20,H*.22)}px;height:${Math.min(W*.20,H*.22)}px;border-radius:50%;object-fit:cover;border:3px solid white"></video>`);
  }
  captions.forEach((c,i)=>{
    const a=plan.audio.find(a=>a.id===c.segment), mode=a.source==='commentary'?'Commentary':'Source';
    nodes.push(`<div ${timed('caption-'+i,c.start,c.end-c.start,4)}><div id="cap-${i}" class="caption" data-caption="${i}">${esc(c.speaker)} (${mode}): ${esc(c.text)}</div></div>`);
  });
  nodes.push(`<audio id="news-audio" src="assets/news-mix.wav" data-start="0" data-duration="${edit.duration}" data-track-index="0" data-volume="1"></audio>`);
  // Framework owns timed clip/media visibility; only their inner content is animated. Inspector applies media clocks separately.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${style}</style><script src="assets/kit/gsap.min.js"></script></head><body><div id="root" data-composition-id="main" data-width="${W}" data-height="${H}" data-duration="${edit.duration}">${nodes.join('\n')}</div><script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});window.__timelines['main']=tl;window.__vgReady=true;</script></body></html>`;
}

export async function openNewsInspector(job, manifest) {
  const {chromePath}=await import('./native.mjs'), {default:puppeteer}=await import('puppeteer-core');
  const browser=await puppeteer.launch({executablePath:await chromePath(),headless:true,args:['--no-sandbox','--allow-file-access-from-files','--hide-scrollbars']});
  const page=await browser.newPage(); await page.setViewport({width:manifest.width,height:manifest.height,deviceScaleFactor:1});
  await page.goto(pathToFileURL(path.join(job,'review/inspect/index.html')).href,{waitUntil:'load'});
  await page.evaluate(()=>document.fonts.ready);
  const seek=async t=>page.evaluate(async time=>{
    window.__timelines.main.seek(time,false);
    for(const el of document.querySelectorAll('.clip')) {
      const at=Number(el.dataset.start),end=at+Number(el.dataset.duration), active=time>=at&&time<end;
      el.style.visibility=active?'visible':'hidden';
      if(active&&el.tagName==='VIDEO') {
        const target=time-at+Number(el.dataset.mediaStart||0);
        if(el.readyState<2) await new Promise(resolve=>el.addEventListener('loadeddata',resolve,{once:true}));
        if(Math.abs(el.currentTime-target)>.001) await new Promise(resolve=>{el.addEventListener('seeked',resolve,{once:true});el.currentTime=target;});
      }
    }
    return [...document.querySelectorAll('[data-caption]')].filter(e=>getComputedStyle(e.parentElement).visibility==='visible').map(e=>({id:e.dataset.caption,text:e.textContent,box:[e.offsetLeft,e.offsetTop,e.offsetWidth,e.offsetHeight],overflow:e.scrollHeight>e.clientHeight||e.scrollWidth>e.clientWidth}));
  },t);
  return {page,browser,seek,log:async()=>[],conflicts:async()=>[],consoleErrors:[],screenshot:async(t,f)=>{await seek(t);await mkdir(path.dirname(f),{recursive:true});await page.screenshot({path:f});},close:()=>browser.close()};
}

export async function buildNews(job, {print=true}={}) {
  const plan=await newsPlan(job),{edit,manifest}=plan;
  for(const d of ['review/inspect','renders','assets','compositions']) await mkdir(path.join(job,d),{recursive:true});
  await installRuntime(job);
  manifest.commentaryDuration=Number((await probe(path.join(job,'assets/narration.wav'))).format.duration);
  manifest.duration=edit.duration;
  await save(path.join(job,'job.json'),manifest);
  await newsMix(job,plan);
  await writeFile(path.join(job,'index.html'),newsHTML(plan));
  await writeFile(path.join(job,'review/inspect/index.html'),newsHTML(plan,{inspection:true}).replace('<head>','<head><base href="../../">'));
  const timing={duration:edit.duration,missing:[],scenes:edit.scenes.map(s=>({id:s.id,start:s.at,end:s.at+s.duration,duration:s.duration,kind:'html',beats:[]}))};
  const film={title:edit.title,concept:'Actual sources with original commentary and mandatory subtitles',theme:{bg:'#10141a'},scenes:edit.scenes.map(s=>({id:s.id,kind:'html',file:'index.html',idea:s.context,evidence:s.claims}))};
  await save(path.join(job,'film.json'),film); await save(path.join(job,'timing.json'),timing);
  await save(path.join(job,'assets/media-plan.json'),{objects:[],moves:[],sounds:[],theme:film.theme});
  await save(path.join(job,'assets/news-captions.json'),plan.captions);
  const srt=plan.captions.map((c,i)=>`${i+1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.speaker}: ${c.text}\n`).join('\n');
  await writeFile(path.join(job,'assets/subtitles.srt'),srt);
  await writeFile(path.join(job,'renders/subtitles.srt'),srt);
  await writeFile(path.join(job,'STORYBOARD.md'),`# ${edit.title}\n\nReal sources, original commentary, subtitles.\n\n`+edit.scenes.map(s=>`## ${s.id} (${s.at}–${s.at+s.duration})\n${s.context}\n${s.treatment}\nClaims: ${s.claims.join(', ')}\n`).join('\n'));
  await writeFile(path.join(job,'review/motion.md'),`# News edit\n\n`+edit.scenes.map(s=>`${s.at}–${s.at+s.duration}: ${s.id}; ${s.source}; source in ${s.in||0}; ${s.context}`).join('\n')+'\n\n'+plan.captions.map(c=>`${c.start.toFixed(3)}–${c.end.toFixed(3)} ${c.speaker}: ${c.text}`).join('\n'));
  await writeFile(path.join(job,'review/sounds.md'),'# News soundtrack\n\nOriginal commentary and retained source speech, separate non-overlapping tracks; no synthetic source speech. See news.json and news-sources.json.\n');
  const errors=[],ins=await openNewsInspector(job,manifest);
  try {
    for(const [i,c] of plan.captions.entries()) {
      const boxes=await ins.seek((c.start+c.end)/2), b=boxes.find(b=>b.id===String(i));
      if(!b || b.overflow) errors.push(`Subtitle ${i+1} missing or overflowing; shorten caption grouping/speaker label.`);
    }
    for(const scene of edit.scenes) {
      await ins.seek(scene.at+scene.duration/2);
      const overflow=await ins.page.evaluate(id=>{const e=document.querySelector('#inner-'+id+' .credit');return !e||e.scrollHeight>e.clientHeight||e.scrollWidth>e.clientWidth;},scene.id);
      if(overflow) errors.push(`${scene.id}: source attribution/context exceeds its rail; abbreviate the on-screen context while preserving the full ledger.`);
    }
  } finally {await ins.close();}
  const lint=await lintJob(job,film);errors.push(...lint.errors,...lint.pipeline);
  const report={scenes:Object.fromEntries(timing.scenes.map(s=>[s.id,{source:edit.scenes.find(e=>e.id===s.id).source}]))};
  await save(path.join(job,'review/inspect.json'),{ok:!errors.length,errors,report});
  const result={ok:!errors.length,scope:'all',missing:[],errors,warnings:lint.warnings,report,sourceHash:await sourceFingerprint(job)};
  await save(path.join(job,'review/build.json'),result);
  if(print) console.log(`News build ${result.ok?'OK':'FAILED'}: ${edit.scenes.length} real-media scenes, ${plan.captions.length} required subtitle cues. ${errors.join('; ')}`);
  return result;
}

/** Encoded mix fidelity plus per-cue raster comparisons checks captions in the actual MP4. */
export async function verifyNews(job) {
  const sourceHash=await sourceFingerprint(job);
  const plan=await newsPlan(job), m=await json(path.join(job,'job.json')), file=await localFile(job,'renders/video.mp4');
  const meta=await probe(file), video=meta.streams.find(s=>s.codec_type==='video'), audio=meta.streams.find(s=>s.codec_type==='audio');
  if(!video||!audio||video.width!==m.width||video.height!==m.height||Math.abs(Number(meta.format.duration)-plan.edit.duration)>.12||Math.abs(Number(audio.duration)-plan.edit.duration)>.15||Math.abs(video.avg_frame_rate.split('/').reduce((a,b)=>Number(a)/Number(b))-m.fps)>.01) fail('encoded dimensions, duration, fps or audio differ from the news timeline.');
  const reference=await localFile(job,'assets/news-mix.wav');
  const integrity=await compareNarration(file,reference);
  if(!integrity.ok) fail('encoded audio does not match all retained speech and commentary.');
  const expected=plan.captions;
  const srt=expected.map((c,i)=>`${i+1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.speaker}: ${c.text}\n`).join('\n');
  if(await readFile(path.join(job,'assets/subtitles.srt'),'utf8')!==srt || await readFile(path.join(job,'renders/subtitles.srt'),'utf8')!==srt) fail('subtitle sidecar is missing or stale; rebuild.');
  if(JSON.stringify(await json(path.join(job,'assets/news-captions.json')))!==JSON.stringify(expected)) fail('caption timing/content is stale; rebuild.');
  await mkdir(path.join(job,'review/news-verification'),{recursive:true});
  const inspector=await openNewsInspector(job,m), samples=[];
  try {
    const checks=[];
    for(const [i,c] of expected.entries()) {
      const frame=1/m.fps, mid=Math.ceil((c.start+c.end)/2*m.fps)/m.fps;
      if(mid>=c.end) fail(`subtitle ${i+1} is too short to appear at ${m.fps}fps.`);
      const times=new Set([mid,Math.ceil((c.start+.001)*m.fps)/m.fps,Math.floor((c.end-.001)*m.fps)/m.fps,Math.max(0,Math.floor((c.start-.001)*m.fps)/m.fps),Math.min(plan.edit.duration-frame,Math.ceil((c.end+.001)*m.fps)/m.fps)]);
      for(const at of times) checks.push({cue:i,start:c.start,end:c.end,at,region:'subtitles'});
    }
    for(const scene of plan.edit.scenes) checks.push({scene:scene.id,at:Math.floor((scene.at+scene.duration/2)*m.fps)/m.fps,region:'media'});
    for(const [i,check] of checks.entries()) {
      const ref=path.join(job,`review/news-verification/expected-${i}.png`);
      await inspector.screenshot(check.at,ref);
      const W=m.width,H=m.height,vertical=H>W;
      const x=Math.round((vertical?.06:.05)*W),w=Math.round((vertical?.81:.90)*W);
      const y=check.region==='subtitles'?Math.round((vertical?.70:.80)*H):Math.round((vertical?.12:.06)*H+Math.round(vertical?W*.042:H*.042)*2);
      const h=check.region==='subtitles'?Math.round((vertical?.09:.13)*H):Math.round((vertical?.70:.80)*H-y-Math.round(vertical?W*.042:H*.042));
      const decoded=path.join(job,`review/news-verification/decoded-${i}.png`);
      await ff(['-ss',String(check.at),'-i',file,'-frames:v','1',decoded]);
      const stats=path.join(job,`review/news-verification/ssim-${i}.txt`);
      await ff(['-i',ref,'-i',decoded,'-filter_complex',`[0:v]crop=${w}:${h}:${x}:${y},format=yuv420p[a];[1:v]crop=${w}:${h}:${x}:${y},format=yuv420p[b];[a][b]ssim=stats_file=${stats}`,'-frames:v','1','-f','null','-']);
      const similarity=Number((await readFile(stats,'utf8')).match(/All:([\d.]+)/)?.[1]);
      if(!Number.isFinite(similarity)||similarity<(check.region==='media'?.90:.94)) fail(`${check.region} ${check.cue??check.scene} at ${check.at}s: encoded raster differs from reviewed source/caption (${similarity}); inspect ${decoded}.`);
      samples.push({...check,ssim:similarity});
    }
  } finally {await inspector.close();}
  if(sourceHash!==await sourceFingerprint(job)) fail('sources changed during verification; verify again after rebuilding/reviewing.');
  const report={ok:true,width:m.width,height:m.height,fps:m.fps,sha256:await fileHash(file),sourceHash,duration:plan.edit.duration,narrationIntegrity:integrity,subtitles:{required:true,cues:expected.length,samples},limitations:['Raster and signal checks cannot judge transcription accuracy, rights validity or editorial context; independent review and human listening remain required.']};
  await save(path.join(job,'review/news-verification.json'),report);
  await save(path.join(job,'review/render-verification.json'),report);
  return report;
}

export async function requireNewsDelivery(job) {
  if(!isNews(readPersonality(job))) return;
  await newsPlan(job);
  const report=await json(path.join(job,'review/news-verification.json')).catch(()=>null);
  if(!report?.ok||!report.subtitles?.required||!report.subtitles.cues||report.sha256!==await fileHash(await localFile(job,'renders/video.mp4'))||report.sourceHash!==await sourceFingerprint(job)) fail('delivery requires current encoded audio/subtitle verification; run verify after render.');
}

export async function muxNews(job) {
  await ff(['-i',path.join(job,'renders/picture.mp4'),'-i',path.join(job,'assets/news-mix.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-movflags','+faststart',path.join(job,'renders/video.mp4')]);
}
