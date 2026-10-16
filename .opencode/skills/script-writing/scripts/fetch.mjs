#!/usr/bin/env node
// Fetch a URL and save its readable text as Markdown-ish plain text. No dependencies.
// Usage: node fetch.mjs <url> <out.md>
// Reddit post URLs are fetched as JSON (post + top comments). GitHub blob URLs are fetched raw.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const [url, out] = process.argv.slice(2);
if (!url || !out) {
  console.error('Usage: node fetch.mjs <url> <out.md>');
  process.exit(2);
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

async function get(u, accept = 'text/html,application/json;q=0.9,*/*;q=0.8') {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(u, { headers: { 'user-agent': UA, accept }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      if (res.status === 403 || res.status === 401) throw Object.assign(new Error(`HTTP ${res.status} for ${u} (blocked; use your harness's fetch tool or a browser)`), { fatal: true });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${u}`);
      return { text: await res.text(), type: res.headers.get('content-type') || '' };
    } catch (e) {
      lastError = e;
      if (e.fatal) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastError;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

function htmlToText(html) {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim());
  let body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|iframe|form|button|select)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, '');
  // Prefer the main content container when there is one.
  const main = body.match(/<article\b[\s\S]*?<\/article>/gi)?.sort((a, b) => b.length - a.length)[0]
    || body.match(/<main\b[\s\S]*?<\/main>/i)?.[0];
  if (main && main.length > 2000) body = main;
  body = body
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => `\n\n${'#'.repeat(Number(n))} `)
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|li|tr|table|blockquote|pre|figure|figcaption|ul|ol)>/gi, '\n\n')
    .replace(/<(td|th)[^>]*>/gi, ' | ')
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => {
      const text = t.replace(/<[^>]+>/g, '').trim();
      return text && /^https?:/.test(href) ? `[${text}](${href})` : text;
    })
    .replace(/<[^>]+>/g, '');
  body = decode(body)
    .split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, body };
}

function redditToText(json) {
  const post = json?.[0]?.data?.children?.[0]?.data;
  if (!post) throw new Error('Unexpected Reddit JSON');
  const lines = [`# ${post.title}`, '', `r/${post.subreddit} · u/${post.author} · score ${post.score} · ${new Date(post.created_utc * 1000).toISOString().slice(0, 10)}`, '', post.selftext || post.url, '', '## Top comments', ''];
  const walk = (children, depth) => {
    for (const c of children || []) {
      if (c.kind !== 't1') continue;
      const d = c.data;
      lines.push(`${'  '.repeat(depth)}- u/${d.author} (score ${d.score}): ${d.body.replace(/\n+/g, ' ')}`);
      if (depth < 2 && d.replies?.data?.children) walk(d.replies.data.children.slice(0, 3), depth + 1);
    }
  };
  walk(json?.[1]?.data?.children?.slice(0, 25), 0);
  return lines.join('\n');
}

let text;
const u = new URL(url);
if (/(^|\.)reddit\.com$/.test(u.hostname) && u.pathname.includes('/comments/')) {
  const postPath = u.pathname.replace(/\/$/, '').replace(/\.json$/i, '');
  const jsonUrl = `https://www.reddit.com${postPath}.json?limit=50&sort=top`;
  text = redditToText(JSON.parse((await get(jsonUrl, 'application/json')).text));
} else if (u.hostname === 'github.com' && u.pathname.includes('/blob/')) {
  text = (await get(url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/'), 'text/plain')).text;
} else {
  const { text: raw, type } = await get(url);
  if (/html/.test(type) || /^\s*</.test(raw)) {
    const { title, body } = htmlToText(raw);
    text = `# ${title}\n\n${body}`;
  } else {
    text = raw;
  }
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, `Source: ${url}\nFetched: ${new Date().toISOString()}\n\n${text}\n`);
const words = text.split(/\s+/).filter(Boolean).length;
console.log(`${out}: ${words} words`);
if (words < 200) console.log('Warning: very little text extracted. The page may be script-rendered; try another fetch tool.');
