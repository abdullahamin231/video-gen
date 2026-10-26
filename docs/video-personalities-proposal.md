# Video personalities and T3 integration proposal

**Implementation update:** automatic routing and separate personality instruction packages are now implemented in [personalities/](../personalities/README.md) and AGENTS.md. Projects freeze the profile, prepared jobs inherit it, and generated role briefs use it. The --profile option now exists for agents; users describe the video normally. Explainer and rules-story use the existing renderer. Browser app capture is implemented: `app-capture` records a scripted session without a composited pointer and `capture-scene` compiles the pointer, click rings and camera push-ins from the action log ([app-capture.md](app-capture.md)); native desktop surfaces remain outside that adapter. The news timeline/audio adapter remains unimplemented and explicitly gated. The original proposal below records the larger design and remaining work.


25 October 2026. Design proposal, not an enabled feature. No production started, external footage downloaded, or reference video recorded. Browser-only inspection of channel metadata, the creator's website, and selected paused frames; neither reference film was reviewed in full. Earlier research in video-supervisors-research.md remains historical; this proposal follows the newer request for footage-led news and an active computer-use family.

## Decision

Use four selectable video families, with separate financial and political profiles under News. Keep the existing scientific/educational explainer as the default. A personality determines editorial behaviour, evidence gathering, visuals, performance, editing and review; a theme only determines appearance. A skill can invoke a personality, but durable project state must own the selection.

| Family | Proposed profile ID | Primary visual material | Editorial personality |
| --- | --- | --- | --- |
| Scientific / educational explainer | explainer | Existing original diagrams and motion design | Curious teacher; explain causes and mechanisms |
| Bradikinin-style storytelling | rules-story | Original pictograms, sparse typography and controlled suspense | Composed fictional protocol narrator; escalating rules |
| News: financial | news-financial | Cleared real footage, permitted source documents/articles, relevant original data displays | Evidence-led analyst; distinguish results, interpretation and forecasts |
| News: political | news-political | Cleared event footage, permitted articles and primary records | Explicit commentary grounded in evidence and context |
| Computer use / app review | app-review | Our own authorised hands-on recordings and screenshots | Practitioner testing workflows, showing successes and limitations |

There are four families and five concrete profile IDs. Explicit selection wins over inferred routing. An ambiguous request such as “make a news video” needs the financial/political distinction. A technical topic does not automatically mean an explainer: reviewing an actual app selects app-review.

## Reference findings and proposed templates

### Existing explainer

Retain the current scientific/educational standard: researched narration, causal explanation, original diagrams, mechanism-focused animation, human checkpoints and independent reviews. Extract its style instructions into the explainer profile without changing its output. Do not weaken it to accommodate news or app capture.

### Rules-story, informed by Bradikinin

The creator's own [website](https://bradikinin.com/) describes an invented institutional framing, restrained instructional storytelling and seven-rule episodes. Its channel supplies warnings about uncanny situations involving familiar everyday things. A sampled frame at 1:00 of [the dog episode](https://www.youtube.com/watch?v=Vpw2D6LsIV0) showed white pictograms on black, a red negation, a numbered rule progress display, an archive identifier and timecode. This is a different narrative format from explaining scientific mechanisms. These are sampled observations, not a frame-by-frame analysis or listening assessment.

Proposed reusable recipe: impossible everyday event → immediate instruction → numbered rules that escalate the stakes → a reversal that changes how the viewer interprets the rules → unsettling closing consequence. Use original simple symbols, a dark limited palette, selective warning colour, restrained motion, purposeful holds and sparse sound. The narrator remains controlled rather than theatrically frightened. Fictional framing must stay distinguishable from factual advice.

Closely match the format's visual economy, suspense and rule-based storytelling. Write new scenarios and scripts; create our own drawings, identifiers, branding, music and voice direction. Do not copy the creator's footage, exact stories, department identity or recurring proprietary assets. Freeze a small set of original benchmark scenes as the acceptance reference after a dedicated style study. Exact cadence, shot duration and sound treatment remain to be auditioned; two sampled frames cannot establish them.

This profile also needs a different writer/reviewer rubric: suspense, escalation, continuity of rules, payoff and fiction/fact separation. A science reviewer demanding a causal demonstration on every beat would damage this format.

