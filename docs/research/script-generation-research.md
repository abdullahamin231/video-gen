# Generating human-sounding scripts

Research and repository review: 16 October 2026.

Status: historical research and experiment notes. The proposals below are not a list of implemented features;
the current workflow is `.opencode/skills/script-writing/SKILL.md`. The cited studies have not been independently
reverified in this implementation review. The one-topic comparisons in §5 are exploratory, not a validated quality
benchmark or an AI detector; their style ranges must not be treated as universal targets.

The goal is a new front end for the pipeline. The user gives a topic, one or more articles, or a few Reddit posts, plus a
target duration. The agent researches the material and writes a script that sounds like a person wrote it. HyperFrames
TTS (local Kokoro) reads it, and the existing `start` → `next` flow turns the audio and script into a film. Voice quality
is out of scope for now.

**Update, same day.** The user supplies the source links, and all thinking and writing runs on a strong model, so
the search-provider and weak-model parts of §3 no longer apply. What was built is the `script-writing` skill
(`.opencode/skills/script-writing/`): a writing process, craft and tells references, a dependency-free fetcher and a
lint that prints reference ranges measured on human narration. §5 records how it was tuned.

This report separates what the research says, what the `unslop` skill already covers, and what I propose building. I
have not changed any code.

## 1. What the research says makes AI text read as AI

### The tells come from habits that are measurable and consistent

- **Instruction-tuned models write in a different grammatical register.** A PNAS paper from February 2025 (Reinhart et
  al., "Do LLMs write like humans?") compared texts on Douglas Biber's lexical, grammatical and rhetorical features. It
  found systematic differences between LLMs and humans. The gaps persist as models get larger and are bigger for
  instruction-tuned models than for base models. As I recall the paper (I did not re-check this detail for this
  report), the features that stand out are present participial clauses and nominalisations ("highlighting the importance of...", "the implementation of..."). Both are written-register habits
  that sound wrong when read aloud.
- **Human text varies more, and its syntax is simpler.** Zanotto and Aroyehun (EMNLP 2025) measured 11 LLMs across 8
  domains. Human texts varied more on almost every feature, and newer models were converging on the same style. Human
  texts had simpler syntax and more varied semantic content. A companion paper found human writing is less cognitively
  demanding, carries more semantic content and more emotion, and that the gap is widest in genres with loose style rules.
  Spoken scripts are one of those genres.
- **Particular phrases are over-represented by orders of magnitude.** The Antislop paper (Paech et al., ICLR 2026)
  profiled model output against human baselines. Some patterns appear more than 1,000 times as often in model output as
  in human writing. Its sampler suppresses over 8,000 patterns by backtracking, while plain token banning breaks down at
  about 2,000. The authors released their slop-profiling pipeline and pattern lists under MIT.
- **Models tend to pick the most typical answer.** The Verbalized Sampling paper (Zhang et al., 2025) traces this to
  preference data, because annotators reward familiar text. Asking the model for several candidates with stated
  probabilities, instead of one answer, raised creative-writing diversity 1.6 to 2.1 times. That matters for hooks and
  angles, where the typical choice is the forgettable one.

### Professional editors agree on what to fix

Chakrabarty, Laban and Wu ("Can AI writing be salvaged?", 2024–25) had 18 professional writers edit 1,057 paragraphs
from Claude 3.5 Sonnet, GPT-4o and Llama 3.1-70B, which produced 8,035 edits (the LAMP corpus). They grouped the edits
into seven categories, including clichés, unnecessary exposition, purple prose, poor sentence structure and lack of
specific detail. No model family wrote clearly better than the others. Automatic editing guided by the taxonomy closed
part of the gap, but readers still preferred the expert-edited text.

Wikipedia's "Signs of AI writing" guide (WikiProject AI Cleanup) collects similar tells from real drafts: promotional
wording, editorial asides such as "it's important to note", summaries at the end of each section, title-case headings,
leaked Markdown, and invented citations. It warns that no single sign proves anything. Humans use all of these patterns
too. What gives AI text away is how often they occur.

### LLM judges are useful but biased toward surface style

