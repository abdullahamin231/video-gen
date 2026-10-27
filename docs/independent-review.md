# Independent review for autonomous video production

**Personality scope:** the job's frozen `production-profile.json` owns editorial/design/review direction. Technical schema, timing, legibility, evidence and independence requirements here remain shared. Scientific metaphor, drawing-only, constant-motion and explainer-style examples apply to `explainer`; other personalities use their own `DESIGN.md` and `REVIEW.md`. A fixed personality's visual grammar is a production requirement, not an optional theme preference. Do not impose another personality's style.

The user supplies audio and script paths and receives a finished MP4. The
production agent directs, builds, renders, commissions independent reviews,
repairs defects, and qualifies delivery. Review is an internal production
stage. It introduces no storyboard approval, interview, or user-operated
command.

This protocol supplements [the production workflow](agent-workflow.md) and
the quality requirements in [orchestrator.md](orchestrator.md). Technical audits remain
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

Review the whole film once, after every scene builds. There is no earlier
prototype gate. The final review must cover the exact sources that are rendered
for delivery.

Nothing is rendered before the final review. Reviews look at the built HTML: the
browser seeks the same seek-safe timeline the renderer captures, so a frame from
the pack is the frame the MP4 will hold at that time. Prepare a frozen evidence pack for each
build. The pack is preflighted before it becomes visible to reviewers: every scene
must contain image evidence, audio must span the film, and encoded packs must
have clips covering each scene (and each app-capture interval). A failed preflight
writes no pack and starts no reviewer; its consolidated error names every gap.
Include the source fingerprint, duration, contact sheet sampled at the review depth's frame step
(standard: once per second), ordered frames stamped with their film time, phone-scale frames, and denser
samples around changes of state, cue starts, and handoffs. Once the final reviews
pass, the film is rendered once from exactly those sources (the render's source
receipt must match the pack), and delivery checks that the rendered narration
matches the recording and that the pixel checks pass. Older packs made from an MP4
(`review-pack --from render`) also carry the MP4's SHA-256 and short clips. Keep source
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
look: the design theme is a creative choice made in the visual plan (or by the director). Do reject a film that does not
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

Repair the responsible mechanism, composition, timing, or asset. Rebuild,
run technical checks, and prepare a fresh evidence pack. Recheck
the affected interval plus adjacent handoffs. Because final qualification is
bound to the exact source fingerprint (and through it, to the one render), all three roles must issue
current final reports; prior reports remain history and cannot qualify changed
output. Reviewers can use prior findings to target attention, but must account
for the full new artifact, including unintended regressions.

Use the review depth's creative-round budget per stage. Collect all three role reports before repairs.
After that many complete failed rounds, finish the film with unresolved findings disclosed, as specified in
"Bounded creative review policy" below. Never manufacture a passing verdict. Independent passing qualification
requires no unresolved blockers; bounded completion records a separate review-limit-reached disposition.
Both require current valid independent coverage and passing technical verification.

## Commands and machine-readable contract

The host runs the commands and commissions the reviewers itself. For example,
after the film builds, freeze the full interval:

```bash
npm run video -- review-pack --job jobs/example --stage final
```

