---
name: script-writing
description: Write a narration script for a video from material the user supplies (article links, Reddit posts, notes, files) and a target duration. The script must sound like a specific, informed person talking, not like AI. Use when asked to write, draft or rewrite a video script or voiceover from sources.
---

# Script writing

You write the words a narrator will say. The film is built afterwards from the recording and this script, so the
script carries the whole argument: if it is dull or generic, no animation will save it.

The bar is an accurate script that rewards the viewer's attention and sounds natural in the creator's voice.
Choose its genre before drafting: explanation, argument, tutorial or reported story. An argument needs a defensible
position; a tutorial needs a usable outcome; a story needs an honest sequence of events. Do not force one into another.

## Inputs

- **Sources**: links or files from the user. These are the research. Read every one in full.
- **Duration**: target running time. Convert it to a word budget (see `references/speech-and-tts.md`).
- Optional: a title, an angle, an audience, and creator notes (their own results, opinions, earlier videos, how they
  talk). Creator notes are the only legitimate source of first-person experience. They are also the biggest single
  improvement available: reactions, frustrations, things the creator got wrong. When the notes are thin, say in your
  report which moments would benefit from a line of the creator's own experience, rather than inventing one.

Use the duration in the brief; otherwise use a positive `length` from `video.config.json` (seconds). If both are absent
or the config says null, ask for the missing duration. Respect explicit user choices. Record genre, audience, voice,
target minutes and chosen words per minute in `research.md`; use that same rate for budgeting and linting.

## Outputs

Work in `outputs/scripts/<slug>/` (create it):

| File | Contents |
|---|---|
| `sources/NN-<name>.md` | the extracted text of each source, with its URL |
| `research.md` | facts worth using (each with source and a short verbatim quote), open questions, tensions, candidate angles and openings, the choice you made and why |
| `SCRIPT.md` | the narration only: plain spoken text, one paragraph per beat, nothing a TTS voice would read wrongly |
| `review.md` | a fresh reviewer's quoted findings, evidence checks, and final disposition; not the writer's self-review |

## Process

### 1. Read and take notes like a researcher, not a summariser

