---
name: script-writing
description: Write a narration script for a video from material the user supplies (article links, Reddit posts, notes, files), at the length the user asks for or, when they name none, a length chosen to fit the material. The script must sound like a specific, informed person talking, not like AI. Use when asked to write, draft or rewrite a video script or voiceover from sources.
---

# Script writing

You write the words a narrator will say, and the visual plan the film is built from. The film is built afterwards from
the recording, this script and its visual plan by agents on a weaker model, so you carry the whole argument and the
whole picture: if the script is dull or the plan is vague, no animation will save it.

The bar is an accurate script that rewards the viewer's attention and sounds natural in the creator's voice.
Choose its genre before drafting: explanation, argument, tutorial or reported story. An argument needs a defensible
position; a tutorial needs a usable outcome; a story needs an honest sequence of events. Do not force one into another.

## Inputs

- **Sources**: already gathered for you by the script researcher (a cheaper model) in `jobs/scripts/<slug>/sources/`,
  indexed by `SOURCES.md` with the user's brief verbatim. These are the research. Read `SOURCES.md` and every source
  file in full. You do not fetch links, search the web or open URLs yourself; when you need more, ask (see step 1).
- **Duration** (optional): target running time. When the brief names none, you choose it (see *Choosing the length*).
  Either way, convert it to a word budget (see `references/speech-and-tts.md`).
- Optional: a title, an angle, an audience, and creator notes (their own results, opinions, earlier videos, how they
  talk). Creator notes are the only legitimate source of first-person experience. They are also the biggest single
  improvement available: reactions, frustrations, things the creator got wrong. When the notes are thin, say in your
  report which moments would benefit from a line of the creator's own experience, rather than inventing one.

Use the duration in the brief; otherwise use a positive `length` from `video.config.json` (seconds). If both are absent
or the config says null, choose the length yourself; never stop to ask for one. Respect explicit user choices. Record
genre, audience, voice, target minutes (and whether it was requested or chosen) and the words per minute in
`research.md`; use that same rate for budgeting and linting.

### Choosing the length

Choose after research, not before: the length is the time the promise needs with the evidence you actually have.

- **Count the beats.** List the steps the viewer must take (the question, each mechanism or test, the counterexample,
  the answer) and give each the time it needs to land, usually 20 to 60 seconds in long-form. The sum is the length.
- **Let the material set the range.** One surprising mechanism or one piece of news explained: 2 to 4 minutes. A
  comparison, buying decision or multi-step tutorial: 5 to 10 minutes. An investigation backed by plenty of primary
  evidence: 10 to 15 minutes. Thin sources make a short film, never a padded long one.
- **Vertical short-form** (reel, short, `--format vertical`): one idea and one payoff in 30 to 60 seconds, never more
  than `verticalMaxSeconds` in `video.config.json` (90 by default).
- **When torn, go shorter.** A beat the viewer would not miss is cut, not stretched to fill time.

Write in `research.md` the chosen target, the beat count and one sentence on why that length fits. Then budget and lint
against it exactly as you would a requested length, and report it to the host as the chosen length.

## Outputs

Work in `jobs/scripts/<slug>/` (create it):

| File | Contents |
|---|---|
| `sources/NN-<name>.md` | the extracted text of each source, with its URL (saved by the researcher; you do not edit them) |
| `SOURCES.md` | the researcher's index: brief, every source with its kind and completeness, unreachable primary evidence |
| `research.md` | facts worth using (each with source and a short verbatim quote), open questions, tensions, candidate angles and openings, the choice you made and why |
| `SCRIPT.md` | the narration only: plain spoken text, one paragraph per beat, nothing a TTS voice would read wrongly |
| `VISUALS.md` | the visual plan: concept, design theme, scenes with their on-screen events at exact words, assets, thumbnail (`references/visuals.md`) |
| `review.md` | a fresh reviewer's quoted findings, evidence checks, and final disposition; not the writer's self-review |

## Process

### 1. Read and take notes like a researcher, not a summariser

