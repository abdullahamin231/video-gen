# Shared animation and asset library

This tracked directory accumulates reusable work across films. Jobs stay isolated
and ignored by Git; useful artifacts survive here. Start small and grow through
production. Hundreds of entries should represent distinct useful actions, not
permutations of the same entrance effect.

## Discover, use, contribute

```bash
npm run video -- library-search --query "draw transport flow"
npm run video -- library-info --item motion-primitives@1.0.0
npm run video -- library-use --item motion-primitives@1.0.0 --job jobs/example
npm run video -- library-add --source jobs/example/library-candidates/packet-router
```

Search reads metadata only and returns eight matches by default. It uses lexical
matching, not embeddings. Inspect only promising matches. Search here before the
external HyperFrames registry; use external discovery when local entries do not
fit. Do not browse old jobs to find code.

Installation copies declared files into `assets/library/<id>/<version>/` and
records SHA-256 hashes in the job's `library.json`. It returns usage instructions;
the agent explicitly wires the entry into scene code. No automatic shot insertion,
implicit latest versions, or automatic script execution. Pipeline audit checks
frozen copies. To adapt an entry, create a separately named job-local derivative
and record its source; leave the frozen original intact.

## Levels of reuse

- **primitive:** draw a stroke, transport a packet, move a camera.
- **component:** a working mechanism with geometry and behavior, such as a queue
  accepting items, a GPU processing batches, or a branching signal network.
- **sequence:** a short coordinated action with anticipation, development, and a
  handoff. Several cue slots control its stages; never hardcode narration times.
- **asset:** SVG, illustration, texture, footage, sound, or other reusable media.

Components and sequences are the main growth target. Make geometry, behavior,
styling, and timing adjustable so the same mechanism supports different framings
and explanations. Each film still invents its through-line and shot structure.

## Bundle contract

Versions live at `library/<id>/<major.minor.patch>/`. Build candidate bundles
inside a job, with this `artifact.json`:

```json
{
  "schemaVersion": 1,
  "id": "packet-router",
  "version": "1.0.0",
  "kind": "component",
  "title": "Signal router with branching packet travel",
  "description": "A signal enters a router and splits into coordinated output paths.",
  "tags": ["signal", "packet", "branch", "network", "transport"],
  "entry": "router.js",
  "files": ["router.js", "geometry.svg", "preview.mp4", "review.md"],
  "parameters": {"color": "accent stroke", "branches": "output count"},
  "cueSlots": ["assemble", "arrival", "route", "exit"],
  "usage": "Document exact markup, API, timeline integration, dependencies and handoff behavior.",
  "origin": {"source": "jobs/example", "license": "project-owned"},
  "review": {"status": "reviewed", "evidence": ["preview.mp4", "review.md"]}
}
```

The CLI checks metadata, declared files, safe paths, and evidence presence; it
does not certify motion quality. Draft entries may be saved before review and
are labeled in search. Mark an entry reviewed only after rendering and inspecting
its behavior; freeze its preview and review notes in the bundle. Preserve actual
third-party origins and licenses.

Published versions are append-only through the CLI. Changes require a new
version. Freeze dependencies other than the documented host runtime. Namespace
DOM IDs and APIs so multiple instances coexist. Use a caller-owned paused
timeline, caller-supplied targets, and cue-derived times. Avoid wall clocks,
unseeded randomness, global timeline clearing, and remote assets. Installation
does not yet resolve dependency graphs or remap DOM IDs.

## Every film saves its assets

Nothing a film brings in or makes is lost. Search first, then save:

```bash
npm run video -- library-search --query "gpu card"                      # before sourcing or drawing anything
npm run video -- asset --job jobs/example --src <url|file> --name gpu.png --note "RTX card, front view" --tags "gpu,nvidia"
npm run video -- save --job jobs/example --file components/shelf.js --title "Store shelf with tag slots" --tags "shelf,store,price"
npm run video -- save-all --job jobs/example                            # leftovers; next runs this before every review
```

`asset` imports a file into the job and saves it here in one step. `save` publishes a file an agent made (an SVG or PNG
drawing in `assets/`, a component in `components/`, a Manim scene in `manim/`) as a one-file bundle with its usage
instructions. Saving is content-addressed: an identical file is saved once, a changed file becomes a new patch version
of the same id. Auto-saved bundles are `draft`; their origin records the job and source URL. Pipeline files (the kit,
cues, narration, rendered Manim clips) and copies installed with `library-use` are never saved again.

## Sound effects and music

`npm run video -- sfx-library` adds 34 `sfx-*` bundles (183 code-made sound effects from earshot forge, each with a
`sounds.json` of variants: length, loudest moment, earshot's verdict). Search them by kind (`library-search --query
"sfx whoosh"`, `"sfx pop"`, `"sfx click"`), install with `library-use`, and place a variant in a shot's `"sounds"`.
Music tracks are saved here by the `music` command with their source and licence in `origin`. See
[docs/sound.md](../docs/sound.md).

## Production rule

Search by what should happen, not just the topic. Reuse suitable entries; invent
new mechanisms when needed. After the film is reviewed, extract useful work into
candidate bundles, remove narration-specific content, document parameters and
cue slots, include evidence, and publish. Record reused and contributed versions
in the film's review report. No fixed reuse quota applies.

The initial motion-primitives bundle preserves existing helpers and is labeled
draft; it is not a reviewed short-animation collection. Build the richer
components and sequences through actual productions.

Large previews and media will need appropriate repository storage as the library
grows. No Git LFS or object-storage integration is configured yet.
