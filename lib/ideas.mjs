// Finds video ideas: pulls public feeds, groups items about the same thing, scores them and writes idea cards.
// Every run returns ideas that have not been shown before. State lives in .video/ideas/ (ignored by Git).
import {readFile, writeFile, mkdir, readdir, rename} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';

const HOUR = 3600e3, DAY = 24 * HOUR;
const USER_AGENT = 'video-gen-ideas/1.0 (local research tool)';
export const STATUSES = ['new', 'saved', 'rejected', 'used'];

export const DEFAULT_PROFILE = {
  niche: 'Local AI: running models on your own hardware',
  keywords: ['llm', 'local', 'gpu', 'vram', 'inference', 'quantization', 'quant', 'gguf', 'llama.cpp', 'ollama', 'mlx',
    'mac', 'apple', 'nvidia', 'amd', 'cuda', 'open source', 'open-source', 'open weights', 'model', 'agent', 'coding',
    'qwen', 'deepseek', 'kimi', 'glm', 'gemma', 'mistral', 'llama', 'claude', 'gpt', 'tokens/s', 'kv cache', 'context'],
  sources: {
    huggingface: {pipelineTags: ['text-generation', 'image-text-to-text', 'any-to-any'], limit: 60},
    papers: {limit: 50},
    reddit: {subreddits: ['LocalLLaMA']},
    hackernews: {queries: ['llm', 'local ai', 'gpu inference'], minPoints: 60},
    github: {queries: ['llm inference', 'local llm', 'llama.cpp'], minStars: 40},
    youtube: {channels: [{id: 'UCgUfJoPtkt7-RiiuYh4vmGA', name: 'Kai'}], minMultiple: 2},
  },
  maxAgeDays: 30,
  batchSize: 6,
};

