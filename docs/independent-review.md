# Independent review for autonomous video production

The user supplies audio and script paths and receives a finished MP4. The
production agent directs, builds, renders, commissions independent reviews,
repairs defects, and qualifies delivery. Review is an internal production
stage. It introduces no storyboard approval, interview, or user-operated
command.

This protocol supplements [the production workflow](agent-workflow.md) and
the quality requirements in [AGENTS.md](../AGENTS.md). Technical audits remain
mandatory. A review verdict cannot waive an audit failure, and a successful
audit cannot waive a demonstrated creative defect.

## Separation of responsibilities

The host agent spawns three reviewer sub-agents in separate contexts. It can
run them concurrently. Node commands prepare evidence and validate records;
they do not start language-model agents or manufacture review judgments.
The host must actually use its available agent tools to commission reviews.

Reviewers must be different agents from the director and builders. Do not
delegate a passage to a builder and then ask that same agent to independently
approve it. Do not pass the director's desired verdict, self-assessment, repair
explanations, or other reviewers' findings into an initial review. Give each
reviewer the input evidence its role needs and the quality contract. Each
reviewer writes its own report; the director must not compose or amend a
reviewer's judgment. A reviewer may read its own earlier findings when checking
a repair, but must inspect the new render again.

| Role | Independent question | Required inspection |
|---|---|---|
| Visual mechanism | What actually changes, what causes it, and what does the viewer learn? | Ordered render samples first, without script, narration, storyboard, source code, or author descriptions; then compare its recorded observations with the intended explanation. |
| Narration fidelity | Does the picture explain the supplied recording without unsupported claims? | Actual recording where supported, supplied script, alignment discrepancies, resolved cues, rendered samples, displayed values, and intended mechanism. |
| Continuity and legibility | Can the viewer follow the subject, read essential information, and see the handoffs? | Full-frame and 480 px phone-scale samples, dense transition samples, recurring-subject contract, and playback where supported. |

The visual reviewer must save its first-pass observations before receiving
the storyboard or narration. Describe events in plain language: for example,
"the selected item disappears but the selection remains attached to its old
position." Avoid inferring actions from intended labels. In the second pass,
compare that account with the narration and storyboard. If the image does not
show the intended consequence, report it even when the source code contains
the expected tween or the storyboard describes a convincing mechanism.

An isolated review context is the preferred way to protect the first pass. If
the host's agent tools can fork without history, use that capability and pass
only the role packet. If a reviewer inherits the production conversation,
disclose this contamination; do not describe that pass as blind. Tool-enforced
isolation and independently recorded observations reduce anchoring; a JSON
field alone cannot establish reviewer independence.

Before dispatch, record the actual director and builder agent IDs in
`job.json` under `review.producerAgentIds`. The default is `["/root"]`;
replace or extend it when the host uses another identity or delegates building.
The three review records must use distinct reviewer IDs, none of which appears
in that producer list. Identity fields are a host trust boundary: the CLI
checks consistency, but cannot authenticate a sub-agent tool invocation or
prove that a claimed reviewer worked independently. The host must not invent
IDs or submit director-authored opinions under reviewer identities.

## Evidence and coverage

Review the demanding 10–15 s prototype before extending the film. Use the same
three roles at that gate. Review the whole film again after assembly; a good
prototype does not approve an unseen second half. The final review must cover
the exact rendered MP4 offered for delivery.

Prepare a frozen evidence pack for each render. Include the MP4 and its SHA-256,
source fingerprint, duration, contact sheet sampled at least once per second,
ordered frames with explicit video timestamps, phone-scale frames, and denser
samples around changes of state, cue starts, and handoffs. Supply reviewable
short clips or playback when the available tools support them. Keep source
audio, script, alignment, cues, storyboard, and subject contracts available to
the roles that need them; do not leak these into the visual first pass.