`review-pack` creates `review/<stage>/pack.json` and a frozen evidence run
directory. It also writes `briefs/review-<stage>-<role>.md` for each reviewer
and prints their absolute paths and the pack hash. Spawn a separate reviewer
as a fresh sub-agent with no conversation history (however the host harness spawns one) for each brief, passing the brief path as its initial
task. Each reviewer runs `review-template` (pre-filled hashes, and the reviewer id when the runner started the agent), fills `review/<stage>/incoming/<role>.json`,
and submits it with `review-submit`, which lists every remaining problem with its field in one pass. Packs also contain the motion transcript (`motion.md`, kind `motion`) and the
automated check results (`inspect.json`, `pixels.json`, kind `checks`) as supporting diagnostics.
They cannot replace image/video inspection. Without visual input a reviewer records `inspection.visual: "unavailable"`
and verdict `incomplete`. The blind visual role reads diagnostics only after saving its observations of the images.
`next` dispatches reviewers and repairs automatically.
The command prepares dispatch material; the host's agent tools execute the
reviews. Use `--stage final` for the whole film once every scene builds.
`--stage prototype` is retired and exits with an explanation.
Interval arguments are film seconds, not word-count timing estimates. Sample
the built film itself, never a Studio state (Studio stamps ids into the job's HTML).

The pack contains its interval, scenes, `source` (`html`, or absent for a pack made from an MP4), `sourceHash`,
`videoSha256` (`null` for an html pack), and
`evidence` entries with `path`, `sha256`, `kind`, `start`, and `end`. The kinds
are `frames`, `contact-sheet`, `clip`, `audio`, `verification`, `motion`, `checks` and
`sound`; each individual PNG frame is a `frames` entry. `sound` entries are the film's sound plan
(`sounds.md`: every effect with its cue, volume and reason, every cut and big move with its beat offset), the mix
measurements (`mix.json`, measured on the MP4), and the cue sheets (one frame before and after each cue with the
waveform around it, decoded from the MP4) with the five headphone checks (`listen.md`). Verification receipts are frozen inside the
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
  "stage": "final",
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
rendered audio and the reference soundtrack (the supplied narration, or for a film with sound effects or music the
pipeline's own mix `renders/mix.wav`, in which the narration is unprocessed apart from one master gain), and the
report explicitly states
that listening was unavailable. This is a heuristic consistency check, not
proof of exact sample preservation, unchanged words, or listening. The comparison
decodes both tracks to 8 kHz mono float32, examines the entire decoded tracks
without time-shift correction, fits one global gain (strictly between 0.25 and 4), and requires correlation of at least
0.995, normalized RMS error of at most 0.10, and duration difference of at most
0.05 s. Silence, decoding errors, and failed comparisons do not qualify this
fallback. These thresholds allow ordinary lossy encoding; they are not a
validated speech-recognition or intelligibility test. Significant legitimate
mixing or processing can fail the check and require supported listening instead.
It does not establish intelligibility under added music or sound effects: for
that, read the measurements in the pack's `mix.json` (`voiceMasked`: moments where effects and music are louder
than the voice while it speaks; `voiceClose`: within 3 dB under it; both K-weighted) and the build's masking warnings
in `sounds.md`. `voiceMasked` needs supported audio review or a mix repair and remains blocking. `voiceClose` and the
per-effect warnings are advisory: a short effect a few dB under the voice does not hide a word. `unavailable` cannot pass required audio review.
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
npm run video -- review-submit --job jobs/example --file jobs/example/review/final/incoming/visual-mechanism.json
npm run video -- review-status --job jobs/example --stage final
```

Submission takes the stage from the report and stores the validated record at
`review/<stage>/reviews/<role>.json`. `review-status` returns structured status
and exits unsuccessfully while the gate is unmet. The host must read and act
on findings, not merely retry the status command. Repeat submission for all
three roles.

After the final pack and all three current reviews pass (and, when the person asked to see the film, their approval),
`next` asks for one `render`, which writes a source receipt for the encoded result. Then run:

```bash
npm run video -- deliver --job jobs/example
```

`deliver` checks the current final reviews and evidence, the render's source
receipt, and technical media verification before recording completion. Final
qualification strictly matches the current source and delivered MP4. Changing
scenes, assets, cues, narration, camera behavior, or the final render invalidates
the corresponding current qualification. Re-run review after such changes;
do not copy old hashes into a new report.

## Review depth

Review depth is chosen before the job starts and frozen with the project and manifest. It changes evidence
density and the creative repair budget, never independence: every depth still uses the same three fresh
reviewers and the same qualification checks.

| Depth | Failed rounds | Frame step |
| --- | --- | --- |
| `fast` | 2 | 2 s |
| `standard` (default) | 3 | 1 s |
| `deep` | 4 | 0.5 s |

Set it with `project-new --review-depth ...`, `start --review-depth ...` or `project-set --review-depth ...`.
Jobs created before the setting existed resolve to `standard`.

## Bounded creative review policy

The final review gets at most the project's creative-round budget: `fast` two rounds, `standard` three and
`deep` four. Wait for all three role reports before producing one combined repair brief; repeated `next` on
the same pack does not consume another round. After the last failed round, if no readability blockers remain,
proceed with a `review-limit-reached` disposition and preserve other creative blocking findings
in delivery metadata. Reviewer verdicts stay unchanged; this is completion with disclosed findings, not a pass.
Invalid/stale evidence, missing reviewers, unavailable inspection, incomplete coverage, build failures and failed
narration/render verification still require repair. Human review gates remain explicit user decisions.

Fresh reviewer briefs include prior decisions after the blind visual inspection instructions. Reviewers must
record a resolved/unresolved/disputed response, with a reason, for each blocker in their latest prior report.
Assess truth and understanding consistently; supporting action may anticipate or finish around a spoken cue.
Loading SSD rows copies them into RAM without deleting the persistent copy. Cosmetic timing is advisory. Deliberate overlap is allowed only when every visible word remains clearly readable; unreadable secondary labels are blocking too. Reversing an accepted repair requires
a concrete contradiction or regression in current evidence.

Readability is non-waivable: obscured, illegible or unintentionally overlapping text blocks delivery even after three creative review rounds. Intentional layering needs an explicit reason and clearly readable text.