- LitBench (2025) built story pairs from Reddit with human preference labels. The best off-the-shelf judge (Claude 3.7
  Sonnet) agreed with readers 73% of the time, and trained reward models reached 78%.
- Several 2025–26 papers report that judges write convincing critiques yet anchor their scores on surface features.
- In one study, expert readers preferred human writing in 83% of blind pairs, while lay readers preferred the AI
  writing.

So surface checks should be deterministic code, and the judge model should answer narrow questions about substance. A
single score out of 10 is the least reliable form of judgement.

### What practitioner guides add for spoken scripts

The scriptwriting guides found are mostly vendor blogs with no controlled evidence, but they agree on the following.
Land the hook in the first one to three seconds. Keep one or two open loops in the middle and close every one you open.
Write short spoken sentences. Read the script aloud and cut anything that sounds like an essay. Use the creator's own
material and the audience's real questions rather than a bare topic. The repo's
`hyperframes-creative/references/narration.md` and `story-spine.md` say the same: about 2.5 words per second,
contractions, varied sentence length, a hook that is not "Welcome to...", and value before evidence.

### TTS constraints (Kokoro via `npx hyperframes tts`)

- Kokoro reportedly ignores SSML, emotion tags and capitals. Punctuation is the only control: a period is a long pause
  that resets intonation, and a comma is a short breath. This comes from a third-party guide, so test it on our voice.
- TTS reads text literally. Write numbers, symbols and acronyms as they should be spoken ("ten times", "A P I"). Strip
  Markdown. `narration.md` already has a pronunciation table.
- The narration guidance assumes 145–155 words per minute, but the real rate depends on the voice and speed setting.
  Measure it rather than assume it (see §4).

## 2. The `unslop` skill (`~/.config/opencode/skills/unslop/SKILL.md`)

It is a single 5.8 KB file of numbered rules (3–33, with gaps kept so other skills can cite numbers). It is marked
`disable-model-invocation: true`, so it runs only when called explicitly. The rules cover vague attributions, the AI
word list, "serves as" instead of "is", "not just X but Y", forced groups of three, synonym cycling, em dashes, colons,
bold and emoji, chatbot phrases, filler, hedging, generic conclusions, jargon metaphors, passive voice, adverbs, fancy
words, mannered prose and over-compression.

**What fits scripts well.** Most rules map directly onto findings in §1. Rule 3 targets participial phrases, which is
the PNAS finding. Rules 25 and 27 target generic statements, which matches the lack of specific detail flagged by
LAMP. Rule 7 is a short slop list. Rules 13 and 14 (no em dashes, few colons) also help TTS, because Kokoro's pauses
come from periods and commas.

**What needs changing for spoken scripts.**

1. **Rule 32 bans rhetorical fragments, but spoken scripts need them.** "And then you see the prices." is a fragment,
   and it is the most human line in the GPU sample script. Keep the ban on aphorisms and personified things, and allow
   fragments in speech.
2. **Many rules target document formatting (15–19) and don't apply to a script read aloud.** For scripts, the rule is
   simpler: plain text only, with nothing TTS would read out.