Every reviewer must inspect the full assigned interval, including the ending,
rather than extrapolate from scene midpoints. For a long film, partition
evidence into manageable intervals and include overlapping context across
their boundaries. Each role's report must account for the union of its assigned
intervals. Missing coverage prevents qualification. A contact sheet is a
navigation aid, not a substitute for inspecting intermediate states.

The pack establishes which frames and artifact versions were reviewed. It
cannot prove that a model opened every image, understood a mechanism, or made
a sound creative judgment. The director must investigate concrete findings
against the rendered evidence, preserving disagreement rather than replacing
the reports with a consensus score.

## What reviewers must reject

Use timestamped findings with a visible observation, an affected subject, the
violated requirement, evidence paths, and a repair direction. Describe the
defect and desired consequence; give the builder creative discretion over the
implementation. Avoid requests such as "add ten animations" or "make it pop."

Blocking findings include:

- A central narrated idea has no visible operation, consequence, or payoff;
  headings, static diagrams, travelling packets, or camera movement carry the
  explanation without demonstrating the important relationship.
- Unsupported displayed values, invented technical implications, incorrect
  comparisons, or an important mismatch between the recording and the picture.
- Missing footage or essential audio, an absent payoff, a broken subject
  transformation, or a handoff that prevents understanding.
- Unreadable essential labels at phone scale, obstructed essential information,
  competing attention that hides the mechanism, or unmotivated inactive passages.
- Review evidence is missing, stale, insufficient to assess a required property,
  or does not cover the assigned interval.

Advisory findings describe improvements that do not prevent understanding or
violate a delivery requirement, such as a nonessential label that could be
simplified or a sound effect that could make an already clear action more
tactile. Do not downgrade a known requirement violation to obtain a pass.
Do not reject stylistic differences solely because a reviewer prefers another
look: the design theme is the director's choice. Do reject a film that does not
hold to its own declared theme (film.json `theme`, summarised in STORYBOARD.md).

Review active passages in intervals of approximately 3 s. Check whether
several elements develop around a single focus and whether causes connect to
effects. The activity minimum detects obvious emptiness; it does not certify
explanatory quality. Decorative motion, camera-only movement, or high tween
counts cannot close a missing-mechanism finding. Also inspect the meaningful
intermediate states of transformations and counters, not just their endpoints.

## Honest capability reporting

Record the actual inspection method: ordered frame sequence, normal-speed
playback, or both. Opening a browser, seeking to selected times, viewing a
contact sheet, or extracting frames is not normal-speed playback review.
Sequences can establish many spatial and causal developments but cannot fully
establish rhythm, easing, sound synchronization, or intelligibility. Do not
claim that a model watched or listened when its tool input supplied images only.

When playback or audio review is unavailable, obtain denser evidence and use
available deterministic checks, then record the remaining limitation. If the
missing capability leaves a required property unassessed, mark the review
incomplete. Do not turn unavailable evidence into a pass. Exact-audio integrity
checks can support preservation of the recording; waveform levels and ASR
similarity alone do not prove intelligibility after mixing.

## Repair and reinspection

The director combines the independent findings into a repair queue, inspecting
the cited evidence. Fix every blocking defect. If a finding appears mistaken,
return the specific counterevidence to that reviewer for reconsideration; do
not edit its verdict or unilaterally dismiss it in a summary report. Keep the
original finding and the follow-up disposition as review history.

Repair the responsible mechanism, composition, timing, or asset. Reassemble,
run technical checks, render again, and prepare a fresh evidence pack. Recheck
the affected interval plus adjacent handoffs. Because final qualification is
bound to the exact MP4 and source fingerprint, all three roles must issue
current final reports; prior reports remain history and cannot qualify changed
output. Reviewers can use prior findings to target attention, but must account
for the full new artifact, including unintended regressions.

