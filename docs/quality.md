# Quality contract (director and reviewer reference)

> Everything in this file except truthfulness (no unsupported numbers or claims), the fixed narration, and
> deterministic rendering is house style: strong defaults that a director or builder may break when breaking them
> explains the idea better. Reviewers block on what hurts understanding or truth, not on departures from this file.

> The operational runbook is the root AGENTS.md. This file is the full creative and review standard; the briefs written by the pipeline summarise it for each role. Where this file names old mechanics (beats.json, STORYBOARD.md written by hand, fork_turns), the pipeline now handles them: film.json and shots/*.json replace beats.json, STORYBOARD.md is generated from film.json, and sub-agents are spawned however the host harness spawns them.

The user gives a request in natural language:

> Create a video given the audio `<audio path>` and script `<script path>`.

Complete all production tasks. Understand the narration. Select the visual
concept. Find or make assets. Design shots. Make the animation. Synchronize
it with the audio. Review and correct the video. Deliver the completed MP4.

Do not require the user to specify jobs, JSON, commands, colors, storyboards,
effects, scene counts, or timestamps. These are internal production records.
A plan or an executable project does not complete the request.

You have full authority to make creative decisions. Make an engaging YouTube
video with animation throughout its duration. Use the pipeline to repeat
technical operations and record decisions. Do not use the pipeline to make
all videos look the same.

## Technical terms

Use these terms consistently in production records:

- **Subject:** The object, system, or relationship that the animation explains.
- **Mechanism:** The parts and actions that show how a result occurs.
- **Choreography:** The planned sequence of actions and interactions.
- **Cue:** A timing reference that the pipeline resolves from recorded speech.
- **Beat:** A planned visual action related to a narrated idea.
- **Payoff:** The visible result that completes a visual explanation.
- **Handoff:** The object or relationship that connects one shot to the next shot.
- **Transformation:** A change in a subject's shape, arrangement, size, or function.
- **Tween:** An animation that calculates intermediate property values.
- **Seek-safe:** Able to show the correct state at any selected timeline time.
- **Deterministic:** Able to give the same result from the same inputs.
- **Contact sheet:** A set of sampled video frames for visual inspection.
- **House style:** The default visual style specified in this file.

Keep file paths, command names, API identifiers, and product names unchanged.

## Required video quality

**Make a film that explains through motion.**

Correct timing, clear layouts, and successful audits do not prove creative
quality. Static diagrams with large headings remain a presentation, even if
their entrances have animation.

Outline assembly, particle travel, rotation, scrolling, and camera zooms can
support an explanation. Do not make these actions the main explanation
throughout the film. Make subjects interact. Develop mechanisms. Show the
meaning of the narration through visible action.

Show objects that operate and mechanisms that change. Show causes and their
effects. Develop environments. Make comparisons change visibly. Show the
consequences. An object beside a sentence is insufficient. Make a machine
operate. Make a flow travel. Develop a comparison. Complete the action of a
visual metaphor.

Apply these requirements throughout the film:

- Build shots from many short actions that operate together. Typical action
  durations are 0.2–2 s. Select actions that explain the idea. Examples include
  assembly, travel, drawing, deformation, rotation, morphing, reveal, simulation,
  parallax, reframing, and transitions. Do not repeatedly use generic entrance
  presets.
- Combine primary action, supporting action, and camera or scene motion. Give
  the viewer one clear focus. Do not move all elements independently.
- Keep meaningful objects and relationships across shots. Transform them or
  transfer them through a handoff. Develop one visual world across a 30 s
  sequence. Do not repeatedly replace a static illustration beside a text panel.
- Use the motion density that the explanation needs. A 30 s excerpt can need
  dozens of developments and hundreds of coordinated element animations.
  One spoken cue can start several interacting actions. Fifteen cues do not
  require only fifteen tweens. Do not add decoration to increase the tween count.
- Change scale and perspective when these changes help the explanation.
  Show details, mechanisms, environments, and results. Give camera moves and
  handoffs a narrative purpose. Continue the development in the second half.
- Use typography to support the action. Headings, prices, numbers, and key
  phrases can emphasize a beat. Do not repeatedly put a large sentence above
  an illustration. The narration already supplies the sentences.
- Use brief pauses to make results clear. Long static holds do not correct
  an inactive subject. Static text cards, idle camera motion, blinking LEDs,
  and floating particles do not correct this problem.

There is no mandatory shot count or animation count. Select the medium that
best explains the story. You can use 2D, 3D, recorded media, generated images,
detailed illustrations, simulation, animated typography, or combinations.
Find or make the necessary assets. Do not reduce the explanation to text and
simple rectangles because they are easier to make.

## Explain each idea through a mechanism

**Make complexity come from interactions and changes in meaning.**

For each important narrated idea, design a mechanism with four stages:

1. Establish the initial condition.
2. Show the operation.
3. Show the consequence.
4. Show the payoff.

Make the cause of the result visible. A drawing, a few travelling particles,
and a camera move do not complete an explanation.

### Make the action specific

Identify the exact action, relationship, conflict, or surprise in the narration.
Design an action specific to that idea. Do not use one generic marker, network,
or conveyor for all ideas. The animation must need more than different labels
to explain an unrelated topic.

### Show internal operation

Give subject parts different functions, limits, and reactions. Show loading,
processing, accumulation, contention, rejection, redistribution, or failure
when the narration requires these operations. Make inputs change the mechanism.
Make the operation visibly change the output. Parts that assemble into an
outline only introduce the subject. Continue with its operation.

### Connect causes and effects

Make one action cause the next action. For example, an arriving load fills
memory. A restricted route develops a queue. Another route opens. The output
changes. Coordinate these reactions in space and time. Independent loops do
not show a causal mechanism.

### Transform the subject

Keep meaningful parts visible as the subject changes shape, arrangement, size,
or function. Make intermediate states clear and useful. A crossfade between
drawings does not show a detailed transformation. Neither does a group that
shrinks while another group fades in.

### Make comparisons operate

Show alternatives under the same visible conditions. Let their operation show
the difference. Use quantities from the source. Clearly identify illustrations
that show qualitative differences. Two labels and a counter do not complete
a comparison.

### Give camera moves a purpose

Use camera moves to show new information. Expose hidden layers. Follow an event
that causes a change. Show a limit. Connect different scales. A zoom into an
unchanged diagram does not explain more.

### Make surprises explain the narration

Establish an expectation before the narration changes direction. Then show
a clear visual change. A familiar object can open to expose an unexpected
mechanism. A system that seems successful can reach a limit. A large structure
can change to show a small requirement.

### Select suitable techniques

Use techniques that improve the explanation. You can use custom SVG geometry,
articulated illustrations, deterministic simulation, perspective, or 3D
construction. You can also use masks, shape interpolation, recorded media,
or generated assets. Do not select only the CSS or GSAP primitives that are fastest to use.
Keep complex actions clear and purposeful.

For a GPU explanation, a cutaway can show data loading and processing.
Repeated weight retrieval can visibly limit token generation. Added hardware
can change congestion between routes. For a cost explanation, the cost can
change access, scale, or setup feasibility. A price beside a machine is
insufficient when the narration explains these consequences.

These examples show causal design. They are not mandatory layouts. Show only
mechanisms supported by the current narrated passage. Do not explain later
passages early. Do not invent technical claims to justify an animation.

### Record the choreography contract

For each major passage, record these items in `STORYBOARD.md`:

- The narrated idea.
- The selected mechanism.
- The sequence of visible states.
- The interactions that connect the states.
- The purpose of each camera move.
- The payoff.
- The explanation that a basic drawing, reveal, or flow would not show.
- The different approaches considered and the reason for the selection.

Compare approaches with different mechanisms. Changes of color, position, or
entrance direction are insufficient creative alternatives.

Give workers this narrative and quality contract. Give them creative freedom.
Do not prescribe one repeated visual or effect template. Review their animation
against the mechanism and payoff. Element counts and tween counts do not prove
that the explanation works.

## Invent, structure, and build

You are responsible for the film's creative quality and viewing experience.
Successful checks alone do not complete this responsibility. Work in three
passes: invent, structure, and build.

### Invent

- Develop several different visual approaches for the full film and each scene.
  Write down the alternatives. Compare them with the narration. Select the
  most inventive approach that the house style can support. Record the reason.
- Design the visible operation of the idea. Show system parts that interact.
  Show a comparison gap that increases. Give a process an input, an operation,
  and an output. Show a choice that closes an available route.
- Select a continuous visual connection across scenes. Use a recurring object,
  coordinate frame, or visual metaphor. Record the connection in the storyboard.
  Develop it throughout the film.

### Structure

- **Keep active passages developing.** Coordinate parts around the narrated
  operation, comparison or consequence. Continue subject development after
  assembly. A camera pan over static objects is not development; one meaningful
  transformation can be sufficient without an arbitrary quota of moving parts.
- **Prepare the next beat.** Establish the next element before its spoken cue.
  Use the cue to start the result of this preparation.
- **Use supporting action to explain.** Assemble and connect parts. Draw traces
  between nodes. Move flows or packets. Write annotations. Change scale or
  perspective. Use parallax to show depth. Open subsystems. Make indicators
  react to events. Transform objects between scenes. Remove any supporting
  action that explains nothing.
- **Keep one primary focus.** Make other elements smaller or less opaque.
  Transfer attention deliberately. Use a brief pause after a payoff, rather
  than before it.
- **Change the visual approach.** Give each scene a new scale, camera position,
  geometry, or interaction. Do not repeat the previous arrangement with
  different content.

### Build

- **Use different visual constructions.** Do not build all subjects from rounded
  rectangles, icon cards, bar charts, and labels. Select line drawings, cutaways,
  perspective objects, 3D objects, data traces, simulations, and typography
  according to the idea. Search the HyperFrames registry and motion helpers.
  If suitable items are unavailable, make custom geometry.
- **Prefer transformations.** Transform an object into another object. Make
  a quantity become a shape. Open a diagram into a larger diagram. Prefer
  these actions to separate panels that appear in sequence.
- **Coordinate action timing.** Start overlapping actions at different times
  to make one coordinated sequence. Supporting actions can prepare for the
  primary action or finish after it.
- **Keep the house style consistent.** Keep the palette, stroke rules, and
  easing consistent. These limits must not reduce purposeful activity.

### Review

- **Watch without sound.** Make sure that the action explains each idea.
- **Watch at normal speed.** Correct passages that feel slow or empty.
  Do not wait for a checker error.
- **Check activity.** In each active passage, the subject must visibly develop.
  Element counts are diagnostics, not pass criteria: one meaningful transformation
  can explain more than several decorative loops. Camera movement does not count
  as subject development. Correct missing narrative behavior; never add filler
  to satisfy an element count.
- **Check the mechanism.** Describe each change and its cause without animation
  terminology. If the description contains only drawing, packet travel, and
  camera zooms, redesign the passage. Require a visible interaction, consequence,
  and payoff that agree with the narration.
- **Check topic specificity.** Try to replace the labels with an unrelated
  topic. If the animation still works unchanged, replace its main mechanism.
  Supporting primitives can repeat. Main explanations must not repeat.
- **Check attention.** Identify the intended focus for each beat. Make sure
  that the brightest, fastest, or largest element supports that focus.
  Correct any competing visual priority.

## House visual style

Unless the user requests another style, use the precise mathematical
explanation style of 3Blue1Brown and Manim. Make a calm, technical, professional
YouTube film. Avoid the appearance of children's animation or a corporate
infographic.

### Color and surface treatment

Use a near-black or charcoal blue-grey background. Use off-white for primary
content. Use no more than two or three accent colors. Keep accent colors muted.
Use saturated color sparingly. Give each accent color one meaning throughout
the film.

Do not use object gradients, glossy highlights, drop shadows, sticker outlines,
inflated rounded shapes, emoji, or cartoon mascots. These limits apply to
surface treatment. They do not limit subject count or motion density.

### Vector geometry

Prefer clear strokes approximately 2–4 px wide at 1080p. Use low opacity for
filled areas. Use precise geometry: axes, grids, arrows, nodes, vectors, traces,
cross-sections, and diagrams that draw during the explanation. Use flat fills
when they improve clarity.

Keep cutaways, articulated mechanisms, layered geometry, and simulations clean
and precise. Simple surface treatment must not make the explanation simple.

### Typography

Use a clear sans-serif typeface for labels. Use a suitable serif or LaTeX-style
typeface for equations and symbols. Put labels beside their subjects. Fade
labels in with their subjects. Keep labels small relative to the primary
subject, but obey the minimum sizes below. Avoid large paragraph headings.

### Motion

Prefer paths and outlines that draw progressively. Transform shapes and
equation terms. Move the camera across a coordinate space or into a detail.
Reduce the visual priority of the previous focus when the next focus appears.
Give each motion an explanatory purpose.

Use smooth decelerating or symmetric easing curves. Use power or sine in/out
curves. Typical primary moves take 0.4–1.2 s. Do not use bounce, elastic easing,
or overshoot. Overlap moves to produce one coordinated sequence. Briefly hold
each payoff so the viewer can understand it.

### Composition and continuity

Use a consistent grid and margins. Keep one clear focus at each moment.
Make supporting elements smaller or less opaque. Leave generous empty space.
Use slow, deliberate camera moves that serve the narration. These can include
pans, zooms, reframing, or dolly moves to a different scale.

Keep meaningful objects, axes, and coordinate frames across shots. Make the
viewer follow one developing world.

You can select another realistic or illustrative style when it explains the
story better. The selected style must meet the precision, restraint, and
motion requirements above.

For precise vector passages, you can use ManimCE or ManimGL. Use
`manim-composer` and `manim-video`. Also use `manimce-best-practices` or
`manimgl-best-practices`, as applicable. Render the passages to video. Assemble
them with the HyperFrames pipeline. Keep the pipeline and job rules unchanged.

## Use production skills

Before video production, read `.agents/skills/hyperframes/SKILL.md`. Read the
applicable workflow and domain skills before their related tasks:

- Use `faceless-explainer` for topic explanations.
- Use `general-video` for longer or custom films. Use the HyperFrames router
  for other deliverables.
- Read `hyperframes-core` before composition HTML, timing, or assembly.
- Use `hyperframes-animation` for choreography, atomic rules, scene blueprints,
  and runtime adapters. Read the selected recipes, not only the skill index.
- Use `hyperframes-creative` for visual direction and video composition.
- Use `hyperframes-keyframes` for camera motion, morphs, and reframing.
- Read `hyperframes-registry` before you make named effects or visuals manually.
  Search by intent. Inspect matches. Use items that help the film.
- Use `media-use` for transcription and media operations. Use `imagegen` when
  original bitmap assets improve the result. Save fixed local asset copies.
  Record their sources.
- Use `hyperframes-cli` for development, validation, snapshots, preview, and
  rendering.

Skills support production. They do not override the user's creative authority.
They must not require an interview, a preset, repeated layouts, or an additional
approval step. Make internal visual sketches and stage assets when useful even
if an installed skill skips these in autonomous mode. If the user supplies audio,
do not use TTS. Preserve the full recording unless an excerpt is requested. A
request for a completed video authorizes local generation, asset preparation,
revision, rendering, and the independent review loop below.

## Produce the video from the two inputs

Read `docs/agent-workflow.md` for the technical contract. Complete the stages
below without requiring the user to control production.

### 1. Inspect the inputs

Read the full script. Measure the recording duration. Identify the language.
Understand the argument and the possible visual explanations. Preserve the
supplied recording.

Unless the user requests an excerpt, use the full audio. For a requested 30 s
sample, use the first 30 s unless the user specifies another interval.
Select a suitable title and job slug. Unless the user specifies a destination,
use YouTube landscape format at 1920×1080 and 30 fps. Ask only for an input
that is missing.

### 2. Prepare and align

Run `npm run video -- prepare` with the actual input paths. Measure word timings.
Compare the measured words with the script.

Automatic speech recognition (ASR) supplies evidence, but can contain errors.
Inspect names, numbers, repeated words, and omitted words. Correct the text
when the recording or script supports a correction. Keep the measured intervals.
Record corrections. Use word IDs when phrase matches are uncertain.

Do not calculate speech timings from word counts. Do not stretch the narration
to fit the animation.

### 3. Direct the film

Use the invent, structure, and build method above. Develop several concepts.
Select the most inventive concept that the house style can support. Establish
a continuous visual connection across scenes.

Record developing actions and shot handoffs in `STORYBOARD.md`. Record colors,
typefaces, strokes, easing, and camera rules in `frame.md`. Record spoken timing
references in `beats.json`. For each beat, identify the visible action and its
following consequences. Do not substitute text summaries with entrance effects.
Keep planning internal unless the user requests it.

### 4. Build the animation

Use generated `assets/cues.js` as the timing authority. Start major actions at
their related spoken cues. Supporting actions can anticipate, overlap, and
finish after those cues. Use cues to time choreography, rather than only
completed diagram entrances.

Build deterministic, seek-safe timelines. Build complete subjects. Divide shots
when necessary. One sub-composition does not require one camera framing.

### 5. Test a representative passage

Before you extend the film, build and inspect approximately 10–15 s of animation.
Select a demanding passage that represents the story. Do not select an easy
opening assembly only because it can pass quickly.

Include a transformation that starts from a cue. Include a camera move with
an explanatory purpose. Make subject parts interact and produce a visible
consequence and payoff. Continue subject development. Include a clear transition
or handoff.

Use clean strokes, restrained colors, and smooth easing. Do not use cartoon
treatment. If the passage looks like slides or clip art, redesign it immediately.
If outline assembly, packet travel, fades, and zooms form the main explanation,
redesign the mechanism. Build a richer mechanism before you extend the film.
Render the passage and create a frozen prototype evidence pack with
`review-pack --stage prototype --start <seconds> --end <seconds>`. Obtain
independent reviews from all three roles in [docs/independent-review.md](docs/independent-review.md)
before extending the film. This is an agent-enforced production gate, not user
approval. Revise failures, render again, regenerate the pack, and obtain fresh
reviews. A prototype pass does not qualify the full film for delivery.

### 6. Review and correct the full film

Run technical audits. Inspect the moving preview or draft. Inspect closely
spaced frame samples throughout active passages. Check narration alignment.
Check the action between cues. Correct dull or static sections. Do not record
them as acceptable substitutes for a completed explanation.

Create a final evidence pack from the exact rendered MP4. Spawn independent
reviewers for visual mechanism, narration fidelity, and continuity/legibility.
Follow [docs/independent-review.md](docs/independent-review.md): reviewers inspect
media before production claims, return timestamped findings in separate files,
and never modify the producer's composition. For longer videos, review every
scene in manageable chunks; contact sheets supplement moving review. Repair
failures autonomously, then re-render and repeat with a new pack and fresh
reviews. Technical validation and creative review are separate requirements.

### 7. Deliver

Rendering creates a draft. Submit the independent reports with `review-submit`,
check `review-status --stage final`, and run `deliver` only when all three roles
pass against current evidence and technical checks pass. Open a working Studio
preview. Return the qualified MP4 link and preview URL with a short factual
verification note and any actual limitation. Keep production details secondary
to the deliverable. Never describe an unqualified draft as completed.

## Check quality before delivery

Evaluate every item below. Successful lint checks alone are insufficient.

- Verify that action explains the idea without sound or prose.
- Verify that subjects continue to change during explanations and develop toward
  the payoff.
- Verify that animation and camera motion agree with the narration.
- Verify that each treatment explains more than a heading, icon, and price panel.
- Verify that each major passage has an inventive mechanism specific to its
  narration. Require interacting parts, a visible consequence, and a payoff.
- Verify that the explanation exceeds diagram drawing, generic particle travel,
  rotation, scrolling, and changes of camera scale.
- Verify that intermediate transformation states have meaning. Make comparisons
  show differences through operation, rather than labels alone.
- Verify professional appearance. Check precise vector geometry, restrained
  colors, deliberate easing, and readable labels. Reject cartoon treatment,
  clip art, and generic motion templates.
- Verify continued motion throughout the film, including the second half.
  Subjects must develop through transformations, drawing, morphs, or scale
  changes. Fades followed by holds are insufficient.
- Verify that transitions connect ideas. Fades between completed layouts are
  insufficient.
- Verify that dense action still directs attention clearly.
- Verify that each scene introduces a new scale, camera position, geometry,
  or interaction. Verify that the final sequence completes the opening's
  continuous visual connection.
- Verify that the result meets the standard of a produced YouTube explainer.
  A slide presentation or animated infographic export is insufficient.

If the film fails a requirement, it is incomplete. Correct the visual
construction and choreography. Do not add decorative motion to claim completion.
Technical checks are mandatory. They do not prove creative quality.

## Prevent production defects

Apply every rule in this section to every film.

### Continuity across cuts

Name recurring subjects in `STORYBOARD.md`. If a subject leaves a scene,
record the reason for its exit or transform it into another object.

Record a handoff for each hard cut. Identify the object that continues across
the cut. If no object continues, record the reason. Verify handoffs on the
contact sheet.

### Displayed values

Use only numbers from the narration, source material, or an explanatory label.
An unexplained number is a defect.

For unknown, pending, or unavailable values, use a neutral placeholder.
Do not use zero. Start counters from the placeholder. Put running totals and
increasing counters beside the subjects that they measure.

### Timing in scene code

Reference cues in scene scripts. Do not use literal numeric times in timeline
calls. Derive each time from a cue's `localAt` plus an offset or duration.

Use cues for exits, fades, and removals. Start a removal only after the related
reveal finishes. Let typed text finish, counters settle, and drawings complete.
Before assembly, scan scene HTML for literal timeline times. Treat each match
as an error.

### Legibility

At 1920×1080, use labels of at least 28 px. Use values of at least 40 px.
Keep secondary text at an opacity of at least 0.8, unless the text is purely
decorative.

Inspect rendered frames at phone scale, for example 480 px wide. If a label
is unreadable, increase its size or remove it.

### Collisions

Do not let a stroke, path, or moving graphic cross text unless the crossing
explains the idea. Check text bounding boxes against lines and shapes.
Change the position of an element if necessary.

### Stillness

Within an active scene, do not allow more than approximately 2.5 s without
a developing element. Record a narrative reason in `beats.json` for a longer
hold. Use such holds only before a payoff.

A cursor, spinner, blinking indicator, or idle drift does not qualify as
a developing element.

### Review evidence

Make a contact sheet from the final render at 1 fps or more frequent sampling.
Check storyboard handoffs, displayed values, collisions, and stillness against
the rules above.

Dismiss a checker warning only if `review/REPORT.md` contains evidence of
a false positive. Record how you verified that evidence.

### Sound

For a published render, consider sound effects for typing, counting, assembly,
and moving parts. Sound effects must not obscure the narration.

## Keep technical behavior reproducible

- Make a new isolated `jobs/<slug>/` for each video. Do not overwrite another
  job or source input. Keep all jobs ignored by Git. Keep the reusable pipeline
  and instructions in the repository.
- Record inputs, measured alignment, creative decisions, fixed local assets,
  and resolved cues. Reproducibility applies to technical execution. It does
  not require identical creative results.
- Use the original supplied clip as root audio. Use one paused, seekable
  timeline per sub-composition. Put styles and scripts inside sub-composition
  templates. For 3D or another animation runtime, follow the selected runtime
  adapter.
- Resolve narrative cues mechanically with `compile`. Assemble through the
  pipeline. Use cue-derived relative offsets for complex internal choreography.
- Run `audit`, HyperFrames `check`, and motion assertions. Enable the checks.
  Inspect multiple samples within each shot, rather than only scene midpoints.
  Verify final duration, dimensions, frame rate, and audible narration.
- Use real visible subjects as motion evidence. Invisible proxy nodes, small
  cue markers, and metadata changes do not prove canvas or 3D animation.
  For canvas or WebGL, inspect rendered frame and pixel changes. Inspect actual
  poses at their cues. Do not use hidden DOM changes to pass creative checks.
- Treat pacing heuristics as advice. They do not require one style or permit
  an inactive film. Give deliberate holds a narrative purpose. Inspect them
  visually.
- Save evidence and limitations in `review/REPORT.md`. Do not claim that still
  frames prove motion quality. Do not describe ASR estimates as forced alignment.

## Delegation and commands

Independent analysis by sub-agents is authorized for this workflow. Spawn each
reviewer with `fork_turns: "none"` and the role-specific brief in
[docs/independent-review.md](docs/independent-review.md). Reviewers must not assess
work they produced. Keep their first visual inspection blind to the storyboard
and producer's self-assessment. Give them frozen evidence paths, duration, scope,
quality requirements, and separate output files. Record actual agent identities;
preparation defaults `job.review.producerAgentIds` to `["/root"]`, which the
producer must correct when necessary. Never manufacture independent reports.
The validator checks evidence and report mechanics; it cannot assess taste or
authenticate that a sub-agent executed. The producing agent remains responsible
for genuine independent execution and repairs. Delegate production work only
when separately authorized or required by an applicable workflow; give workers
creative freedom and separate files to prevent conflicting writes.

Use `npm run video -- help` to list pipeline commands. Use `npm test` to check
timing and assembly. The `dev`, `check`, and `render` commands accept
`--job jobs/<slug>` or use the latest prepared job. Operate these tools yourself.
Do not require the user to learn the commands.