Fetch each link with `node .opencode/skills/script-writing/scripts/fetch.mjs <url> <out.md>` (dependency-free text
extraction; use your harness's fetch tool or a browser if a page is script-rendered). For a GitHub repository, read the
files that matter, not just the README. The fetcher accepts ordinary Reddit post URLs or their `.json` forms and gets
the post and top comments. Check the extraction covers the supplied material; a nonempty file is not proof of completeness.

While reading, collect in `research.md`:

- **Facts with teeth**: numbers, names, dates, mechanisms, quotes, each traced to a source. Prefer the fact that would
  make a viewer say "wait, really?" over the one that merely confirms what they assumed.
- **Concrete artifacts**: things that exist and could be shown on screen. A footnote, a config file, a price tag, a
  chart, a comment thread, a line of code. Scripts that point at real things feel researched; scripts that describe
  categories feel generated.
- **The questions** a smart, sceptical viewer would ask at each step, in the order they would ask them.
- **Tensions**: where sources disagree, where the common belief is wrong, where the incentive of someone involved
  explains something, where a cost hides.

For the central measurements and claims the argument depends on, follow secondary articles to the primary evidence
(the original paper, measurement or code). Record which source you actually inspected, its scope and caveats. If the
primary evidence is unavailable, attribute the secondary report and narrow the claim or leave it out. Never promote a
blog's account into a measurement you verified. Label inference and opinion separately from observation; factual
sentences without numbers still need support. Never fill a gap from memory with a specific number or quote.

### 2. Choose, then close the sources

Rich sources tempt you to use all of them. The most common failure of a researched AI script is a digest: fact,
source, fact, source, at an even pace, with the narrator passing along what others said. Avoid it in two steps.

- **Select.** Mark the facts the script actually needs, the ones it would be weaker without, and
  pick the few that deserve the most time. Scale their number to the duration; a short may need only one. Everything
  else stays in `research.md`. Depth beats coverage: one fact explained until the viewer feels it beats four listed.
- **Explain it.** Once you understand the material, explain the reasoning in the creator's voice, retaining attribution
  where the evidence or idea belongs to someone else. Do not imply you ran a study, discovered a fact or experienced an
  event yourself. The viewer should follow an explanation, not a sequence of source summaries.

### 3. Find the spine before writing a sentence

Answer these in `research.md`, in one or two sentences each:

1. **What does the viewer take away?** The claim for an argument, the working mental model for an explanation,
   the result for a tutorial, or the change in circumstances for a story.
2. **Why should this viewer care now?** What it costs them, changes for them, or explains about something they have
   already noticed.
3. **What drives the next beat?** The unresolved question, practical obstacle, tension or consequence. For commentary,
   choose a stance grounded in the evidence; do not invent controversy or industry stakes for a neutral explanation.

Consider distinct openings and structures before choosing; record why the choice serves this audience and genre.
Avoid a fixed candidate count for small requests. See `references/craft.md` for options rather than a template.

### 4. Draft for the ear

Write the whole draft in one pass, at about the word budget, in the voice you chose. Follow `references/craft.md`.
Give particular attention to the opening promise and its payoff. Scale both to the duration; do not consume a short
with an eight-minute video's introduction and conclusion.

### 5. Revise in separate passes

Read the draft once per pass, each time looking for one thing only:

1. **Ear pass.** Say every sentence in your head at speaking speed. Rewrite anything you would not say to a friend
   across a table: stacked clauses, nominalisations ("the implementation of"), participial tails (", highlighting..."),
   words you would only write.
2. **Specificity pass.** Ground important claims in a concrete case or mechanism from `research.md`. Replace generic
   filler; keep connective or explanatory beats when they help the viewer follow the argument.
3. **Momentum pass.** Each beat must answer the question the previous beat raised, or raise the next one. Mark any beat
   whose removal the viewer would not notice, and remove it. Check that the ending fulfills the opening's promise;
   a callback is useful when earned, not mandatory.
4. **Ownership pass.** Count the named sources. Keep a name only where it adds weight a viewer would care about (a
   company admitting something about its own product, a primary measurement); restate everything else as your own
   explanation. Keep attribution necessary for trust and fairness; do not optimize a source-count quota.
5. **Tells pass.** Run `node .opencode/skills/script-writing/scripts/lint.mjs outputs/scripts/<slug>/SCRIPT.md --minutes
   <target> --wpm <chosen-rate>` and work through `references/tells.md`. Fix format/budget errors. Treat style counts
   as prompts to listen again, not targets or an AI detector; the reference sample is small and genre-specific.
6. **Truth pass.** Every factual claim, including comparisons and causal explanations, is supported by the saved sources
   and accurately represented in `research.md`. Check context, scope and attribution as well as numbers, names and quotes.
   Hedge exactly as much as the source hedges.
   Anecdotes stay anecdotes. No invented personal experience: "I" statements about doing things come only from creator
   notes.

### 6. Fresh review and finish

Before delivering a newly researched script, ask the host to commission a fresh reviewer with no writing history.
Give it the brief, script, saved sources and research notes, and `references/review.md`. The host can use any strong-model
sub-agent; never claim independent review from a self-check. Small wording-only edits need not repeat research review
unless claims change. If delegation is unavailable, state that review is incomplete.

Address concrete editorial or factual findings, then have the reviewer check the revision. Stop after two revision
rounds and report unresolved blockers as a draft instead of silently passing it. No user approval step is introduced.

`SCRIPT.md` is plain text: no headings, stage directions, timestamps, Markdown or emoji. Report the word count, the
estimated duration and speaking-rate assumption, the takeaway, review status, and anything unresolved. A duration based
on word count is an estimate, not measured narration length. The lint checks format and budget, not truth or engagement.

## References

- `references/craft.md`: how good spoken scripts are built (openings, structures, voice, rhythm, endings).
- `references/tells.md`: patterns that mark text as AI-written, and how to fix each.
- `references/speech-and-tts.md`: word budgets, and writing for a TTS voice.
- `references/review.md`: the fresh reviewer's editorial and factual checks and report.
