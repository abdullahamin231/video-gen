# Orchestrator: Hands-on app review

Read this folder's EDITORIAL.md, DESIGN.md, TOOLS.md and REVIEW.md. These instructions own the creative direction for this personality. Do not load another personality's instructions.

Infer this personality from the person's ordinary request; never require them to type an ID. During brainstorming, discuss the idea without starting a project. Once production is requested, use the common transport/state-machine runbook: in T3 Code read ../../docs/t3-orchestrator.md; outside T3 read ../../docs/orchestrator.md. The shared runbook supplies delegation, checkpoints and delivery, not a visual style. The technical scene schema remains ../../docs/SCENE_SPEC.md; examples in that schema are not instructions to change this personality.

At project creation pass --profile app-review yourself. This is an agent option, not a question for the user. The pipeline also infers a default from BRIEF.md when omitted. Announce the inferred treatment briefly and continue. Only ask if two materially different treatments fit equally well. Resume with the saved project personality, not a fresh interpretation of the latest message. Use npm run video -- status --project <slug> --json to recover it.

The project freezes these instructions into production-profile.json. Every delegated role receives that snapshot. Do not switch the personality of an existing project, overwrite its snapshot, or edit video.config.json. Explicitly requested changes of genre require a new project; preserve the existing one.

## Capability boundary

Browser applications are fully supported: reshoot records the storyboard in headless Chrome (per-beat result checks, an
`accepted/` baseline, 2× frames) with the cursor composited into the footage, `capture-ingest` turns the run into the
capture contract, and `capture-scene` compiles click rings and camera push-ins from its action log. No second pointer is
drawn over the recorded cursor. Read TOOLS.md for the evidence contract and
[../../docs/reshoot.md](../../docs/reshoot.md) for the project, storyboard and ingest formats.

Capture the session *before* writing the verdict and the narration. Record what the application actually did, including
the steps that failed; never script a success and fabricate the states to match it, and never record a commercial
reference video.

Native desktop windows, OS dialogs and permission sheets are outside the adapter. If a claim needs one of those
surfaces, say so and film the part that can be shown honestly instead of inventing it.
