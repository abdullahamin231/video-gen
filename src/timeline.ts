/**
 * Shared timeline data — drives all three video renderers.
 * Sources: "Can 9 year old GPU beat today's latest GPUs?" transcript + scene directions.
 *
 * Times are in seconds (matching the 1044.79s audio).
 * Visual elements are typed so each renderer (Remotion / Hyperframes / AgentDiscretion)
 * can interpret them in its own idiom while staying faithful to the script.
 */

export type Bar = {
  label: string;
  value: number;
  display: string;
  tone?: 'good' | 'bad' | 'neutral' | 'accent';
  sub?: string;
};

export type Spec =
  | {kind: 'chips'; items: {label: string; sub?: string}[]; caption?: string}
  | {kind: 'bars'; title?: string; bars: Bar[]; unit?: string; max?: number}
  | {kind: 'stat'; value: string; label: string; tone?: Bar['tone']}
  | {kind: 'cards'; items: {title: string; body: string; tone?: Bar['tone']}[]}
  | {kind: 'quote'; text: string; source?: string}
  | {kind: 'timeline'; items: {when: string; what: string; tone?: Bar['tone']}[]}
  | {kind: 'callout'; text: string; sub?: string};

export type Scene = {
  id: string;
  start: number;
  end: number;
  title: string;
  kicker: string;
  /** Narration line (verbatim excerpt) */
  line: string;
  /** Punchline that lands near the end of the scene */
  punch?: string;
  spec: Spec;
};

export const FPS = 30;
export const DURATION_S = 1044.79;
export const TOTAL_FRAMES = Math.round(DURATION_S * FPS); // 31344

