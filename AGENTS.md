# Make the finished video

This repository's interface is a natural-language request:

> Create a video given the audio `<audio path>` and script `<script path>`.

The agent owns the entire production: understand the narration, choose the
creative concept, source or generate assets, design shots, animate, synchronize,
review, revise, and return the final video. The user should not have to specify
jobs, JSON, commands, palettes, storyboards, effects, scene counts, or timestamps.
Those are internal working artifacts. A plan or a runnable project is not the
requested deliverable; complete the MP4.

The agent has full creative discretion and authority over the creative process.
Use that authority to make an engaging, fully animated YouTube video. The
pipeline exists to reproduce technical execution and preserve decisions, not to
standardize the creative result.

## What quality means here

**Make a motion-designed film, not a presentation with animated entrances.**
The rejected sample had correct timing and clean layout but was still a sequence
of static diagrams with large headlines. Passing audits did not make it good.
Do not reuse that sample's composition, layout, art direction, or shot structure.

The visuals must *perform* the narration. Show objects operating, mechanisms
changing, cause and effect unfolding, environments developing, comparisons
becoming visible, and consequences happening. A subject appearing beside a
sentence is not enough. A machine should do something; a flow should travel;
a comparison should evolve; a visual metaphor should play out.

Motion design should carry the piece throughout its duration:

- Build shots from many short, coordinated actions, commonly around 0.2–2s:
  assembly, traversal, drawing, deformation, rotation, morphing, reveal,
  simulation, parallax, purposeful reframing, and transitions. Choose the right
  technique for the idea rather than cycling generic entrance presets.
- Layer primary action, supporting action, and motivated scene/camera motion.
  Stage them so the viewer knows where to look. High motion density should still
  have one clear focus; do not move everything independently.
- Let objects and relationships persist, transform, and hand off between shots.
  Develop a full visual world across a thirty-second sequence instead of
  replacing a static left-hand illustration and right-hand text panel.
- A thirty-second excerpt may need dozens of narrative developments and
  hundreds of coordinated element-level animations. A spoken cue can launch
  several interacting micro-animations. Fifteen cues do not mean fifteen tweens.
  Use the density the explanation needs; do not inflate a tween count with
  meaningless decoration.
- Change visual scale and perspective where useful: detail, mechanism,
  environment, payoff. Use motivated camera moves and visual handoffs. Keep the
  film evolving in the later half as well as at the opening.
- Let typography support the action. Headlines, prices, numbers, and key phrases
  can be strong moments, but a large sentence above an illustration must not be
  the recurring foundation of the film. The narration already supplies prose.
- Brief deliberate rests help a payoff read. Long static holds, breathing cards,
  idle camera drift, blinking LEDs, and floating particles do not rescue a shot
  whose subject has stopped developing.

No exact shot count or animation count is mandatory. Use 2D, 3D, real media,
generated imagery, detailed illustration, simulation, kinetic type, or
combinations according to the story. The quality requirement is dynamic visual
storytelling. Choose and create the assets needed to achieve it; do not reduce
the idea to text and simple rectangles because they are easier to author.

## House visual style: clean, precise, professional

Unless the user asks for another look, the default register is the precise
mathematical-explainer style of 3Blue1Brown and Manim: a calm, technical,
premium film. The target is a produced YouTube explainer, not a kids' animation
or a corporate infographic.

- **Restraint.** Use a dark or deep neutral background (near-black or charcoal
  blue-grey) with off-white primary content. Use at most two or three accent
  colors, muted and saturated only sparingly, each with one consistent meaning
  across the film. No gradients on objects, no glossy highlights, no drop shadows,
  no sticker outlines, no bubbly rounded shapes, no emoji or cartoon mascots.
- **Line-based vector construction.** Prefer thin, crisp strokes (roughly 2–4px
  at 1080p), filled areas at low opacity, and geometry that reads as engineered:
  axes, grids, arrows, nodes, vectors, traces, cross-sections, and
  diagrams drawn as the viewer watches. Flat fills are fine when they clarify.
- **Typography as a precise instrument.** Use a clean sans for labels and a
  refined serif or LaTeX-style face for equations and symbols. Labels are small,
  placed next to the thing they describe, and fade in with their subject. Avoid
  large paragraph-sized headlines on screen.
