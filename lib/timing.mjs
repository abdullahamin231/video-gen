import path from 'node:path';

export const normalized =text => String(text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const tokens = text => String(text).match(/[\p{L}\p{N}]+(?:['’.,-][\p{L}\p{N}]+)*/gu) || [];

export function extractNarration(markdown) {
  const quoted = markdown.split('\n').filter(line => /^\s*>/.test(line))
    .map(line => line.replace(/^\s*>\s?/, '').replace(/^\s*["“]|["”]\s*$/g, ''));
  return quoted.length ? quoted.join('\n\n') : markdown;
}

// File names that say nothing about the film (script-writer writes SCRIPT.md, for example).
const GENERIC_NAMES = new Set(['script', 'scripts', 'source-script', 'narration', 'draft', 'final', 'copy', 'untitled',
  'new', 'input', 'text', 'transcript', 'readme', 'sample', 'output']);
const slugOf = text => String(text).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

// The job name: the script's file name, else its # heading, else its folder (jobs/scripts/<slug>/SCRIPT.md), else its opening words.
export function jobNameFor(scriptPath, markdown) {
  const file = slugOf(path.basename(scriptPath, path.extname(scriptPath)));
  if (file && !GENERIC_NAMES.has(file)) return file;
  const heading = slugOf(String(markdown).match(/^#\s+(.+)$/m)?.[1] || '');
  if (heading) return heading;
  const folder = slugOf(path.basename(path.dirname(scriptPath)));
  if (folder && !GENERIC_NAMES.has(folder)) return folder;
  return slugOf(extractNarration(markdown).split(/\s+/).slice(0, 6).join(' ')) || 'film';
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

export function resolveCue(cue, alignment, duration) {
  if (!cue || typeof cue !== 'object') throw new Error('Cue must be an object.');
  if (cue.boundary) {
    if (!['start', 'end'].includes(cue.boundary)) throw new Error('Invalid boundary cue.');
    return cue.boundary === 'start' ? 0 : duration;
  }
  if (cue.edge && !['start', 'end'].includes(cue.edge)) throw new Error('Cue edge must be start or end.');
  const words = alignment.words;
  let first, last;
  if (cue.wordId) {
    first = last = words.find(w => w.id === cue.wordId);
    if (!first) throw new Error(`Unknown wordId: ${cue.wordId}`);
  } else {
    const phrase = tokens(cue.phrase || '').map(normalized);
    if (!phrase.length) throw new Error('Cue needs phrase or wordId.');
    const candidates = [];
    for (let i = 0; i <= words.length - phrase.length; i++) {
      if (phrase.every((token, k) => token === normalized(words[i + k].text) ||
          (words[i + k].scriptText && token === normalized(words[i + k].scriptText)))) candidates.push(i);
    }
    if (!candidates.length) throw new Error(`Cue not found in measured audio: "${cue.phrase}"`);
    if (candidates.length > 1 && cue.occurrence == null)
      throw new Error(`Ambiguous cue "${cue.phrase}" (${candidates.length} matches); specify occurrence or wordId.`);
    const occurrence = cue.occurrence ?? 1;
    if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > candidates.length)
      throw new Error(`Invalid occurrence for "${cue.phrase}".`);
    const at = candidates[occurrence - 1]; first = words[at]; last = words[at + phrase.length - 1];
  }
  const offset = cue.offset ?? 0;
  if (!Number.isFinite(offset)) throw new Error('Cue offset must be finite.');
  const value = (cue.edge === 'end' ? last.end : first.start) + offset;
  if (value < 0 || value > duration) throw new Error(`Cue outside audio window: ${value}`);
  return Number(value.toFixed(3));
}

export function compilePlan(plan, alignment, duration) {
  if (!Number.isFinite(alignment.matchRatio) || alignment.matchRatio < 0 || alignment.matchRatio > 1)
    throw new Error('Alignment needs a valid measured match ratio.');
  if (new Set(alignment.words.map(w => w.id)).size !== alignment.words.length)
    throw new Error('Alignment contains duplicate word IDs.');
  if (alignment.matchRatio < 0.85 && !(alignment.review?.approved && alignment.review.note?.trim()))
    throw new Error('Low script match; review alignment discrepancies and record alignment.review before compiling.');
  if (plan.version !== 1 || !Array.isArray(plan.scenes) || !plan.scenes.length)
    throw new Error('Expected beats.json version 1 with nonempty scenes.');
  const ids = new Set(), scenes = [], warnings = [];
  let previous = 0;
  for (const scene of plan.scenes) {
    if (!/^[a-z][a-z0-9-]*$/.test(scene.id) || ids.has(scene.id)) throw new Error(`Invalid/duplicate scene id: ${scene.id}`);
    ids.add(scene.id);
    if (!/^compositions\/[a-zA-Z0-9/_-]+\.html$/.test(scene.file) || scene.file.includes('..'))
      throw new Error(`Invalid scene file: ${scene.file}`);
    if (!scene.purpose?.trim()) throw new Error(`Missing purpose: ${scene.id}`);
    const start = resolveCue(scene.start, alignment, duration), end = resolveCue(scene.end, alignment, duration);
    if (Math.abs(start - previous) > 0.025 || end <= start) throw new Error(`Scene gap/overlap or invalid duration at ${scene.id}`);
    previous = end;
    const beats = [], beatIds = new Set();
    for (const beat of scene.beats || []) {
      if (!/^[a-z][a-z0-9-]*$/.test(beat.id) || beatIds.has(beat.id)) throw new Error(`Invalid/duplicate beat id: ${beat.id}`);
      beatIds.add(beat.id);
      if (!beat.action?.trim() || !beat.purpose?.trim() || !beat.visual?.trim() ||
          !Array.isArray(beat.targets) || !beat.targets.length || !beat.targets.every(t => /^#[a-zA-Z][\w-]*$/.test(t)))
        throw new Error(`Beat ${beat.id} needs action, purpose, visual and #id targets.`);
      const at = resolveCue(beat.cue, alignment, duration);
      if (at < start || !Number.isFinite(beat.duration) || beat.duration <= 0 || at + beat.duration > end + 0.025)
        throw new Error(`Beat ${beat.id} is outside its scene or has invalid duration.`);
      beats.push({...beat, at, localAt: Number((at - start).toFixed(3))});
      if (Math.abs(beat.cue.offset || 0) > 0.5) warnings.push(`${beat.id}: cue offset exceeds 0.5s; listen to confirm anticipation.`);
    }
    if (!beats.length) throw new Error(`Scene ${scene.id} has no planned beats.`);
    if (!beats.some(b => ['assemble', 'connect', 'flow', 'compare', 'transform', 'draw'].includes(b.action)))
      warnings.push(`${scene.id}: review whether its custom actions develop the explanation.`);
    beats.sort((a, b) => a.at - b.at);
    const holds = (scene.holds || []).map(hold => {
      const a = resolveCue(hold.start, alignment, duration), b = resolveCue(hold.end, alignment, duration);
      if (!hold.reason?.trim() || a < start || b > end || b <= a) throw new Error(`Invalid hold in ${scene.id}`);
      return {start: a, end: b, reason: hold.reason};
    });
    const intervals = [...beats.map(b => [b.at, b.at + b.duration]), ...holds.map(h => [h.start, h.end])].sort((a, b) => a[0] - b[0]);
    let cursor = start;
    for (const [a, b] of [...intervals, [end, end]]) {
      if (a - cursor > 4) warnings.push(`${scene.id}: ${(a - cursor).toFixed(2)}s unplanned hold at ${cursor.toFixed(2)}s.`);
      cursor = Math.max(cursor, b);
    }
    if (end - start > 6 && beats.at(-1).at < start + (end - start) * 0.5)
      warnings.push(`${scene.id}: all developments start in the first half; likely front-loaded.`);
    scenes.push({...scene, start, end, duration: Number((end - start).toFixed(3)), beats, holds});
  }
  if (Math.abs(previous - duration) > 0.025) throw new Error('Scenes do not cover the complete audio window.');
  return {version: 1, duration, scenes, warnings};
}

export function browserCues(timing) {
  return {duration: timing.duration, scenes: Object.fromEntries(timing.scenes.map(s => [s.id,
    {start: s.start, duration: s.duration, beats: Object.fromEntries(s.beats.map(b => [b.id,
      {at: b.at, localAt: b.localAt, duration: b.duration, targets: b.targets}]))}]))};
}
