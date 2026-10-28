---
name: script-writing
description: Research, write or review narration scripts and concise visual intent for this video pipeline.
---

Write for the audience, purpose and duration in the brief. Choose the structure and voice that serve the
material; openings, narrative arcs, sentence patterns and revision passes have no prescribed template.
A duration estimated from words is not a measured recording duration.

Project outputs live in `jobs/scripts/<slug>/`:
- `SCRIPT.md`: spoken narration only, without Markdown, stage directions or delivery cues.
- `SOURCES.md` and `sources/`: source index and retained evidence for factual claims.
- `research.md`: material evidence, uncertainty and decisions worth handing off.
- `VISUALS.md`: concise visual intent and any assets or moments important to meaning. Free-form notes
  are sufficient; the director can develop or improve them during production.

Preserve user-supplied wording unless asked to rewrite it. Separate reported facts, interpretation,
fiction and creator experience. Sources do not become the narrator's personal experiences. Prefer primary
evidence for material claims; disclose what could not be verified.

Research assignments: `references/sourcing.md`. Independent review assignments: `references/review.md`.
Read only the reference relevant to your role. The writer can request missing evidence in
`research.md` under `## Evidence requests` and reply `NEEDS SOURCES` for the host to resolve.

Optional tools: `node skills/script-writing/scripts/fetch.mjs <url> <output.md>` saves source text;
`node skills/script-writing/scripts/lint.mjs <SCRIPT.md> --minutes <target> --wpm <rate>` checks spoken
format and duration estimates. Style counters are diagnostic, not quality targets or an AI detector.

The host commissions independent script review. Report what you produced, word count, duration estimate,
review status and any unresolved evidence. A self-check is not independent review.