3. **It has no spoken-genre tells.** Missing: "In today's video", "Let's dive in", "buckle up", "game-changer",
   "Imagine a world where", "But here's the thing", "It's not X. It's Y." reversals, a rhetorical question opening every
   section, a punchline closing every paragraph, every section the same length, and a tidy moral at the end ("So the
   next time you...").
4. **It treats patterns as bans, while the research says density matters.** The CBS ransomware script, written by a
   human, says "here's the catch". One per script is fine. One per paragraph is a tell. A lint should count occurrences
   per minute, not reject a phrase outright.
5. **It is an editing pass only.** The research says the largest gains come before editing: real source detail (the
   semantic-content gap), a chosen voice, and choosing among several angles. Editing can't add specifics that the draft
   never had.

**Recommendation.** Copy the rules into the repo (into a script-editor brief and a lint table, citing unslop rule
numbers in warnings). Add a spoken-genre section, and relax rule 32 for speech. Agents in every harness then get the
same rules, without depending on a skill installed only in the user's OpenCode config.

## 3. Proposed design

This follows the repo's existing approach: `next` drives every step, sub-agents work from self-contained briefs, code
catches broken output, and judgement goes to independent reviewers. Script writing is a creative role, so the writer
and the reviewers should run on the strong model, like the director.

### Inputs

```bash
npm run video -- script --topic "Why old GPUs are back" --duration 60
npm run video -- script --article <url> [--article <url>] --duration 90
npm run video -- script --reddit <post url> [--reddit <post url>] --duration 45 [--mode story|synthesis]
# optional for every input: --voice-notes <file>, --angle "<one line>", --audience "<one line>"
```

When the script stage finishes, the pipeline runs `hyperframes tts` itself and then continues into the existing
`start` flow with the generated audio and `SCRIPT.md`. The user still asks for one thing and gets back one MP4.

### Stages

| Stage | Who | Writes | Checked by |
|---|---|---|---|
| Gather | pipeline commands | `research/sources/*.md`: extracted article text, or a Reddit post with its top comments, each with URL, author and date | fetch succeeded, text non-empty |
| Research | `script-researcher` sub-agent | `research/ledger.json`: claims, each with a verbatim quote, source id and confidence; `research/angles.md` | every claim's quote occurs in a saved source |
| Angle | writer sub-agent | 4–6 candidate angles and hooks with stated likelihood (verbalized sampling), then one chosen, with the reason | – |
| Draft | writer sub-agent | `script/outline.md`, `script/draft.md` | word budget, ledger coverage |
| Edit | script-editor sub-agent (fresh context) | `script/SCRIPT.md` plus an edit log | `script-lint` (deterministic) |
| Review | 2 fresh reviewer sub-agents | listener and fact-check reports | `review-submit` |
| Voice | pipeline | `audio/narration.wav`, measured duration | duration within ±7% of target, otherwise a trim or expand brief |

**Gather stays in code, not in the agent.** `npm run video -- research search "<query>"` and `research fetch <url>`
save extracted text into the job. This keeps evidence inside the repo (an existing rule) and works in harnesses without
web tools. For extraction, Mozilla Readability with jsdom stays in Node.
Trafilatura scores better on the published benchmarks but needs Python. For search, an independent 2026 benchmark found
Brave, Exa, Firecrawl and Parallel statistically tied on quality, with Tavily about a point lower. Brave runs its own
index and needs a separate fetch step. Exa returns page content. Read the key from an env var, and fall back to the
harness's own WebSearch when it is unset.

**Research follows STORM** (Stanford, NAACL 2024). The researcher lists three to five perspectives on the topic (for
example a sceptic, a buyer, an engineer), writes the questions each one would ask, then searches and fetches to answer
them. In the paper this produced articles judged better organised (by 25 points absolute) and broader (by 10 points)
than a plain retrieve-then-outline baseline. Experts flagged that it carries over source bias and links unrelated
facts. The ledger's verbatim-quote rule and the fact-check reviewer address both problems.

**Reddit has two modes.**

- `story` narrates one post, for example a TIFU or a build log. Keep the poster's first-person arc, but retell it in
  our own words rather than reading it out. Credit the user handle on screen only if the user wants that.
- `synthesis` combines several threads into "what people found". The comments supply the perspectives, which is the
  STORM idea again, and vote counts help decide which claims matter. Present anecdotes as anecdotes ("one commenter
  said..."), never as established fact.

Getting the data: the free OAuth API allows about 100 queries per minute per client. Adding `.json` to a post URL works
without authentication at about 10 requests per minute, which is plenty for a few posts. Reddit's Responsible Builder
Policy requires written approval for commercial use. Several 2025–26 reports say new apps, including personal ones,
now need pre-approval, and one unconfirmed report says Reddit stops accepting new requests on 31 October 2026. A
monetised channel probably counts as commercial use. Check Reddit's current Data API terms before relying on this
beyond personal use.

### What makes the writer sound human

Put these in the writer brief, in order of effect:

1. **Specifics from the ledger.** Every paragraph has at least one named thing, number, place, person or concrete
   action from a source. This is the semantic-content gap from §1, and it is the most effective fix.
2. **A voice card** (`script/voice.md`), chosen once per script: who is speaking, what they think about the topic, how
   they talk (pace, humour, what they would never say), and a short sample in that voice. `--voice-notes` supplies it
   when the user has a channel persona.
3. **Honest first person.** The GPU sample works because a person tells their own story. The writer must never invent
   personal experiences ("I tested this last week"). Personal lines come from `--voice-notes`, from a Reddit post's own
   author ("this guy spent three weeks..."), or not at all. Invented experiences would be the "untrue" output the
   pipeline already treats as an error.
4. **Spoken grammar.** Simple clauses, verbs instead of nominalisations, no participial tails, contractions, varied
   sentence length, and fragments where a speaker would use one. Start some sentences with "And" or "So". Use one or two
   open loops, and close each one.
5. **Several drafts, compared pairwise.** Write at least two hooks and two outlines, and have a fresh agent pick between
   pairs with a reason. Pairwise choices are more reliable than scores (LitBench).
6. **Write to the clock.** Budget words per scene from the measured voice rate, and write about 10% short to leave room
   for pauses (`narration.md` suggests 2.3 words per second against 2.5 available).

### `script-lint`: surface checks in code, not in the judge

Following the repo's convention: errors for broken or untrue output, warnings for style that an agent may break on
purpose with a note.

**Errors**
- Word count outside the budget, or measured TTS duration more than 7% off target (checked after voicing).
- A number, name or quotation in the script that is not in the ledger. This extends the existing "unsourced numbers"
  build error to the script stage.
- Text TTS would read out: Markdown, emoji, URLs, unspoken symbols (`%`, `$`, `&`, `/`, `→`), or digits in forms Kokoro
  mispronounces (test the list).
- Stage directions or timestamps left in the narration.

**Warnings** (rates per minute of audio, citing unslop rule numbers where one exists)
- AI vocabulary (rule 7, extended with the Antislop lists), "serves as" (8), "not just X but Y" (9), em dashes (13),
  chatbot phrases (20), filler (23), hedging (24), generic conclusions (25), participial "-ing" tails (3).
- The new spoken-genre list from §2.
- Uniformity: low variance in sentence length, more than half the sentences starting the same way, repeated openers
  within a scene, every paragraph ending in a question or punchline, too many groups of three.
- Average sentence over about 20 words, or nominalisation density above a threshold. Tune both on human scripts such as
  those in `inputs/scripts/`.

Calibrate the warning thresholds on the human scripts already in `inputs/scripts/`, so the lint does not flag normal
human speech.

### Reviewers

The surface lint runs before the reviewers, so they only judge substance.

- **Listener.** Listens to the TTS render (or reads it aloud for a model without audio input). Questions: Is the value
  clear within ten seconds? Is there a point where you would stop watching, and at what line? Which line sounds like a
  chatbot? Is each open loop closed? Answers must quote lines.
- **Fact-checker.** Checks each claim in the script against the ledger quote and source. Flags claims that the source
  states more cautiously than the script does, and anecdotes presented as general fact.

A failed review produces a revision brief through `next`, just as scene repairs do.

### UI

Begin with no new UI. The orchestrator conversation is the interface, as it is now. After each script run, `next`
writes `script/report.html`. It shows the sources (with links), the claim ledger, the chosen angle and the rejected
ones, the script with lint warnings highlighted, words against the budget, and an audio player for the TTS render. That
is enough to see how the agent researched the topic.

An interactive version can come later through `npm run video -- preview`: tick sources on or off, pin or drop claims,
pick a different angle, and send it back to the writer. Build that only after the automated loop produces good scripts,
because otherwise the UI just hides the problem.

## 4. Open questions to settle before building

1. **Search key.** Brave, Exa or Tavily, or only the harness's own web search. A key makes the pipeline harness-neutral.
2. **Reddit use.** Personal or monetised. This decides whether the `.json` endpoint is enough.
3. **Voice rate.** Measure the actual words per minute of the chosen Kokoro voice once, and store it in the kit config.
4. **Persona.** Whether there is a fixed channel voice (one `voice-notes` file reused for every script) or a new voice
   per script.
5. **A golden set.** Five or so human scripts the user considers excellent, to calibrate the lint and to give the
   pairwise judge examples. The memory notes say not to add reference videos. Reference scripts are a different and
   much lighter input, but confirm first.

## 5. Tuning the skill against a human script

Target: the human "Agent Harness explained in 8min" transcript in `inputs/scripts/`. Each round, a fresh Opus writer
got the same brief (title, 8 minutes at 195 words per minute, seven source links, one creator note) and was barred from
reading `inputs/` or searching for the original. A fresh blind judge then compared its script with the human one, with
the A/B order varied. Only general principles were added to the skill; no lines or structure from the human script.

| Round | Judge would rather watch | Judge's confidence the AI script is AI | Main remaining problem |
|---|---|---|---|
| 1 | human | 85% | research digest: 11× the human's rate of named sources, staccato sentences, punchline paragraph ends, checklist ending |
| 2 | AI | 80% | 8.5 numbers/min against 3.6, few spoken connectives, never points at the screen, scripted reactions |
| 3 | human, narrowly | 75% | one car metaphor stretched over the whole script, even coverage, slogan ending |
| 4 | AI | 75% | dutiful counterpoint sections, mirrored pairs, aphoristic paragraph ends, no personal friction |

Outputs are in `outputs/scripts/harness-r1` … `harness-r4`. Round 4 sits inside every lint reference range. The
remaining gap is mostly first-person friction, which only creator notes can supply honestly. The judges' later advice
also starts to contradict itself, and to reward imitating the human's slips. Further rounds would overfit to one
creator, so the next test should use a different genre (a Reddit-story video, for example).

## Sources

- Reinhart et al., "Do LLMs write like humans? Variation in grammatical and rhetorical styles", PNAS 2025 —
  https://researchwith.njit.edu/en/publications/do-llms-write-like-humans-variation-in-grammatical-and-rhetorical/
- Zanotto and Aroyehun, "Linguistic and Embedding-Based Profiling of Texts Generated by Humans and LLMs", EMNLP 2025 —
  https://arxiv.org/abs/2507.13614 ; "Human Variability vs. Machine Consistency" — https://arxiv.org/html/2412.03025v1
- Paech et al., "Antislop", ICLR 2026 — https://arxiv.org/abs/2510.15061
- Zhang et al., "Verbalized Sampling" — https://arxiv.org/abs/2510.01171v3
- Chakrabarty, Laban and Wu, "Can AI writing be salvaged?" — https://arxiv.org/abs/2409.14509v3
- Wikipedia "Signs of AI writing", coverage —
  https://techcrunch.com/2025/11/20/the-best-guide-to-spotting-ai-writing-comes-from-wikipedia/
- LitBench — https://arxiv.org/pdf/2507.00769v1 ; "Evaluation Illusion" — https://arxiv.org/html/2603.11027v1 ;
  expert vs lay judges — https://arxiv.org/html/2601.18353v1
- STORM — https://storm-project.stanford.edu/research/storm/ , https://arxiv.org/html/2402.14207v2
- Extraction: WCXB benchmark — https://arxiv.org/pdf/2605.21097 ; trafilatura evaluation —
  https://trafilatura.readthedocs.io/en/latest/evaluation.html
- Search APIs: https://parallel.ai/articles/best-ai-search-for-agents.md ,
  https://rhumb.dev/blog/exa-vs-tavily-vs-serper-vs-brave-search
- Reddit: https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy ,
  https://www.socialcrawl.dev/blog/reddit-data-api-2026 ,
  https://replydaddy.com/blog/reddit-api-pre-approval-2025-personal-projects-crackdown
- Kokoro punctuation — https://deapi.ai/blog/kokoro-tts-guide-how-to-control-41-voices-with-nothing-but-punctuation
- Practitioner scriptwriting — https://rivereditor.com/guides/how-to-script-youtube-videos-2026 ,
  https://alpha.outlierkit.com/resources/chatgpt-prompts-for-youtube-scripts/