Use an explicit repair budget, normally three render-and-review rounds per
mechanism. A repeated defect should trigger a different mechanism or construction,
not decorative additions to the same weak scene. If the budget is exhausted,
retain the draft and findings, report the job as incomplete, and state the
remaining blocker. A bounded loop limits resource use; it does not relax the
definition of a completed video. The director may reserve additional resources
or change approach autonomously when available. Do not require routine user
approval for repairs already authorized by the production request.

Qualification requires passing technical checks, full current independent
coverage, no unresolved blocking findings, and honest capability limitations.
Advisories may remain with a recorded disposition. Preserve every review round
and reference the exact delivered artifact in `review/REPORT.md`.

## Commands and machine-readable contract

The host runs the commands and commissions the reviewers itself. For example,
after a draft render, select the demanding prototype interval:

```bash
npm run video -- review-pack --job jobs/example --stage prototype --start 8 --end 20
```

`review-pack` creates `review/<stage>/pack.json` and a frozen evidence run
directory. It also writes `briefs/review-<stage>-<role>.md` for each reviewer
and prints their absolute paths and the pack hash. Spawn a separate reviewer
as a fresh sub-agent with no conversation history (however the host harness spawns one) for each brief, passing the brief path as its initial
task. Each reviewer runs `review-template` (pre-filled hashes), fills `review/<stage>/incoming/<role>.json`,
and submits it with `review-submit`. Packs also contain the motion transcript (`motion.md`, kind `motion`) and the
automated check results (`inspect.json`, `pixels.json`, kind `checks`) as supporting diagnostics.
They cannot replace image/video inspection. Without visual input a reviewer records `inspection.visual: "unavailable"`
and verdict `incomplete`. The blind visual role reads diagnostics only after saving its observations of the images.
`next` dispatches reviewers and repairs automatically.
The command prepares dispatch material; the host's agent tools execute the
reviews. Use `--stage final` for the whole film after its final draft render.
The prototype is normally 10–15 s; a shorter film can use its whole duration.
Interval arguments are video seconds, not word-count timing estimates. Sample
the actual encoded render, not a different Studio state.

The pack contains its interval, scenes, `sourceHash`, `videoSha256`, and
`evidence` entries with `path`, `sha256`, `kind`, `start`, and `end`. The kinds
are `frames`, `contact-sheet`, `clip`, `audio`, and `verification`; each individual
PNG frame is a `frames` entry. Verification receipts are frozen inside the
evidence run so later technical checks do not overwrite historical evidence.
Reviewers must cite exact paths present in that pack.
Hash the pack bytes to obtain `packSha256`. Do not modify evidence after
dispatch. Regenerate the pack and reviews when evidence changes.
Accepted encoder padding is included in the final review interval; the last
scene records its original content boundary and any trailing mux padding.
This adjustment cannot fill an actual gap in planned scene coverage.

Each reviewer writes a report using this version-1 shape. Angle-bracket values
below are placeholders to replace with the actual identity and 64-character
SHA-256 values; timestamps must match the pack's real interval.

```json
{
  "version": 1,
  "stage": "prototype",
  "role": "visual-mechanism",
  "reviewer": {"agentId": "<actual reviewer agent ID>", "independent": true},
  "packSha256": "<pack SHA-256>",
  "sourceHash": "<source fingerprint from pack>",
  "videoSha256": "<video SHA-256 from pack>",
  "inspection": {
    "mode": "frame-sequence",
    "visual": "viewed",
    "evidence": ["<actual frozen frame or clip path from the pack>"],
    "limitations": ["Ordered frames inspected; normal-speed playback was not reviewed."]
  },
  "coverage": [{"start": 8, "end": 20}],
  "initialObservation": "The selected part leaves its slot; the slot stays empty while the alternative is selected.",
  "findings": [],
  "verdict": "pass"
}
```

