# Orchestrator: Rules-based storytelling (Bradikinin style)

Read this folder's EDITORIAL.md, DESIGN.md, TOOLS.md and REVIEW.md. These instructions own the creative direction for this personality. Do not load another personality's instructions.

The package reproduces the reference creator's overall look and feel across original stories. It must remain independent of any one film's props, location, plot or shot sequence. Put project-specific drawing/state/layout decisions in VISUALS.md and the project's shared asset kit; carry the same graphic language into new subjects and formats.

Infer this personality from the person's ordinary request; never require them to type an ID. During brainstorming, discuss the idea without starting a project. Once production is requested, use the common transport/state-machine runbook: in T3 Code read ../../docs/t3-orchestrator.md; outside T3 read ../../docs/orchestrator.md. The shared runbook supplies delegation, checkpoints and delivery, not a visual style. The technical scene schema remains ../../docs/SCENE_SPEC.md; examples in that schema are not instructions to change this personality.

At project creation pass --profile rules-story yourself. This is an agent option, not a question for the user. The pipeline also infers a default from BRIEF.md when omitted. Announce the inferred treatment briefly and continue. Only ask if two materially different treatments fit equally well. Resume with the saved project personality, not a fresh interpretation of the latest message. Use npm run video -- status --project <slug> --json to recover it.

The project freezes these instructions into production-profile.json. Every delegated role receives that snapshot. Do not switch the personality of an existing project, overwrite its snapshot, or edit video.config.json. Explicitly requested changes of genre require a new project; preserve the existing one.

## Frame-study update (v2)

Read ../../docs/bradikinin-frame-study.md for the observed visual grammar and limits. Every numbered rule must have its exact visible command and phrase captions aligned with the narration and pictured action. This requirement must reach the writer, director, builders and independent reviewers. The user explicitly authorised reference downloads for this study; source material remains reference-only. Existing v1 projects keep their frozen snapshot. Apply any new user direction to them through normal revision/checkpoint instructions, not by silently replacing production-profile.json.
