# Attention Is All You Need — render recovery log

Date: 2026-10-17. Requested output: all 70 scenes, 1920×1080, 30 fps, 997.806 seconds. The user explicitly requested rendering without independent reviews and authorized continuing without further permission questions.

## Confirmed issues and remedies

### 1. Node exhausted its default JavaScript heap

- Evidence recovered from the Claude conversation and `/tmp/claude-1000/fullbuild3.log`: `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`. Garbage collection was operating around 2,033 MB.
- Claude had successfully used a 4 GB heap for one build, but its subsequent full-build command omitted that environment setting and crashed again.
- Remedy: apply `NODE_OPTIONS=--max-old-space-size=4096` to every render invocation, including inherited child processes.
- Confirmed result: the complete 70-scene build finished with **0 errors and 88 warnings**, twice during this recovery. Its process exceeded the previous 2 GB limit without crashing.

### 2. Previous attempts left orphaned headless browsers

- Several failed or interrupted builds left Chromium processes running after their Node parent exited. They consumed CPU and memory while later attempts started more browsers.
- The initial investigation used a sandbox process listing, which showed only processes in that sandbox. It incorrectly inferred that the build process had disappeared.
- Remedy: inspect the host process table, identify the specific orphaned automation browsers, and send those browser parents `SIGTERM`. No general browser kill was used.
- Confirmed result: the competing browsers were removed before restarting the full render. A browser orphaned by the later cancelled screenshot capture was also stopped.

### 3. `beats.json` was incorrectly diagnosed as a blocker

- Running the standalone `compile` command returned `ENOENT` for the job's missing `beats.json`.
- `docs/agent-workflow.md` explains that `compile` belongs to the legacy `beats.json` workflow. This job uses `film.json` and `build`; it does not require that legacy file.
- Remedy: return to the film workflow and use `npm run video -- render --job jobs/attention-is-all-you-need`. No fabricated beat grid was created.
- Confirmed result: the film built successfully without `beats.json`. The earlier claim that its absence was the root cause was incorrect.

### 4. HyperFrames commands were confused with pipeline commands

- `npm run video -- doctor` and `npm run video -- beats` returned `Unknown command`.
- Those are HyperFrames CLI operations, not exposed commands of this repository's video wrapper. The repository prohibits invoking HyperFrames directly for this job.
- Remedy: use the repository wrapper's supported commands and its workflow documentation. No dependency upgrade or change to `node_modules` was made.
- `setup-audio` succeeded and confirmed ffmpeg and librosa were ready; it did not resolve the render failure because audio setup was not its cause.

### 5. The sandbox blocked Chromium startup

- The first render with the increased heap reached browser startup and failed with `setsockopt: Operation not permitted (1)` from Chromium's crash handler.
- Remedy: run the same video render outside the filesystem/process sandbox, retaining the 4 GB Node heap setting.
- Confirmed result: Chromium launched and the full browser build completed with zero errors.

### 6. Automatic low-memory mode selected a slow capture path

- The installed renderer automatically enabled its low-memory profile on this machine. That profile forces screenshot capture and one worker.
- The first capture used `screenshot` on software graphics. A partial-file measurement found only 341 encoded frames (11.4 seconds of picture) at that checkpoint, so capture was making progress but slowly.
- Remedy: cancel that early capture and use the installed renderer's supported environment settings without editing source or dependency files:

```bash
env NODE_OPTIONS=--max-old-space-size=4096 \
  PRODUCER_LOW_MEMORY_MODE=false \
  PRODUCER_FORCE_SCREENSHOT=false \
  PRODUCER_MAX_WORKERS=3 \
  HF_STATIC_DEDUP=false \
  npm run video -- render --quality delivery --job jobs/attention-is-all-you-need
```

- `HF_STATIC_DEDUP=false` disables an optional optimization scan; it does not remove animation or frames.
- Confirmed result: the restarted renderer logged `beginframe`, loaded the complete composition, and began encoding.
- Important limitation: `PRODUCER_MAX_WORKERS=3` is a maximum, not a forced worker count. Calibration measured slow random-seek captures (`p95Ms: 7282`, multiplier 8), and the renderer reduced its automatic count to **one worker**. The capture-path fix is confirmed; a parallel-speedup is not.

### 7. Timing repairs inherited from Claude

- Claude's successful full build found eight overlapping-action errors: one in `history`, six in `transpose`, and one in `residual`.
- Its builders repaired these before this recovery: history selector timing; transpose row drop/move durations and score gather timing; residual cue occurrence so the packet/indicate follows the intended spoken occurrence.
- This recovery preserved those authored files. The subsequent complete build's zero-error result confirms the reported overlap errors are cleared.

## Composition completeness and remaining findings

- All 70 planned scene files exist.
- Generated `timing.json` and `assets/world.json` both contain 70 scenes; the compiled missing-scene list is empty.
- The compiled world contains 2,092 objects, 2,529 actions, and 181 sound cues.
- The 88 build warnings include text overlaps, small labels, still intervals, frame use, ambiguous cue occurrences, sound levels relative to narration, and moves without sound effects. They were not treated as independently reviewed or repaired in this render-only request.
- The supplied narration was preserved. No replacement TTS was generated.
- No independent review agents, review packs, review submission, or delivery qualification were commissioned during this render-only request.