### Financial news

The [supplied FinVid reference](https://www.youtube.com/watch?v=dN1RHfd86F4) is 56:03 long. Its description divides the earlier section into named broadcast segments and labels a FinVid section starting at 32:07. A sampled frame at 32:20 showed financial software and a market heatmap with commentary captions. This supports a broadcast-roundup plus commentary interpretation; it does not establish permission to reuse the networks' footage or commercial interfaces/data.

Our template should be footage-led: news claim or event → cleared original excerpt → our analysis → permitted article/document or data evidence → another relevant excerpt or rebuttal → what changes the interpretation. Narration contributes analysis rather than reciting headlines. Show the date, currency, period and source when figures matter. Research should trace reports to filings, economic releases, transcripts or other primary evidence. Original charts can explain a disputed figure but must not become a presentation-style substitute for the requested reporting format.

Exclude cartoon metaphors, generic animation and image slideshows. Keep price/data displays brief and directly relevant. Do not capture a commercial trading terminal or commercial news programme simply because the reference does. Use only material permitted under the project's chosen media policy.

### Political news

Use actual cleared event footage and permitted article/primary-record views with original commentary. The default is no cartoons, no stock-image sequence and no PowerPoint-style scenes. I interpret the user's “No ... Images” as excluding standalone illustrative image scenes; any broader use of stills should be an explicit later choice.

Sequence: define the claim/event → show the relevant excerpt in context → pause for original commentary → inspect supporting or contradicting records → identify what is established, disputed or unknown. Commentary can have a declared perspective; it must distinguish opinion from reporting and avoid misleading edits. Label archival footage by date when it could be mistaken for current material. Preserve the original speaker's words and surrounding meaning.

Reserve a circular presenter at bottom left, sized and positioned relative to the output format so it does not cover subtitles, names or article text. This is the user's requested layout, not a layout inferred from the financial example. Use our own presenter recording, or a separately authorised presenter/avatar. A crop or still portrait does not solve lip-sync; synthetic presenter generation is a separate optional capability. Never substitute a borrowed presenter's identity.

## News media policy: resolve permission before acquisition

Two permissions are separate: a source can substantiate a statement without giving us rights to show its video, photography or designed page. Public availability, a citation, a short clip and adding commentary do not themselves clear footage. [YouTube's fair-use guidance](https://support.google.com/youtube/answer/9783148?hl=en) says the determination is case-specific; the workflow must not treat fair use as an automatic permission flag.

Apply the user's strict instruction by default: no recording or downloading commercial broadcasts or uncleared third-party media. Research links and summarise facts in original notes. Acquire files only after verifying that the individual asset is owned by us, verified public domain, or covered by an explicitly approved permission route. Explicitly licensed third-party content is an optional policy expansion, not an assumption in the default. Do not record whole news websites as a way around footage restrictions.

Use original event sources when cleared, rather than a network's edited rebroadcast, whose overlays, music and other material may introduce separate rights. Government hosting is not universal clearance: the [Library of Congress](https://www.loc.gov/legal/security-copyright-and-privacy/understanding-copyright/) cautions that online items may have restrictions. The [Federal Reserve](https://www.federalreserve.gov/disclaimer.htm) identifies third-party exceptions and additional logo restrictions. These are candidates to check per asset, not domain-wide allowlists. BLS offers [published reuse guidance](https://www.bls.gov/opub/copyright-information.htm) for its own material with exceptions.

An article-led scene can display a cleared page/excerpt where permitted. Otherwise show an original factual summary with a source link; do not assume article screenshots are automatically allowed. If enough usable real footage is unavailable, report that the requested news treatment cannot yet be assembled. Do not silently replace it with cartoons or slide cards.

Proposed rights record: asset ID, original source URL, creator/rights holder, basis and evidence of permission, allowed editing/publication, attribution, access date, restrictions, local hash and clip in/out times. A separate claim record maps assertions to source passages and dates. Check rights before download/recording, at import, and on final used assets. Metadata alone is not proof of clearance; missing or unverified evidence must block acquisition.

Reusable formatting should support original reporting, not mass-produced replacements of words and names. [YouTube's monetisation policy](https://support.google.com/youtube/answer/1311392?hl=en) distinguishes original value from reused or repetitive material; copyright clearance does not guarantee monetisation.

## Computer-use personality

This needs a different order of work. Start with an exploration/test plan, actually use the app, then write the review from observed evidence. A script written first must not invent results and ask a builder to fabricate matching UI.

Proposed sequence: identify app version and account/features available → enumerate workflows → explore in a clean test workspace → record verified demonstrations and screenshots → assess results and limitations → write narration from the evidence → edit recording, narration, cursor and callouts together → review that every claim matches the captured result.

Use T3's collaborative browser tools for browser-based apps: preview_status/open, snapshots and locators, focused interactions, and recording_start/stop. Keep each recording bounded to a planned task; verify the recorded output and transfer it into the repository. Do not assume this browser recorder controls native desktop windows or includes every OS dialog. Desktop applications need a separate available and tested computer-control/capture adapter; discovery of that adapter is a prerequisite to claiming native coverage.

Capture assets require a manifest: feature/task ID, app version/build, viewport and display scale, starting state, actions, observed result, file/hash and source time range. Add a timestamped cursor/action track with click target bounds, scrolling and wait intervals. Render cursor emphasis from that log, mapped through crop, zoom and edit transforms. Prefer a source recording without a baked pointer if the adapter supports it; otherwise suppress the duplicate overlay or use the real pointer. Do not invent a successful click or move the pointer to a different control for editorial convenience.

Keep source recordings unchanged. Cut and reframe derived copies, mark removed waits, and retain failed attempts when they affect the verdict. Use demo data; prevent tokens, private conversations or personal accounts from entering raw recordings. Record the relevant application only; commercial media embedded elsewhere in the screen must not enter the capture.

T3 Code is a suitable first pilot because real tasks can demonstrate projects, conversations, model selection, code changes, terminal/tests, browser tools, delegation, worktrees, reviews and settings where the installed build exposes them. The public [T3 Code repository](https://github.com/pingdotgg/t3code) can inform the feature inventory; the installed build and actual observations determine what the review claims. Do not equate a public README with tested behaviour.

“Entirely” should mean a documented feature inventory and workflow coverage, with each item marked tested, partly tested, unavailable or outside scope. Include happy paths and important failure cases. Split an exhaustive walkthrough into chapters; an edited review can then use the strongest evidence without claiming every configuration was tested. This proposal has not conducted that full app audit.

## Where profiles live and how T3 invokes them

Proposed repository structure (not created or enabled by this document):

```text
profiles/
  explainer/
  rules-story/
  news-financial/
  news-political/
  app-review/
    profile.json       # ID, version, workflow and capabilities
    editorial.md       # audience, narrator, structure, sourcing
    visuals.md         # permitted media, composition, transitions
    review.md          # profile-specific acceptance criteria
    examples/          # original, cleared acceptance examples
.agents/skills/video-personalities/SKILL.md  # optional invocation/routing wrapper
lib/profiles.mjs        # proposed validated loading and freezing
```

Keep provider/model selection in the existing chat.config.json. Its profiles currently mean provider defaults, not editorial identities. Use a distinct project field such as productionProfile, with id, version and content hash, rather than overloading that configuration.

Proposed T3 invocation: “Use the political-news personality for this event,” “Use the rules-story personality for this premise,” or “Use app-review to test T3 Code.” The orchestrator resolves the ID, then invokes the normal project pipeline with a proposed --profile flag. That flag does not exist yet. Repository instructions plus the optional skill make the vocabulary available in a new T3 conversation; the frozen project state makes it survive resuming, delegation and repairs. Skills must be discoverable by the actual provider's configured skill mechanism, not merely put somewhere and assumed active.

At project creation, validate and freeze the resolved profile files into the job's script-stage directory. Store the ID/version/hash in project state, carry the same snapshot into the prepared film job, and include it in every research, writer, director, builder, review and thumbnail brief. Retries must use the same frozen snapshot. Profile changes after work starts need explicit migration and invalidation of affected scripts/plans/reviews; do not let edited global files silently alter an existing film. Old jobs resolve to the current explainer behaviour for compatibility.

Start with natural-language selection in T3. No native T3 picker needs to be built to make this work. A custom T3 composer menu would be a separate T3 app feature requiring extension/UI work; the video-gen web UI can later add its own selector using the same loader.

## Actual integration work required

| Current location | Finding | Proposed change |
| --- | --- | --- |
| lib/project.mjs createProject / projectStep | Persists format, TTS and role models, but no editorial personality | Add profile resolution, snapshot and workflow dispatch; propagate profile into all generated tasks |
| scripts/video.mjs project-new/start/prepare | No profile option; prepares a narration-led job | Add validated --profile, frozen profile transfer and workflow-aware preparation |
| lib/briefs.mjs QUALITY / TOOLS / director and builder briefs | Globally demands drawings, no photos and motion on each beat | Separate shared technical requirements from explainer-only guidance; choose profile-specific instructions instead of appending contradictory prompts |
| docs/SCENE_SPEC.md and review rubrics | Image guidance assumes SVG drawings | Make allowed scene/media vocabulary and visual acceptance depend on profile |
| lib/channel.mjs and preparation | Global channelTheme can carry the current brand into new genres | Resolve a profile theme per project, preserve the old default, and avoid changing video.config.json |
| lib/assets.mjs | Supports local video/raster imports and source/hash metadata; license evidence is optional and web-raster switch is not rights clearance | Introduce permission preflight for all asset types and project-scoped media policy, before acquisition |
| lib/spec.mjs and lib/kit/kit.js | Video appears on the narration clock; buildMedia explicitly mutes video audio | Add source in/out, source-audio tracks, captions and seek-safe timing, not just permission to import MP4 |
| lib/mix.mjs | Mixes narration, effects and optional music | Add source speech and presenter tracks, alternating narration/clip speech and deliberate ducking |
| lib/thumbnails.mjs | Shared brief and review generation | Pass frozen profile and rights policy into makers and reviewers |
| docs/t3-orchestrator.md and ui/backend/prompt.mjs | Entrypoints assume current research-to-narration workflow | Route by productionProfile and include capture/rights readiness when required |

The biggest structural change is timing. News alternates original source speech and commentary. Introduce a bounded edit-decision list containing source file, source in/out, timeline start/duration, audio role, transcript and provenance. Existing continuous-narration explainers keep their current clock. For news, assemble the commentary and untouched source excerpts into an editorial master clock before alignment and scene building. Keep imported recordings immutable and retain their attribution. Caption timing must include the original speakers, not just our generated narration. Human script/storyboard approval includes what clips will play and why.

App reviews can use post-recorded continuous narration over screen footage, with a capture-to-film time mapping for each cut. Source offset, cursor coordinates and zoom/crop transforms must remain synchronised. News and app-review can share media composition primitives without sharing editorial instructions.

## Recommended implementation order and acceptance

1. Profile infrastructure and explainer compatibility. Implement persistence, freezing, routing, brief composition, versioned rubrics and explicit selection. Tests must show existing jobs keep their current behaviour and new news jobs do not inherit “no photos/draw everything” rules. Keep current model policy, Ming voice continuity and checkpoints.
2. Rules-story profile. It is closest to the current renderer and does not need external footage. Produce original acceptance scenes to tune look, pacing and narrative personality. Prototype approval sets the standard before a full episode.
3. App-review capture and timeline adapter. Use a controlled T3 Code test workspace as a pilot once production is requested. Validate recording transport, cursor timing, crop/zoom mapping, privacy and factual evidence. Build a feature-coverage report alongside the film.
4. Shared news media infrastructure, then financial and political rubrics. Prove permission preflight, native clip audio, multi-speaker captions, source-time accuracy and presenter safe zones with owned or verified-public-domain test material. Create each news prototype from genuinely usable sources before commissioning a complete script.

Infrastructure tests should cover profile selection/fallback, frozen profiles across retries, absence of conflicting instructions, blocked acquisition without evidence, unchanged input recordings, clip/audio/caption sync and profile-aware review invalidation. Production acceptance needs an original prototype for each concrete profile, with the existing script/prototype/final/thumbnail decisions retained. News also needs a source-and-clip selection decision before locking the script; app-review needs an exploration/coverage decision before recording a long walkthrough.

Implementation can proceed in stages without modifying the current explainer standard or requiring a T3 fork. This proposal does not enable profiles, record commercial media, run an app audit or start new videos.
