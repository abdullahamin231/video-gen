# Research: automatic topic discovery and human review of story drafts

Research date: 19 October 2026. This is a research report and proposed design; no production workflow or job was changed.

**Recommendation:** add an editorial workflow before the existing video-production pipeline. It should continuously discover ideas across domains, recommend an evidence-backed shortlist, and develop a selected idea into a treatment, visual storyboard and script that a human can revise before narration is committed.

Kai is a reference for framing, specificity and story development. Its subject area should not constrain discovery. A broad editorial promise could be: “Explain surprising mechanisms behind things people encounter, use or make decisions about.” That is a starting hypothesis for the channel's identity, not a prescribed niche.

## 1. Evidence and limits

I inspected the repository's saved sample of 18 Kai title/thumbnail pairs and both visual contact sheets, plus the annotated transcript of the old-versus-new GPU video. The channel's live page did not load through the research browser; the channel observations below use the saved 19 October snapshot. The supplied transcript includes scene descriptions and timestamps, which I read; I did not independently watch the entire reference film or verify its technical measurements.

Local evidence:

- [Thumbnail study](kaiexplains-thumbnail-study.md), [source manifest](../research/kaiexplains-2026-10-19/manifest.json) and [channel listing](../research/kaiexplains-2026-10-19/channel-source.json).
- [Contact sheet 1](../research/kaiexplains-2026-10-19/contact-sheet-1.jpg) and [contact sheet 2](../research/kaiexplains-2026-10-19/contact-sheet-2.jpg).
- [Annotated reference transcript](../<../inputs/scripts/Can 9 year old GPU beats today's latest GPUs？.md>), associated with [this video](https://www.youtube.com/watch?v=eckOsa0kBkY).
- [Current pipeline contract](../orchestrator.md), [workflow documentation](../agent-workflow.md), [script-writing process](../../.opencode/skills/script-writing/SKILL.md) and [storyboard format reference](../../.opencode/skills/hyperframes/references/storyboard-format.md).

The saved listing has no per-video view counts, durations or publication dates. We have no channel impressions, CTR, retention, historical variants or controlled comparisons. The sample supports observations about editorial choices, not conclusions about what caused growth. Technical claims in its titles, thumbnails and transcript remain claims by the reference creator.

External research supports specific parts of the proposal:

| Evidence | What it supports | What it does not establish |
|---|---|---|
| YouTube's Trends documentation describes audience searches, related videos, breakout videos and content gaps, with availability limits. | Use actual audience questions and gaps as discovery inputs. | A trend or gap guarantees a successful video. |
| YouTube's Ask Studio documentation describes brainstorming, channel analysis, saved concepts and script feedback. The Inspiration page now says it is being deprecated in favor of Ask Studio. | Native tools can provide a useful comparison and optional channel-specific input. | A supported API for automating these Studio features. |
| STORM researches multiple perspectives before constructing an outline, while reporting source-bias and over-association problems. | Separate research and outline formation from prose drafting; seek counterevidence. | Proven audience retention benefits for videos. |
| Dramatron explores hierarchical script generation and interaction with industry professionals. | Develop and revise story structure above the sentence level. | Autonomous factual accuracy or a validated explainer template. |
| Adobe describes animatics as timed storyboard sequences for evaluating a production before detailed work. | Use a cheap temporal draft to assess ordering and pacing. | A polished storyboard proves the final film will communicate well. |

Sources: [YouTube Trends](https://support.google.com/youtube/answer/11962757?hl=en), [Ask Studio](https://support.google.com/youtube/answer/16291691?hl=en), [Inspiration transition](https://support.google.com/youtube/answer/15575509?hl=en), [STORM paper](https://aclanthology.org/2024.naacl-long.347/), [Dramatron publication](https://deepmind.google/research/publications/13609/), [Adobe animatics](https://www.adobe.com/uk/creativecloud/animation/discover/animatics.html). The workflow below is my synthesis of these sources and the repository's constraints.

## 2. What transfers from Kai across domains

The useful unit is a **viewer question with a concrete consequence**. In the sample, that often means whether existing equipment is sufficient, what to buy, why an apparent limitation exists, or how a surprising comparison works. The titles identify a specific object or constraint; the thumbnail often supplies the consequence or tension. The [saved study](kaiexplains-thumbnail-study.md) documents the individual pairs.

The annotated GPU transcript has a more developed argument than its headline suggests:

1. Establish a recognizable goal and an obstacle.
2. Introduce an apparent reversal of expectations.
3. Define the comparison and invite skepticism.
4. Explain the mechanism behind the result.
5. Introduce another constraint and a counterexample.
6. Test whether the initial explanation is sufficient.
7. Bring in practical costs and maintenance limits.
8. End with a conditional decision for different viewers.

My interpretation is that the story progresses by revising the viewer's explanation. A promising result becomes a mechanism question, then a question about practical usefulness. We can adapt that progression without adopting its domain, measurements, personal anecdotes or stronger thumbnail verdicts.

Examples of transferable story forms:

| Story form | Illustrative question in another domain | Evidence needed before making it |
|---|---|---|
| A hidden bottleneck | Why can adding a road fail to remove congestion? | Specific transport studies, network assumptions and a bounded case. |
| A surprising comparison | When can repairing something be preferable to replacing it? | Comparable costs, lifespan assumptions and relevant environmental evidence. |
| A sufficiency question | How much resolution can a viewer actually notice? | Viewing-distance, screen-size and perception evidence. |
| An invisible system | What happens between putting a parcel in a box and its delivery? | Documented operations, a concrete route and access to usable visual evidence. |
| A historical reversal | Why did a once-promising invention lose out? | Primary records, chronology and competing explanations. |

These are example research prompts, not verified claims or a recommended publishing slate. Do not impose a reversal or controversy on a subject whose strongest story is a clear demonstration, chronology or explanation.

## 3. Automatically deciding what to make

### Start with an editorial profile that allows breadth

Capture intended viewers, their assumed knowledge, language, geography, tone, desired video lengths, production capacity and the kinds of understanding the channel promises. Duration and format must be explicit for each commissioned story; the current repository defaults to landscape and has no default target length.

Domains should be extensible tags, not a whitelist. Science, engineering, economics, history, design, culture and everyday systems can all enter the same discovery process. A new cluster should be able to enter without rewriting the workflow.

Breadth still needs a recognizable viewing experience: a consistent level of explanation, evidence standard and curiosity. Test whether audiences overlap across subjects. If they do not, consider separate recurring series or editorial profiles; do not assume that a single audience wants every domain.

### Use three discovery paths

| Path | Inputs | What it contributes |
|---|---|---|
| Changes worth explaining | Research publications, product or project releases, official datasets, institutional announcements and reporting. | A reason to cover a subject now. |
| Persistent questions | Audience comments, search questions, recurring confusion, reference works and overlooked historical cases. | Evergreen subjects independent of the news cycle. |
| Connections and surprises | Compare mechanisms, incentives, tradeoffs or unresolved questions across source clusters. | Original angles beyond repeating a popular video's topic. |

Reporting, social posts and competing videos help locate questions. The decisive claim should be checked against the relevant original evidence where possible. Twenty articles repeating the same announcement remain one evidentiary origin.

For each candidate, retain the source URL, publication date, event date where applicable, retrieval date, original evidence, question, proposed angle, uncertainty and a possible visual demonstration. Cluster repeated coverage by event, entity and central claim, then compare with our own published and rejected ideas.

A practical cycle is: collect broadly, cluster cheaply, triage, research only the strongest candidates, then present a small shortlist. Start with five cards spanning several subjects; that number is a product choice to test, not a research finding. Allow the system to return fewer candidates when evidence is weak.

### Separate discovery signals from evidence

Use reference-channel metadata to learn packaging and find questions. Use the relevant subject sources to establish the answer. Track these separately in each card.

For public YouTube data, the official implementation guide describes retrieving a channel's uploads playlist; video details can be fetched using the video-list endpoint. Use these for a configurable group of reference channels across domains. [Uploads implementation](https://developers.google.com/youtube/v3/guides/implementation/videos), [video details](https://developers.google.com/youtube/data/reference/rest/v3/videos/list).

When enough observations exist, compare a reference video's performance with comparable uploads from that channel at a similar age. Repeated snapshots allow recent view growth to be estimated. A first snapshot cannot reconstruct an earlier trajectory. Separate Shorts from long-form, account for channel changes and treat sparse comparisons as uncertain. Raw views across unrelated channels are a poor basis for declaring a topic attractive.

Google Trends is another optional signal, but its index is sampled and normalized within the requested time and geography. A value of 100 is not a search count, and separately scaled requests do not establish relative absolute demand. [Google Trends methodology](https://support.google.com/trends/answer/4365533?hl=en).

For our own channel, use authorized analytics and Studio information when available. Audience retention can expose specific moments that lose or hold attention; average view duration and percentage provide additional context. Missing access should remain “unknown,” rather than an invented prediction. [Retention documentation](https://support.google.com/youtube/answer/9314415?hl=en), [Analytics metrics](https://developers.google.com/youtube/analytics/metrics).

Do not make competitor transcripts a required ingestion dependency. YouTube's official caption-download endpoint requires permission to edit the video. Public metadata access does not grant arbitrary transcript access. Use supplied or appropriately accessible material, and degrade gracefully when it is unavailable. [Caption-download requirements](https://developers.google.com/youtube/data/reference/rest/v3/captions/download).

### Rank ideas with explicit reasons

Assess these dimensions separately before combining them:

| Dimension | Question |
|---|---|
| Viewer relevance | Who cares, and what would they understand or do differently? |
| Curiosity | Is there a concrete unresolved question with a meaningful answer? |
| Evidence | Can the central promise be supported, including its limits? |
| Original contribution | What do we explain, demonstrate or connect beyond existing coverage? |
| Visual potential | Can we show the mechanism, change or evidence? |
| Timing and durability | Is there a credible reason to publish now, or lasting usefulness? |
| Production feasibility | Can this be made well with available time, assets and expertise? |

Use a small ordinal rubric and retain supporting observations. Keep missing data explicit. Any initial weights are editorial settings, not a trained probability of success. Evidence and deliverability can block commissioning even when curiosity is high.

After ranking, diversify the shortlist by subject, story form and freshness. Reserve room for unfamiliar subjects so the system does not learn “more of the last winner” as its entire strategy. A high-volume domain should not consume every slot merely because it produces more daily announcements.

### The human-facing topic card

Each card should contain:

- A provisional title and a one-sentence viewer promise.
- The intended viewer and why this idea matters now or remains useful.
- The specific angle and what existing coverage leaves unresolved.
- Key evidence links, strongest counterargument and unanswered questions.
- One visual explanation we could actually make.
- Expected duration range, production difficulty and the reason for its rank.
- Actions: develop, change angle, save, reject; a short reason for feedback.

Do not require the human to inspect a raw source feed or write configuration. Rejection reasons should distinguish “wrong audience,” “already covered,” “weak evidence,” “wrong angle” and “too expensive.” Those signals imply different future changes.

## 4. A high-level story workflow with human feedback

### Make the decisions progressively more concrete

| Draft | Artifact | Human decision |
|---|---|---|
| Topic and angle | Shortlist cards, with a recommended choice. | Is this a video we want to make? |
| Story treatment | Roughly one page: central question, provisional answer, stakes, evidence, counterargument, ending; two genuinely different routes if useful. | Is this the right argument and journey? |
| Visual storyboard | Numbered beats, rough panels, narration summaries, evidence and approximate timing. | Does the explanation make sense on screen and fulfill the promise? |
| Script and optional animatic | Full narration with source mapping; timed rough panels where pacing needs testing. | Are the words, order and pace ready to commit? |

For routine work, combine treatment and storyboard into one review round. Use an animatic when timing, a mechanism or a transition is uncertain. A simple story need not receive every possible artifact. The desired default is two substantive human checkpoints—idea and story—with a final script/timing check when material changes warrant it.

This is a proposed collaborative editorial mode. It is deliberately different from the current production instruction to finish a supplied-audio video autonomously. A future implementation should enable it explicitly for this workflow and preserve the existing production behavior.

### What a treatment must answer

“This video helps [viewer] understand [question] by showing [evidence or mechanism], ending with [bounded takeaway].”

Then state what the viewer initially believes, what they will understand by the end, what drives each next beat, the best evidence against the initial answer, and what cannot honestly be concluded. Keep the answer provisional until research supports it. Write a few sample opening lines to convey voice, without prematurely drafting every sentence.

The treatment is especially valuable when sources are plentiful: it forces a choice about what belongs in the story. STORM's research-before-outline method is useful here, but an explainer still needs an argument or mental model rather than comprehensive article coverage. [STORM](https://aclanthology.org/2024.naacl-long.347/).

### Storyboards need action and purpose

Each beat should have a stable ID, its question, approximate duration, narration summary, start state, visible change, end state, evidence references and its job in the story. A thumbnail sketch may communicate one state; a mechanism often needs two or three panels.

“Show a traffic diagram” is too vague to review. “Keep the same number of vehicles, change the available routes, then compare the resulting movement under stated assumptions” exposes what the audience is supposed to learn. Any counts and outcomes must come from a sourced case or a clearly labeled illustrative model.

Example storyboard for the research question “Why can adding a road fail to remove congestion?”:

| Beat | Story purpose | Proposed visual development | Research condition |
|---|---|---|---|
| B01 — The intuitive fix | Establish the question. | Show an existing queue and the proposed extra route. | Choose a documented case; do not invent its outcome. |
| B02 — Define the test | Make the comparison fair. | Hold the relevant assumptions visible before changing the network. | Specify demand, behavior and scope. |
| B03 — Follow the choices | Explain a candidate mechanism. | Trace route choices and how they affect other users. | Match the model to the evidence. |
| B04 — Test the boundary | Prevent an overgeneralized verdict. | Change one assumption and compare what happens. | Find cases or analysis defining when the effect applies. |
| B05 — Return to the decision | Fulfill the opening promise. | Revisit the original proposal with a bounded explanation. | State what is established and what remains conditional. |

This is a structural example, not a completed research treatment. No numerical outcome or blanket claim about road construction is asserted.

### Make revision local and visible

The human should be able to say “open with B03,” “this feels too technical,” “keep this visual,” or “show the counterexample sooner.” The system should preserve accepted work, revise affected beats and report what changed and why. A changed central premise may require broader revision; it should say so explicitly.

Store feedback against stable beat IDs and a particular draft revision. Support reorder, shorten, remove, replace, pin, request evidence and freeform comments. Show a concise before/after comparison. Do not regenerate the entire story for a local comment unless its dependencies require it.

Approval must attach to the exact treatment, script and board revision. Meaningful changes to approved claims, order, scope or narration invalidate the relevant approval. Elapsed time and silence never count as acceptance.

An independent editorial/factual review should challenge the promise, evidence, counterexamples and opening/ending relationship before final script commitment. Human preference and factual qualification are separate decisions: liking a draft does not resolve a false claim.

## 5. Fit with this repository

The existing `start`/`next` production loop begins with audio and script. Its director plans visuals after word timing is available, and its prototype/final reviews qualify the rendered film. The script-writing skill already handles supplied-source research, drafting and independent review. These are useful foundations, but they do not constitute an automatic cross-domain discovery system or a human editorial checkpoint before recording. [Pipeline documentation](../agent-workflow.md), [script-writing skill](../../.opencode/skills/script-writing/SKILL.md).

The installed HyperFrames references describe a plan-layer storyboard with outline/built/animated states and a narrative strategy line. Those are useful conventions; their presence does not prove the repository's current CLI exposes this proposed review workflow. [Storyboard reference](../../.opencode/skills/hyperframes/references/storyboard-format.md), [story spine](../../.opencode/skills/hyperframes-creative/references/story-spine.md).

Proposed flow:

```text
Cross-domain discovery → deduplicated candidates → evidence-backed shortlist
  → human selects/adjusts an angle
  → treatment + visual storyboard ↔ human feedback
  → full script + factual/editorial review + timing draft as needed
  → explicit commitment of the editorial revision
  → narration → existing start/next → prototype → final review → MP4 + thumbnail
```

Keep discovery data under a separate editorial area and story drafts under the script's workspace. Suggested artifacts are `IDEA.md`, `TREATMENT.md`, a separate editorial board, revision history, feedback, claim/source mapping and an approval record. These names are proposed, not implemented commands or schemas.

Preserve the editorial board separately from the production-generated `STORYBOARD.md`, so production does not overwrite what the human reviewed. The director should receive the committed treatment, board, pinned decisions and claim references. This handoff would need implementation; writing an extra file alone will not make current briefs consume it.

Use approximate timings during editorial development. After narration exists, reconcile them with actual word cues. Do not promise exact runtime from a word-count estimate.

Before TTS, settle the narration and retain a clean narration-only `SCRIPT.md`. If supplied audio already exists, preserve it and expose the resulting constraints: story changes that require different words need a new user-supplied recording, while visual edits can proceed within the recording. Never silently replace a supplied voice with TTS.

Keep current technical checks, fresh film reviewers and thumbnail completion requirements. An approved storyboard does not qualify a finished MP4. Packaging concepts may be explored at idea time; the finished thumbnail must still be checked against the completed video's actual payoff.

## 6. What to build and test first

1. **Run an editorial pilot.** Produce a diverse shortlist, develop a selected idea into a treatment and rough storyboard, gather feedback, and revise it before any production build. Use existing files and the conversation first.
2. **Persist decisions and revisions.** Add stable idea/beat IDs, evidence references, pinned choices, feedback and exact approval revisions. Make the production handoff explicit.
3. **Automate collection and triage.** Add source adapters, clustering, freshness checks, bounded research budgets and a recurring shortlist. Deep-research a few candidates rather than every ingested item.
4. **Add a review workbench if the pilot warrants it.** Cards, editable/reorderable beats, side-by-side revisions, source inspection and timed rough panels. The interface should support actual editorial decisions found in the pilot.
5. **Learn from outcomes cautiously.** Combine acceptance/rejection reasons with our own published-video analytics when available. Retain exploratory topics and avoid training selection solely on clicks or the most recent winner.

Evaluate the pilot across several domains and more than one story form. Track whether the human finds worthwhile ideas, how much research is discarded, factual blockers, substantial rewrites, feedback time and production rework. Compare the human's understanding of the storyboard's promise with its intended takeaway. Later, examine retention and fulfillment of the opening promise alongside reach; comparisons are observational unless an appropriate controlled test is used.

The first useful deliverable is a small batch of sourced idea cards and one revisable visual story package. That tests whether we can choose and develop worthwhile videos before expanding the current unlisted upload step into a broader automated publishing system.
