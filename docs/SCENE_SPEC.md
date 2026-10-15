# Scene spec reference

A scene is one JSON file, `shots/<scene-id>.json`. The pipeline compiles every scene into one shared world
(one SVG coordinate space, one camera, one timeline), so objects from earlier scenes can stay, move, and transform.
`npm run video -- build --job jobs/<slug> --scene <id>` validates your file, runs it in a browser, and prints errors
plus a motion transcript of what is actually on screen. Iterate until it reports 0 errors.

## File shape

```json
{
  "scene": "bottleneck",
  "cues": {
    "load":  {"phrase": "loads the weights"},
    "wait":  {"phrase": "has to wait", "edge": "end"},
    "again": {"phrase": "again", "occurrence": 2, "offset": -0.2}
  },
  "objects": [ ... ],
  "actions": [ ... ],
  "holds": [{"from": "wait", "to": "wait+1.5", "reason": "let the empty queue register before the payoff"}],
  "hook": "shots/bottleneck.hook.js",
  "notes": "Replaced the planned pipe with a queue: waiting is easier to see as a line than as pressure."
}
```

- **notes** (optional): one or two sentences on deliberate departures from the director's plan or the style guidance.
  They appear in STORYBOARD.md so reviewers judge your choice instead of the old plan.

- **cues**: names for moments in the narration. `phrase` = words copied from the word table in your brief (case and
  punctuation ignored). Searched only inside your scene; if repeated, the first is used unless `occurrence` is set.
  `edge: "end"` uses the end of the last word. `offset` shifts in seconds. `start` and `end` (scene bounds) are built in.
- **at** (on every action): `"load"`, `"load+0.4"`, `"load-0.3"`, `"@prev"` (same start as the previous action),
  `"@prev+0.2"`, `"@after"` (when the previous action ends), `"@after+0.1"`. Literal numbers are rejected.
- **dur**: seconds. Defaults: create 1, write 1, fadeIn 0.6, move 0.9, transform 0.9, camera 1.4, count 1.2.
- **ease**: a named ease — `smooth` (default for moves), `out` (default for entrances), `in`, `sine`, `linear`, `slow`,
  `pop` (overshoot and settle), `snap` (fast stop), `settle` (springy), `drop` (bounces to rest) — or any GSAP ease
  (`"back.out(1.4)"`, `"elastic.out(1, 0.5)"`). The film's theme may redefine any name (`theme.eases`), so prefer the
  names: then every scene moves with the same personality.

## Coordinates

World units are pixels of a 1920×1080 frame at camera zoom 1: x right, y down, the default view centre is [960, 540].
Positions are `[x, y]`. Objects are hidden until an action shows them (`"visible": true` shows one from the start). Prefer `draw`/`create` for set-up objects over `"visible": true`: a scene that starts fully built looks like a pop-in.
Lines, arrows, paths and polygons use world coordinates directly. Everything else is placed by `at` (its centre).
Objects with `"of": "<axes-or-plane-id>"` use **data coordinates** of that axes and move with it.

Keep the subject large: the build warns when content fills less than ~20% of the frame. Essential text should be
≥28 px on screen (values ≥40 px; key numbers usually much larger); zooming the camera out shrinks text, so prefer
clearing or changing the stage over zooming out to fit more.

**Errors vs warnings.** The build fails only when the film is broken or untrue: invalid JSON or fields, a missing or
incomplete theme, unknown targets, missing asset files, cue words not spoken in the scene, two actions animating the
same property at once, motion that is not seek-safe, randomness or clocks, or numbers the narration does not support
(unless the object says why with `numbers`). Everything else (text size, colours or fonts outside the theme, frame use,
stillness, text overlap) is a warning: fix it, or keep it on purpose and say why in `notes`.

## The design theme

Every film declares ONE design theme in `film.json` `"theme"`. The director chooses the look; nothing about it is
prescribed. The kit applies the tokens to every object automatically, which is what keeps scenes consistent: write a
colour or font name from the theme, never a new hex value or typeface in a shot. The two examples below show the
format with deliberately different looks; design the theme for your film rather than copying either.

