# Native HyperFrames authoring

The agent owns scene HTML, CSS, JavaScript and assets. The pipeline supplies the root composition,
recording, word alignment, review evidence and delivery. No component catalog or world model is required.
Use one composition for the whole film or split where the material benefits.

## Job interface

`job.json` contains duration, canvas and frame rate. `alignment.json` contains measured word starts and
ends. `inputs/source-script.md` is the supplied narration; `inputs/visuals.md`, when present, is intent.
`film.json` is a small manifest, not a visual programming language:

```json
{
  "version": 2,
  "title": "The title",
  "concept": "What the audience should understand",
  "scenes": [
    {"id": "opening", "idea": "Introduce the question", "kind": "html", "file": "compositions/opening.html"},
    {"id": "answer", "idea": "Show the explanation", "kind": "html", "file": "compositions/answer.html", "start": {"phrase": "the exact spoken phrase"}}
  ]
}
```

The first scene starts at zero. Later starts resolve against the recording; use `occurrence` for repeated
phrases or `wordId` for an exact aligned word. A scene ends at the next start or the recording end.
`theme`, `subjects`, alternatives and detailed visual planning fields are unnecessary for native scenes.
An optional `theme.bg` controls the root background. Each scene can supply its own background and style.
Assign `owner: "builder"` only when delegating that scene; the director otherwise owns it.

Scene IDs and file basenames use lowercase letters/digits/hyphens. The pipeline generates `index.html`,
`timing.json` and `assets/cues.js`; author scene files and their assets rather than editing generated files.
The root loads `assets/kit/gsap.min.js`; this is just GSAP, not the repository's drawing library.
Paths in assembled scenes resolve from the job root, including script, image and font paths.

## Scene integration

A minimal sub-composition looks like this; the dimensions and duration below are examples:

```html
<!doctype html>
<html><body>
<template id="opening-template">
<style>
#opening-root { position:absolute; inset:0; overflow:hidden; background:#122030; }
#opening-subject { position:absolute; left:30%; top:35%; width:30%; height:30%; background:#fdc85a; }
</style>
<div id="opening-root" data-composition-id="opening"
     data-width="1920" data-height="1080" data-duration="6">
  <div id="opening-subject"></div>
</div>
<script>
const openingTimeline = gsap.timeline({paused:true});
openingTimeline.fromTo('#opening-subject', {x:-100, opacity:0}, {x:0, opacity:1, duration:0.8}, 0);
window.__timelines['opening'] = openingTimeline;
</script>
</template>
</body></html>
```

Keep styles/scripts inside the template: the assembler drops a templated file's head scripts/styles.
The inner composition ID and registered timeline key match the scene ID. Prefix DOM IDs across scenes.
Timeline times are local to the scene. Register the paused timeline after construction, including any
font-dependent layout. Font files are local and declared with `@font-face`.

The renderer owns time and clip visibility. Animate children of timed hosts rather than visibility on
the hosts themselves. Use explicit initial/end states for seekable animation. Seed procedural randomness;
wall clocks, network state and playback callbacks cannot determine a rendered frame. A timestamp must
produce the same result in forward and backward seeking. Holds and cuts are valid creative choices.

## Media and audio

Use local `src` media and the framework's `data-start`, `data-duration`, `data-media-start` and
`data-track-index` attributes for playback. Do not manually play or seek video in animation callbacks.
Avoid a timed video inside another timed plain wrapper: put timing on one, not both. Keep IDs unique.

The fixed narration is placed by the pipeline. Native HTML is the picture layer; authored audio tags
are not the delivered soundtrack. Put optional effects in film.json `sounds` and music in film.json
`music` as described in [sound.md](sound.md), so they pass through the verified pipeline mix.
Retained source speech for news uses [news.md](news.md).

## Build and inspect

```bash
npm run video -- plan-check --job jobs/<slug>
npm run video -- build --job jobs/<slug>
npm run video -- snapshot --job jobs/<slug> --at 0.5,3,5.9
```

Build assembles the real HyperFrames composition, checks runtime/assets and sampled text bounds, and
compares repeated timestamps after backward seeking. It also runs HyperFrames lint. Inspect actual
frames and playback: sample checks do not establish contrast, occlusion, narrative clarity or smooth motion.
Independent review precedes final render and delivery. The orchestrator runs those stages.

For browser scenes, [capture.md](capture.md) describes ingest, source cuts and evidence. The adapter emits
native HTML and media metadata. Optional graphics and camera moves are agent-authored.
