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
  "hook": "shots/bottleneck.hook.js"
}
```

- **cues**: names for moments in the narration. `phrase` = words copied from the word table in your brief (case and
  punctuation ignored). Searched only inside your scene; if repeated, the first is used unless `occurrence` is set.
  `edge: "end"` uses the end of the last word. `offset` shifts in seconds. `start` and `end` (scene bounds) are built in.
- **at** (on every action): `"load"`, `"load+0.4"`, `"load-0.3"`, `"@prev"` (same start as the previous action),
  `"@prev+0.2"`, `"@after"` (when the previous action ends), `"@after+0.1"`. Literal numbers are rejected.
- **dur**: seconds. Defaults: create 1, write 1, fadeIn 0.6, move 0.9, transform 0.9, camera 1.4, count 1.2.
- **ease**: `smooth` (default for moves), `out` (default for entrances), `in`, `sine`, `linear`, or a GSAP power ease.
  No bounce/elastic/back.

## Coordinates

World units are pixels of a 1920×1080 frame at camera zoom 1: x right, y down, the default view centre is [960, 540].
Positions are `[x, y]`. Objects are hidden until an action shows them (`"visible": true` shows one from the start).
Lines, arrows, paths and polygons use world coordinates directly. Everything else is placed by `at` (its centre).
Objects with `"of": "<axes-or-plane-id>"` use **data coordinates** of that axes and move with it.

Keep the subject large: the build fails when content fills less than ~20% of the frame. Text must be ≥28 px on screen
(values ≥40 px); zooming the camera out shrinks text.

## Objects

Every object has `id` (kebab-case, unique in the whole film) and `type`. Common optional fields: `color` (theme name
`white grey dim faint blue yellow red green purple teal orange` or a hex), `width` (stroke px), `fill` (true or a colour),
`fillOpacity` (default 0.18), `dash` (e.g. "8 8"), `scale`, `rotate`, `opacity`, `visible`, `layer: "screen"` (ignores
the camera), `label` (a string, or `{"text", "side": "top|bottom|left|right|center", "size", "gap"}`; fades in with
the object), `persist: true` (never auto-removed), `numbers: "<reason>"` (allows a number not in the narration).

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
| `plane` | `at`, `size`, `x`, `y` | transformable grid (3b1b NumberPlane); `step`; use with `applyMatrix` |
| `graph` | `of`, `fn` | `fn: "x => Math.sin(x)"`, `domain`, `samples` |
| `area` | `of`, `fn` | filled region under fn over `domain` |
| `vector` | `to` | arrow from `from` (default [0,0]); with `of`, data coordinates |
| `bars` | `of`, `values` | `xs` positions, `barWidth`, `colors`; parts `bar-0`, `bar-1`… |
| `network` | `nodes` | `nodes: [{"id","at","label","r"}]`, `edges: [["a","b"], ...]`; parts are node ids and `a-b` |
| `particles` | `at` | `count`, `size: [w,h]` region, `seed`, `r`, `colors`, `points`; parts `p0`, `p1`… |
| `group` | `at`, `children` | children are objects positioned relative to the group |
| `image` | `at`, `src`, `size` | local file under `assets/` |
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
    const body = k.svg('circle', {r: o.r ?? 60, fill: 'none', stroke: k.col('white'), 'stroke-width': 3}, k.body);
    const gate = k.svg('line', {x1: -50, y1: 0, x2: 50, y2: 0, stroke: k.col('yellow'), 'stroke-width': 6}, k.body);
    return {parts: {body, gate}};
  },
  verbs: {
    open(k, inst, a, t, dur) { k.tween(inst.parts.gate, {rotation: 90}, t, dur, a.ease || 'smooth'); },
  },
});
```

Use it with `{"do": "open", "target": "valve-1", "at": "flow"}`. `k.tween(el, {prop: value}, t, dur, ease)` is the only
way to animate (it tracks state so seeking is safe); props: `x y scale rotation opacity autoAlpha drawSVG morphSVG`
and `attr.<name>`. Also available: `k.svg`, `k.col`, `k.theme`, `k.rng(seed)`, `k.setNow`, `k.worldBox`, `k.pathPoints`.
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
