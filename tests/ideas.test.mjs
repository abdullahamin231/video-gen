import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseChannelPage, outliers, parseRedditRss, parseHuggingFace, modelName, modelParams, memoryEstimate, group, angle, relevance,
  findIdeas, loadIdeas, setIdeaStatus, videoPrompt, newestFirst, DEFAULT_PROFILE} from '../lib/ideas.mjs';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const days = n => new Date(NOW - n * 86400e3).toISOString();

// A channel page holds one lockupViewModel per upload, as YouTube serves it.
const lockup = (id, title, views, age) => `"lockupViewModel":{"contentId":"${id}","contentType":"LOCKUP_CONTENT_TYPE_VIDEO","metadata":{"lockupMetadataViewModel":{"title":{"content":"${title}"},"metadata":{"contentMetadataViewModel":{"metadataRows":[{"metadataParts":[{"text":{"content":"x"},"accessibilityLabel":"${views} views"},{"text":{"content":"y"},"accessibilityLabel":"${age} ago"}]}]}}}}}`;
const channelPage = `{"channelMetadataRenderer":{"title":"Kai","description":"d"}}` + [
  lockup('aaaaaaaaaa1', 'Is 16GB All You Need for Serious Local LLM?', '377 thousand', '12 days'),
  lockup('aaaaaaaaaa2', 'Oracle\\u2019s $288B Lease', '11 thousand', '2 weeks'),
  lockup('aaaaaaaaaa3', 'Video three', '60 thousand', '3 days'),
  lockup('aaaaaaaaaa4', 'Video four', '62 thousand', '4 days'),
  lockup('aaaaaaaaaa5', 'Video five', '55 thousand', '5 days'),
  lockup('aaaaaaaaaa6', 'Old hit', '900 thousand', '3 months'),
].join(',');
const redditFeed = entries => `<feed>${entries.map(([id, title, at]) => `<entry><author><name>/u/x</name></author><content type="html">&lt;p&gt;body&lt;/p&gt; submitted by x</content><id>t3_${id}</id><link href="https://www.reddit.com/r/LocalLLaMA/comments/${id}/x/" /><updated>${at}</updated><published>${at}</published><title>${title}</title></entry>`).join('')}</feed>`;
const hf = [
  {id: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', trendingScore: 1600, createdAt: days(3), pipeline_tag: 'text-generation', safetensors: {parameters: {BF16: 763e9}, total: 763e9}, tags: ['text-generation']},
  {id: 'LiquidAI/LFM2.5-24B-A2B', trendingScore: 480, createdAt: days(5), pipeline_tag: 'text-generation', tags: []},
  {id: 'unsloth/LFM2.5-24B-A2B-GGUF', trendingScore: 200, createdAt: days(5), pipeline_tag: 'text-generation', tags: []},
  {id: 'black-forest-labs/flux-3', trendingScore: 700, createdAt: days(4), pipeline_tag: 'image-to-image', tags: []},
];
function fixtureFetch(overrides = {}) {
  const calls = [];
  const fetchText = async url => {
    calls.push(url);
    for (const [pattern, body] of Object.entries(overrides)) if (url.includes(pattern)) { if (body instanceof Error) throw body; return body; }
    if (url.includes('huggingface.co/api/models')) return JSON.stringify(url.includes('search=') ? [{id: 'apple/OpenELM-Mac-3B', trendingScore: 50, createdAt: days(2), pipeline_tag: 'text-generation', safetensors: {total: 3e9}}] : hf);
    if (url.includes('daily_papers')) return JSON.stringify([
      {publishedAt: days(1), paper: {id: '2610.1', title: 'KV cache quantization for faster LLM inference', upvotes: 90, summary: ''}},
      {publishedAt: days(1), paper: {id: '2610.2', title: 'ScaleNav: Pretraining for Local Navigation', upvotes: 50, summary: 'a model'}}]);
    if (url.includes('reddit.com') && url.includes('search.rss')) return redditFeed([['m1', 'Mac Studio vs 4090 for local inference?', days(2)]]);
    if (url.includes('reddit.com')) return redditFeed([['r1', 'DeepSeek V4.1 Flash now leads open-weight models', days(2)], ['r2', 'Which GPU should I buy for 70B models?', days(3)], ['r3', 'Old thread', days(60)]]);
    if (url.includes('hn.algolia.com')) return JSON.stringify({hits: [{objectID: '1', title: 'Show HN: feel how fast a local LLM runs before you buy', points: 330, created_at: days(2), url: 'https://example.com'}, {objectID: '2', title: 'Tiny LLM post', points: 5, created_at: days(1)}]});
    if (url.includes('api.github.com')) return JSON.stringify({items: [{name: 'strata', full_name: 'x/strata', html_url: 'https://github.com/x/strata', created_at: days(6), stargazers_count: 900, description: 'Run 125B models 6x faster than llama.cpp'},
      {name: 'guide-ru', full_name: 'y/guide-ru', html_url: 'https://github.com/y/guide-ru', created_at: days(2), stargazers_count: 100, description: 'Полный гайд на русском как запустить локально'}]});
    if (url.includes('youtube.com/channel/')) return channelPage;
    throw new Error(`unexpected ${url}`);
  };
  return {fetchText, calls};
}
async function workspace(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'video-ideas-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  return root;
}

test('a channel page yields views and ages; outliers are measured against the channel median', () => {
  const page = parseChannelPage(channelPage);
  assert.equal(page.channel, 'Kai');
  assert.equal(page.videos.length, 6);
  assert.deepEqual(page.videos[0], {id: 'aaaaaaaaaa1', title: 'Is 16GB All You Need for Serious Local LLM?', views: 377000, ageDays: 12});
  assert.equal(page.videos[1].title, 'Oracle’s $288B Lease');
  const found = outliers(page, {minMultiple: 2, maxAgeDays: 30, channelId: 'UC1', now: NOW});
  // The 3-month-old hit is an outlier too, but too old to be timely.
  assert.deepEqual(found.map(f => f.title), ['Is 16GB All You Need for Serious Local LLM?']);
  assert.equal(found[0].multiple, 6.1);
  assert.equal(outliers({channel: 'x', videos: page.videos.slice(0, 3)}, {minMultiple: 2, maxAgeDays: 30, now: NOW}).length, 0, 'too few uploads for a median');
});

test('parsers: Reddit RSS keeps rank, Hugging Face keeps only text models, names lose their suffixes', () => {
  const posts = parseRedditRss(redditFeed([['a', 'First &amp; best', days(1)], ['b', 'Second', days(1)]]), 'LocalLLaMA');
  assert.deepEqual(posts.map(p => [p.title, p.rank]), [['First & best', 1], ['Second', 2]]);
  assert.equal(parseHuggingFace(hf, DEFAULT_PROFILE).length, 3);
  assert.equal(modelName('deepseek-ai/DeepSeek-V4.1-Flash-1017'), 'DeepSeek V4.1 Flash');
  assert.equal(modelName('unsloth/LFM2.5-24B-A2B-GGUF'), 'LFM2.5 24B A2B');
  assert.deepEqual(memoryEstimate(24e9), {billions: 24, gb: 14, tier: 16});
  // The name wins; packed integer weights make Hugging Face's own parameter count meaningless.
  assert.equal(modelParams({id: 'nvidia/Nemotron-3.5-Bolt-74B-A9B-24GB', safetensors: {parameters: {I32: 1e9}, total: 1e10}}), 74e9);
  assert.equal(modelParams({id: 'x/Packed', safetensors: {parameters: {BF16: 1e9, I8: 5e9}, total: 6e9}}), null);
  assert.equal(modelParams({id: 'x/Plain', safetensors: {parameters: {BF16: 7e9}, total: 7e9}}), 7e9);
  assert.equal(relevance('ScaleNav: Pretraining for Local Navigation model', DEFAULT_PROFILE.keywords), 0, 'generic words alone are not on-topic');
  assert(relevance('KV cache quantization for LLM inference', DEFAULT_PROFILE.keywords) >= 2);
});

test('a discussion naming a trending model joins that model; angles follow the size of the model', () => {
  const items = [...parseHuggingFace(hf, DEFAULT_PROFILE), ...parseRedditRss(redditFeed([['r1', 'DeepSeek V4.1 Flash now leads', days(1)], ['r2', 'Unrelated question?', days(1)]]), 'LocalLLaMA')];
  const clusters = group(items);
  const deepseek = clusters.find(c => c.key === 'deepseekv41flash');
  assert.deepEqual(deepseek.items.map(i => i.source), ['huggingface', 'reddit']);
  const lfm = clusters.find(c => c.key === 'lfm2524ba2b');
  assert.equal(lfm.items.length, 2, 'the GGUF repack is the same model');
  assert.match(angle(lfm).title, /^Can LFM2.5 24B A2B run on a 16GB GPU\?$/);
  assert.match(angle(deepseek).title, /^What would it cost to run DeepSeek V4.1 Flash locally\?$/);
  assert.equal(angle(clusters.find(c => c.key.startsWith('unrelated'))).form, 'Persistent question');
});

test('each run returns only ideas not shown before, and a failing source does not stop the run', async t => {
  const root = await workspace(t), {fetchText} = fixtureFetch({'hn.algolia.com': new Error('HTTP 503')});
  const first = await findIdeas(root, {count: 3, fetchText, now: NOW, youtubeKey: ''});
  assert.equal(first.cards.length, 3);
  assert.equal(first.cards[0].title, 'What would it cost to run DeepSeek V4.1 Flash locally?');
  assert(first.cards[0].reasons.some(r => r.includes('2 places')));
  const hn = first.run.sources.filter(s => s.name.startsWith('Hacker News'));
  assert(hn.length && hn.every(s => !s.ok && s.error === 'HTTP 503'));
  const second = await findIdeas(root, {count: 50, fetchText, now: NOW, youtubeKey: ''});
  const firstKeys = new Set(first.cards.map(c => c.key));
  assert(second.cards.length > 0 && second.cards.every(c => !firstKeys.has(c.key)), 'a second run never repeats an idea');
  const all = [...first.cards, ...second.cards].map(c => c.title).join('\n');
  assert(!/ScaleNav|guide-ru|Old thread|flux|Tiny LLM/.test(all), all);
  assert.match(all, /Is 16GB All You Need/, 'the reference channel outlier is a proven question');
  assert.equal((await loadIdeas(root)).runs.length, 2);
  const third = await findIdeas(root, {fetchText, now: NOW, youtubeKey: ''});
  assert.equal(third.cards.length, 0, 'nothing new left');
});

test('a focused request searches for it directly and keeps only matching ideas', async t => {
  const root = await workspace(t), {fetchText, calls} = fixtureFetch();
  const {cards, run} = await findIdeas(root, {focus: 'more ideas about Mac hardware', fetchText, now: NOW, youtubeKey: ''});
  assert.equal(run.focus, 'more ideas about Mac hardware');
  assert(calls.some(u => u.includes('search=mac%20hardware')), 'searches Hugging Face for the focus');
  assert(calls.some(u => u.includes('search.rss?q=mac%20hardware')));
  assert(cards.length && cards.every(c => /mac|hardware/i.test(JSON.stringify(c))), JSON.stringify(cards.map(c => c.title)));
  assert(cards.some(c => c.title.includes('Mac Studio vs 4090')));
});

test('ideas for videos already in jobs/ are skipped; status changes persist; the prompt carries the sources', async t => {
  const root = await workspace(t), {fetchText} = fixtureFetch();
  await mkdir(path.join(root, 'jobs/deepseek-v4-1-flash-cost'), {recursive: true});
  const {cards} = await findIdeas(root, {count: 50, fetchText, now: NOW, youtubeKey: ''});
  assert(!cards.some(c => c.key === 'deepseekv41flash'));
  const saved = await setIdeaStatus(root, cards[0].id, 'rejected', 'Weak evidence');
  assert.equal(saved.reason, 'Weak evidence');
  assert.equal((await loadIdeas(root)).cards.find(c => c.id === cards[0].id).status, 'rejected');
  await assert.rejects(setIdeaStatus(root, cards[0].id, 'bogus'), /Status must be/);
  const prompt = videoPrompt(cards[0]);
  assert.match(prompt, /^An explainer: /, 'the length is left to the agent');
  assert.match(videoPrompt(cards[0], 5), /^A 5-minute explainer: /);
  for (const s of cards[0].sources) assert(prompt.includes(s.url));
});

test('ideas.config.json can switch sources off and add channels', async t => {
  const root = await workspace(t), {fetchText, calls} = fixtureFetch();
  await writeFile(path.join(root, 'ideas.config.json'), JSON.stringify({sources: {reddit: {subreddits: ['LocalLLaMA']}}, batchSize: 2}));
  const {cards, run} = await findIdeas(root, {fetchText, now: NOW, youtubeKey: ''});
  assert.equal(run.sources.length, 1);
  assert(calls.every(u => u.includes('reddit.com')));
  assert(cards.length <= 2);
  await writeFile(path.join(root, 'ideas.config.json'), '{bad');
  await assert.rejects(findIdeas(root, {fetchText, now: NOW}), /not valid JSON/);
});

test('with a YouTube API key, outliers come from the official API without search.list', async t => {
  const root = await workspace(t);
  await writeFile(path.join(root, 'ideas.config.json'), JSON.stringify({sources: {youtube: {channels: [{id: 'UCabc', name: 'Ref'}], minMultiple: 2}}}));
  const calls = [];
  const fetchText = async url => {
    calls.push(url);
    if (url.includes('/playlistItems')) return JSON.stringify({items: [1, 2, 3, 4, 5].map(i => ({contentDetails: {videoId: `vid${i}`}}))});
    if (url.includes('/videos')) return JSON.stringify({items: [1, 2, 3, 4, 5].map(i => ({id: `vid${i}`, snippet: {title: i === 1 ? 'Can a Mac Mini replace your AI subscription?' : `Upload ${i}`, channelTitle: 'Ref', publishedAt: days(i)}, statistics: {viewCount: String(i === 1 ? 500000 : 50000)}}))});
    throw new Error(url);
  };
  const {cards, run} = await findIdeas(root, {fetchText, now: NOW, youtubeKey: 'SECRET'});
  assert(calls.every(u => !u.includes('/search')) && calls.some(u => u.includes('playlistId=UUabc')));
  assert.deepEqual(cards.map(c => c.title), ['Can a Mac Mini replace your AI subscription?']);
  assert.match(cards[0].promise, /10× Ref’s usual views/);
  assert(!JSON.stringify(run).includes('SECRET'));
  const failing = await findIdeas(root, {fetchText: async url => { throw new Error(`HTTP 403 for ${url}`); }, now: NOW, youtubeKey: 'SECRET', refresh: true});
  assert(!JSON.stringify(failing.run).includes('SECRET'), 'the key never reaches stored errors');
  assert(!(await readFile(path.join(root, '.video/ideas/ideas.json'), 'utf8')).includes('SECRET'));
});

test('newest search first, best score first within a search', () => {
  const cards = [{title: 'old best', createdAt: '2026-10-19T00:00:00Z'}, {title: 'old second', createdAt: '2026-10-19T00:00:00Z'},
    {title: 'new best', createdAt: '2026-10-20T00:00:00Z'}, {title: 'new second', createdAt: '2026-10-20T00:00:00Z'}];
  assert.deepEqual(newestFirst(cards).map(c => c.title), ['new best', 'new second', 'old best', 'old second']);
});
