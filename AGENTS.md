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
Correct timing, clean layout, and passing audits do not establish creative
quality. A sequence of static diagrams with large headlines remains a
presentation even when its entrances are animated.

Outline assembly, particles travelling along paths, rotating parts, scrolling
content, and camera zooms are useful supporting primitives. A film built mainly
from those operations is too simple. Require inventive choreography in which
subjects interact, mechanisms develop, and the narration's meaning becomes
visible through action.

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

## Animation must explain through an inventive mechanism

**Complexity means interacting behavior and evolving meaning, not more tweens.**
For each important narrated idea, invent an animated mechanism with a setup,
an operation, a consequence, and a visual payoff. The viewer should see why the
result happens. Drawing the subject, sending a few particles through it, and
moving the camera closer does not complete the explanation.

- **Make the action specific to the narration.** Identify the exact verb,
  relationship, tension, or surprise in the spoken passage. Design an action
  that could not be reused unchanged for an unrelated topic. A generic marker,
  network, or conveyor must not stand in for every idea.
- **Develop internal behavior.** Subjects should have parts with distinct jobs,
  constraints, and reactions. Show loading, processing, accumulation, contention,
  rejection, redistribution, or failure when the story calls for it. Inputs
  should change the mechanism; its operation should visibly change the output.
  Components merely seating into an outline are an introduction to the subject,
  not its whole performance.
- **Use consequential choreography.** One action should cause the next:
  an arriving load fills memory, a constrained route backs up, an alternative
  path opens, and the output changes. Coordinate these reactions spatially and
  temporally. Independent loops running together do not create a mechanism.
- **Transform the actual subject.** Preserve meaningful parts as geometry,
  organization, scale, or function changes. A crossfade between two drawings,
  or shrinking one group while another fades in, must not be described as a
  rich morph. Make the intermediate states intelligible and useful.
- **Choreograph comparisons.** Let alternatives operate under the same visible
  conditions so their difference emerges through behavior. Use quantities from
  the source; label qualitative illustrations clearly. Do not replace the
  comparison with two labels and a count-up.
- **Use the camera to reveal new information.** A move can expose hidden layers,
  follow a consequential event, reveal a constraint, or connect scales. A zoom
  on an otherwise unchanged diagram adds no explanatory depth.
- **Build visual surprise with a reason.** A familiar object can unfold into an
  unexpected mechanism, an apparently winning system can encounter a constraint,
  or a large structure can resolve into a small requirement. Set up the visual
  expectation, then make the spoken turn produce a clear change.
- **Choose the medium the idea needs.** Use custom SVG geometry, articulated
  illustration, deterministic simulation, perspective or 3D construction,
  masks, shape interpolation, real media, or generated assets when they improve
  the explanation. Do not limit the film to whichever CSS/GSAP primitives are
  quickest to implement. Complexity must remain readable and purposeful.

For a GPU explainer, possible actions include a cutaway that exposes data being
loaded and processed, repeated weight retrieval that visibly constrains token
generation, or interacting routes whose congestion changes when hardware is
added. For a cost passage, the cost can alter access, scale, or the feasibility
of the desired setup instead of appearing as a price beside a machine. These
are examples of causal thinking, not mandatory layouts. Only show mechanisms
supported by the actual narrated passage; do not introduce later explanations
or invent technical claims to justify an animation.

### Write a choreography contract for each major passage

In `STORYBOARD.md`, record the narrated idea, the chosen mechanism, its successive
visible states, the interactions that connect those states, the camera's purpose,
and the payoff. State what makes it more inventive than a basic draw/reveal/flow
version. Compare genuinely different approaches; changes of color, placement,
or entrance direction do not count as creative alternatives.

Give workers this narrative and quality contract with creative freedom. Do not
preselect a repeated visual or effect template. Review the returned animation
against the mechanism and payoff, not its reported element or tween count.

## Creative latitude, density, and engagement

The agent is the film's creative director, accountable for how it plays, not
just whether it passes checks. Work in three passes: invent, then structure,
then build.

### Invent

- For the film as a whole and for each scene, generate several distinct visual
  approaches before choosing. Write the alternatives down, judge them against
  the narration, and pick the most inventive one the house style can carry.
  Record why it won.