export const SCENES: Scene[] = [
  {
    id: 'intro',
    start: 0,
    end: 35,
    kicker: 'LOCAL AI',
    title: 'The dream, and the price tag',
    line: 'Picture this, you finally decided that you want to run AI locally. And then you see the prices.',
    spec: {kind: 'cards', items: [
      {title: 'DGX SPARK', body: '$6,950', tone: 'bad'},
      {title: 'RTX 5090', body: '$2,000+', tone: 'bad'},
      {title: '8-CARD BLACKWELL RACK', body: '$120,000', tone: 'bad'},
      {title: 'WHAT YOU ACTUALLY WANT', body: 'run one model', tone: 'accent'},
    ]},
    punch: 'I just want to run a model, I\'m not trying to land on the moon.',
  },
  {
    id: 'rabbit-hole',
    start: 35,
    end: 85,
    kicker: 'THREE WEEKS AGO',
    title: 'A claim that deserved a double take',
    line: 'A video showed up from June Yamog with four GPUs from 2017 — claiming they write text 2.5× faster than a $6,950 chip from 2025.',
    spec: {kind: 'bars', unit: 'tok/s', title: 'The claim', bars: [
      {label: '4× V100 (2017)', value: 2.5, display: '2.5× faster', tone: 'good'},
      {label: 'DGX Spark (2025)', value: 1, display: '1× baseline', tone: 'bad'},
    ]},
    punch: 'My first thought: clickbait. My second thought: what if it isn\'t?',
  },
  {
    id: 'setup',
    start: 85,
    end: 167,
    kicker: 'THE SETUP',
    title: 'Four datacenter bricks vs. two shiny boxes',
    line: 'June bought four Nvidia Tesla V100s from 2017, mounted on a carrier board linked by NVLink — 128GB total for around $3,500.',
    spec: {kind: 'cards', items: [
      {title: '4× V100 SXM2', body: '$695 each · 128 GB via NVLink\n≈ $3,500 total', tone: 'good'},
      {title: '2× DGX SPARK', body: '$6,950 each · GB10 Blackwell\n= $13,900 total', tone: 'bad'},
      {title: 'SAME MODEL', body: 'Qwen 3.8 Flash Next · vLLM', tone: 'accent'},
    ]},
  },
  {
    id: 'benchmark',
    start: 167,
    end: 255,
    kicker: 'THE BENCHMARK',
    title: '155 vs 60 — and the skepticism',
    line: 'The nine-year-old cards did 155 tokens per second. The brand new 2025 chips managed about 60. And every spec sheet says that should be impossible.',
    spec: {kind: 'bars', title: 'Writing speed (tokens/sec)', unit: 'tok/s', max: 160, bars: [
      {label: '4× V100 (2017)', value: 155, display: '155', tone: 'good'},
      {label: '2× DGX Spark (2025)', value: 60, display: '60', tone: 'bad'},
    ]},
    punch: 'Volta only speaks 16-bit. No 4-bit, no BF16. The 2025 chip should win by a mile.',
  },
  {
    id: 'prefill-vs-gen',
    start: 255,
    end: 376,
    kicker: 'WHY IT WORKS',
    title: 'Two jobs: reading and writing',
    line: 'Running a language model is not one job, but two. Prefill reads your prompt in parallel. Generation writes one token at a time — and that is memory bound.',
    spec: {kind: 'cards', items: [
      {title: 'JOB 1 · PREFILL', body: 'Read the prompt\nparallel · compute bound\n→ tensor cores', tone: 'accent'},
      {title: 'JOB 2 · GENERATION', body: 'Write one token at a time\nsequential · memory bound\n→ bandwidth', tone: 'bad'},
      {title: 'THE TEXTBOOK RULE', body: 'reread every weight for\nEACH single word', tone: 'neutral'},
    ]},
  },
  {
    id: 'bandwidth',
    start: 376,
    end: 450,
    kicker: 'MEMORY BANDWIDTH',
    title: '900 GB/s vs 273 GB/s',
    line: 'The V100\'s HBM2 runs at 900 GB per second. The Spark\'s unified memory runs at 273. The old card has three times the bandwidth.',
    spec: {kind: 'bars', title: 'Memory bandwidth (GB/s)', max: 960, bars: [
      {label: '4× V100 · HBM2', value: 900, display: '900 GB/s', tone: 'good'},
      {label: 'DGX Spark · unified', value: 273, display: '273 GB/s', tone: 'bad'},
    ]},
    punch: 'Ancient silicon, three times the bandwidth of Nvidia\'s brand-new $7,000 chip.',
  },
  {
    id: 'scoreboard',
    start: 450,
    end: 494,
    kicker: 'llama.cpp BENCHMARK',
    title: 'The scoreboard splits perfectly',
    line: 'The old card wins at writing, and the two of them are dead even at reading.',
    spec: {kind: 'bars', title: 'Real benchmark · llama.cpp', max: 3100, bars: [
      {label: 'WRITING · V100', value: 129, display: '129 tok/s', tone: 'good'},
      {label: 'WRITING · DGX Spark', value: 57, display: '57 tok/s', tone: 'bad'},
      {label: 'READING · V100', value: 3043, display: '3,043', tone: 'accent'},
      {label: 'READING · DGX Spark', value: 3062, display: '3,062 · TIE', tone: 'accent'},
    ]},
  },
  {
    id: 'interconnect',
    start: 494,
    end: 590,
    kicker: 'THE INTERCONNECT TRAP',
    title: 'More hardware, slower results',
    line: 'A $120,000 eight-card server wrote 126 tok/s. June\'s four 2017 cards wrote 155. Adding more hardware made it slower.',
    spec: {kind: 'bars', title: 'Writing speed · same model', unit: 'tok/s', max: 160, bars: [
      {label: '4× V100 · NVLink', value: 155, display: '155', tone: 'good'},
      {label: '8× RTX Pro 6000 · PCIe', value: 126, display: '126', tone: 'bad'},
      {label: '8× same box, actually', value: 37, display: '37 (was 58 on 4 cards)', tone: 'bad'},
    ]},
    punch: 'PCIe wasn\'t fast enough for all-to-all. NVLink was.',
  },
  {
    id: '1080ti',
    start: 590,
    end: 675,
    kicker: 'COUNTER-EXAMPLE',
    title: 'The 1080 Ti: bandwidth without software',
    line: 'The 1080 Ti has more bandwidth than the RTX 5060 — 484 vs 448 — yet writes 62 tok/s against the 5060\'s 97.',
    spec: {kind: 'bars', title: 'Spec sheet vs. reality', unit: 'tok/s', max: 500, bars: [
      {label: '1080 Ti · spec', value: 484, display: '484 GB/s', tone: 'accent'},
      {label: 'RTX 5060 · spec', value: 448, display: '448 GB/s', tone: 'neutral'},
      {label: '1080 Ti · actual write', value: 62, display: '62 tok/s', tone: 'bad'},
      {label: 'RTX 5060 · actual write', value: 97, display: '97 tok/s', tone: 'good'},
    ]},
    punch: 'The 1080 Ti has a fan club. The V100 has developers.',
  },
  {
    id: 'software',
    start: 675,
    end: 763,
    kicker: 'THE SECRET WEAPON',
    title: 'One release: 49 → 201 tok/s',
    line: 'The speed is not the hardware, it is 1cat-vllm — a fork built for V100s. Same chip, same model, one release apart.',
    spec: {kind: 'bars', title: 'Same hardware · same model', unit: 'tok/s', max: 210, bars: [
      {label: 'v1.5.0 · Sept', value: 49, display: '49', tone: 'neutral'},
      {label: 'v1.5.1 · Oct 3', value: 201, display: '201', tone: 'good'},
    ]},
    punch: 'Nothing about the silicon changed — the software just stopped wasting it. 310% faster.',
  },
  {
    id: 'parity',
    start: 763,
    end: 845,
    kicker: 'V100-SKINNY',
    title: '$400 of eBay cards match a $6,000 5090',
    line: 'Four 16GB V100s under $400 wrote 219 tok/s against the RTX 5090\'s 214.7. The verdict was parity.',
    spec: {kind: 'bars', title: 'Qwen 3.8 27B · writing', unit: 'tok/s', max: 230, bars: [
      {label: '4× V100 16GB (<$400)', value: 219, display: '219 · 5/5 correct', tone: 'good'},
      {label: 'RTX 5090 ($6,000)', value: 214.7, display: '214.7 · 5/5 correct', tone: 'accent'},
    ]},
    punch: 'The V100 is missing less silicon than it is missing software.',
  },
  {
    id: 'eol',
    start: 845,
    end: 930,
    kicker: 'THE UNCOMFORTABLE PART',
    title: 'The calendar is the real competitor',
    line: 'CUDA 13 removed Volta entirely. Driver 580 is the final branch. PyTorch 2.14 is the last prebuilt wheel.',
    spec: {kind: 'timeline', items: [
      {when: 'AUG 2025', what: 'CUDA 13 · Volta removed · new code ✗', tone: 'bad'},
      {when: 'SEP 4 2025', what: 'PyTorch 2.14 · last wheel', tone: 'bad'},
      {when: 'MID 2028', what: 'Driver 580 · end of support', tone: 'bad'},
      {when: 'TODAY', what: 'Community forks · 4 projects · 0 from Nvidia', tone: 'good'},
    ]},
    punch: 'Four community projects keep this card alive. Zero of them are from Nvidia.',
  },
  {
    id: 'math',
    start: 930,
    end: 1000,
    kicker: 'THE REAL MATH',
    title: 'Break-even lands on end-of-support',
    line: 'Power costs 23¢ per million tokens against a hosted 47¢. The $3,500 pays itself back in 14.5 billion tokens.',
    spec: {kind: 'bars', title: 'Cost per million tokens', max: 500, bars: [
      {label: 'Hosted · Alibaba', value: 47, display: '$0.47', tone: 'accent'},
      {label: 'V100 rig · power only', value: 23, display: '$0.23', tone: 'good'},
    ]},
    punch: '24/7 = 3 years to break even. Support ends mid-2028. Same season.',
  },
  {
    id: 'verdict',
    start: 1000,
    end: 1044.79,
    kicker: 'VERDICT',
    title: 'It beats the GPU. It can\'t beat the calendar.',
    line: 'Yes, a 9-year-old GPU is genuinely faster at writing. But the comparison that matters is the V100 versus the calendar.',
    spec: {kind: 'cards', items: [
      {title: 'IF YOU HAVE SOLAR + LIKE THE BUILD', body: 'DO IT · treat releases as gifts', tone: 'good'},
      {title: 'IF YOU JUST WANT THE MODEL', body: 'RENT IT · hosted has no expiry', tone: 'accent'},
    ]},
    punch: 'I found 4 V100s on eBay. I\'m not closing the tab.',
  },
];

/** Helpers shared by renderers */
export const sceneAt = (t: number): Scene =>
  SCENES.find((s) => t >= s.start && t < s.end) ?? SCENES[SCENES.length - 1];

export const sceneIndexAt = (t: number): number => {
  const i = SCENES.findIndex((s) => t >= s.start && t < s.end);
  return i === -1 ? SCENES.length - 1 : i;
};

export const toFrames = (sec: number) => Math.round(sec * FPS);
