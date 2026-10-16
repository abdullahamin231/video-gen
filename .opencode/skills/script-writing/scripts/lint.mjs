#!/usr/bin/env node
// Measure a narration script: length against a duration, rhythm, AI tells and TTS hazards.
// Usage: node lint.mjs <SCRIPT.md> [--minutes 8] [--wpm 160] [--json] [--reference-transcript]
// Timestamp removal is opt-in when measuring reference transcripts, never narration to deliver.
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
let file, wpm = 160, minutesTarget = NaN;
const usageError = message => {
  console.error(message);
  console.error('Usage: node lint.mjs <SCRIPT.md> [--minutes N] [--wpm N] [--json] [--reference-transcript]');
  process.exit(2);
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--json' || a === '--reference-transcript') continue;
  if (a === '--minutes' || a === '--wpm') {
    const n = Number(args[++i]);
    if (!Number.isFinite(n) || n <= 0) usageError(`${a} needs a positive finite number`);
    if (a === '--minutes') minutesTarget = n; else wpm = n;
  } else if (a.startsWith('--') || file) usageError(`Unexpected argument: ${a}`);
  else file = a;
}
if (!file) usageError('A script file is required');

const raw = await readFile(file, 'utf8');
const text = args.includes('--reference-transcript')
  ? raw.replace(/^\s*\[\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?\s*(?:-->\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?\s*)?\]\s*/gm, '')
  : raw;