The researcher has already fetched every source, followed articles to their primary evidence and recorded what it
could not reach (`references/sourcing.md`). Start from `SOURCES.md`, then read each source file in full. Note any
extraction it marks incomplete and any primary evidence it could not reach: those limit what you can claim.

**Need more evidence?** Do not fetch it yourself. Add a `## Evidence requests` section to `research.md` listing
exactly what you need and why (a primary paper behind a number, a missing section, a counter-view), then stop and reply
`NEEDS SOURCES` with that list. The host sends the researcher, then resumes you. After one such round, work with what
you have: narrow the claim, attribute it to the secondary report, or leave it out.

While reading, collect in `research.md`:

- **Facts with teeth**: numbers, names, dates, mechanisms, quotes, each traced to a source. Prefer the fact that would
  make a viewer say "wait, really?" over the one that merely confirms what they assumed.
- **Concrete artifacts**: things that exist and could be shown on screen. A footnote, a config file, a price tag, a
  chart, a comment thread, a line of code. Scripts that point at real things feel researched; scripts that describe
  categories feel generated.
- **Quotable lines**: the exact sentence, table row or config line you may put on screen, copied verbatim with its URL
  and who said it. The visual plan shows these as source cards and spec sheets, so they must be word for word.
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
5. **Tells pass.** Run `node .opencode/skills/script-writing/scripts/lint.mjs jobs/scripts/<slug>/SCRIPT.md --minutes
   <target> --wpm <chosen-rate>` and work through `references/tells.md`. Fix format/budget errors. Treat style counts
   as prompts to listen again, not targets or an AI detector; the reference sample is small and genre-specific.
6. **Truth pass.** Every factual claim, including comparisons and causal explanations, is supported by the saved sources
   and accurately represented in `research.md`. Check context, scope and attribution as well as numbers, names and quotes.
   Hedge exactly as much as the source hedges.
   Anecdotes stay anecdotes. The narrator speaks as "I" for opinions and reactions, but never invents an experience:
   "I" statements about doing things ("I bought", "I tested") come only from creator notes. Without notes, the opening
   scene belongs to the viewer ("you") or to a real person from the sources.

### 6. Write the visual plan

Once the narration is final, write `VISUALS.md` following `references/visuals.md`. This is where your creative
thinking about the picture goes: the whole-film concept, the one design theme, every scene's stage and events tied to
exact words, the assets, the prototype scene and the thumbnail. Write it for builders who will do exactly what it says
and invent little. The concrete artifacts you collected in `research.md` are your best material.

### 7. Fresh review and finish

Before delivering a newly researched script, ask the host to commission a fresh reviewer with no writing history.
Give it the brief, script, visual plan, saved sources and research notes, and `references/review.md`. The host can use any strong-model
sub-agent; never claim independent review from a self-check. Small wording-only edits need not repeat research review
unless claims change. If delegation is unavailable, state that review is incomplete.

Address concrete editorial or factual findings, then have the reviewer check the revision. Stop after two revision
rounds and report unresolved blockers as a draft instead of silently passing it. No user approval step is introduced.

`SCRIPT.md` is plain text: no headings, stage directions, timestamps, Markdown or emoji; all visual direction goes
in `VISUALS.md`. Report the word count, the
estimated duration (and whether the length was requested or chosen, with the reason) and speaking-rate assumption, the takeaway, review status, and anything unresolved. A duration based
on word count is an estimate, not measured narration length. The lint checks format and budget, not truth or engagement.

## References

- `references/craft.md`: how good spoken scripts are built (openings, structures, voice, rhythm, endings).
- `references/tells.md`: patterns that mark text as AI-written, and how to fix each.
- `references/speech-and-tts.md`: word budgets, and writing for a TTS voice.
- `references/visuals.md`: the visual plan the film is built from, and its required structure.
- `references/sourcing.md`: how the script researcher gathers and saves the sources before you start.
- `references/review.md`: the fresh reviewer's editorial and factual checks and report.

## A visual plan for an existing script

When the pipeline asks for a visual plan for a script it already has (a supplied recording or script), follow only
`references/visuals.md` and its "For a supplied script" section: never change the narration.
