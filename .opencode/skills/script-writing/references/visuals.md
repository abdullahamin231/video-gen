# The visual plan (`VISUALS.md`)

You are the only strong model in the production. Everyone after you (the director who writes `film.json`, the scene
builders, the reviewers, the thumbnail maker) runs on a weaker model that executes instructions well but invents
poorly. Whatever you leave vague, they fill with the generic: labelled boxes, centred text, fades. So the visual plan
carries the film's creative thinking in full, and says it concretely enough to be built without guessing.

Write `VISUALS.md` next to `SCRIPT.md` after the script is final (its scene starts quote the script, so the words must
not move afterwards). Never put visual notes into `SCRIPT.md`; it stays plain narration.

Before writing, read the repository's `docs/quality.md` (the standard the film is judged against) and the sections
"The design theme", "Objects" and "Actions" of `docs/SCENE_SPEC.md` (what the scene language can do). Plan only what
that toolset can build: shapes, paths, text, counters, images (photo cut-outs, logos, SVG drawings), TeX, axes and
bars, networks, deterministic particles, a free camera, verbs such as drop, pop, stamp, swing, strike, type, shake,
draw, move, transform, count, grow, focus; plus custom components and ManimCE for anything the built-ins cannot do.

## How to make it buildable

- **Name the thing on screen**, not the effect you want. Not "a striking visual of cost" but "a yellow price tag
  reading $3,999 swings down onto the DGX Spark box and settles with a small overshoot".
- **Tie every event to the words that trigger it.** Quote the exact words from `SCRIPT.md` (`"four thousand dollars"`)
  for each event. One clear event per spoken beat, in order.
- **Give positions and sizes in frame terms**: left third, centre, top-right corner; "about half the frame width",
  "price numerals around 120 px". Builders follow numbers better than adjectives.
- **Say what leaves.** At each new stage, say what is cleared, dimmed, transformed or carried.
- **Name real things exactly**: the product, logo, website or place, with the search words a builder should use to
  find an image (`"NVIDIA DGX Spark press photo, transparent PNG"`), or say "draw it" and describe its silhouette.
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
- Payoff: <the visible result that completes the explanation, and how long it holds>
- Camera: <the move and its reason, or "static: reason">
- Assets: <each real thing: search words for an image or logo, or "draw: <silhouette>">
- Carry: <subject ids still on screen from earlier scenes, or none>
- Handoff: <what carries into the next scene and how; everything else leaves>
- Why not basic: <what a labelled box, a sentence on screen or a plain fade would fail to show>
- Sound: <one effect per cut and big move: whoosh, pop, click, typing; or "silent: reason">

### <next-scene-id>
...

## Thumbnail
- Headline: <2–4 large uppercase words>
- Subject: <the one central image and its silhouette>
- Layout and colours: <placement, background, accent colours, in the film's theme>
- Relationship to the title: <what the image adds that the title does not say>
- Payoff in the video: <scene id and the words where the promise is paid off>
- Sourcing: <the research line behind any number or claim it shows>
````

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