```json
"theme": {
  "name": "Shop-shelf stickers",
  "description": "Chunky white outlines on a near-black stage. Real products appear as photo cut-outs sitting on a white shelf; everything else is flat sticker graphics with hard black offset shadows. Prices are heavy black numerals on tilted yellow tags. Labels are small bold uppercase mono chips. Things drop in and land with a little overshoot, tags swing, verdicts are stamped. One stage per idea, objects large, lots of empty space.",
  "rejected": "Thin-line technical diagrams: precise but too cold for a conversational shopping story",
  "bg": "#0e1010",
  "fg": "white",
  "colors": {"white": "#eff1f1", "grey": "#8a9091", "dim": "#3a3f40", "faint": "#1d2122", "blue": "#138ddf",
             "yellow": "#fcd53a", "red": "#e0342f", "green": "#3fbf6f", "ink": "#0e1010", "panel": "#1b1d1e"},
  "meanings": {"yellow": "money and prices", "blue": "your own machine", "red": "no / unavailable"},
  "fonts": {"sans": "Archivo", "mono": "JetBrains Mono", "display": "Archivo"},
  "stroke": 7, "corner": 14, "fillOpacity": 1,
  "shadow": {"dx": 10, "dy": 10, "blur": 0, "color": "#000000", "opacity": 1},
  "text": {"weight": 800},
  "label": {"font": "mono", "weight": 800, "size": 34, "upper": true},
  "value": {"font": "sans", "weight": 900, "color": "ink"},
  "eases": {"out": "pop"},
  "defaults": {"rect": {"shadow": true, "fill": "panel"}, "image": {"shadow": {"dx": 0, "dy": 14, "blur": 18, "opacity": 0.6}}}
}
```

A very different theme in the same format:

```json
"theme": {
  "name": "Engineer's notebook",
  "description": "Warm off-white paper with a faint blue grid. Everything is drawn as if by a fine black pen: thin even lines, no fills except a single highlighter yellow that marks the number that matters. Real hardware appears as careful line drawings with labelled callouts. Handwritten labels, typewriter values. Lines draw themselves on; things slide calmly into place; nothing bounces. Diagrams sit on the grid and grow across the page.",
  "rejected": "Neon on black: flashy, but the narrator is calm and explanatory",
  "bg": "#f4efe4", "fg": "white",
  "colors": {"white": "#1c1c1c", "grey": "#6b6b6b", "dim": "#b9b3a6", "faint": "#dcd8f0", "blue": "#2f5fb3",
             "yellow": "#ffe14d", "red": "#c8372d", "green": "#3d8a4f"},
  "meanings": {"yellow": "the number that matters", "red": "a limit or a cost"},
  "fonts": {"sans": "Caveat", "mono": "IBM Plex Mono"},
  "stroke": 3, "corner": 4, "fillOpacity": 0.9,
  "label": {"size": 40, "weight": 700}, "value": {"font": "mono", "weight": 500},
  "eases": {"out": "power2.out", "smooth": "sine.inOut"}
}
```

(Here `white` is mapped to near-black ink: the name is a role, "the default ink", not a hue.)

| field | meaning |
|---|---|
| `name`, `description` | required. The look in words, written so a builder who never saw the film could follow it |
| `rejected` | a theme you considered and why it lost |
| `bg` | required. Background colour |
| `colors` | required. Named colours; shots refer to these names. Map the built-ins' role names `white` (default ink), `grey`, `dim`, `faint`, `blue`, `yellow` (highlights), `red` (strike), `green` to your palette; add any names you like |
| `meanings` | what each accent colour means, for the whole film |
| `fg` | default colour of strokes and text (a colour name or value; default `white`) |
| `fonts` | roles → bundled families: `sans` (default), `mono` (counters), `serif`, plus any role you invent (`display`). Objects pick a role with `"font": "display"`. Bundled: Inter, Archivo, Space Grotesk, Nunito, Bebas Neue, Source Serif 4, Fraunces, DM Serif Display, JetBrains Mono, IBM Plex Mono, Caveat |
| `fontFiles` | your own fonts: `[{"family": "X", "src": "assets/fonts/x.woff2", "weight": 700}]` (bring the file in with `asset`) |
| `stroke`, `corner`, `fillOpacity` | default line width, rect corner radius, fill opacity (use 1 for flat solid fills) |
| `shadow` | the shadow objects get with `"shadow": true`: `dx`, `dy`, `blur` (0 = hard), `color`, `opacity` |
| `text`, `label`, `value` | type defaults for text objects, object labels and counters: `font`, `weight`, `size`, `color`, `tracking`, `upper` |
| `eases` | redefine named eases (`"out": "pop"`, `"smooth": "power3.inOut"`) so every entrance and move shares one personality |
| `defaults` | default fields per object type (`"rect"`, `"image"`, `"text"`, ... or `"*"`), merged under each object's own fields |

Manim clips receive the theme too (`COLORS` in `vg_manim`).

## Objects