- Ask what the idea looks like, not what it is about. A system has parts that
  interact; a comparison has a gap that widens; a process has an input, a
  machine, and an output; a choice has a door that closes. Build those.
- Give the film a through-line: one recurring object, coordinate frame, or
  visual metaphor that the viewer can follow across scenes. State it in the
  storyboard and make it evolve.

### Structure

- **Continuous motion.** In any three-second window of an active passage,
  several elements should be doing something: drawing, moving, morphing,
  counting, flowing, rotating, or reacting. A window with one or two moving
  things is under-built. Do not let a subject go still the moment it is built.
- **Anticipation.** Build toward each spoken beat. Let the frame set up the next
  element before the cue arrives, so the cue triggers a payoff rather than a
  cold start.
- **Secondary action.** Add supporting elements that serve the idea: parts that
  assemble and connect, traces that draw between nodes, flows and packets along
  paths, annotations that write on, scale and perspective changes, depth layers
  with parallax, sub-systems that open up, indicators that respond to events,
  and transitions that reshape one object into the next. Each must answer
  "what does this show?" If it cannot, cut it.
- **One focus at a time.** Dense motion needs a hierarchy. Give one element the
  primary action, subdue the rest in scale or opacity, and move the focus
  deliberately. Use a brief rest after a payoff, not before it.
- **No repetition.** Each scene should introduce a new way of showing an idea:
  a different scale, camera position, geometry, or interaction. A scene that
  reuses the last scene's arrangement with new content is a missed beat.

### Build

- **Vary the vocabulary.** Do not build every subject from the same primitives
  (rounded rectangles, icon cards, bar charts, text labels). Mix line drawings,
  schematic cutaways, 3D or perspective objects, data-driven traces, simulations,
  and typography, chosen per idea. Search the hyperframes registry and the
  motion helpers for effects that fit, and build custom geometry when they do not.
- **Prefer transformations.** An object becomes another object, a quantity
  becomes a shape, a diagram unfolds into a larger one. Prefer these over
  sequential appearances of separate panels.
- **Layer the timing.** Stagger overlapping actions so the frame reads as one
  orchestrated movement, not a stack of separate tweens. Small secondary motions
  can anticipate or resolve after the primary one.
- **Restraint applies to palette and clarity, not to activity.** The house
  palette, stroke rules, and easing stay fixed. Within them, the film should
  feel busy with purposeful action.

### Review

- **Watch it muted.** A good film reads without sound. Check that each idea
  lands through the action alone.
- **Watch it at speed.** The viewer experiences the film at full rate. If a
  passage feels slow or empty, tighten it; do not wait for a reported error.
- **Count the moving elements.** In any three-second window of an active
  passage, if fewer than three elements are visibly developing, the shot is
  under-built. This is a minimum activity check, not a creative quality score.
  Many moving pins, traces, fans, or packets can still form a simplistic shot.
  Fix the missing narrative behavior rather than padding the element count.
- **Audit the mechanism.** Describe what changes and why in each passage without
  naming animation primitives. If the description is only "it draws, packets
  move, and the camera zooms," redesign the passage. Require an observable
  interaction, consequence, and payoff that match the narration.
- **Test for interchangeability.** If swapping the labels would let the same
  animation explain a different topic, its construction is too generic. Replace
  it with subject-specific behavior. Repeated supporting primitives are fine;
  repeated primary explanations are not.
- **Check the eye.** Identify where attention should be in each beat and
  confirm that the brightest, fastest, or largest element sits there. If the
  eye is drawn elsewhere, fix the hierarchy.

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
  Restraint applies to surface treatment, not to the number of subjects or the
  amount of motion.
