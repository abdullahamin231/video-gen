# Explainer production vocabulary

Tools (for you and for builders): the explainer vocabulary first — "hero" (the big number), "card" (a
source quote with highlight and source chip), "sheet" (a spec list), "tag" (a hanging price/size tag), "verdict" (a
rubber stamp), "gauge" (a container with a scale that fills, with the "fill" verb), "chip" (a small label) — then
shapes and paths, text, counters, SVG drawings and logos ("image"), TeX, axes/graphs/bars, coordinate planes,
networks, deterministic particles, a free camera, and verbs with physical character (drop, pop, stamp, swing, strike,
type, shake) next to create/write/move/transform/count/grow/focus — all in docs/SCENE_SPEC.md. The film's theme tokens (colours, fonts, stroke, corners, shadow, label style, eases, per-type
defaults) are applied by the kit automatically. Beyond the built-ins, and just as valid: custom components with their
own verbs, per-scene hooks (arbitrary GSAP choreography), ManimCE scenes, and whole hand-written HTML scenes (3D, other
runtimes).

Assets (images, logos, fonts, drawings, components) — every film adds to a shared library that later films reuse.
Run these commands from `.`:
- Look in the library FIRST: `npm run video -- library-search --query "<what you need>"` (e.g. "gpu", "price tag", "server
  rack"). If a match fits, `npm run video -- library-use --item <id@version> --job <job>` copies it into
  assets/library/... and prints how to use it. Restyle it through the theme rather than redrawing it.
- Otherwise draw it, or bring in an SVG logo: `npm run video -- asset --job <job> --src <svg url|file> --name <name>.svg --note "<what it shows>" --tags "<search words>"`.
  It lands in the job's assets/ with its source recorded AND is saved to the library automatically. Never keep
  downloads in /tmp or another scratch folder. This channel uses no photos: real things are SVG drawings.
- Anything you MAKE that could be shown again — a drawn illustration (save SVG drawings as files in assets/ and show them
  with an image object), a component (components/<type>.js), a Manim scene — save it as soon as it works:
  `npm run video -- save --job <job> --file <path in the job> --title "<what it is>" --tags "<search words>"`. Good titles and
  tags are what let the next film find it. (Anything left unsaved is saved automatically before review, with weaker
  descriptions.)
- Drawing a real thing: an SVG file in assets/ (viewBox sized to the object, the theme's colours and line weight),
  with its true silhouette, proportions and the two or three details that identify it. Look at it at phone size.

Sound (read `docs/sound.md`) — nobody here can hear, so every sound decision rests on a measurement:
- Every cut and big move (camera move, drop, stamp, transformation, a title appearing) gets ONE ready-made sound
  effect in its shot's "sounds": whoosh for movement and cuts, pop for things appearing, click for clicks and stamps,
  typing for typing. Take them from the library (`npm run video -- library-search --query "sfx whoosh"`, then library-use;
  each bundle's sounds.json lists its variants with length and loudest moment). Never make sounds in code. If no variant
  fits, leave the move silent and explain why in the shot's notes.
- The voice is the loudest thing. The build measures every sound against the narration and prints the "volume"
  that keeps it 6 dB under the voice: use it, or move the sound into a pause. With music, it also prints which
  moves miss the beat: nudge an action's "at" offset onto the beat where the narration allows.
- Report measured levels and timing; never say something "sounds good".
