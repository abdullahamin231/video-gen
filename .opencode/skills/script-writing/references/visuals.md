# The visual plan (`VISUALS.md`)

You are the only strong model in the production. Everyone after you (the director who writes `film.json`, the scene
builders, the reviewers, the thumbnail maker) runs on a weaker model that executes instructions well but invents
poorly. Whatever you leave vague, they fill with the generic: labelled boxes, centred text, fades. So the visual plan
carries the film's creative thinking in full, and says it concretely enough to be built without guessing.

Write `VISUALS.md` next to `SCRIPT.md` after the script is final (its scene starts quote the script, so the words must
not move afterwards). Never put visual notes into `SCRIPT.md`; it stays plain narration.

Before writing, read the repository's `docs/quality.md` (the standard the film is judged against) and the sections
"The design theme", "Objects", "Composite objects" and "Actions" of `docs/SCENE_SPEC.md` (what the scene language
can do). Plan with that toolset: the explainer vocabulary first (`hero` numbers, source `card`s, spec `sheet`s,
hanging `tag`s, `verdict` stamps, `gauge`s that fill, `chip`s), then shapes, paths, text, counters, SVG drawings and
logos, TeX, axes and bars, networks, deterministic particles, a free camera, verbs such as drop, pop, stamp, swing,
strike, type, shake, draw, move, transform, count, grow, fill, focus; plus custom components and ManimCE for anything
the built-ins cannot do. No photos: real things are drawn as SVG.

## The channel theme

If `video.config.json` names a `channelTheme` (by default `channel/theme.json`; in a job, `inputs/channel-theme.json`),
the film is made in it: copy that JSON into the plan's `## Theme` block and describe the film inside it. Change a
token only when this film's material truly needs it, and say what and why in `"channelDepartures"` inside the JSON.
Viewers recognise the channel by its look; a new look for every film throws that away. With `"channelTheme": null`,
design the theme for this film.

## How every frame is composed

- **Use the whole frame.** Plan each scene's layout in frame terms: the main subject on one side (left or right
  third), the hero across from it, the evidence card or supporting detail in a free corner. Never one small cluster in
  the middle of an empty frame.
- **One hero per beat.** Name the one element that dominates each beat: a big number or word (`hero`, 140–220 px, in
  the accent colour, with a small unit), or the main subject at a quarter to half of the frame width. Everything else
  is small and quiet.
