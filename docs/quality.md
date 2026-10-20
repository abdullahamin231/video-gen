# Quality standard (directors, builders and reviewers)

The operational runbook is [orchestrator.md](orchestrator.md). This file is the creative and review standard. The
briefs written by the pipeline summarise it for each role; directors and reviewers read it in full.

The user gives one request:

> Create a video given the audio `<audio path>` and script `<script path>`.

The result is a finished MP4 that looks like a produced YouTube explainer: a viewer who watches it on a phone with the
sound off can still follow what is happening, and a viewer with the sound on feels that every sentence is being shown
to them. The user never chooses colours, scenes, timings or styles; the agents do.

## The rules that cannot be broken

The pipeline enforces these. Everything else in this file is guidance that an agent may break on purpose when that
makes the film better (and says why in the shot's `notes`).

1. **The recording is fixed.** Timing comes from the spoken words. Never change, stretch or re-voice the narration.
2. **The film is true.** Show only numbers and claims that the narration or script supports. An explanatory value that
   is not spoken (an axis scale, an illustrative count) is allowed only when the object says why (`"numbers"`).
3. **The film renders the same way every time.** No randomness, clocks or timers; every motion is tied to a cue.
4. **The film has one design theme.** The script writer chooses it in the visual plan (`VISUALS.md`), the director
   declares it in `film.json` `theme`, and every scene is made in it. Which theme is a creative choice (the director's,
   for a film without a visual plan); that there is exactly one is not negotiable.

## Design: one theme per film, starting from the channel's

### The channel theme

When `video.config.json` names a `channelTheme` (by default [channel/theme.json](../channel/theme.json)), every film
starts from it: the job carries a copy at `inputs/channel-theme.json`, the script writer copies it into the visual
plan, and the director copies that into `film.json`. Viewers recognise the channel by its look, so keep it. Change a
token only when this film's material needs it (a colour meaning the film cannot do without, a font the topic calls
for), and say what and why in the theme's `"channelDepartures"`. plan-check warns about an unexplained departure.

With `"channelTheme": null`, each film chooses its own look freely, as described below.

### Choosing a theme (no channel theme, or a deliberate departure)

No look is mandatory and nothing is off the table: flat sticker graphics, paper cut-outs, blueprint line work,
chalkboard, neon on black, editorial print, isometric 3D, clay, pixel art, hand-drawn marker, a precise mathematical
style, or something new. Choose the theme that best fits the topic, the audience and the voice of the narrator, then
commit to it.

- Start from the narration. A wry, conversational tech video suits a bold graphic look with drawn products and real sources; a
  calm proof suits precise geometry; a history story might suit paper and print. Consider at least two genuinely
  different themes and record the one you rejected and why (`theme.rejected`).
- Decide the **imagery language** first: how real things appear (flat illustrations, line drawings, isometric
  drawings; always SVG, never photos) and how abstract ideas appear (charts, blocks, diagrams, metaphors). Then decide the surface treatment,
  type and motion so they belong with that imagery.
- Write the theme down in `film.json` `theme`: a `name`, a `description` that a builder who has never seen the film
  could follow (imagery, surfaces, line weight, shapes, type, colour use, motion personality, composition), and the
  tokens the kit applies automatically: `bg`, `colors` with `meanings`, `fonts`, `stroke`, `corner`, `fillOpacity`,
  `shadow`, `label`/`text`/`value` type settings, `eases`, and per-type `defaults`. See
  [SCENE_SPEC.md](SCENE_SPEC.md#the-design-theme) for every field.

### Keeping it consistent

A viewer who pauses on any frame should recognise the film. Across every scene keep the same:

- background, palette and the meaning of each accent colour (one meaning per colour for the whole film);
- line weight, corner radius, shadow and fill treatment;
- typefaces, weights and case for labels, values and titles;
- imagery language: every real thing is drawn in one hand (the same line weight, fill treatment and level of detail);
- motion personality: the same kind of entrance, emphasis and exit for the same kind of event;
- framing rules: margins, where labels sit, how big the main subject is.

Put shared choices in the theme tokens (`defaults`, `label`, `eases`) rather than repeating them in every shot, so
builders inherit them. A scene that departs from the theme needs a reason that serves the film, recorded in `notes`.

## What makes the picture work (any theme)

These are the qualities that separate a produced explainer from an animated slide deck. They hold for every theme.

### Show the real thing, drawn

- When the narration names something concrete (a product, a place, a company, a device, a person, a website), show
  it so the viewer recognises it in under a second without reading a label. Draw it as an SVG illustration in the
  theme's style: its true silhouette, proportions and the two or three details that identify it (the vents and
  ports of a Mac Studio, the gold fan shroud of a GPU, the logo on a box). Companies appear as their logo (an SVG
  mark). An anonymous rectangle with a label is a last resort. **This channel uses no photos.**