// ---------- small helpers ----------
const compact = text => String(text || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const words = text => String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9.+/-]*/g) || [];
const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const decode = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#x27;/g, "'").replace(/&#32;/g, ' ').replace(/&amp;/g, '&');
const ageDays = (at, now) => at ? Math.max(0, (now - Date.parse(at)) / DAY) : null;
const hasTerm = (text, term) => new RegExp(`(^|[^a-z0-9])${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(` ${String(text || '').toLowerCase()} `);
const matchesAny = (text, terms) => terms.some(term => hasTerm(text, term));
// Words like "model" or "local" appear everywhere ("local navigation"), so they only count alongside a specific term.
const GENERIC = new Set(['model', 'agent', 'local', 'context', 'coding', 'open source', 'open-source', 'apple', 'mac']);
export function relevance(text, keywords) {
  const hits = keywords.filter(k => hasTerm(text, k));
  return hits.some(k => !GENERIC.has(k)) ? hits.length : 0;
}
// Cards are written in English; skip items whose text is mostly another script.
const mostlyLatin = text => { const letters = String(text).match(/\p{L}/gu) || []; return !letters.length || letters.filter(c => /[a-z]/i.test(c)).length / letters.length > 0.7; };
// Rank within one source: the top item gets 1, the bottom approaches 0.
function percentile(items, value) {
  const sorted = [...items].sort((a, b) => value(b) - value(a));
  sorted.forEach((item, i) => { item.momentum = sorted.length === 1 ? 1 : 1 - i / sorted.length; });
  return items;
}

// ---------- parsers (pure; tested with fixtures) ----------
const MODEL_SUFFIX = /(-(gguf|instruct|it|chat|fp8|fp16|bf16|awq|gptq|mlx|\d+bit|hf|base|preview|\d{4}))+$/i;
export function modelName(id) {
  return String(id).split('/').pop().replace(MODEL_SUFFIX, '').replace(/[-_]+/g, ' ').trim();
}
// Parameter count: the name ("74B A9B" → 74B total) is the most reliable. Hugging Face's safetensors count is only trusted for
// unquantized float weights; packed integer weights (int4 in I32/I8) make it meaningless.
export function modelParams(m) {
  const named = String(m.id).split('/').pop().match(/(?:^|[-_ ])(\d+(?:\.\d+)?)B(?=$|[-_ ])/i);
  if (named) return Number(named[1]) * 1e9;
  const dtypes = Object.keys(m.safetensors?.parameters || {});
  return dtypes.length && dtypes.every(d => /^(BF16|F16|F32|F8_E4M3|F8_E5M2)$/.test(d)) ? m.safetensors.total : null;
}
export function parseHuggingFace(list, profile) {
  const tags = profile.sources.huggingface.pipelineTags;
  return (Array.isArray(list) ? list : []).filter(m => tags.includes(m.pipeline_tag) || (m.tags || []).some(t => tags.includes(t))).map(m => ({
    source: 'huggingface', kind: 'model', id: `hf:${m.id}`, title: modelName(m.id), url: `https://huggingface.co/${m.id}`,
    at: m.createdAt, key: compact(modelName(m.id)), metric: {label: 'trending score', value: m.trendingScore ?? 0},
    params: modelParams(m), text: `${m.id} ${(m.tags || []).join(' ')}`, relevant: true,
  }));
}
export function parsePapers(list) {
  return (Array.isArray(list) ? list : []).map(p => ({
    source: 'papers', kind: 'paper', id: `paper:${p.paper?.id}`, title: p.paper?.title || p.title, url: `https://huggingface.co/papers/${p.paper?.id}`,
    at: p.publishedAt || p.paper?.publishedAt, metric: {label: 'upvotes', value: p.paper?.upvotes ?? 0},
    text: `${p.paper?.title || ''} ${p.paper?.summary || p.summary || ''}`,
  })).filter(p => p.title && p.url);
}
// Reddit's JSON API needs OAuth now; its RSS feeds still answer. They hold no vote counts, so rank stands in for score.
export function parseRedditRss(xml, subreddit) {
  return [...String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry], rank) => {
    const get = tag => decode((entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || '');
    const link = decode((entry.match(/<link href="([^"]+)"/) || [])[1] || '');
    const content = get('content').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/submitted by.*$/, '').trim();
    return {source: 'reddit', kind: 'discussion', id: `reddit:${get('id')}`, title: get('title'), url: link, at: get('published') || get('updated'),
      metric: {label: `rank in r/${subreddit} this week`, value: -rank}, rank: rank + 1, text: `${get('title')} ${content}`, relevant: true};
  }).filter(p => p.title && p.url);
}
export function parseHackerNews(result, minPoints) {
  return (result?.hits || []).filter(h => h.title && (h.points || 0) >= minPoints).map(h => ({
    source: 'hackernews', kind: 'discussion', id: `hn:${h.objectID}`, title: h.title, url: `https://news.ycombinator.com/item?id=${h.objectID}`,
    link: h.url || null, at: h.created_at, metric: {label: 'points', value: h.points || 0}, comments: h.num_comments || 0, text: h.title,
  }));
}
export function parseGitHub(result, minStars) {
  return (result?.items || []).filter(r => (r.stargazers_count || 0) >= minStars).map(r => ({
    source: 'github', kind: 'repo', id: `gh:${r.full_name}`, title: r.name, url: r.html_url, at: r.created_at,
    key: compact(r.name), metric: {label: 'stars', value: r.stargazers_count}, description: r.description || '',
    text: `${r.full_name} ${r.description || ''} ${(r.topics || []).join(' ')}`,
  }));
}
const AGE_UNITS = {second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365};
// A channel's Videos tab carries each recent upload's views and rough age; no API key needed.
export function parseChannelPage(html) {
  const s = String(html), channel = decode((s.match(/"channelMetadataRenderer":\{"title":"((?:[^"\\]|\\.)*)"/) || [])[1] || '');
  const videos = s.split('"lockupViewModel":{').slice(1).map(seg => {
    const id = (seg.match(/"contentId":"([\w-]{11})"/) || [])[1];
    const title = (seg.match(/"lockupMetadataViewModel":\{"title":\{"content":"((?:[^"\\]|\\.)*)"/) || [])[1];
    const views = seg.match(/"accessibilityLabel":"([\d.,]+) (thousand |million |billion )?views?"/);
    const age = seg.match(/"accessibilityLabel":"(\d+) (second|minute|hour|day|week|month|year)s? ago"/);
    if (!id || !title || !views) return null;
    const scale = {'thousand ': 1e3, 'million ': 1e6, 'billion ': 1e9}[views[2]] || 1;
    return {id, title: JSON.parse(`"${title}"`), views: Math.round(Number(views[1].replace(/,/g, '')) * scale),
      ageDays: age ? Number(age[1]) * AGE_UNITS[age[2]] : null};
  }).filter(Boolean);
  return {channel, videos};
}
// Views divided by the channel's median: 2x or more marks a topic that pulled far beyond the channel's usual audience.
export function outliers({channel, videos}, {minMultiple, maxAgeDays, channelId, now}) {
  if (videos.length < 5) return [];
  const sorted = videos.map(v => v.views).sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)] || 1;
  return videos.filter(v => v.views / median >= minMultiple && (v.ageDays == null || v.ageDays <= maxAgeDays)).map(v => ({
    source: 'youtube', kind: 'proven', id: `yt:${v.id}`, title: v.title, url: `https://www.youtube.com/watch?v=${v.id}`,
    at: v.at || (v.ageDays != null ? new Date(now - v.ageDays * DAY).toISOString() : null), channel, channelId,
    multiple: Number((v.views / median).toFixed(1)), views: v.views, median,
    metric: {label: `× ${channel}'s median views`, value: Number((v.views / median).toFixed(1))}, text: v.title, relevant: true,
  }));
}

