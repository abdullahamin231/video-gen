# Shot compiler API (optional adapter)

Native composition authoring uses [composition.md](composition.md). This reference is only for the JSON
shot compiler used by capture tooling or when an agent explicitly chooses its drawing helpers.
The vocabulary describes API capabilities, not required visual choices.

`film.json` version 2 contains title, concept and ordered scenes. Shot scenes omit `kind` (or use
`"kind":"shots"`); each has `shots/<id>.json` with `scene`, `cues`, `objects` and `actions`.
The first scene starts at zero; later starts name measured narration phrases. A shot's cues map names to
`{"phrase":"spoken words"}` with optional occurrence, edge and offset. Actions reference cue names,
`start`, `end`, `@prev` or `@after`, with optional numeric offsets such as `"change+0.2"`.
These times resolve to the recording, not a separately guessed clock.

Objects have unique kebab-case IDs, type and the fields below. Actions have `do`, target, at, duration
`dur` and verb-specific fields. Targets may name object parts with `id.part`. Children of groups are local
to the group. Shot themes provide bg, colors, fonts and defaults for built-in objects; these fields are
compiler styling inputs, not a requirement for native HTML. Theme descriptions and rejected alternatives
are unnecessary for understanding the compiler.

## Objects

| type | required | notes |
|---|---|---|
| `circle` | `at` | `r` |
| `dot` | `at` | `r` (default 9), filled |
| `ellipse` | `at` | `radii: [rx, ry]` |
| `rect` / `square` | `at`, `size` / `side` | `corner` radius |
| `arc` | `at` | `r`, `from`, `to` (degrees, counter-clockwise from +x) |
| `line` / `arrow` | `from`, `to` | arrow: `tip` size, `double: true` |
| `path` | `d` | any SVG path in world coordinates |
| `polyline` / `polygon` | `points` | `[[x,y], ...]` |
| `brace` | `from`, `to` | curly brace on the left of from→to; `depth`; label goes to its tip |
| `text` | `at`, `text` | `size` (px, default 32), `weight`, `font: sans|serif|mono`, `anchor: start|middle|end`, `italic`, `\n` for lines |
| `tex` | `at`, `tex` | LaTeX via MathJax, `size` (default 48). Mark terms with `\cssId{name}{...}` to transform them term by term |
| `counter` | `at` | `value` (omit to start at the placeholder "—"), `prefix`, `suffix`, `decimals`, `size` (≥40) |
| `axes` | `at`, `size`, `x`, `y` | `x`/`y` = `[min, max, step]`; `grid`, `labels: {"x","y"}`, `tickLabels: false|"all"`, `tickFormat: "v => ..."` |
| `numberline` | `at`, `range` | `range: [min, max, step]`, `length` |
| `plane` | `at`, `size`, `x`, `y` | transformable coordinate grid; `step`; use with `applyMatrix` |
| `graph` | `of`, `fn` | `fn: "x => Math.sin(x)"`, `domain`, `samples` |
| `area` | `of`, `fn` | filled region under fn over `domain` |
| `vector` | `to` | arrow from `from` (default [0,0]); with `of`, data coordinates |
| `bars` | `of`, `values` | `xs` positions, `barWidth`, `colors`; parts `bar-0`, `bar-1`… |
| `network` | `nodes` | `nodes: [{"id","at","label","r"}]`, `edges: [["a","b"], ...]`; parts are node ids and `a-b` |
| `particles` | `at` | `count`, `size: [w,h]` region, `seed`, `r`, `colors`, `points`; parts `p0`, `p1`… |
| `group` | `at`, `children` | children are objects positioned relative to the group |
| `image` | `at`, `src`, `size` | an SVG file under `assets/`: a drawing of a real thing (you draw it: true silhouette, identifying details, the theme's colours and line weight) or a logo. Use local media with recorded provenance. `frame: true` (or `{"padding", "fill", "color", "corner", "width"}`) presents it on a card in the theme's style |
| `svg` | `markup` | raw SVG; elements with `id` become parts |
| `manim` | `at`, `size`, `file`, `class` | a ManimCE clip (see below); starts at its `play` action |
| `video` | `at`, `src`, `size`, `clipDuration` | local video file under `assets/`; `clipDuration` is its real length, so it cannot play past the cut. Objects with `layer: "media"` are the overlays that sit on top of it (see above). Compile these with reshoot + `capture-ingest` + `capture-scene` ([capture.md](capture.md)) |
| custom | — | `type` = a component in `components/<type>.js` |


## Composite helpers

| type | required | notes |
|---|---|---|
| `hero` | `at` | THE number or word of the beat. `value` (rolls with `count`; omit to start at "—") or `text`; `unit` (small uppercase line under it); `size` (default 180), `color` (default `yellow`), `anchor`, plus `prefix`, `suffix`, `decimals`. Parts `text`, `unit` |
| `card` | `at`, `text` | a real source on screen: `text` = its exact words (wrapped to `width`, default 640), `title` (e.g. "r/LocalLLaMA · u/name", "Meta AI blog"), `highlight` (words from `text` marked in `highlightColor`, default `yellow`), `source` (chip under the card: the site, subreddit, repo), `size` (default 32). Parts `paper`, `title`, `text`, `highlight` (sweep it in with `grow` `from: "left"`), `source` |
| `sheet` | `at`, `rows` | a spec list on paper: `rows: [["layers", "78"], ...]`, `title`, `highlight` (row index or list), `width` (default 560), `size` (default 30). Parts `paper`, `title`, `row-0`, `row-1`… |
| `tag` | `at`, `text` | a hanging tag (price, size): `string` (length of the string above it, default 80; 0 for none), `color` (default `yellow`), `size` (default 44). Parts `string`, `pin`, `body`, `text`. `swing` sways it from the pin |
| `verdict` | `at`, `text` | a rubber stamp: bordered uppercase word(s), tilted (`tilt`, default -7°), `color` (default `red`), `size` (default 72). Arrive with `stamp` |
| `gauge` | `at` | a container on a shelf with a scale beside it: `size: [w, h]` (default [360, 440]), `max`, `step`, `unit`, `value` (start level), `fillLabel` (text on the fill), `limit` (dashed line at a level), `title` (under the shelf), `color` (frame, default `blue`), `fill`. Parts `well`, `frame`, `shelf`, `scale`, `fill`, `fill-label`, `limit`, `title`. Change the level with `fill` |
| `chip` | `at`, `text` | a small rounded uppercase label: `color`, `filled: true`, `size` (default 28). Parts `pill`, `text` |


## Actions

| verb | parameters | what it shows |
|---|---|---|
| `create` / `draw` | — | outlines draw on, then fills arrive; text writes on |
| `write` | — | text/TeX writes on character by character / glyph by glyph |
| `fadeIn` / `fadeOut` | `shift: [dx,dy]`, `from_scale` | entrance / exit |
| `uncreate` | — | outlines undraw and vanish |
| `show` / `hide` | — | instant |
| `grow` | `from: center|bottom|left` | grows from zero size (bars from the baseline) |
| `move` | `to: [x,y]` / `by: [dx,dy]` / `along: "<path-object id>"` or points; `arc: 0.3` curves the path | travel |
| `scale` | `to: 1.4` or `[sx, sy]` | resize about the object's anchor |
| `rotate` | `by` / `to` degrees, `about: [x,y]` | rotation |
| `color` | `to`, `prop: stroke|fill|both` | recolour (a change of meaning) |
| `set` | `props: {"opacity": 0.4, "stroke-width": 6}` | tween any attribute |
| `count` | `to`, `from`, `step` | counter rolls to a value (from the placeholder the first time) |
| `transform` / `morph` | `into: "<id>"` | the target becomes another object: shapes morph path by path, TeX terms with the same `\cssId` glide to their new places, the rest cross-fades. Define the end state as a hidden object |
| `trace` | `along: "<graph id>"`, `range: [x0, x1]`, `draw: true` | a dot rides a graph, optionally drawing it |
| `retarget` | graph `fn`; vector `to`; bars `values` | the same object changes value in place |
| `applyMatrix` | `matrix: [[a,b],[c,d]]` | linear transformation of a plane and everything plotted on it |
| `flow` | `count`, `spacing`, `r`, `color`, `shape: square` | tokens travel along a line/arrow/path |
| `arrange` | `layout: {"type": "row|column|grid|circle|line|points|along|scatter", ...}` | rearranges targets (e.g. `"id.*"` particles): `center`, `gap`, `cols`, `r`, `from`/`to`, `points`, `of` |
| `simulate` | `model: brownian|drift|attract|orbit|fall`, `speed`, `velocity`, `to`, `gravity`, `seed` | deterministic particle motion |
| `drop` | `from: [dx, dy]` (default `[0, -90]`) | arrives from an offset and lands (ease `pop` unless set) |
| `pop` | `from_scale` | grows out of nothing, overshoots and settles |
| `stamp` | `from_scale` (default 1.9) | slams down from larger than life: a verdict (SOLD OUT, ✓, REJECTED) |
| `swing` | `angle` (default 14), `about: [x, y]` (local; default its top centre) | sways on a pivot to rest: a hanging tag or sign |
| `strike` | `color` (default `red`), `width`, `padding` | a line is drawn across the target and stays attached to it |
| `type` | `cursor: true`, `blink` (s), `cursorColor` | text appears character by character, like typing into a search box |
| `shake` | `amount` (px, default 14) | a quick side-to-side shake: refusal, error, impact |
| `fill` | `to` (a level on the gauge's scale), `label` (new fill text), `color` | a `gauge` fills or drains to a new level |
| `focus` / `unfocus` | `level` (default 0.25) | dims everything except the targets / restores |
| `indicate` | `scale`, `color` | brief emphasis |
| `circumscribe` | `shape: rect|circle`, `color`, `keep` | draws a ring around the target |
| `flash` / `pulse` | `color` | an event happens here |
| `camera` | `center: [x,y]`, `zoom`, `rotate`, or `focus: "<id>"` / `[ids]` + `padding` | the camera moves through the world |
| `play` | — | starts a manim/video object |
| component verbs | anything | defined by the component |


## Extension and continuity

Custom types live in `components/<type>.js` and register through `VG.component(name,{build,verbs})`.
Per-scene hooks register `VG.hook(sceneId,k=>...)`. These are optional escape hatches for the drawing
runtime. `k.tween(el,to,time,duration,ease,defaults)` schedules tracked motion; `k.cue(name,offset)`,
`k.obj(id)`, `k.part(id)` and `k.add(id,el)` connect to the compiled scene. Use explicit states so seeking
works. Native HTML can instead use GSAP directly without these APIs.

Recurring subjects may be declared in film subjects and carried into later scenes with carry IDs. The
compiler gates object lifetimes and clears unused subjects at handoffs. `persist:true` deliberately extends
an object. Regions set camera centers/zoom; `inheritCamera:true` keeps the previous pose. These options
apply only to compiler-managed objects.

Shot `sounds` use local WAV src, cue-based at, optional align/start|peak|end, volume and why. Native
film-level sound cues use [sound.md](sound.md). Capture video objects and media overlays should be produced
through [capture.md](capture.md), which binds them to recorded action logs and omission evidence.

Run plan-check and build to validate actual files. Build failures identify unsupported fields, missing
assets, invalid cues and runtime defects. Automated style warnings are diagnostics, not creative rules.