- Search the library first (`library-search`, then `library-use`): earlier films may already hold the drawing, logo
  or component you need. Save every drawing you make as an SVG file in `assets/` and show it with an `image` object;
  `save` it with a title and search tags so the next film finds it. Logos come in with
  `npm run video -- asset --src <svg url|file> --name <name>.svg` (the source is recorded in `assets/SOURCES.json`).
  Every asset stays inside the repository, never in `/tmp` or a scratch directory.
- Draw the right thing: the actual model, not a different one with the same name; if you cannot tell what it looks
  like, show its logo and name instead of inventing hardware.
- Abstract ideas become familiar, physical metaphors the viewer already understands: a shop shelf with price tags
  for "what it costs", a SOLD OUT stamp for scarcity, a strike-through for "you no longer pay this", a search bar
  being typed into for "you go and look it up", a stack of coins growing for "it adds up". Then let the metaphor act.

### Use the whole frame, with one hero per beat

A filled frame is not a crowded one. Produced explainers keep most of the frame dark and quiet; what makes them feel
full is that their few elements reach across the whole frame and that one of them clearly dominates
([the frame study](kaiexplains-frame-study.md) has the measurements).

- **Spread the composition.** Place the main subject on one side (left or right third), the hero number across from
  it, and the evidence card or supporting detail in a free corner. Content should span most of the frame, not
  cluster in the middle third. The build warns when a scene's content spans less than 40% of the frame.
- **One hero per beat.** Each beat has one element that is clearly the biggest and brightest thing on screen: a hero
  number or word (`hero`, 140–220 px, in the accent colour, a small uppercase unit under it), or the main subject at a
  quarter to half of the frame width. The build warns about a scene where nothing reaches 96 px text or a tenth of the
  frame.
- **Everything else is small and quiet.** Labels are short, uppercase, in the label style, at least 28 px; values at
  least 40 px; supporting elements are dimmer. The size contrast between the hero and the rest is what directs the eye.
- **Strong contrast** between subject and background; the most important element is the brightest or most saturated.
- **Text is a design element, not a sentence**: prices, names, short labels, search queries, one-word verdicts. The
  narration already says the sentences. A quoted source is the exception, and it goes on a card (below).
- **No empty boxes and no washed-out frames.** A rectangle on screen holds something (a value, a drawing, a quote); a
  placeholder box with nothing in it reads as broken. A frame where everything is half-faded looks like a mistake:
  bring the next subject in at full strength, or clear the stage. The build warns about both.
- Check every frame at phone size (480 px wide). If something essential cannot be read, make it bigger or remove it.

### Show the evidence

When the narration rests on something a source says (a post, an article, a paper, a README, a spec, a benchmark
table), put the source itself on screen: a `card` with the exact sentence retyped, the key phrase highlighted and a
chip naming where it is from (the subreddit, the site, the repo), or a `sheet` with the spec's rows. The viewer sees
that the claim is real. Quote exactly what the source says, keep it to one or two sentences, and give the number's
source in `"numbers"` when the narration does not say it.

### The explainer vocabulary

The kit has ready-made objects for the recurring moves of an explainer (see SCENE_SPEC.md "Composite objects"). Use
them before building something similar out of rectangles: `hero` (the big number), `card` (a source quote), `sheet`
(a spec list), `tag` (a hanging price or size tag), `verdict` (a rubber stamp), `gauge` (a container with a scale that
fills: memory, budget, capacity), `chip` (a small source or status label). They take the theme's colours and fonts,
so they belong to any film.

### Vertical films (reels and shorts)

A job made with `--format vertical` is 1080×1920 and watched full-screen on a phone. The brief states the frame.
- Phone apps cover the top (title bar), the bottom (caption and buttons) and the right edge (action rail). Keep text
  and the key subject inside the safe area the brief gives (about x 65–940, y 211–1536); backgrounds and motion may
  use the whole frame. The build warns about text that stays outside it.
- Stack, do not spread: comparisons go top and bottom, sequences flow downwards, one subject fills the width. The
  frame is narrow, so text lines are short; the size minimums above stay the same.
- The first second decides whether anyone keeps watching: something visible happens at once, with no slow build or
  title card.

### One stage per idea, built up in front of the viewer