// ---------- fetching ----------
async function cachedFetch(url, {cacheDir, refresh, ttl = 3 * HOUR, fetchText, headers = {}}) {
  const file = path.join(cacheDir, createHash('sha1').update(url).digest('hex') + '.json');
  if (!refresh) {
    const hit = await readFile(file, 'utf8').then(JSON.parse).catch(() => null);
    if (hit && Date.now() - hit.fetchedAt < ttl) return {body: hit.body, cached: true};
  }
  const body = await fetchText(url, headers);
  await mkdir(cacheDir, {recursive: true});
  await writeFile(file, JSON.stringify({url, fetchedAt: Date.now(), body}));
  return {body, cached: false};
}
export async function defaultFetchText(url, headers = {}) {
  const response = await fetch(url, {headers: {'User-Agent': USER_AGENT, 'Accept-Language': 'en-US', ...headers}, signal: AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
const enc = encodeURIComponent;

// One entry per source: what was asked, and whether it worked. A failing source never stops the run.
function sourcePlan(profile, focus, {now, youtubeKey}) {
  const s = profile.sources, since = new Date(now - profile.maxAgeDays * DAY).toISOString().slice(0, 10), plans = [];
  const hfFields = ['trendingScore', 'downloads', 'likes', 'createdAt', 'pipeline_tag', 'safetensors', 'tags'].map(f => `expand[]=${f}`).join('&');
  if (s.huggingface) plans.push({name: 'Hugging Face trending models', url: `https://huggingface.co/api/models?sort=trendingScore&limit=${s.huggingface.limit}&${hfFields}`,
    parse: body => parseHuggingFace(JSON.parse(body), profile)});
  if (s.papers) plans.push({name: 'Hugging Face daily papers', url: `https://huggingface.co/api/daily_papers?limit=${s.papers.limit}`, parse: body => parsePapers(JSON.parse(body))});
  for (const sub of s.reddit?.subreddits || []) plans.push({name: `r/${sub} top this week`, url: `https://www.reddit.com/r/${enc(sub)}/top/.rss?t=week&limit=50`, parse: body => parseRedditRss(body, sub)});
  const hnSince = Math.floor((now - profile.maxAgeDays * DAY) / 1000);
  for (const q of s.hackernews?.queries || []) plans.push({name: `Hacker News “${q}”`, url: `https://hn.algolia.com/api/v1/search?query=${enc(q)}&tags=story&hitsPerPage=50&numericFilters=${enc(`created_at_i>${hnSince}`)}`,
    parse: body => parseHackerNews(JSON.parse(body), s.hackernews.minPoints)});
  for (const q of s.github?.queries || []) plans.push({name: `GitHub new repos “${q}”`, url: `https://api.github.com/search/repositories?q=${enc(`${q} created:>${since}`)}&sort=stars&per_page=30`,
    headers: {Accept: 'application/vnd.github+json'}, parse: body => parseGitHub(JSON.parse(body), s.github.minStars)});
  for (const channel of s.youtube?.channels || []) plans.push(youtubePlan(channel, profile, {now, youtubeKey}));
  if (focus) {
    // A focused request also searches for it directly, so "more about X" finds items the general feeds missed.
    const f = enc(focus), sub = s.reddit?.subreddits?.[0];
    plans.push({name: `Hugging Face search “${focus}”`, focus: true, url: `https://huggingface.co/api/models?search=${f}&sort=trendingScore&limit=30&${hfFields}`, parse: body => parseHuggingFace(JSON.parse(body), profile)});
    if (sub) plans.push({name: `r/${sub} search “${focus}”`, focus: true, url: `https://www.reddit.com/r/${enc(sub)}/search.rss?q=${f}&restrict_sr=1&sort=top&t=month`, parse: body => parseRedditRss(body, sub).map(i => ({...i, relevant: true}))});
    plans.push({name: `Hacker News “${focus}”`, focus: true, url: `https://hn.algolia.com/api/v1/search?query=${f}&tags=story&hitsPerPage=40&numericFilters=${enc(`created_at_i>${hnSince}`)}`, parse: body => parseHackerNews(JSON.parse(body), Math.min(20, s.hackernews?.minPoints ?? 20))});
    plans.push({name: `GitHub “${focus}”`, focus: true, url: `https://api.github.com/search/repositories?q=${enc(`${focus} created:>${since}`)}&sort=stars&per_page=30`, headers: {Accept: 'application/vnd.github+json'}, parse: body => parseGitHub(JSON.parse(body), Math.min(10, s.github?.minStars ?? 10))});
  }
  return plans;
}
function youtubePlan(channel, profile, {now, youtubeKey}) {
  const options = {minMultiple: profile.sources.youtube.minMultiple, maxAgeDays: profile.maxAgeDays, channelId: channel.id, now};
  if (!youtubeKey) return {name: `YouTube outliers · ${channel.name || channel.id}`, url: `https://www.youtube.com/channel/${enc(channel.id)}/videos`,
    parse: body => outliers(parseChannelPage(body), options)};
  // With an API key: the uploads playlist (1 unit) and one videos.list call for 30 videos (1 unit). search.list (100 units) is never used.
  return {name: `YouTube outliers · ${channel.name || channel.id}`, url: `youtube-api:${channel.id}`, youtube: true, async load(get) {
    const api = (endpoint, query) => get(`https://www.googleapis.com/youtube/v3/${endpoint}?${query}&key=${enc(youtubeKey)}`);
    const uploads = 'UU' + channel.id.slice(2);
    const items = JSON.parse(await api('playlistItems', `part=contentDetails&maxResults=30&playlistId=${uploads}`)).items || [];
    const details = JSON.parse(await api('videos', `part=snippet,statistics&id=${items.map(i => i.contentDetails.videoId).join(',')}`)).items || [];
    return outliers({channel: details[0]?.snippet?.channelTitle || channel.name || channel.id, videos: details.map(v => ({
      id: v.id, title: v.snippet.title, views: Number(v.statistics.viewCount || 0), at: v.snippet.publishedAt, ageDays: ageDays(v.snippet.publishedAt, now)}))}, options);
  }};
}

export async function collect(profile, {focus = '', refresh = false, cacheDir, fetchText = defaultFetchText, now = Date.now(), youtubeKey = process.env.YOUTUBE_API_KEY} = {}) {
  const items = [], sources = [], ids = new Set();
  for (const plan of sourcePlan(profile, focus, {now, youtubeKey})) {
    const started = Date.now();
    try {
      let cached = false, found;
      const get = async url => { const r = await cachedFetch(url, {cacheDir, refresh: refresh || plan.focus, fetchText, headers: plan.headers}); cached ||= r.cached; return r.body; };
      found = plan.load ? await plan.load(get) : plan.parse(await get(plan.url));
      found = found.filter(i => !ids.has(i.id) && ids.add(i.id));
      items.push(...found);
      sources.push({name: plan.name, ok: true, count: found.length, cached, ms: Date.now() - started});
    } catch (error) {
      sources.push({name: plan.name, ok: false, count: 0, error: String(error.message || error).replace(/key=[^&\s]+/g, 'key=…').slice(0, 200), ms: Date.now() - started});
    }
  }
  return {items, sources};
}

// ---------- grouping and scoring ----------
// Kai's numbers: questions about the viewer's own machine and money outperform; industry finance and drama underperform.
const FIT_UP = ['vram', 'gpu', 'mac', 'mini', 'ram', 'laptop', 'cost', 'price', 'cheap', 'free', 'buy', 'faster', 'speed', 'fast', 'tokens/s',
  'locally', 'local', 'hardware', 'replace', 'subscription', 'run', 'runs', 'running', 'enough', 'beats', 'vs', 'benchmark', '8gb', '12gb', '16gb', '24gb', '32gb', '64gb', '128gb'];
const FIT_DOWN = ['lease', 'debt', 'billion', 'lawsuit', 'sued', 'stock', 'ipo', 'valuation', 'revenue', 'ceo', 'politics', 'senate', 'layoffs', 'funding', 'acquires', 'hiring'];
const STOP = new Set(['the', 'and', 'for', 'with', 'about', 'more', 'ideas', 'idea', 'video', 'videos', 'some', 'that', 'this', 'what', 'how', 'why', 'new', 'give', 'want', 'make', 'like']);
export const focusTerms = focus => [...new Set(words(focus).filter(w => w.length >= 3 && !STOP.has(w)))];

function viewerFit(text, kind, params) {
  const w = new Set(words(text)), up = FIT_UP.filter(t => w.has(t)).length, down = FIT_DOWN.filter(t => w.has(t)).length;
  return clamp(0.4 + Math.min(up, 3) * 0.12 - down * 0.2 + (kind === 'model' && params ? 0.2 : 0) + (kind === 'proven' ? 0.15 : 0));
}

// Group items about the same model or repo: an r/LocalLLaMA thread naming a trending model becomes evidence for that model's card.
export function group(items) {
  const anchors = new Map();
  for (const item of items.filter(i => (i.kind === 'model' || i.kind === 'repo') && (i.key || '').length >= 5)) {
    const existing = anchors.get(item.key);
    if (!existing) anchors.set(item.key, {key: item.key, lead: item, items: [item]});
    else { existing.items.push(item); if ((item.momentum || 0) > (existing.lead.momentum || 0)) existing.lead = item; }
  }
  const clusters = [...anchors.values()];
  for (const item of items.filter(i => i.kind !== 'model' && i.kind !== 'repo')) {
    const text = compact(item.title);
    const anchor = [...anchors.values()].filter(a => text.includes(a.key)).sort((a, b) => b.key.length - a.key.length)[0];
    if (anchor) anchor.items.push(item); else clusters.push({key: compact(item.title).slice(0, 60) || item.id, lead: item, items: [item]});
  }
  return clusters;
}

const TIERS = [8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 512, 768, 1024];
// Rough memory for 4-bit weights (about 0.56 bytes per parameter with overhead), before context. Labelled as an estimate on the card.
export function memoryEstimate(params) {
  if (!params) return null;
  const billions = params / 1e9, gb = Math.ceil(billions * 0.56);
  return {billions: billions >= 10 ? Math.round(billions) : Number(billions.toFixed(1)), gb, tier: TIERS.find(t => t >= gb) || null};
}
const shorten = (text, n) => text.length > n ? text.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : text;
export function angle(cluster) {
  const lead = cluster.lead, name = lead.title;
  if (lead.kind === 'model') {
    const m = memoryEstimate(cluster.items.find(i => i.params)?.params);
    if (m && m.gb <= 24) return {form: 'Is my machine enough?', title: `Can ${name} run on a ${m.tier}GB GPU?`,
      promise: `About ${m.billions}B parameters means roughly ${m.gb} GB at 4-bit before context (estimate). Test where it fits, how fast it runs and what you give up.`};
    if (m) return {form: 'What does it cost me?', title: `What would it cost to run ${name} locally?`,
      promise: `About ${m.billions}B parameters means roughly ${m.gb} GB at 4-bit before context (estimate). Price the cheapest builds that hold it, and the speed each one gets.`};
    return {form: 'Is it worth it?', title: `${name}: is it worth running locally?`, promise: `${name} is trending on Hugging Face. Check what it needs, how it compares with what people run now, and who should switch.`};
  }
  if (lead.kind === 'repo') {
    const fast = /fast|speed|accelerat|throughput|latency|\d+x/i.test(lead.description || '');
    return {form: fast ? 'Does it make my setup faster?' : 'Explainer', title: fast ? `${name}: does it actually make local AI faster?` : `${name} explained: what it does and who needs it`,
      promise: lead.description ? `“${shorten(lead.description, 160)}” Test the claim on ordinary hardware and explain how it works.` : 'A new repository climbing fast. Explain what it does and test it.'};
  }
  if (lead.kind === 'proven') return {form: 'Proven question', title: lead.title,
    promise: `This did ${lead.multiple}× ${lead.channel}’s usual views. Make our own version with a different angle or newer evidence; do not copy it.`};
  if (lead.kind === 'paper') return {form: 'What does this research change?', title: shorten(lead.title, 110),
    promise: 'A paper people are upvoting. Explain the mechanism in plain terms and what it means for ordinary hardware, without overclaiming.'};
  return {form: /\?\s*$/.test(lead.title) ? 'Persistent question' : 'What people are talking about', title: lead.title,
    promise: `People are discussing this on ${lead.source === 'reddit' ? 'r/LocalLLaMA' : 'Hacker News'}. Answer it properly, with evidence, for someone deciding what to run or buy.`};
}

export function score(cluster, {now, focus = []}) {
  const items = cluster.items, lead = cluster.lead, text = items.map(i => `${i.title} ${i.text || ''}`).join(' ');
  const momentum = Math.max(...items.map(i => i.kind === 'proven' ? clamp(Math.log2(i.multiple) / 4) : i.momentum || 0));
  const fit = viewerFit(text, lead.kind, items.find(i => i.params)?.params);
  const fresh = Math.max(...items.map(i => { const d = ageDays(i.at, now); return d == null ? 0.5 : Math.exp(-d / 7); }));
  const sources = new Set(items.map(i => i.source)).size, cross = clamp((sources - 1) / 2);
  const evidence = items.some(i => ['model', 'repo', 'paper'].includes(i.kind)) ? 1 : lead.kind === 'proven' ? 0.7 : 0.4;
  const hits = focus.filter(t => matchesAny(text, [t])).length, focusMatch = focus.length ? hits / focus.length : 0;
  const total = 0.3 * momentum + 0.3 * fit + 0.15 * fresh + 0.1 * cross + 0.15 * evidence + 0.3 * focusMatch;
  const reasons = [];
  if (lead.kind === 'proven') reasons.push(`${lead.multiple}× ${lead.channel}’s median views (${lead.views.toLocaleString('en-US')} vs ${lead.median.toLocaleString('en-US')})`);
  else if (momentum >= 0.75) reasons.push(`Near the top of ${lead.source === 'huggingface' ? 'Hugging Face trending' : lead.source === 'github' ? 'new GitHub repos' : lead.source === 'papers' ? 'daily papers' : lead.source === 'reddit' ? 'r/LocalLLaMA this week' : 'Hacker News'}`);
  if (sources > 1) reasons.push(`Showing up in ${sources} places: ${[...new Set(items.map(i => SOURCE_LABEL[i.source]))].join(', ')}`);
  if (fit >= 0.7) reasons.push('About the viewer’s own hardware or money, the kind of question that did best for Kai');
  if (fit <= 0.3) reasons.push('Industry or finance angle; these underperformed for Kai');
  if (fresh >= 0.6) reasons.push('Fresh: from the last few days');
  if (focusMatch) reasons.push(`Matches your request (${focus.filter(t => matchesAny(text, [t])).join(', ')})`);
  return {total: Number(total.toFixed(3)), parts: {momentum: +momentum.toFixed(2), viewerFit: +fit.toFixed(2), freshness: +fresh.toFixed(2), crossSource: +cross.toFixed(2), evidence, focus: +focusMatch.toFixed(2)}, reasons, focusMatch};
}
export const SOURCE_LABEL = {huggingface: 'Hugging Face', papers: 'HF papers', reddit: 'Reddit', hackernews: 'Hacker News', github: 'GitHub', youtube: 'YouTube'};

function card(cluster, scored, batch, now) {
  const a = angle(cluster);
  const sources = cluster.items.sort((x, y) => (y.momentum || 0) - (x.momentum || 0)).slice(0, 6).map(i => ({
    source: i.source, label: SOURCE_LABEL[i.source], title: i.title, url: i.url, ...(i.link ? {link: i.link} : {}), at: i.at || null,
    metric: !i.metric ? '' : i.source === 'reddit' ? `#${i.rank} ${i.metric.label}` : `${Number(i.metric.value).toLocaleString('en-US')} ${i.metric.label}`}));
  return {id: randomUUID().slice(0, 8), key: cluster.key, batch, createdAt: new Date(now).toISOString(), status: 'new',
    kind: cluster.lead.kind, form: a.form, title: a.title, promise: a.promise, subject: cluster.lead.title,
    score: scored.total, scoreParts: scored.parts, reasons: scored.reasons, sources};
}

// Pick the best, but keep the batch varied: at most two cards of one kind (one paper) until the others run out.
// Papers rarely make the kind of video that did well for Kai, so they get one slot.
export function pick(cards, n) {
  const chosen = [], perKind = {}, cap = kind => kind === 'paper' ? 1 : 2;
  for (const c of cards) if (chosen.length < n && (perKind[c.kind] || 0) < cap(c.kind)) { chosen.push(c); perKind[c.kind] = (perKind[c.kind] || 0) + 1; }
  for (const c of cards) if (chosen.length < n && !chosen.includes(c)) chosen.push(c);
  return chosen.sort((a, b) => b.score - a.score);
}

// ---------- state ----------
const stateDir = root => path.join(root, '.video/ideas');
export async function loadProfile(root) {
  const custom = await readFile(path.join(root, 'ideas.config.json'), 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return {};
    throw new Error(`ideas.config.json is not valid JSON: ${error.message}`);
  });
  const {_help, ...rest} = custom;
  // A sources block replaces the default one, so leaving a source out switches it off.
  return {...DEFAULT_PROFILE, ...rest, sources: rest.sources || DEFAULT_PROFILE.sources};
}
export async function loadIdeas(root) {
  return readFile(path.join(stateDir(root), 'ideas.json'), 'utf8').then(JSON.parse).catch(() => ({version: 1, cards: [], runs: []}));
}
async function saveIdeas(root, data) {
  await mkdir(stateDir(root), {recursive: true});
  const file = path.join(stateDir(root), 'ideas.json'), temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n'); await rename(temp, file);
}
// Names of videos already made or started, so a card never proposes one of them again.
async function madeKeys(root) {
  const names = [];
  for (const dir of ['jobs', 'jobs/scripts']) names.push(...await readdir(path.join(root, dir)).catch(() => []));
  return names.map(compact).filter(k => k.length >= 5);
}

// Runs one batch. Only ideas never shown before are eligible, so calling this again always means "more".
export async function findIdeas(root, {focus = '', count, refresh = false, fetchText, now = Date.now(), youtubeKey} = {}) {
  const profile = await loadProfile(root), data = await loadIdeas(root), n = Number(count) || profile.batchSize;
  const terms = focusTerms(focus);
  const {items, sources} = await collect(profile, {focus: terms.join(' '), refresh, cacheDir: path.join(stateDir(root), 'cache'), fetchText, now, youtubeKey});
  const fresh = items.filter(i => { const d = ageDays(i.at, now); return d == null || d <= profile.maxAgeDays; })
    .filter(i => mostlyLatin(`${i.title} ${i.description || ''}`))
    .filter(i => i.relevant || relevance(i.text, profile.keywords) >= (i.kind === 'paper' ? 2 : 1));
  for (const source of new Set(fresh.map(i => i.source))) percentile(fresh.filter(i => i.source === source && i.kind !== 'proven'), i => i.metric?.value ?? 0);
  const seen = new Set(data.cards.map(c => c.key)), made = await madeKeys(root), batch = randomUUID().slice(0, 8);
  let candidates = group(fresh).filter(c => !seen.has(c.key) && !made.some(k => k.includes(c.key) || (c.key.length >= 8 && c.key.includes(k))))
    .map(c => ({c, s: score(c, {now, focus: terms})}));
  if (terms.length) candidates = candidates.filter(x => x.s.focusMatch > 0);
  const cards = pick(candidates.sort((a, b) => b.s.total - a.s.total).map(x => card(x.c, x.s, batch, now)), n);
  const run = {batch, at: new Date(now).toISOString(), focus: focus.trim(), requested: n, found: cards.length, considered: candidates.length, sources};
  data.cards.push(...cards); data.runs = [...(data.runs || []), run].slice(-50);
  await saveIdeas(root, data);
  return {run, cards};
}
// Newest search first; within one search, best score first (cards are stored in that order).
export const newestFirst = cards => [...cards].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export async function setIdeaStatus(root, id, status, reason = '') {
  if (!STATUSES.includes(status)) throw new Error(`Status must be one of: ${STATUSES.join(', ')}`);
  const data = await loadIdeas(root), c = data.cards.find(x => x.id === id);
  if (!c) throw new Error(`No idea with id ${id}`);
  c.status = status; c.updatedAt = new Date().toISOString();
  if (status === 'rejected' && reason) c.reason = String(reason).slice(0, 300); else delete c.reason;
  await saveIdeas(root, data);
  return c;
}
// The prompt a "Make video" click hands to a new thread: the angle plus the sources the script writer should start from.
// Without minutes the length is left to the agent.
export function videoPrompt(c, minutes = null) {
  const links = c.sources.flatMap(s => [s.url, s.link].filter(Boolean));
  return `${minutes ? `A ${minutes}-minute explainer` : 'An explainer'}: ${c.title}\n\n${c.promise}\n\nStart from these sources and check every claim against primary evidence:\n${[...new Set(links)].map(l => `- ${l}`).join('\n')}`;
}