const words = text.match(/[A-Za-z0-9'’$%.,-]+/g)?.filter((w) => /[A-Za-z0-9]/.test(w)) ?? [];
const wordCount = words.length;
const minutes = wordCount / wpm;
const per = (n) => +(n / Math.max(minutes, 0.1)).toFixed(2);

const sentences = text
  .replace(/\n+/g, ' ')
  .split(/(?<=[.!?])\s+(?=["'“A-Z0-9])/)
  .map((s) => s.trim())
  .filter((s) => /[A-Za-z]/.test(s));
const lens = sentences.map((s) => s.split(/\s+/).length);
const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
const short = lens.filter((n) => n <= 6).length;
const long = lens.filter((n) => n >= 28).length;

const firstWords = {};
for (const s of sentences) {
  const w = s.split(/\s+/)[0].replace(/[^A-Za-z']/g, '').toLowerCase();
  firstWords[w] = (firstWords[w] || 0) + 1;
}
const topStarts = Object.entries(firstWords).sort((a, b) => b[1] - a[1]).slice(0, 6)
  .map(([w, n]) => `${w} ${Math.round((100 * n) / sentences.length)}%`);

// Runs of three or more consecutive sentences of six words or fewer.
let staccatoRuns = 0;
for (let i = 0, run = 0; i <= lens.length; i++) {
  if (i < lens.length && lens[i] <= 6) run++;
  else { if (run >= 3) staccatoRuns++; run = 0; }
}

const connectiveStarts = sentences.filter((s) => /^(and|so|now|but|well|which|because|then|or)\b/i.test(s)).length;
const screenRefs = (text.match(/\b(you can see|as you can see|on screen|right here|look at (this|that|these)|let's pull up|pull up|here's (the|what|how) [^.?!]{0,30}(looks|says))\b/gi) || []).length;

const questions = sentences.filter((s) => s.endsWith('?')).length;
const contractions = (text.match(/\b\w+['’](s|re|ve|ll|d|t|m)\b/gi) || []).length;

const TELLS = {
  'ai-vocabulary [7]': /\b(delve|crucial|pivotal|landscape|realm|tapestry|testament|underscores?|showcas\w*|intricate|vibrant|enduring|foster\w*|garner\w*|interplay|robust|seamless\w*|leverag\w*|utiliz\w*|unlock\w*|elevat\w*|empower\w*|game[- ]changer|cutting[- ]edge|ever[- ]evolving|navigat\w* the|quietly|simply|unusually frank|genuinely|fundamentally)\b/gi,
  'fancy-is [8]': /\b(serves as|stands as|acts as|boasts)\b/gi,
  'stock-phrases [20]': /\b(in today's video|let's dive|dive in|let's break (it|this) down|buckle up|without further ado|here's where it gets interesting|the plot thickens|spoiler alert|and that's not all)\b/gi,
  'filler [23]': /\b(it's important to note|it's worth (noting|mentioning)|in order to|when it comes to|at the end of the day|in essence)\b/gi,
  'hedge-stack [24]': /\b(could|may|might) (potentially|possibly)\b/gi,
  'vague-attribution [5]': /\b(experts (say|believe|agree)|many believe|studies (show|suggest)|some (might|would) argue)\b/gi,
  'reversal [9]': /\b(it'?s not (just )?[^.?!]{1,40}[.,;] it'?s|isn'?t just|not just [^.?!]{1,40} but|not because [^.?!]{1,60} but because)/gi,
  'participial-tail [3]': /, (highlighting|showcasing|ensuring|reflecting|underscoring|making it|allowing|enabling|fostering|emphasizing|signaling)\b/gi,
  'generic-ending [25]': /\b(the future (looks|is) bright|only time will tell|one thing is (certain|clear)|(and |so )?the next time (you|your)|the possibilities are endless|changes everything)\b/gi,
  'imagine-opener': /\b(imagine (a world|this)|have you ever wondered|picture this)\b/gi,
  'announced-structure': /\b(next part|here's the part (most people|nobody|everyone)|my argument (in this video )?is|let's start with|now,? let's talk about|let's (look at|talk about)|in this video,? (i|we)('ll| will))\b/gi,
  'performed-tone': /\b(i want to be fair|to be fair here|i (really )?(like|love) this one|i keep thinking about|i'd steal|puts it (well|perfectly|best)|my favou?rite (part|line))\b/gi,
  'heres-the-thing': /\b(here's the (thing|catch|kicker|twist)|but here's)\b/gi,
};
// Habits measured as rates rather than tells: citing sources by name, and how many figures the listener must hold.
const attributions = (text.match(/\b[A-Z][\wö]+(?:'s)? (says|said|calls|puts|describes|points|makes|has a|found|measured|reported|lists|argues|writes|keeps)\b/g) || []).length
  + (text.match(/\b(according to|puts it|calls (it|this|that|these)|describes|points out|reported|found that|has a (line|phrase|rule)|'s phrase|in (their|his|her) words)\b/gi) || []).length;
const figures = (text.match(/\b(\d[\d,.]*|(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)(?:[- ](one|two|three|four|five|six|seven|eight|nine|hundred|thousand|million|billion|point))*)\b/gi) || []).length;

const tells = {};
for (const [name, re] of Object.entries(TELLS)) {
  const hits = text.match(re) || [];
  if (hits.length) tells[name] = { count: hits.length, perMin: per(hits.length), examples: [...new Set(hits.map((h) => h.toLowerCase()))].slice(0, 4) };
}

const hazards = {
  'dashes': (text.match(/ [—–-] |—|–/g) || []).length,
  'colons/semicolons': (text.match(/[:;]/g) || []).length,
  'parentheses': (text.match(/[()]/g) || []).length / 2,
  'symbols ($ % & / +)': (text.match(/[$%&/+]/g) || []).length,
  'markdown/emoji': (text.match(/(^|\n)\s*(?:#{1,6}\s|[*>-]\s|\d+\.\s|`{3})|\*\*|`[^`\n]+`|[\u{1F300}-\u{1FAFF}]/gu) || []).length,
  'digits': (text.match(/\d/g) ? text.match(/\d[\d,.]*/g).length : 0),
  'stage directions/timestamps': (text.match(/^[ \t]*\[[^\]\n]+\]|\[(?:pause|beat|music|laugh\w*|sigh\w*|sfx)\b[^\]\n]*\]/gim) || []).length,
  'urls': (text.match(/https?:\/\/\S+/gi) || []).length,
};

const errors = [];
if (!wordCount) errors.push('Narration is empty.');
if (Number.isFinite(minutesTarget) && Math.abs(wordCount - minutesTarget * wpm) > minutesTarget * wpm * 0.05)
  errors.push(`Word count ${wordCount} is outside the 5% budget for ${minutesTarget} min at ${wpm} wpm.`);
for (const key of ['markdown/emoji', 'stage directions/timestamps', 'urls'])
  if (hazards[key]) errors.push(`Remove ${key} from narration (${hazards[key]} occurrence(s)).`);

const report = {
  file,
  ok: errors.length === 0,
  errors,
  words: wordCount,
  estMinutes: +minutes.toFixed(2),
  wpm,
  targetMinutes: Number.isNaN(minutesTarget) ? undefined : minutesTarget,
  budgetWords: Number.isNaN(minutesTarget) ? undefined : Math.round(minutesTarget * wpm),
  sentences: sentences.length,
  sentenceLength: { mean: +mean.toFixed(1), sd: +sd.toFixed(1), cv: +(sd / mean).toFixed(2), shortPct: Math.round((100 * short) / lens.length), longPct: Math.round((100 * long) / lens.length) },
  sentenceStarts: topStarts,
  staccatoRuns,
  connectiveStartPct: Math.round((100 * connectiveStarts) / sentences.length),
  screenRefs,
  questionsPerMin: per(questions),
  contractionsPerMin: per(contractions),
  attributionsPerMin: per(attributions),
  figuresPerMin: per(figures),
  tells,
  ttsHazards: Object.fromEntries(Object.entries(hazards).filter(([, n]) => n)),
};

if (args.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const r = report;
  console.log(`${r.file}`);
  console.log(`  words ${r.words}, about ${r.estMinutes} min at ${r.wpm} wpm${r.budgetWords ? `; budget ${r.budgetWords} words for ${r.targetMinutes} min (${Math.round((100 * (r.words - r.budgetWords)) / r.budgetWords)}%)` : ''}`);
  console.log(`  sentences ${r.sentences}: mean ${r.sentenceLength.mean} words, sd ${r.sentenceLength.sd} (cv ${r.sentenceLength.cv}), ${r.sentenceLength.shortPct}% ≤6 words, ${r.sentenceLength.longPct}% ≥28 words`);
  console.log(`  sentence starts: ${r.sentenceStarts.join(', ')}; staccato runs (3+ short sentences) ${r.staccatoRuns}`);
  console.log(`  sentences opening with a spoken connective (and/so/now/but/well/which...) ${r.connectiveStartPct}%, references to the screen ${r.screenRefs}`);
  console.log(`  questions ${r.questionsPerMin}/min, contractions ${r.contractionsPerMin}/min, source attributions ${r.attributionsPerMin}/min, number words ${r.figuresPerMin}/min`);
  const t = Object.entries(r.tells);
  console.log(t.length ? '  tells (per minute):' : '  tells: none found');
  for (const [k, v] of t) console.log(`    ${k}: ${v.count} (${v.perMin}/min) e.g. ${v.examples.join(' | ')}`);
  const h = Object.entries(r.ttsHazards);
  if (h.length) console.log(`  TTS hazards: ${h.map(([k, n]) => `${k} ${n}`).join(', ')}`);
  for (const error of errors) console.log(`  ERROR: ${error}`);
  console.log('  Illustrative reference from a small English narration sample, not genre-independent targets: mean sentence 14-18 words, cv about 0.5, about 10% of');
  console.log('  sentences 6 words or fewer, 0-1 staccato runs, 30-65% of sentences opening with a connective, a few');
  console.log('  screen references, named-source attributions under 0.5/min, about 3-5 number words/min, contractions');
  console.log('  4+/min, under 0.3/min in any one tell category. Counts are signals, not verdicts.');
}
process.exitCode = report.ok ? 0 : 1;