- Give each idea a stage (a shelf, a desk, a map, a coordinate plane, a city block) and add to it as the narration
  progresses: the first product lands, then its price tag, then the second product, then the verdict. The viewer
  sees the comparison assemble.
- Keep the stage framed. Do not keep zooming out to fit more things; when the stage is full or the idea changes, clear
  it, transform it into the next stage, or cut cleanly to a new one. Recurring subjects carry across the cut. A stage
  can live for 20–40 s while it builds; pan the camera to what is new instead of cutting away.
- Keep one clear focal point: the hero of the beat. Dark, empty background between elements is fine; a small cluster
  in the middle of an empty frame is not.

### The film is dynamic: every spoken beat lands as a visible event

- Something meaningful happens on screen all the time. Each phrase that introduces something gets its own event,
  timed to the word: an object arrives, a tag drops, a stamp slams down, a line strikes through, a counter rolls, a
  bar grows, a product is swapped for another, the stage transforms into the next one.
- Holds are short. Let a payoff register for a moment (about 1–2 s), then the next beat moves the picture on. Over
  ~3 s with nothing new is a warning; a longer hold needs a reason. Idle wobble, blinking or drifting particles do not
  count as something happening.
- One clear event at a time, in quick succession. Several things may move together when they are one event (a shelf
  and its items arriving) or when a supporting reaction answers the main action (a price tag swings as the product
  lands).

### Motion with a personality

- Pick a motion character that suits the theme and use it everywhere: physical drops that land, pops that overshoot
  and settle, tags that swing on their string, stamps that slam, crisp slides, or smooth precise easing. Set it in
  `theme.eases` so every scene shares it.
- Use motion that means something: arrival (`drop`, `pop`, `create`), verdict (`stamp`, `strike`, `shake`),
  quantity (`count`, `grow`, `retarget`), change (`transform`, `move`, `arrange`), attention (`focus`, `indicate`).
- Nothing simply appears. Every object arrives with motion that suits the theme (it draws on, drops, pops, slides,
  types, grows or transforms out of something already on screen); an instant cut-in or a plain fade says nothing
  about what happened. Only a deliberate scene cut may show a new stage at once.
- Show construction. When the narration describes something being set up or built (a computer, a desk, a shelf, a
  rig, a network), it assembles part by part, in the order a viewer would build it, each part on its own cue, in the
  theme's motion language: line drawings draw themselves on, sticker parts drop and snap into place, paper parts slide
  in and stack. Do not start a scene with those parts already on screen (`"visible": true`); the opening frame holds
  only what is meant to be there at 0 s.

### Explain, do not decorate

- Each important idea has a visible cause and consequence: initial situation → what happens → the result → the
  payoff the narration is leading to. "You no longer pay $20 a month" is a subscription card being struck out, not a
  sentence on screen.
- Comparisons stand side by side under the same conditions (two products on the same shelf, two bars on the same
  axis) and the difference is visible at a glance; a scale difference is shown at true scale when it can be.
- Make the action specific to this narration. If the same animation would explain an unrelated topic by changing the
  labels, it is too generic.
- Do not explain later passages early, and do not invent technical claims to justify a picture.

### Continuity

- Name recurring subjects in `film.json` `subjects` and carry them between scenes (`carry`). A subject that leaves
  has a reason; a subject that returns looks the same.
- Every cut or transition has a handoff: an object that continues, transforms, or a deliberate clean break.

### Sound

The narration is the soundtrack's spine and always the loudest thing. Around it, a film gets one licensed music track
and one ready-made sound effect for every cut and big move (whoosh for movement, pop for things appearing, click for
clicks and stamps, typing for typing), from the library's `sfx-*` bundles. Big moves land on the music's beat. The
music ducks under speech; effects sit above the music and at least 6 dB under the voice. The mix aims at about
-16 LUFS with peaks at or under -4 dBFS, measured on the exported MP4. Agents cannot hear: every choice rests on a
measurement, and nobody claims the film "sounds good". The full process, fields and commands are in
[sound.md](sound.md).

## Working method

### Script writer (the visual plan)

The script writer makes the film's creative decisions in `VISUALS.md` (see the script-writing skill's
`references/visuals.md`): it invents at least two whole-film concepts and picks the strongest, chooses the design
theme, splits the script into scenes by idea, picks the prototype, and writes each scene's stage, events at exact
words, payoff, assets and handoff concretely enough to build without guessing.

### Director

With a visual plan, the director carries it out rather than replacing it:

1. Read the visual plan, the script and the word table.
2. Transcribe the plan into `film.json`: its concept, alternatives, theme, subjects, prototype and scenes, keeping the
   plan's scene ids and wording. Record any change the recording or toolset forces in `"departures"`.
3. Collect the assets the plan names (product images, logos, fonts) into `assets/`, and the music it describes.
4. Build the prototype and the scenes before it, look at the frames, and fix what looks weak before review.

Without a visual plan (jobs planned before visual plans existed), the director makes those creative decisions itself:
choose the theme, invent at least two whole-film concepts and pick the strongest, split the recording into scenes and
write each scene's idea, mechanism, visible states, payoff and handoff so a builder can make it.

### Builders

Builders build their scene from the visual plan's section for it (quoted in their brief), inside the theme. They
choose the implementation (exact layout, sizes, tools, timing offsets) and depart from the plan only where it cannot
be built as written or does not work. They keep the narrated idea, the spoken timing, the theme, and the subjects the
next scene needs. Departures from the plan are recorded in `notes`. Without a visual plan, builders have full creative
authority over their scene inside the theme.

### Prototype gate

The prototype and its context are rendered and reviewed by three independent reviewers before later scenes are
built. If the prototype looks like slides, clip art or a diagram with labels, the concept is redesigned, not
decorated. A prototype pass does not approve the rest of the film.

## Review checklist

Reviewers judge the rendered film, not the plan. Each item is a question about what is on screen.

- **Theme:** Does every scene look like the same film? Palette, line weight, type, imagery language and motion
  personality consistent? (A scene that breaks the theme without a reason is blocking.)
- **Recognition:** Can each concrete subject be recognised within a second, without reading its label?
- **Dynamic:** Does each spoken idea land as a visible event at its words, with the picture moving on in quick
  succession? Does anything just appear without motion, sit idle while the narration moves on, or show up before it
  is said?
- **Explanation:** With the sound off, does the action show what happens and why (cause → consequence → payoff)?
- **Readability:** Is every essential label and number readable at 480 px wide? No text collisions, nothing cut off?
- **Frame:** Does the composition use the whole frame, with one hero per beat that clearly dominates? Any empty
  placeholder boxes or washed-out, half-faded frames?
- **Evidence:** Where the narration rests on a source, is the source shown (a card or sheet with its exact words)?
- **Focus:** Is there one clear focal point at each moment, with the most important thing the most prominent?
- **Stage:** Are layouts calm and framed, or crowded and shrinking? Are transitions clean and handoffs clear?
- **Truth:** Is every number and claim supported by the narration or script?
- **Finish:** Does it look like a produced YouTube explainer, not a slide deck or infographic export?
- **Sound:** Does each sound effect belong to something visible at that moment (`review/sounds.md`, the cue sheets
  in the pack)? Does every cut and big move have one, and do cuts sit on the beat? Do the measurements in
  `review/mix.json` show the voice clear of effects and music, effects above the music, and the loudness and peak
  targets met on the MP4? Effects or music louder than the voice while it speaks (`voiceMasked` in mix.json) is blocking until
  the mix is repaired. A sound within 3 dB under the voice (`voiceClose`) is normal for a short whoosh or hit and is
  advisory at most; the five headphone checks go to the person with the delivery.
- **Vertical (1080×1920 jobs):** Is essential text and the key subject clear of app chrome (inside the safe area)?
  Is the layout stacked for a tall frame rather than a landscape layout squeezed in? Does something happen in the
  first second?

Blocking findings are those that hurt understanding, truth or the film's one theme. Taste-level improvements are
advisory. See [independent-review.md](independent-review.md) for roles, evidence and the report format.

## Technical behaviour

- Each video lives in its own `jobs/<slug>/` (ignored by Git). Never overwrite another job or the source inputs.
- Cues are spoken phrases resolved against measured word timings; literal times are rejected in specs, hooks and
  components. ASR timings are evidence, not forced alignment.
- One seek-safe world: every tween is created from tracked state; hooks and components follow the same rules.
- `build` checks each scene in a real browser (legibility, collisions, frame use, stillness, theme consistency,
  overlapping tweens, seek safety) and prints a motion transcript. `render` adds pixel checks of the encoded MP4.
  Checks prove the absence of known defects; they do not prove quality. Independent review remains mandatory.
- Assets are local files under `assets/` with recorded sources; music and sound files also record their licence.
- The soundtrack is mixed by the pipeline (narration untouched, one master gain) and the delivered MP4's audio is
  verified against that mix; loudness and peaks are measured on the MP4 (see [sound.md](sound.md)).