- **Show the evidence.** Where the narration rests on what a source says, plan a `card` with the source's exact words
  (one or two sentences, copied from `research.md`), the phrase to highlight, the title line (e.g. "r/LocalLLaMA ·
  u/name") and the source chip; or a `sheet` with the spec's rows. Give the URL beside it in the plan.
- **One stage per idea that builds.** A stage can live 20–40 s: it appears, fills, gets tagged and stamped while the
  camera pans to what is new. Plan what is added at each beat rather than a new picture each time.

## How to make it buildable

- **Name the thing on screen**, not the effect you want. Not "a striking visual of cost" but "a yellow price tag
  reading $3,999 swings down onto the DGX Spark box and settles with a small overshoot".
- **Tie every event to the words that trigger it.** Quote the exact words from `SCRIPT.md` (`"four thousand dollars"`)
  for each event. One clear event per spoken beat, in order.
- **Give positions and sizes in frame terms**: left third, centre, top-right corner; "about half the frame width",
  "price numerals around 120 px". Builders follow numbers better than adjectives.
- **Say what leaves.** At each new stage, say what is cleared, dimmed, transformed or carried.
- **Name real things exactly** and describe how to draw them: the product, its silhouette, proportions, colours and
  the two or three details that identify it (`"draw: NVIDIA DGX Spark, a small gold-champagne box about 3:1 wide,
  perforated metal front, a black NVIDIA badge at the lower left"`). Companies appear as their logo
  (`"logo: NVIDIA, SVG"`). No photos.
- **Use only supported numbers and claims.** Every number shown must be spoken or in `research.md`; note the source
  next to any shown figure that is not spoken.
- **Decide, don't offer menus.** Record alternatives you rejected in their own section; the plan itself states one choice.

## Required structure

Use exactly these headings; the pipeline reads the scene sections by id and hands each one to its builder verbatim.

````markdown
# Visual plan: <film title>

## Concept
<The continuous visual world and through-line of the whole film, 2–4 sentences.>

## Alternatives considered
- <a different whole-film concept> — rejected because <why it explains less>
- <another> — rejected because <why>

## Theme
<Several sentences a builder could follow without seeing anything: how real things and abstract ideas are pictured,
surfaces, line weight, shapes, typography, what each colour means, motion personality, composition.>

```json
{ "name": "...", "description": "<same as the prose above, condensed>", "rejected": "<another theme and why it lost>",
  "bg": "#...", "colors": {"white": "#...", "grey": "#...", "dim": "#...", "faint": "#...", "blue": "#...",
  "yellow": "#...", "red": "#...", "green": "#..."}, "meanings": {"yellow": "..."},
  "fonts": {"sans": "<bundled family>", "mono": "<bundled family>", "display": "<bundled family>"},
  "stroke": 6, "corner": 12, "fillOpacity": 1, "shadow": {...}, "label": {...}, "value": {...},
  "eases": {"out": "..."}, "defaults": {...} }
```

## Music
<Mood and tempo to search for (Mixkit free licence), and where it should sit; or "none" with the reason.>

## Recurring subjects
- `<kebab-id>` — <what it is, what it looks like, where it first appears>

## Prototype
`<scene-id>` — <why this 10–15 s passage is the hardest and most representative>

## Scenes

### <scene-id>
- Starts at: "<the first words of this scene, copied exactly from SCRIPT.md>"   (first scene: "start")
- Idea: <what the narration says here, one sentence>
- Stage: <what is on screen when the scene opens, where, how large; what is carried in>
- Events:
  1. "<exact words>" → <object> <verb> <how / where / how large>
  2. "<exact words>" → ...
- Layout: <where things sit in the frame: main subject in the left/right third, hero opposite, evidence in a corner>
- Hero: <the one element that dominates, e.g. "$3,999" hero, 180 px, yellow, top right; or "the gauge, half the frame height">
- Evidence: <each source card or sheet: exact words, highlight, title line, source chip, URL; or "none: reason">
- Payoff: <the visible result that completes the explanation, and how long it holds>
- Camera: <the move and its reason, or "static: reason">
- Assets: <each real thing: "draw: <silhouette, proportions, identifying details>" or "logo: <company>, SVG">
- Carry: <subject ids still on screen from earlier scenes, or none>
- Handoff: <what carries into the next scene and how; everything else leaves>
- Why not basic: <what a labelled box, a sentence on screen or a plain fade would fail to show>
- Sound: <one effect per cut and big move: whoosh, pop, click, typing; or "silent: reason">

### <next-scene-id>
...

## Packaging alternatives
<Three matched title/headline/short-description packages, with audience, click motivation, payoff and sourcing;
see docs/video-click-psychology.md. Recommend one below.>

## Thumbnail
- Title: <the video's title: specific, names the thing (model, device, company, number), tells the viewer what they get>
- Headline: <usually 2–4 readable words: a benefit, discovery, question, result or evidenced warning>
- Description: <two sentences, roughly 30–60 words: topic, viewer benefit and what the film explains>
- Audience: <the intended viewer and what matters to them>
- Click motivation: <the specific unanswered question or useful outcome>
- Subject: <the one central image and its silhouette; the thing being judged, big (its logo, the device)>
- Layout and colours: <placement, background, accent colours, in the film's theme>
- Relationship to the title: <what the image adds that the title does not say>
- Payoff in the video: <scene id and the words where the promise is paid off>
- Sourcing: <the research line behind any number or claim it shows>
````

## Title and thumbnail

Read `docs/video-click-psychology.md` and apply its findings and required output. Develop three different matched
packages (title, thumbnail headline and short description), then recommend one. Preserve explicitly approved copy;
other suggestions remain proposals. Keep all packaging outside `SCRIPT.md`.

- **Clarity and relevance first.** Name the subject and why this viewer should care. Use plain words and one idea.
- **Open a specific information gap.** Reveal enough to understand the question; let the film explain the answer.
  Useful outcomes, surprising mechanisms, comparisons and evidenced warnings are all valid. Questions are allowed.
- **Make the title and image work together.** Usually 2–4 big words on the image add a consequence or contrast;
  the title identifies the subject and offer. The short description adds scope and benefit in natural language.
- **Deliver the promise.** The opening raises the same question promptly and the film resolves it. Cite the scene
  and words where that happens. Do not remove qualifications that change a claim, invent a test or imply deception
  without evidence. Numbers retain their conditions. An accusation needs support for the accusation itself.
- **One idea, big.** One recognizable subject, readable type and a clear visual hierarchy at phone size.
- **Use the reference as a style reference.** `docs/kaiexplains-thumbnail-study.md` describes a small channel sample;
  it does not prove that warnings, accusations, uppercase text or a particular colour cause more clicks. Fear is
  optional, and no angle is a guaranteed winner. Rank editorially; actual performance requires audience testing.

## Scenes

- Split by idea, typically 6–20 s of speech each (about 15–50 words at a normal rate); cover the whole script in order.
- Scene ids are short kebab-case names of the idea (`price-shock`, not `scene-3`). The director keeps them.
- A scene starts at a phrase that is actually spoken. Choose 3–6 distinctive words that occur once in the script, or
  say which occurrence.
- Pick as prototype the most demanding 10–15 s scene: it is built and reviewed first, and sets the look for the rest.
- Each important idea needs cause → consequence → payoff on screen. Comparisons stand side by side under the same
  conditions. Abstract ideas become familiar physical metaphors that act. If the same events would explain an
  unrelated topic by changing labels, they are too generic: rewrite them.

## For a supplied script

When the narration already exists (a recording or someone else's script), write only the visual plan. Do not change a
word of the narration, do not rewrite or "fix" the script, and quote its words exactly as written. Research is limited
to what the script itself claims and any sources supplied with it; show no number or claim the narration does not
support.
