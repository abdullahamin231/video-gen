---
name: hyperframes
description: Author or edit native HTML video compositions for this repository's HyperFrames renderer.
---

You own the HTML, CSS, JavaScript, assets and visual organization inside the job. Use the tools and
representations that best communicate the idea. No registry, component library, JSON drawing language,
world metaphor or preset animation vocabulary is required.

`docs/composition.md` is the small integration contract: scene files, measured timing, timeline registration,
media ownership and build commands. Read it before authoring. It defines what the renderer needs,
not how the picture should look. The pipeline supplies the root composition and fixed narration.

Choose scene boundaries for the material. A composition can cover the whole recording or one passage.
Use a paused, seekable timeline; the same timestamp must produce the same frame regardless of seek order.
Freeze assets locally. Keep browser media under framework control so rendered frames match source time.
GSAP is available locally; other runtimes are possible if they satisfy the seek contract.

Inspect actual frames and transitions after build, and use playback when judging motion. Treat static
frames, signal measurements and playback as different evidence. Check that the picture supports the
spoken meaning and remains readable on the target canvas. Clear technical failures; use judgment on
creative choices. Avoid adding motion merely to satisfy activity metrics.

For explainer and rules-story personalities, read `docs/motion-explainer.md` and both referenced technique catalogs before
visual planning. Consider the full camera, editing and motion graphics vocabulary across the whole film;
inspect relevant example code and adapt or combine techniques to serve each narrative beat. No profile
is limited to a technique subset, short loops or card layouts. The bundle also includes a Canvas timeline
bridge; use the implementation that fits the scene.
