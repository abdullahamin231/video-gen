**Improving autonomous audio-and-script video production**

Research and repository review: 14 October 2026.

The intended interface should stay exactly as it is: the user supplies an audio path and a script path, and receives a completed MP4. The agent should supply the missing direction, references, assets, choreography, editing, and quality control.

**Recommendation:** keep the current timing and assembly pipeline, but put a visual development and revision process around it. Make the agent demonstrate an effective visual explanation before expanding the film, and make delivery depend on evidence from the rendered result. Adding more creative instructions alone is unlikely to solve the problem: `AGENTS.md` already describes most of the desired behavior.

This report distinguishes repository observations, externally documented practices, and proposed changes. No production code or existing jobs were changed. I inspected source, storyboards, review reports, and saved rendered-frame contact sheets. I did not watch all existing MP4s at normal speed; observations about pacing below are therefore limited to the recorded reviews, implementation, and sampled visual development.

**1. What is going wrong in this repository**

**The creative contract is stronger than the executable workflow.**

The repository already requires causal mechanisms, alternative concepts, continuing subject development, a demanding prototype, and review at normal speed. These are sound requirements. However, the production commands enforce mainly timing, file structure, selectors, determinism, and output validity.

In [`scripts/video.mjs`](../scripts/video.mjs), `render` runs `audit`, HyperFrames `check`, encoding, and stream verification. It does not require a reviewed prototype, a completed creative review, or proof that known visual defects were repaired. `verify` checks duration, dimensions, frame rate, audio presence and volume; those checks cannot establish that a film is interesting or that the intended narration survived audibly intact.

In [`lib/timing.mjs`](../lib/timing.mjs), a scene with one recognized action such as `draw` or `flow` avoids the custom-action warning. The pacing heuristic measures declared beat intervals and warns about gaps greater than four seconds. It does not observe what those beats do. A long declared action can cover an inactive passage. This also differs from the stricter activity and stillness guidance in `AGENTS.md`.

**An existing job documents the failure directly.**

[`gpu-9yr-30s/review/REPORT.md`](../jobs/gpu-9yr-30s/review/REPORT.md) reports zero audit warnings and passing HyperFrames checks, while also stating:

- Labels are hard to read at 480 px width and were not enlarged.
- The MP4 was not reviewed at full frame rate.
- The price scene uses a fixed framing.

Its [final-render contact sheet](../jobs/gpu-9yr-30s/review/contact-1fps-render.jpg) shows an opening tower glyph followed by a largely fixed log-price axis populated with labels and counters. The axis communicates magnitude, but most developments add information to a layout rather than make a subject operate. This is a useful example of technical success coexisting with the exact creative weakness you described.

**More geometry helps, but is not sufficient.**

[`silicon-time-machine`](../jobs/silicon-time-machine/review/REPORT.md) contains richer constructed hardware, mechanical interactions, and multiple scales. Its [saved contact sheet](../jobs/silicon-time-machine/review/full-stills/contact-sheet.jpg) shows that this environment can produce considerably more elaborate imagery. It also uses brighter illustrative treatment, and sampled counters show `$0` and intermediate amounts. These are not automatically improved explanations: they need checking against the house style and displayed-value rules. Richness, factual clarity, and restraint must be reviewed together.

[`latest-codex-6-1-med/STORYBOARD.md`](../jobs/latest-codex-6-1-med/STORYBOARD.md) has more ambitious mechanisms and continuity. However, much of the inspected market implementation still consists of drawing parts, moving packets, showing prices, and changing scale. Its storyboard records a minimum number of developing SVG leaves, but that metric cannot establish explanatory value. At inspection, its production report was still pending and no final `renders/video.mp4` was present; it should not be treated as a finished benchmark.

**The installed workflow contains conflicting defaults.**

