# Independent review contract

The host commissions reviewers who did not produce the work. Review evidence is frozen and hash-bound
so findings and approval refer to the actual film. A plan, transcript or lint result cannot replace
inspection of images and, when available, playback. [quality.md](quality.md) gives the editorial standard.

`review-pack --job <job> --stage final` captures the full built composition. Render-source packs also
include encoded clips. A successful full build is required; missing scenes/evidence prevent review.
Three roles address visual understanding, narration fidelity and continuity/legibility. Each reviews the
whole assigned interval, including intermediate states, handoffs and ending. The visual role records its
initial picture observations before reading the intended narrative.

## Report

Generate the schema with:

```bash
npm run video -- review-template --job <job> --stage final --role <role>
```

It writes `review/final/incoming/<role>.json` with current source/pack hashes. Fill the generated fields:

- `reviewer.agentId`: actual session identity; `independent` is truthful.
- `inspection`: actual mode, visual/audio availability, frozen evidence paths inspected and limitations.
- `coverage`: intervals actually inspected, covering the assigned film.
- `initialObservation`: the visual role's account before reading the intended story.
- `verdict`: `pass`, `revise`, or `incomplete`.
- `findings`: concrete timestamped defects; use the template's schema.

Each finding needs `id`, `severity`, `start`, `end`, `subject`, `requirement`, `observed`, `repair`, and
current `evidence` paths. Blockers also name a category (`readability`, `truth`, `mechanism`, `style`,
`evidence`) and scope (`scene`, `plan`, `evidence`); `sceneIds` can identify the responsible scene.
A repair describes the desired outcome rather than forcing the author's implementation.

Missing visual inspection means `inspection.visual: "unavailable"` and `verdict: "incomplete"`.
Audio status is `listened` only after listening, otherwise `signal-verified` or `unavailable` with the
limitation stated. Never turn still-frame inspection into a claim of playback review.

Submit using `review-submit --job <job> --file <report.json>`. The CLI validates identity, hashes,
evidence and coverage. Producers do not edit reviewer verdicts. User decisions remain separate.

On revision, retain IDs for unresolved findings. Respond to prior blockers in `priorFindingResponses`
with sourceHash, findingId, resolved/unresolved/disputed disposition and evidence-based reason.
A new blocker needs current evidence, not a new aesthetic preference. Readability, broken evidence and
technical failures cannot be cleared by exhausting the creative review budget. Delivery records whether
review passed, reached its configured limit with unresolved findings, or was explicitly waived by the user.