- **Motion vocabulary of the genre.** Favor drawing a path or outline (write-on),
  morphing one shape into another, transforming an equation or diagram term by
  term, moving a camera across a coordinate space, zooming into a detail, and
  dimming the previous focus while a new element takes over. Keep most motion
  purposeful; a single motion should explain something.
- **Easing and timing.** Use smooth, decelerating or symmetric curves (power
  or sine in/out, roughly 0.4–1.2s for primary moves). No bounce, elastic, or
  overshoot. Let moves overlap so the frame never looks like a stack of separate
  tweens. Hold briefly on each payoff so it can be read.
- **Composition.** Use a consistent grid and margins. Keep one clear focal point
  per moment, with supporting elements subdued (lower opacity or smaller scale).
  Use generous negative space. Camera moves should be slow, deliberate, and
  motivated by the narration (pan, zoom, reframe, or dolly to a new scale).
- **Continuity.** Carry the same objects, axes, and coordinate frame across
  shots so the viewer tracks one evolving world instead of reading a series of
  unrelated slides.

When the story is better served by a different realistic or illustrative look,
the agent may choose one, but it must still meet the restraint, precision, and
motion standards above. Manim (ManimCE or ManimGL) is a suitable way to build
precise vector passages: use the `manim-composer`, `manim-video`, and
`manimce-best-practices` or `manimgl-best-practices` skills, render them to
video, and compose the result with the HyperFrames pipeline. Keep the pipeline
and job rules in this file unchanged.

## Skills are production knowledge

Start by reading `.agents/skills/hyperframes/SKILL.md`. Consult the owning
workflow and domain skills before their corresponding work:

- `faceless-explainer` for topic explainers; `general-video` for longer or custom
  films. Other deliverables follow the HyperFrames router.
- `hyperframes-core` before composition HTML, timing, and assembly.
- `hyperframes-animation` for choreography, atomic rules, scene blueprints, and
  runtime adapters. Read actual selected recipes, not only the skill index.
- `hyperframes-creative` for visual direction and composition at video scale.
- `hyperframes-keyframes` for camera movement, morphs, and reframing.
- `hyperframes-registry` before hand-building named effects or visuals: search
  by intent, inspect matches, and use them when they serve this film.
- `media-use` for transcription and media; use `imagegen` when original bitmap
  assets would improve the result. Freeze assets locally and record their origin.
- `hyperframes-cli` for development, validation, snapshots, preview, and render.

Skills help the agent execute its concept. They do not override the user's
creative authority or force an interview, a preset, repeated layouts, or another
approval gate. Supplied audio means skip TTS. A request for a finished video
already authorizes local generation, asset preparation, iteration, and rendering.

## Autonomous production from two inputs

Read `docs/agent-workflow.md` for the technical contract. Carry out these stages
without requiring the user to drive them:

1. **Inspect the inputs.** Read the full script, determine the recorded duration
   and language, and understand its argument and visual opportunities. Preserve
   the supplied recording. Use the entire audio unless the user requested an
   excerpt; for a requested 30s sample, use the first 30s unless directed otherwise.
   Infer a sensible title and job slug. Default to YouTube landscape 1920×1080,
   30fps when no destination is specified. Ask only for a genuinely missing input.
2. **Prepare and align.** Run `npm run video -- prepare` with the actual paths.
   Measure word timings; reconcile with the script. ASR is evidence, not perfect
   truth: inspect names, numbers, repetitions, and missed words. Correct text
   from the recording/script when warranted, retain measured intervals, and
   record corrections. Use word IDs for uncertain phrase matches. Never invent
   timings from word counts or stretch the narration to fit the animation.
3. **Direct the film.** Choose a distinctive visual concept that fits the house
   style above. Plan evolving actions and shot handoffs in `STORYBOARD.md`, with
   a design direction in `frame.md` (palette, type, stroke, easing, camera rules)
   and spoken anchors in `beats.json`. For each beat identify the
   actual visible action and its follow-through. Avoid a list of text summaries
   with entrance effects. Keep this planning internal unless the user requests it.