The local [faceless-explainer skill](../.agents/skills/faceless-explainer/SKILL.md) assumes invented visuals with no asset-staging stage, leaves asset candidates empty by default, adopts a shipped design preset, skips sketches in autonomous mode, and asks the agent to glance at midpoint snapshots and move on if nothing is obviously broken. It also contains script-restructuring, TTS, and approval instructions that do not fit supplied-audio production.

Your repository instructions take precedence, but requiring the agent to reconcile these contradictions on every run is brittle. There is a particularly costly inversion here: autonomous mode removes some of the visual review that an autonomous agent needs to perform for itself.

**The reusable library is technically ready but creatively thin.**

The inspected library contains one bundle: `motion-primitives@1.0.0`, exposing `reveal`, `draw`, and `flow`. Versioning, provenance, and frozen copies are useful infrastructure. The available content mainly makes simple animations cheaper; it does not yet make complex mechanisms cheaper.

**2. What people are doing with AI motion design**

**A. Coding agents author editable animation, with concrete direction.**

Remotion officially supports coding agents through maintained skills, and its public prompt gallery includes UI demos, maps, charts, and Three.js work. One published map example specifies a camera following a journey from Los Angeles to New York, then adds Paris and an animated 3D Eiffel Tower. The important feature is the specific sequence and camera behavior in the direction. The gallery demonstrates possible outputs, not a controlled measure of reliable one-prompt quality. [Remotion skills](https://www.remotion.dev/docs/ai/skills), [community gallery](https://www.remotion.dev/prompts), [map example](https://www.remotion.dev/prompts/travel-route-on-map-with-3d-landmarks).

**What to adopt:** have the agent generate concrete visual direction internally. The user should not need to become the motion designer. Switching from HyperFrames to Remotion would not itself supply this missing direction.

**B. AI works inside established creative tools.**

Anthropic documents creative connectors including Blender, whose Python API can be accessed through a natural-language interface. Its examples emphasize scene analysis, debugging, scripting, and batch operations. This is evidence for agents operating a mature graphics environment, rather than expecting a single text-to-video request to solve every production problem. [Anthropic: Claude for Creative Work](https://www.anthropic.com/news/claude-for-creative-work).

**What to adopt:** let a passage use a more suitable authoring tool when its mechanism needs one. Use Blender or Three.js for spatial construction and cutaways, Manim for mathematical transformations, and SVG/GSAP for precise 2D interaction. Preserve HyperFrames as the assembly and narration clock.

**C. Visual references and pre-compositions provide control.**

Runway teaches using 3D asset pre-compositions as references to improve control and consistency. It also publishes storyboard and consistent-sequence workflows. The transferable practice is to establish visual inputs and shot relationships before generating final footage. [Runway: 3D assets as references](https://academy.runwayml.com/tutorial/using-3d-assets-in-references), [storyboard workflow](https://academy.runwayml.com/tutorial/storyboard-featured-workflow).

**What to adopt:** generate or construct reference frames, then animate their meaningful parts. Use generative footage selectively for imagery that benefits from it. Keep exact text, values, technical relationships, and important causal actions in controllable geometry. This division is a recommendation for this repository, not a measured finding about every video model.

**D. Research systems inspect rendered output and repair it.**

OmniManim describes explicit visual planning, shared scene state, post-render diagnostics, and localized repair. It specifically addresses defects that appear after execution, including intermediate animation states. Kubrick describes a director/programmer/reviewer process for Blender scripts using intermediate screenshots and motion coordinates. These papers support the architecture of render-based iteration; they do not prove autonomous professional motion-design quality. [OmniManim, May 2026](https://arxiv.org/abs/2605.15585), [Kubrick, revised May 2025](https://arxiv.org/abs/2408.10453).

**What to adopt:** review observed state transitions and the payoff, then repair the responsible passage. Do not accept a storyboard description as evidence that the corresponding action occurred on screen.

**E. Systems remember both successful approaches and failures.**

ManimAgent reports a memory system with successful reference examples and validated failure patterns, with improvements on its task-specific evaluation. That is a useful direction for the existing library, although it needs validation on this repository's narrated films. [ManimAgent, July 2026 revision](https://arxiv.org/abs/2606.30296).

**What to adopt:** save why a mechanism worked and where it failed, alongside code and preview clips. Retrieve by explanatory problem, such as “a limit causes a queue,” rather than only by effect name.

**F. Automated scores remain fallible.**

PhysicsSolutionAgent reports complete videos and favorable automated scores while human inspection still found layout and interpretation errors. Motion's AI Kit provides example retrieval and runtime performance auditing, but performance scores are not storytelling scores. [PhysicsSolutionAgent, January 2026](https://arxiv.org/abs/2601.13453), [Motion AI Kit](https://motion.dev/docs/ai-kit).

**What to adopt:** combine technical tests, visual evidence, and calibrated creative judgment. A second model or a higher score is not sufficient evidence of improvement.

**3. The proposed production workflow**

Use the same two inputs and run the following stages without routine user approval. These are internal production stages, not additional user tasks.

| Stage | Agent work | Evidence required to advance |
|---|---|---|
| Understand | Read the full script; measure and listen to the audio; reconcile names, numbers, and omissions | Source-linked claims and trustworthy cue anchors |
| Explore | Compare different mechanisms and inspect relevant visual references | A selected concept with reasons and visual examples |
| Design | Construct key visual states, prepare assets, define subject identity and handoffs | Readable reference frames and a choreography contract |
| Prototype | Animate a demanding 10–15 s passage; compare alternatives where the mechanism is uncertain | Render showing operation, consequence, payoff, and handoff |
| Build | Extend the selected visual language and mechanisms across the recording | Complete narration coverage and working scene transitions |
| Review and repair | Inspect playback and dense temporal samples; identify defects; revise locally | Timestamped findings, fixes, and reinspection of affected intervals |
| Deliver | Encode, inspect the final output, verify narration and media properties | Final MP4 with review evidence bound to that exact version |

**Explore with actual pictures and motion examples.**

For a new film, have the agent assemble a small reference board from relevant diagrams, hardware imagery, animation examples, or original reference frames. Record what each reference contributes: spatial arrangement, camera behavior, transformation, material treatment, or attention control. A list of links or the phrase “3Blue1Brown style” is insufficient.

Compare mechanisms rather than cosmetic treatments. For an expensive-hardware passage, alternatives could be a common calibrated cost axis, a hardware showroom that expands beyond a small intended task, or a purchasing sequence interrupted by unavailable stock. Select according to the spoken idea. Do not invent an exact budget, throughput, or memory limitation to make the picture operate.

Keep visual exploration in autonomous mode. The agent selects the direction itself. External references guide decisions; they are not permission to copy assets without suitable rights.

**Design multiple meaningful states before polishing animation.**

For each important passage, sketch the initial condition, operation, consequence, and payoff. Include an intermediate state likely to be difficult, such as an opened cutaway, partially assembled system, or crossing handoff.

Extend the existing choreography contract with stable subject IDs, relevant state variables, claim references, and what the viewer should infer. For example: a candidate occupies an available purchase slot; availability changes; that candidate withdraws; the slot remains empty. This has a visible consequence without implying an unsupported performance result.

Not every sentence needs a machine simulation. A motivation, joke, price comparison, and technical mechanism need different treatments. Require causal operation where the narration makes a causal claim, and use visual contrast or a specific metaphor where that better fits the passage.

**Make the prototype a real selection gate.**

The prototype requirement already exists; enforce it. Choose a difficult passage rather than an easy opening. Render it with its narration, review the action, and reject approaches whose main content remains outlines, packets, or arriving labels.

When the visual mechanism is uncertain, build two rough motion treatments before polishing either. Test composition at modest resolution, then check critical labels and strokes at delivery resolution. Reserve time for revision explicitly. If repeated attempts fail, change the mechanism or tool; do not merely add more animation to the same weak construction.

**Build from subject state, with reusable mechanisms.**

Represent the relationships that matter independently of individual tweens. Examples include a queue length, occupied memory cells, selected candidate, open route, visible inventory, or transformed component positions. Animate geometry from those states using the recorded cues.

For deterministic simulation, compute state from time or use seeded, reproducible state evaluation. Ensure direct seeking works; it must not depend on having played every earlier frame. A state model can remain plain JavaScript; this does not require a large new framework.

Grow the library with reviewed constructions: a constrained-capacity mechanism, an articulated cutaway, stable-part transformations, synchronized comparison, and a handoff that preserves subject position and identity. Each should include suitable uses, assumptions, failure modes, source, an editable implementation, and a short rendered example. These are capabilities to select, not a mandatory set of layouts.

**Choose a medium per passage.**

| Need | Suitable starting point |
|---|---|
| Precise 2D relationships and labels | SVG + GSAP |
| Equations, geometry, mathematical transformations | Manim |
| Depth, spatial constraints, articulated hardware | Three.js or Blender |
| Recognizable physical subjects or evidence | Frozen photographs, diagrams, or licensed footage |
| Atmospheric or illustrative imagery | Generated images or short generated footage, when useful |

Keep the first implementation focused on the existing SVG/GSAP path. Add another renderer when a selected passage needs it. For imported rendered passages, retain editable source and map their local timing to the global audio clock. Freeze chosen media locally with provenance. Discover tool and credential availability early; do not silently replace a planned important asset with an icon because a service is unavailable.

**4. Make review capable of rejecting the film**

Technical validity, visible activity, and explanatory quality are separate judgments. Report them separately.

For each passage, give the reviewer the relevant narration, intended mechanism, reference states, actual temporal samples, and a short playback clip where supported. Start with a visual-only pass: describe what happens and what causes it. Then compare that description with the intended explanation and audio. This reduces the temptation to infer actions from the storyboard that are absent from the render.

Use timestamped defect records containing severity, observed evidence, violated requirement, affected subject, and repair direction. For example: “The item becomes unavailable, but the selection remains attached to it; show the failed purchase and transfer attention to the empty slot.” Reinspect the repaired interval and adjoining handoffs. Factual errors, broken mechanisms, unreadable essential labels, and missing footage must block delivery.

Use a 1 fps contact sheet for whole-film coverage, denser samples around cue starts and transitions, and actual normal-speed playback for timing and attention. Still images cannot establish motion quality. If the reviewing model only accepts images, use ordered frame sequences and record that limitation accurately; do not label that as a playback review. A browser that can seek is not by itself a video-understanding capability.

Pixel differences and visible element changes can find inactivity. They cannot tell whether a price became meaningful, a comparison operated fairly, or the camera revealed new information. Do not let decorative movement or camera-only change satisfy semantic review.

For phone-scale review, inspect the final rendered picture at 480 px width. An authoring font-size minimum is only a starting condition. Enlarge, simplify, or remove unreadable labels. Also inspect intermediate displayed values: a counter can accidentally communicate an invented price even when its final value is correct. Prefer a neutral placeholder followed by the spoken value when intermediate quantities explain nothing.

For audio, retain the supplied recording as the root authority. Supplement level checks with listening or supported audio review and a comparison against the original track. When mixed with sound effects, check intelligibility at the affected moments. ASR can help detect omissions but is not proof of an unchanged recording.

Use separate director, builder, and reviewer passes with distinct inputs. This can run sequentially within one agent. Multiple agents are optional and must follow the repository's delegation rule. If later authorized, divide work by coherent sequences with shared subject and handoff contracts; independent frame workers are a poor default for a continuous visual mechanism.

**5. Concrete changes to this repository, in priority order**

| Priority | Change | Where | Acceptance condition |
|---|---|---|---|
| P0 | Add a repository-owned supplied-audio workflow that resolves conflicting skill defaults | `docs/agent-workflow.md`, preparation scaffold | Original audio, references, asset preparation, internal sketches, and autonomous review are explicit; no TTS or routine approval stage |
| P0 | Track production stages and evidence | `scripts/video.mjs`, job metadata | A job cannot be marked complete with a pending report or missing final MP4 |
| P0 | Add required prototype and review records | New review schema and validation | A demanding rendered passage and its review exist before full production proceeds |
| P0 | Separate draft rendering from delivery qualification | Render/delivery commands | Drafts remain easy to render; delivery requires current technical and creative evidence with no unresolved blocking defects |
| P0 | Add a reusable temporal review pack | New script using existing renderer/FFmpeg | Agent can request cue-centered samples, short clips, phone-scale frames, and final contact sheet without ad hoc commands |
| P1 | Extend the choreography data with subject states and claim links | Storyboard/beat schema | Major passages identify observed consequences and payoff; no fixed number of shots or tweens |
| P1 | Add reviewed mechanism bundles and failure memory | `library/`, `lib/library.mjs` | Search returns applicable mechanisms with previews and limitations, alongside primitives |
| P1 | Introduce cached scene rendering and targeted reinspection | Production tooling | Revising one passage does not unnecessarily regenerate the film; affected handoffs are checked again |
| P2 | Add optional Manim/3D and generated-media adapters | Asset/render integration | A passage can use another medium while preserving measured cues and reproducible local assets |

Treat proposed command names such as `review-pack`, `review-validate`, and `deliver` as additions, not existing capabilities.

Bind evidence to source and output hashes. A review of version A must become stale when version B changes the scene, assets, cues, camera, or audio. Final contact sheets and qualification should reference the final MP4 hash. A schema validator can prove evidence exists and is current; it cannot prove the reviewer's judgment is correct.

Keep dependency versions fixed during a job and update deliberately between jobs. Record available tools, renderer versions, fonts, and service capabilities at preparation. Use staged context: a short authoritative production contract, then only the selected runtime recipes and relevant scene material. This reduces contradictory instructions and leaves more attention for visual reasoning.

Give production an explicit resource policy: capability discovery, low-cost exploration, a reserved revision allowance, cached renders, and bounded retries. If resources are exhausted before the quality bar is met, preserve the draft and report the incomplete result accurately. Never lower the definition of “complete” by hiding defects in a limitations paragraph.

**6. An initial experiment that would test the proposal**

Rebuild the same supplied 30 s GPU excerpt in a new isolated job. Keep narration, facts, aspect ratio, and house style constant. Compare the current workflow against the proposed process, recording total agent time, render time, external cost, and repair rounds.

For this excerpt, develop a continuous local-computer subject. Show the recurring-payment motivation without implying local inference has no costs. Let the search reveal recognizable, differently scaled hardware. Attach each spoken price to its actual subject and map it onto one common cost coordinate system. Show stock withdrawal only when availability is narrated. Do not introduce bandwidth or throughput mechanisms before those ideas are spoken. Keep the ending faithful to the excerpt boundary.

This direction still needs a prototype; it is not a guaranteed winning design. Compare it against a genuinely different mechanism before committing. A chart remains useful when it explains magnitude, but should participate in the action rather than simply accumulate labels.

Judge the resulting films in blinded order for comprehension, factual fidelity, purposeful motion, visual interest, readability, and continuity. Ask what the viewer understood without sound, and which passage felt empty. Track judge disagreement and verify model-found defects against the frames. Do not use element counts as the winner criterion.

Then repeat on different subjects and a longer recording to test whether the improvement generalizes beyond this GPU script and survives the second half of a film. The desired outcome is consistently stronger explanations with the same two-path user interface. That outcome has to be demonstrated by new renders; the research and workflow changes alone do not establish it.