### 8. The wrapper always rebuilt and did not forward worker selection

- The film render command unconditionally reran the full browser build, even when its successful receipt and source fingerprint were current. Each capture retry therefore repeated roughly ten minutes of preparation.
- Its HyperFrames invocation also omitted `--workers`, so automatic calibration could reduce the maximum of three workers back to one.
- Remedy: add optional `--reuse-build true` and `--workers 3` support to `scripts/video.mjs` and `lib/film.mjs`. Defaults are unchanged. Reuse requires a successful, current, full browser build with no errors or missing scenes and an inspection record for every compiled scene. A stale or partial build is rejected. Worker values are validated and passed through to HyperFrames.
- Validation: both changed JavaScript files passed `node --check`. Focused regression checks in `tests/render-reuse.test.mjs` passed for invalid worker counts and failed, partial, missing-inspection, and stale build receipts. The real render accepted the preserved receipt and printed `Reusing current successful build: 70 scenes, 0 errors.`
- The wrapper requires a value for every option. An initial bare `--reuse-build` was rejected before doing work; the working spelling is `--reuse-build true`.

Current invocation:

```bash
env NODE_OPTIONS=--max-old-space-size=4096 \
  PRODUCER_LOW_MEMORY_MODE=false \
  PRODUCER_FORCE_SCREENSHOT=false \
  PRODUCER_MAX_WORKERS=3 \
  HF_STATIC_DEDUP=false \
  npm run video -- render --quality delivery \
    --reuse-build true --workers 3 --job jobs/attention-is-all-you-need
```

### 9. Progress was hard to observe

- The wrapper passes `--quiet` to HyperFrames, so successful capture can produce no console output for minutes. Silence alone did not establish that it was hung.
- A diagnostic attempt to read a browser timeline through its debugging endpoint failed while extracting its temporary-profile argument. This was a read-only diagnostic failure; it did not affect the render.
- Remedy: monitor the actual encoding processes and count completed H.264 picture units in the growing temporary MP4. Report these as encoded picture frames, not as a claim that audio mixing or the final MP4 is complete.

### 10. A scene-scoped build was not a full-film checkpoint

- Early recovery attempts included `build --scene route`. That checks the opening scene and records `scope: route`, even though compilation contains all scenes. It does not satisfy the full-film build freshness check used by `next`.
- Remedy: complete the all-scene browser build. The subsequent receipt has `scope: all`, no missing scenes, zero errors, and inspection data for every scene. The new reuse option requires this full checkpoint.

### Execution authorization

The user granted full permission to continue and asked not to be interrupted by permission questions. Subsequent work continued using the authorized execution paths. The host's browser restriction required execution outside the sandbox; that requirement was not a creative approval or review step.

### 11. Final soundtrack could not reach the loudness target within its peak ceiling

- The completed MP4 measured **−25.7 LUFS integrated**, **−4.3 dB true peak**, and **−4.3 dB sample peak**. The requested pipeline target is −16 LUFS with peaks at or below −4 dB.
- The mixer reported that gain was limited by the peak ceiling. Peak compliance passed; the integrated loudness target was not reached. This is a remaining limitation, not a fixed or independently approved result.
- The authored soundtrack retains 181 sound cues and no music. The automatic signal analysis also reports 12 local risks of effects masking narration, at 572.93, 657.67, 697.03, 702.80, 703.52, 704.36, 706.50, 709.11, 710.51, 801.99, 828.29, and 880.11 seconds. These are measurements, not listening judgments.
- No additional narration processing or creative sound revision was introduced to force the loudness target. The user requested the existing film rendered without reviews.
- MP4-versus-reference-mix waveform verification passed (correlation 0.999948; normalized error 0.010151). This is a heuristic decoded-waveform comparison, not listening or proof of intelligibility.

## Render status

**Completed successfully.** The render command exited with code 0 and reported `0 pixel-check error(s)`.

- Final MP4: `jobs/attention-is-all-you-need/renders/video.mp4`.
- All **70 scenes**, with no missing scene files or compiled scenes.
- **29,935 video frames**, **997.833333 seconds** (16:37.8), **1920×1080**, **30 fps**.
- H.264 video, `yuv420p`, AAC audio; **63,556,514 bytes**.
- SHA-256: `8b33b822d725a3dd1aacda727693a8c05f3e61c3f80cd9b020c5cea7b9cee543`.
- Pipeline media verification passed; encoded-picture checks reported zero errors, and the current render source receipt was written.
- The final run reused the verified full build and successfully used all three explicitly requested BeginFrame capture workers.
- Automatic cue sheets and signal checks were generated by the render command. Independent reviews, review packs, and delivery qualification were skipped as requested. The pipeline's `draft-rendered` status is expected for this render-only handoff; this log does not claim independent review approval.
- Sound measurements and remaining advisory findings are recorded above. No listening judgment was made.

This log lives outside the job directory because the pipeline fingerprints every non-excluded job file. Adding or updating notes inside the job during rendering would make its source receipt stale. The log was moved here before completion to preserve the original job fingerprint.