4. **Build the animation.** Use the generated `assets/cues.js` as the timing
   authority. Major actions start on the relevant spoken cue; supporting motions
   can anticipate, overlap, and resolve around it. A cue anchors choreography,
   not just the instant at which a whole completed diagram appears. Build
   seek-safe deterministic timelines and complete visual subjects. Subdivide
   shots as needed; a single sub-composition is not a reason to keep one framing.
5. **Prove the motion language early.** Build and inspect a short animated
   passage (about 10–15s, covering at least one cue-driven transformation and one
   camera move) before extending the film. It must show ongoing subject action
   and a convincing transition/handoff, not a static board with a headline. It
   must also match the house style: clean strokes, restrained palette, smooth
   easing, no cartoon treatment. If it looks like slides or clip art, redesign it
   immediately. No user approval is needed for this internal quality check.
6. **Review and revise the complete piece.** Run technical audits, but also
   inspect the moving preview/draft and dense frame sequences across active
   passages. Check narration alignment and what the viewer sees between cues.
   Fix dull or static sections instead of documenting them as acceptable.
7. **Deliver.** Render and verify the final MP4, open a working Studio preview,
   and return a link to the video. Include a short factual note on verification
   and any real limitation. Keep process details secondary to the deliverable.

## Quality gate before delivery

The agent must evaluate all of these, not only lint success:

- Does the muted video show the idea through action, even without reading prose?
- Are subjects actively changing during explanatory passages, with continued
  development toward the final payoff?
- Do the animation and camera have a coherent relationship to the narration?
- Is each visual treatment richer than a headline, an icon, and a price panel?
- Does it look like a precise, professionally produced explainer (clean vector
  geometry, restrained palette, deliberate easing, readable labels) rather than
  cartoon illustration, clip art, or a generic motion template?
- Is motion present throughout the film, including the second half, with
  objects transforming, drawing, morphing, or moving across scales, rather than
  mostly fading in and holding?
- Do transitions connect ideas rather than fade between completed layouts?
- Is the viewer's attention guided despite the density of micro-animation?
- Would this feel at home in a produced YouTube explainer, rather than a slide
  presentation or an animated infographic export?

If the result fails, it is unfinished. Revise the visual construction and
choreography; do not add cosmetic motion to declare it complete. Technical checks
are required, but they are not evidence of cinematic or creative quality.

## Technical invariants and reproducibility

- Every video lives in a new isolated `jobs/<slug>/`. Never overwrite another
  job, source inputs, or the legacy `public/hf/index.html`. All jobs are ignored
  by Git; retain the reusable pipeline and instructions in the repository.
- Record inputs, measured alignment, creative decisions, frozen assets, and
  resolved cues. Reproducibility concerns execution, not identical creative output.
- Root audio is the original supplied clip. One paused seekable timeline per
  sub-composition; styles/scripts live inside sub-composition templates. Follow
  the selected runtime adapter when using 3D or another animation runtime.
- Resolve narrative cues mechanically with `compile`; assemble with the pipeline.
  Complex internal choreography can use relative offsets derived from these cues.
- Run `audit`, HyperFrames `check`, and motion assertions with checks actually
  enabled. Inspect multiple samples within shots, not just scene midpoints.
  Validate final duration, dimensions, fps, and audible narration.
- Motion evidence must concern real visible subjects. Invisible proxy nodes,
  tiny cue markers, and changing metadata do not prove that a canvas/3D scene
  animates. For canvas or WebGL, inspect rendered frame/pixel changes and the
  actual cue-driven poses; never pass a creative gate using hidden DOM toggles.
- Pacing heuristics are advisory: they do not enforce one style. They also do not
  excuse an inert film. Deliberate holds need a narrative purpose and visual review.
- Save evidence and limitations in `review/REPORT.md`. Do not claim that watching
  stills proves motion quality or that ASR estimates are forced alignment.

## Delegation and commands

Delegate when explicitly requested or required by the owning workflow. Workers
receive exact input paths, duration/scope, creative authority, required skills,
technical contracts, quality expectations, and deliverables. Do not give them a
preselected visual template. Assign separate jobs/files to avoid write conflicts.

`npm run video -- help` lists pipeline commands. `npm test` checks timing and
assembly. `dev`, `check`, and `render` accept `--job jobs/<slug>` or use the latest
prepared job. These are tools the agent operates, not steps the user must learn.