Allowed `role` values are `visual-mechanism`, `narration-fidelity`, and
`continuity-legibility`. Allowed `inspection.mode` values are `frame-sequence`,
`playback`, and `mixed`. The visual role requires a nonempty
`initialObservation` recorded before receiving narrative material; other roles
may omit it. The CLI can require the field, but cannot establish when it was
written. Save first-pass observations in a file named for the current pack before providing the second-pass packet;
preserve earlier observations. Every passing role must declare `inspection.visual: "viewed"` and list the frozen
visual files it inspected in `inspection.evidence`. Templates leave capability claims and coverage unset.

Blocking findings may include `scope: "scene" | "plan" | "evidence"` and `sceneIds` naming responsible scenes,
including an earlier scene that causes a boundary defect. Plan defects return to the director; repeated visual failures
also trigger a director revision. A failed pack is counted once, regardless of how often `next` is queried.

The narration role additionally requires `inspection.audio` with one of
`listened`, `signal-verified`, or `unavailable`. `listened` means the reviewer
actually received supported audio input, not merely a transcript.
`signal-verified` requires a passing technical waveform comparison between the
rendered audio and supplied root narration, and the report explicitly states
that listening was unavailable. This is a heuristic consistency check, not
proof of exact sample preservation, unchanged words, or listening. The comparison
decodes both tracks to 8 kHz mono float32, examines the entire decoded tracks
without time-shift correction, fits one global gain (strictly between 0.25 and 4), and requires correlation of at least
0.995, normalized RMS error of at most 0.10, and duration difference of at most
0.05 s. Silence, decoding errors, and failed comparisons do not qualify this
fallback. These thresholds allow ordinary lossy encoding; they are not a
validated speech-recognition or intelligibility test. Significant legitimate
mixing or processing can fail the check and require supported listening instead.
It does not establish intelligibility under added music or sound effects. An
unresolved possibility of masked speech needs supported audio review or a mix
repair and remains blocking. `unavailable` cannot pass required audio review.
The CLI can inspect receipts and reported methods; it cannot authenticate
listening or model capability.

Each finding has this shape:

```json
{
  "id": "visual-001",
  "severity": "blocking",
  "start": 11.5,
  "end": 13.2,
  "subject": "selected hardware candidate",
  "requirement": "Make the unavailable choice visibly close the purchase route.",
  "observed": "The unavailable candidate leaves, but the selection still appears attached to the empty position.",
  "evidence": ["<exact evidence path from pack>"],
  "repair": "Show the interrupted choice and move attention to the consequence before considering an alternative."
}
```

Findings must fall inside the reviewed interval. `severity` is `blocking` or
`advisory`. `verdict` is `pass`, `revise`, or `incomplete`: use `revise` for
demonstrated defects and `incomplete` for missing coverage or evidence. A pass
requires full interval coverage and no blocking findings. Empty findings alone
do not establish a pass. Supply limitations honestly, including frame-only
inspection.

Submit each review and inspect the gate status:

```bash
npm run video -- review-submit --job jobs/example --file jobs/example/review/incoming/reviewer-report.json
npm run video -- review-status --job jobs/example --stage prototype
```

Submission takes the stage from the report and stores the validated record at
`review/<stage>/reviews/<role>.json`. `review-status` returns structured status
and exits unsuccessfully while the gate is unmet. The host must read and act
on findings, not merely retry the status command. Repeat submission for all
three roles. Preserve the accepted prototype evidence when expanding the film.

`render` remains available for drafts and writes a source receipt for the
encoded result. After the final pack and all three current reviews pass, run:

```bash
npm run video -- deliver --job jobs/example
```

`deliver` checks accepted prototype history, current final reviews and evidence,
the render's source receipt, and technical media verification before recording
completion. A prototype is historical evidence of a reviewed approach: its
frozen source, video, pack, and review hashes must remain internally consistent,
but its source hash need not equal the later full-film source hash. Final
qualification strictly matches the current source and delivered MP4. Changing
scenes, assets, cues, narration, camera behavior, or the final render invalidates
the corresponding current qualification. Re-run review after such changes;
do not copy old hashes into a new report.
