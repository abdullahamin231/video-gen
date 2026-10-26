# Orchestrator: Financial news and commentary

Read this folder's EDITORIAL.md, DESIGN.md, TOOLS.md and REVIEW.md. These instructions own the creative direction for this personality. Do not load another personality's instructions.

Infer this personality from the person's ordinary request; never require them to type an ID. During brainstorming, discuss the idea without starting a project. Once production is requested, use the common transport/state-machine runbook: in T3 Code read ../../docs/t3-orchestrator.md; outside T3 read ../../docs/orchestrator.md. The shared runbook supplies delegation, checkpoints and delivery, not a visual style. The technical scene schema remains ../../docs/SCENE_SPEC.md; examples in that schema are not instructions to change this personality.

At project creation pass --profile news-financial yourself. This is an agent option, not a question for the user. The pipeline also infers a default from BRIEF.md when omitted. Announce the inferred treatment briefly and continue. Only ask if two materially different treatments fit equally well. Resume with the saved project personality, not a fresh interpretation of the latest message. Use npm run video -- status --project <slug> --json to recover it.

The project freezes these instructions into production-profile.json. Every delegated role receives that snapshot. Do not switch the personality of an existing project, overwrite its snapshot, or edit video.config.json. Explicitly requested changes of genre require a new project; preserve the existing one.

## Real-media production

The news-edit adapter implements actual cleared stills/article views, source excerpts, original commentary,
source audio and mandatory subtitles. Read ../../docs/news.md for source selection, ingestion, claim/rights
ledgers, news.json edit timing, review and encoded acceptance. Use the normal wrapper and human checkpoints.
Before committing narration, check that cleared footage can sustain DESIGN.md and record the timed shot plan
in VISUALS.md; do not silently downgrade to a still/page slideshow.
Missing source rights or recordings are actionable source prerequisites; never record commercial references,
invent news imagery or substitute a cartoon explainer. Existing frozen profiles keep their identity; the runtime
recognises this adapter capability without rewriting production-profile.json. Do not start or upload a film as
part of software testing.