- **Line-based vector construction.** Prefer thin, crisp strokes (roughly 2–4px
  at 1080p), filled areas at low opacity, and geometry that reads as engineered:
  axes, grids, arrows, nodes, vectors, traces, cross-sections, and
  diagrams drawn as the viewer watches. Flat fills are fine when they clarify.
  This is a surface language, not a complexity ceiling: detailed cutaways,
  articulated mechanisms, layered geometry, and simulations should still feel
  clean and precise. Minimal styling must not become minimal storytelling.
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
3. **Direct the film.** Follow the invent–structure–build method in "Creative
   latitude, density, and engagement." Generate several concepts, pick the most
   inventive one the house style can carry, and give the film a through-line.
   Plan evolving actions and shot handoffs in `STORYBOARD.md`, with
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
   passage (about 10–15s) from a demanding, representative part of the story
   before extending the film. Do not choose an easy opening assembly merely
   because it can pass quickly. Include a cue-driven transformation, a motivated
   camera move, and interacting subject behavior that produces a visible
   consequence and payoff. It must show ongoing subject action
   and a convincing transition/handoff, not a static board with a headline. It
   must also match the house style: clean strokes, restrained palette, smooth
   easing, no cartoon treatment. If it looks like slides or clip art, redesign it
   immediately. If it is clean but consists mainly of outline assembly, packet
   travel, fades, and zooms, it also fails: invent and build a richer mechanism
   before scaling that motion language across the film. No user approval is
   needed for this internal quality check.
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
- Does each major passage have an inventive, narration-specific mechanism with
  interacting parts, a visible consequence, and a payoff?
- Does the animation explain more than drawing a diagram, routing generic
  particles, rotating parts, scrolling content, and changing camera scale?
- Are transformations meaningful through their intermediate states, and do
  comparisons reveal differences through operation rather than labels alone?
- Does it look like a precise, professionally produced explainer (clean vector
  geometry, restrained palette, deliberate easing, readable labels) rather than
  cartoon illustration, clip art, or a generic motion template?
- Is motion present throughout the film, including the second half, with
  objects transforming, drawing, morphing, or moving across scales, rather than
  mostly fading in and holding?
- Do transitions connect ideas rather than fade between completed layouts?
- Is the viewer's attention guided despite the density of micro-animation?
- Does the film build toward its payoff: does each scene introduce a new scale,
  camera position, geometry, or interaction rather than reusing the previous
  arrangement, and does the final sequence resolve the thread the opening set up?
- Would this feel at home in a produced YouTube explainer, rather than a slide
  presentation or an animated infographic export?

If the result fails, it is unfinished. Revise the visual construction and
choreography; do not add cosmetic motion to declare it complete. Technical checks
are required, but they are not evidence of cinematic or creative quality.

## Failure modes the pipeline must prevent

These rules apply to every film. Treat each one as a gate, not a suggestion.

**Continuity across cuts**
- Name the recurring subjects in `STORYBOARD.md`. A subject that leaves a scene must either exit with a stated reason or transform into another object.
- Every hard cut needs a written handoff: the object that carries over, or the reason no object does. Verify it on the contact sheet.

**Displayed values**
- Every number on screen must come from the narration, the source material, or a label that explains it. An unexplained figure is a defect.
- Unknown, pending, or unavailable values use a neutral placeholder, never zero. Counters start from that placeholder.
- Running totals and count-ups sit beside the thing they measure, not floating in empty space.

**Timing in scene code**
- Scene scripts reference cues only. Literal numeric times in timeline calls are not allowed; derive every time from a cue's `localAt` plus an offset or duration.
- Exits, fades, and removals are cues too. A removal starts only after the reveal it would cut off has finished (typed text completes, counters settle, draws end).
- Scan scene HTML for literal times before assembly and treat any hit as an error.

**Legibility**
- At 1920×1080, labels are at least 28 px and values at least 40 px. Secondary text stays at 0.8 opacity or higher unless it is purely decorative.
- Check the rendered frame at phone scale (for example 480 px wide). If a label cannot be read there, enlarge it or remove it.

**Collisions**
- No stroke, path, or moving graphic may cross text unless the crossing is the message. Check text bounding boxes against lines and shapes, and move one of them.

**Stillness**
- Within an active scene, no more than about 2.5 s may pass without a developing element. A longer hold needs a stated narrative reason in `beats.json` and should be used only before a payoff.
- A cursor, spinner, blinking indicator, or idle drift is not a developing element.

**Review evidence**
- Build a contact sheet of the final render at 1 fps or denser. Check it against the storyboard handoffs, displayed values, collisions, and stillness rules above.
- A checker warning may be dismissed only when `review/REPORT.md` records the evidence that it is a false positive and how that was verified.

**Sound**
- For a published render, consider a sound layer for mechanical actions such as typing, counting, assembly, and moving parts. It must never obscure the narration.

## Technical invariants and reproducibility

- Every video lives in a new isolated `jobs/<slug>/`. Never overwrite another
  job or source inputs. All jobs are ignored
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
