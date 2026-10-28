import {readdir} from 'node:fs/promises';
import path from 'node:path';

export const normalized =text => String(text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const tokens = text => String(text).match(/[\p{L}\p{N}]+(?:['’.,-][\p{L}\p{N}]+)*/gu) || [];

export function extractNarration(markdown) {
  const quoted = markdown.split('\n').filter(line => /^\s*>/.test(line))
    .map(line => line.replace(/^\s*>\s?/, '').replace(/^\s*["“]|["”]\s*$/g, ''));
  return quoted.length ? quoted.join('\n\n') : markdown;
}

export function normalizeWords(input, duration) {
  const raw = Array.isArray(input) ? input : input.words;
  if (!Array.isArray(raw) || !raw.length) throw new Error('Expected a nonempty measured word array.');
  // ASR emits punctuation-only tokens ("-") where a recording is cut mid-word; they are not spoken words.
  const words = raw.map(w => ({text: String(w.text ?? w.word ?? '').trim(), start: Number(w.start), end: Number(w.end)}))
    .filter(w => normalized(w.text)).map((w, i) => ({id: `w${i}`, ...w}));
  if (!words.length) throw new Error('Expected a nonempty measured word array.');
  let previous = -1;
  for (const w of words) {
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end) ||
        w.start < 0 || w.end < w.start || w.start < previous || w.end > duration + 0.15)
      throw new Error(`Invalid/nonmonotonic measured interval at ${w.id}: ${JSON.stringify(w)}`);
    previous = w.start;
  }
  return words;
}

// Semi-global edit-distance alignment: locate the spoken excerpt anywhere in
// the full script. Leading/trailing script text is free; differences within the
// excerpt are preserved. This reconciles ASR text, not acoustic forced alignment.
export function reconcile(words, script) {
  const scriptWords = tokens(script), a = words.map(w => normalized(w.text));
  const b = scriptWords.map(normalized), n = a.length, m = b.length;
  if (!m) throw new Error('The script has no narration words.');
  if ((n + 1) * (m + 1) > 30_000_000)
    throw new Error('Alignment exceeds memory budget; prepare smaller audio/script sections.');
  // Tie-break equal edit distances by the most exact matches. Otherwise a final
  // matched word can be treated as an insertion to shorten the excerpt.
  const width = m + 1, dp = new Int32Array((n + 1) * width), penalty = n + 1;
  for (let i = 1; i <= n; i++) {
    dp[i * width] = i * penalty;
    for (let j = 1; j <= m; j++) dp[i * width + j] = Math.min(
      dp[(i - 1) * width + j - 1] + (a[i - 1] === b[j - 1] ? -1 : penalty),
      dp[(i - 1) * width + j] + penalty, dp[i * width + j - 1] + penalty);
  }
  let j = 0;
  for (let k = 1; k <= m; k++) if (dp[n * width + k] < dp[n * width + j]) j = k;
  const excerptEnd = j, mapped = words.map(w => ({...w, scriptIndex: null, scriptText: null}));
  const discrepancies = [];
  let i = n, matches = 0;
  while (i > 0) {
    const here = dp[i * width + j];
    if (j > 0 && here === dp[(i - 1) * width + j - 1] + (a[i - 1] === b[j - 1] ? -1 : penalty)) {
      const exact = a[i - 1] === b[j - 1];
      if (exact) {mapped[i - 1].scriptIndex = j - 1; mapped[i - 1].scriptText = scriptWords[j - 1]; matches++;}
      else discrepancies.push({kind: 'changed', wordId: words[i - 1].id, observed: words[i - 1].text,
        expected: scriptWords[j - 1], scriptIndex: j - 1});
      i--; j--;
    } else if (here === dp[(i - 1) * width + j] + penalty) {
      discrepancies.push({kind: 'extra-spoken', wordId: words[i - 1].id, observed: words[i - 1].text}); i--;
    } else {
      discrepancies.push({kind: 'omitted', expected: scriptWords[j - 1], scriptIndex: j - 1}); j--;
    }
  }
  return {method: 'ASR word timestamps + semi-global script reconciliation',
    accuracyNote: 'Estimated ASR intervals; spot-check important cues against the audio.',
    matchRatio: matches / n, excerpt: {scriptStart: j, scriptEnd: excerptEnd,
      text: scriptWords.slice(j, excerptEnd).join(' ')}, words: mapped,
    discrepancies: discrepancies.reverse(), review: {approved: false, note: ''}};
}

export function browserCues(timing) {
  return {duration: timing.duration, scenes: Object.fromEntries(timing.scenes.map(s => [s.id,
    {start: s.start, duration: s.duration, beats: Object.fromEntries(s.beats.map(b => [b.id,
      {at: b.at, localAt: b.localAt, duration: b.duration, targets: b.targets}]))}]))};
}

export const VISUALS_FILE = 'inputs/visuals.md';

/** VISUALS.md beside the script, if the writer left one. */
export async function findVisualPlan(scriptPath) {
  const dir = path.dirname(scriptPath), base = path.basename(scriptPath, path.extname(scriptPath)).toLowerCase();
  const names = await readdir(dir).catch(() => []);
  const match = names.find(n => n.toLowerCase() === 'visuals.md') || names.find(n => n.toLowerCase() === `${base}.visuals.md`);
  return match ? path.join(dir, match) : null;
}

