# Recorded browser media

Use actual recordings for app reviews. `capture-ingest` reads a reshoot run, verifies its metadata and
composited cursor, and retains recording.mp4, actions.jsonl, manifest.json and stills inside the project.
A screenshot sequence is not evidence of an interaction. See [reshoot.md](reshoot.md) for recording.

```bash
npm run video -- capture-ingest --job jobs/scripts/<slug> --run <repository run folder> --task <task-id>
```

The app session precedes its script. Use the recording and action log to distinguish tested behavior,
failures, unavailable features and inference. Source recordings remain unchanged; cuts are derived copies.
Preparation carries captures from the script project into the film job.

## Native cut adapter

An agent can author native media directly, or use `capture-scene` to produce authenticated cuts and a
native HTML scene. Create the scene in film.json and write `capture/<task>/edits.json`:

```json
{
  "scene":"filters",
  "edits":[
    {"id":"open-dialog","phrase":"the exact narration words","source":[0.4,2.0],
     "feature":"filters","result":"the new-filter dialog opens"}
  ],
  "omissions":[]
}
```

`source` is seconds in the original recording. Phrase, optional occurrence and offset resolve against
measured narration. Cuts need a meaningful recorded interaction. Preserve complete typing/wait sequences;
cutting their middle misrepresents what occurred. Keep important failures in the account.

```bash
npm run video -- capture-scene --job jobs/<slug> --capture capture/<task> --scene filters
```

The adapter writes local video cuts, `compositions/filters.html`, a `.capture.json` evidence sidecar and
the corresponding native scene entry in film.json. It holds the last genuine frame when a shorter cut
needs to remain visible. The recorded cursor is already composited; the adapter adds no synthetic pointer,
preset rings or camera vocabulary. Agents may author graphics and reframing in the HTML.

## Omitted interactions

Meaningful logged actions outside all source cuts need evidence-bound explanations:

```json
{"actionIndex":3,"reason":"Why this omission does not misrepresent the account",
 "evidence":[{"kind":"action-log","path":"actions.jsonl","sha256":"<current hash>","actionIndex":3}]}
```

The adapter validates source/log hashes and writes scene-bound omissions.json under an OS lock. Review
checks the current log, cuts and omission evidence. An omitted action did not occur on screen; narration
must not imply otherwise. Recompile affected scenes when their evidence changes.

Encoded capture verification compares supported footprints against source frames. Transformed or ambiguous
footprints require independent paired-frame inspection through `capture-visibility` and the generated
review assignment. Pixel checks cannot establish the truth of a product claim; the reviewer must inspect
the real session. Do not claim coverage or listening that the available evidence does not support.
