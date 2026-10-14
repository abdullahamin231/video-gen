# Narration-driven production

The user supplies audio and script paths; the agent returns a finished video.
The agent has full creative discretion and operates every technical step below
autonomously. These commands and JSON artifacts are internal production tools.
Scripts perform ingestion, reconciliation, cue resolution, assembly, and timing
validation. Follow AGENTS.md's dynamic-film quality gate: a technically valid
slideshow is unfinished. No fixed scene counts, art style, or template choices
are imposed. Pacing findings are advisory; visual storytelling remains mandatory.
Inputs may be plain narration or the existing Markdown transcript with
blockquote narration and separate visual notes.

## 1. Prepare the actual recording

```bash
npm ci
npm run video -- prepare --name example --audio inputs/audio/source.mp3 \
  --script 'inputs/scripts/your-script.md' --start 0 --duration 30
```

Requires Node 22+, FFmpeg/FFprobe and uv. The default pinned faster-whisper
script downloads its local dependencies/model on first use; `--engine hyperframes`
uses HyperFrames transcription when whisper.cpp is installed. English defaults to `small.en`; pass
`--language` and `--model small` for another language. Preparation may take a few
minutes. For existing measurements use `--words /path/to/words.json`; timestamps
must be relative to the clipped audio, in seconds, as a flat array of
`{text,start,end}`. Never use estimated words as measured input.

Preparation scaffolds a HyperFrames job, clips audio accurately to WAV, saves
the original script and extracted narration, transcribes, and reconciles the
spoken excerpt against the script. `alignment.json` preserves the observed text,
matched script indices, estimated ASR word intervals, and discrepancies. This
is ASR reconciliation, **not forced alignment** or guaranteed precise phoneme
timing. Listen at important cues and correct measurements if needed. No timing
is synthesized for omitted script words. Existing jobs are never overwritten.

Read `alignment.json` and the actual clip before planning. When the spoken text
differs, follow the recording and record the discrepancy. Reconciliation below
85% exact word matches needs explicit review in `alignment.review` with
`approved: true` and a useful `note` before compilation. This is an agent review
record, not a user approval gate.

## 2. Plan an evolving explanation

Write the job's `BRIEF.md`, `frame.md`, and `STORYBOARD.md` using the owning skill.
Inputs already determine voice and duration; skip the TTS step. The sample task
is autonomous and preserves the first 30 seconds exactly, even if the excerpt
ends mid-thought. Do not rewrite narration to create a new ending.

Write `beats.json` using this shape (all referenced cues must exist in the audio):

```json
{
  "version": 1,
  "scenes": [
    {
      "id": "opening",
      "start": {"boundary": "start"},
      "end": {"boundary": "end"},
      "file": "compositions/opening.html",
      "purpose": "Show the escalating cost of local hardware",
      "beats": [
        {
          "id": "local-machine",
          "cue": {"phrase": "run AI locally", "edge": "start"},
          "duration": 0.8,
          "purpose": "Turn the local-AI idea into a recognizable machine",
          "visual": "Assemble a desktop tower; connect its GPU to the model",
          "targets": ["#opening-tower"],
          "action": "assemble"
        }
      ],
      "holds": []
    }
  ]
}
```

This example illustrates one beat, not a complete production plan. Cue matching
is punctuation/case insensitive and accepts observed text or reconciled script
text. Repeated phrases require `occurrence` (1-based) or explicit `wordId`.
Use `edge: "end"` to resolve against the last word's end, and optional `offset`
to start anticipation before/after speech. An offset over 0.5s is an audit warning.
Scene boundaries accept the same cue objects, or `boundary: start|end`.
Suggested action tags: `assemble`, `reveal`, `connect`, `flow`, `compare`,
`transform`, `emphasize`, `remove`, `camera`, `draw`. Custom action tags are valid;
the audit asks for review when it cannot recognize semantic development.

