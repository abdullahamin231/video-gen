# Motion Explainer

[Motion Explainer](https://github.com/showheyohtaki/motion-explainer) by Shohei Ohtaki provides
MIT-licensed prompts and Canvas examples for camera moves, transitions and motion graphics. Use it
as animation vocabulary and drawing code to adapt. Its original format is a 24-term animated teaching
set; that format is optional here.

Unmodified upstream files live in `library/motion-explainer/1.0.0/upstream/`. `SOURCE.json` records
the revision and hashes; `upstream/LICENSE` preserves attribution. The separate, project-owned
`timeline.js` connects frame drawing to HyperFrames. Production uses this repo's renderer and workflow.

## Choose references

| Use | Starting points |
|---|---|
| Explainer | Line draw, stagger, parallax and shape morph for mechanisms and comparisons |
| Rules-story horror | Slow dolly, rack focus, mask reveal and match/smash cuts for tension and reveals |
| Other | Highlights for app demos, animated diagrams for training/news, kinetic text for titles, term cards for vocabulary lessons |

Read `upstream/examples/camera-moves/NAMES.md` or `upstream/examples/motion-graphics/NAMES.md`, then
inspect the matching example HTML. The motion graphics example has Japanese labels; its names document
includes English equivalents. Specify the technique, subject, timing and strength when directing a scene.

## Install into a job

```bash
npm run video -- library-use --item motion-explainer@1.0.0 --job jobs/<slug>
```

The bundle is copied to `assets/library/motion-explainer/1.0.0/`. Adapt drawings into scene files or
separate assets, preserving the frozen originals. Use the job's canvas, frame rate and measured timing
rather than upstream's fixed dimensions, page durations and loops. Follow [composition.md](composition.md)
for scene structure, registration, asset loading and build commands.

## Canvas bridge

Inside the scene template, load the bridge and register a timeline:

```html
<script src="assets/library/motion-explainer/1.0.0/timeline.js"></script>
<script>
{
  // Define drawFrame to redraw this scene's canvas completely from the supplied time.
  function drawFrame(frame, seconds) { /* adapted drawing code */ }
  window.__timelines['scene-id'] = MotionExplainer.createTimeline(drawFrame,
    { duration: 6, fps: 30 }); // Replace with actual scene duration and job fps.
}
</script>
```

`createTimeline` returns a paused GSAP timeline. It calls `drawFrame(integerFrame, seconds)` on time
assignment, including seeks that suppress callbacks. Seconds are frame-quantized and the endpoint is
clamped to the final valid frame. Each timeline has its own clock. Remove upstream's preview loop and
use the supplied time instead of a global `window.renderFrame` or timer. Canvas text needs manual
readability inspection because DOM text bounds checks cannot measure it.

For a vocabulary series, consult `upstream/PROMPT.md` for term selection and lesson grouping. Treat its
standalone setup, rendering, approval and posting instructions as upstream reference material; this
repo's workflow and the user's brief govern production.