Every object has `id` (kebab-case, unique in the whole film) and `type`. Common optional fields: `color` (a colour
name from the theme), `width` (stroke px; default `theme.stroke`), `fill` (true or a colour), `fillOpacity` (default
`theme.fillOpacity`), `dash` (e.g. "8 8"), `shadow` (true = the theme's shadow, or overrides), `scale`, `rotate`,
`opacity`, `visible`, `layer: "screen"` (ignores the camera), `label` (a string, or `{"text", "side":
"top|bottom|left|right|center", "size", "gap", ...}`; styled by `theme.label`; fades in with the object), `persist: true`
(never auto-removed), `numbers: "<reason>"` (allows a number not in the narration). Text and labels also take `font`
(a theme font role), `weight`, `tracking`, `upper: true`.

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
| `image` | `at`, `src`, `size` | a file under `assets/` (product photo, logo, illustration); `fit: "cover"` crops; `knockout: "white"\|"black"` (or `{"key", "tolerance", "softness"}`) makes a plain studio background transparent; `frame: true` (or `{"padding", "fill", "color", "corner", "width"}`) presents it as a card in the theme's style. Bring files in with `npm run video -- asset --src <url\|file> --name <name>.png` |
| `svg` | `markup` | raw SVG; elements with `id` become parts |
| `manim` | `at`, `size`, `file`, `class` | a ManimCE clip (see below); starts at its `play` action |
| `video` | `at`, `src`, `size` | local video file |
| custom | — | `type` = a component in `components/<type>.js` |

**Parts**: target `"id.part"` to act on part of an object: axes `x-axis y-axis ticks tick-labels grid x-label y-label`,
arrows `shaft head`, vectors `shaft head`, tex `\cssId` names, network node ids and `a-b` edges, bars `bar-N`,
particles `pN`, svg/component ids. `"id.*"` targets every part (e.g. all particles).

## Actions

`{"do": "<verb>", "target": "<id | id.part | [ids]>", "at": "...", "dur": 0.8, ...}`. A list of targets runs with a
small stagger (`stagger` sets it).

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
| `focus` / `unfocus` | `level` (default 0.25) | dims everything except the targets / restores |
| `indicate` | `scale`, `color` | brief emphasis |
| `circumscribe` | `shape: rect|circle`, `color`, `keep` | draws a ring around the target |
| `flash` / `pulse` | `color` | an event happens here |
| `camera` | `center: [x,y]`, `zoom`, `rotate`, or `focus: "<id>"` / `[ids]` + `padding` | the camera moves through the world |
| `play` | — | starts a manim/video object |
| component verbs | anything | defined by the component |

Two actions must not animate the same property of the same object at the same time; the build reports overlaps.

## Continuity and exits

Recurring subjects are listed in film.json `subjects`; a scene's `carry` lists subjects that stay from earlier scenes.
Reuse their ids — never redefine them. At each handoff the pipeline fades out everything that is neither carried into
nor used by the next scene, after its last action. If film.json gives the scene a `region`, the camera moves there at the
scene start unless your first second already moves the camera. Remove or transform your own objects when the mechanism
requires it; do not leave finished diagrams lying around.

## Worked example

```json
{
  "scene": "bottleneck",
  "cues": {"load": {"phrase": "loads the weights"}, "token": {"phrase": "one token"}, "wait": {"phrase": "has to wait"}},
  "objects": [
    {"id": "memory", "type": "rect", "at": [520, 540], "size": [360, 520], "corner": 10, "fill": true, "label": "memory"},
    {"id": "core", "type": "rect", "at": [1400, 540], "size": [300, 300], "corner": 10, "color": "blue", "fill": true, "label": "compute"},
    {"id": "bus", "type": "arrow", "from": [710, 540], "to": [1240, 540], "color": "grey"},
    {"id": "weights", "type": "particles", "at": [520, 540], "size": [300, 460], "count": 48, "seed": 3, "color": "yellow"},
    {"id": "done", "type": "counter", "at": [1400, 760], "suffix": " tokens", "size": 44}
  ],
  "actions": [
    {"do": "create", "target": ["memory", "core"], "at": "start+0.2", "dur": 1.2},
    {"do": "fadeIn", "target": "weights", "at": "@after-0.4", "dur": 0.6},
    {"do": "create", "target": "bus", "at": "load-0.3", "dur": 0.6},
    {"do": "arrange", "target": "weights.*", "layout": {"type": "line", "from": [760, 540], "to": [1300, 540]}, "at": "load", "dur": 1.4, "ease": "sine"},
    {"do": "pulse", "target": "core", "at": "token", "dur": 0.6, "color": "yellow"},
    {"do": "count", "target": "done", "to": 1, "at": "token", "dur": 0.4},
    {"do": "arrange", "target": "weights.*", "layout": {"type": "grid", "center": [520, 540], "cols": 6, "gap": 44}, "at": "token+0.6", "dur": 1.2},
    {"do": "focus", "target": ["bus", "weights"], "at": "wait", "dur": 0.5},
    {"do": "camera", "focus": "bus", "padding": 0.25, "at": "wait+0.2", "dur": 1.2}
  ]
}
```

The weights physically travel through the bus for every token, the counter advances only after they arrive, and the
camera closes in on the bus when the narration says the core has to wait. That is a mechanism, not a diagram.

## Beyond the built-ins (full creative freedom)

**Custom components** — `components/<type>.js`, used as `{"type": "<type>", ...}`:

```js
VG.component('valve', {
  build(o, k) {                       // draw in local coordinates around (0,0); return named parts
    const body = k.svg('circle', {r: o.r ?? 60, fill: 'none', stroke: k.col('white'), 'stroke-width': k.theme.stroke}, k.body);
    const gate = k.svg('line', {x1: -50, y1: 0, x2: 50, y2: 0, stroke: k.col('yellow'), 'stroke-width': k.theme.stroke * 2}, k.body);
    return {parts: {body, gate}};
  },
  verbs: {
    open(k, inst, a, t, dur) { k.tween(inst.parts.gate, {rotation: 90}, t, dur, a.ease || 'smooth'); },
  },
});
```

Use it with `{"do": "open", "target": "valve-1", "at": "flow"}`. `k.tween(el, {prop: value}, t, dur, ease)` is the only
way to animate (it tracks state so seeking is safe); props: `x y scale rotation opacity autoAlpha drawSVG morphSVG`
and `attr.<name>`. Also available: `k.svg`, `k.col` (theme colour names), `k.theme`, `k.fontStack(role)`,
`k.shadowFilter(true)` (the theme's shadow as a `filter` value), `k.rng(seed)`, `k.setNow`, `k.worldBox`, `k.pathPoints`.
Draw components in the film's theme: take colours, stroke width, corner and fonts from `k.theme`, not new literals.
The full signature is `k.tween(el, to, t, dur, ease, defaults = {}, extra = {})`. `defaults` supplies initial values
for properties not yet tracked; later tweens start at their previously scheduled end state. For example,
`k.tween(line, {'attr.x2': endX}, t, dur, 'smooth', {'attr.x2': startX})`.
During component construction, `k.setNow(el, props)` sets the DOM and registers that initial state. Never mutate
animated attributes after scheduling their tweens, read live playback state to choose endpoints, or add callbacks.
No `Math.random`, clocks, timers, callbacks, or literal times.

**Hooks** — `shots/<scene>.hook.js` for one-off choreography the spec cannot express:

```js
VG.hook('bottleneck', k => {
  const gate = k.part('memory.shape');
  k.tween(gate, {'attr.stroke-width': 8}, k.cue('wait', 0.3), 0.4, 'out');
});
```

`k.cue(name, offset)` gives the time; `k.obj(id)` / `k.part("id.part")` give elements; `k.add(id, el)` registers a
new element so the checks can see it. The same determinism rules apply.

**Manim clips** — for passages Manim does better (run `npm run video -- setup-manim` once). `manim/<file>.py`:

```python
from manim import *
from vg_manim import CueScene, COLORS

class Limit(CueScene):
    def construct(self):
        dots = VGroup(*[Dot(color=COLORS["blue"]) for _ in range(12)]).arrange_in_grid(3, 4)
        self.play(FadeIn(dots, lag_ratio=0.1), run_time=1)
        self.wait_until("wait")          # cue name from this shot's "cues", relative to the clip start
        self.play(dots.animate.arrange(RIGHT), run_time=1)
```

Object: `{"id": "limit-clip", "type": "manim", "file": "manim/limit.py", "class": "Limit", "at": [960, 540], "size": [1280, 720]}`
plus `{"do": "play", "target": "limit-clip", "at": "start+0.2"}`. Background is transparent. LaTeX is not installed:
use `Text`, or put equations in `tex` objects of the world.

**HTML scenes** — a whole scene can be a hand-written HyperFrames composition (`"kind": "html"`, `"file"` in
film.json) for 3D or other runtimes. It is layered over the world for its interval; follow the hyperframes-core skill.