Choose scene boundaries from ideas, not a fixed duration. A 30-second scene can
contain many spoken developments and several internal framings. Keep subjects
persistent when that makes the relationship clearer; simplify when clutter
grows. Registry primitives and atomic rule recipes supply implementation, not
the explanation. Search the registry before inventing a named effect.

First search the shared local library by visible action using `npm run video --
library-search --query "<action>"`. Inspect promising entries with `library-info`;
freeze selected explicit versions with `library-use --item <id@version> --job
jobs/<slug>`. Follow [the library contract](../library/README.md) for integration.
Search metadata rather than browsing previous jobs. Reuse mechanisms when they
fit; preserve the film's original visual direction.

Holds are optional objects with `start`/`end` cue objects and a concrete `reason`.
Use them for deliberate reading pauses, never to conceal a front-loaded scene.
The audit warns on uncovered action gaps over 4s; it doesn't require constant
movement. Brief entrances aren't evidence of useful visualization.

## 3. Compile and build

```bash
npm run video -- compile --job jobs/example
```

This creates `timing.json` and `assets/cues.js`. Each resolved beat contains
absolute `at`, scene-relative `localAt`, duration, targets, and purpose. The
browser API is `window.VideoCues.scenes['opening'].beats['local-machine']`.
Use `localAt` on the scene's timeline. Keep this file as the only timing source.
Load `assets/cues.js` at the root **before** sub-composition scripts execute.

Set `job.json`'s optional `canvas` hex color to the creative palette's canvas
color; the assembler uses it as the base ground. All scene styling remains yours.
Preparation defaults to landscape and 30fps; `--resolution portrait|square` and
`--fps 24|60` select other supported delivery formats.

Write one HTML sub-composition per scene. IDs must match the plan and the
`window.__timelines` registry. Root-relative stylesheet/script paths and global
variables in scripts must work after assembly; use IIFEs for scene scripts.
Add `data-beat-id="local-machine"` to a semantic target and use the same selector
as `targets`. Shared `assets/motion.js` has deterministic entrance/draw/flow
helpers; use only helpers that suit the selected animation recipes.

```bash
npm run video -- assemble --job jobs/example
npm run video -- audit --job jobs/example
npm run check -- --job jobs/example
```

Assembly writes the root composition with local GSAP, cues, motion helpers,
scene hosts, and the supplied audio. It does not overwrite scene HTML.
Audit validates timing, complete scene coverage, IDs/files/targets, meaningful
developments, and records warnings for gaps/front-loading. It also checks that
scene code references resolved cues. It cannot prove that code uses every cue
correctly: runtime checks and visual/audio review remain necessary.

## 4. Review and deliver

Inspect snapshots at early, middle, and late developments per scene. Add motion
assertions when useful, especially for late reveals. For the assembled project,
put assertions in root `index.motion.json` with global selectors and absolute
cue times; verify that HyperFrames reports motion checks as enabled (this CLI
may skip sidecars that exist only beside a sub-composition). Listen/watch at the named
cue moments. Do not suppress every layout finding at the root.

```bash
npm run dev -- --job jobs/example
npm run render -- --job jobs/example
npm run video -- verify --job jobs/example
```

`render` runs pipeline audit and HyperFrames check before encoding. Final output
is `jobs/example/renders/video.mp4`; `verify` requires a video stream, audible
audio, expected dimensions, and duration within 0.12s of the plan. Leave Studio
running and deliver its project URL, the MP4, and `review/REPORT.md`. Record actual
validation, alignment accuracy limitations, any deliberate holds, and revisions.

For a longer film, repeat the same contract scene by scene. Retain one global
audio clock, resolve phrases to stable word IDs, and rebuild timing/assembly
after timing corrections. Do not regenerate unchanged scene designs.

After creative review, save useful new components, short action sequences, and
assets as candidate bundles in `jobs/<slug>/library-candidates/`. Generalize
content and timing, preserve provenance, include preview/review evidence, and
publish new immutable versions with `library-add --source <bundle-dir>`. Record
contributions in `review/REPORT.md`. The collection grows from actual production;
no fixed reuse quota or preset film structure is required.
