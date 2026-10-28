# Build and render failures

Use `npm run video -- ...` with an explicit job. `build` validates the native manifest, assembles the real
composition, inspects sampled frames/seeking and runs HyperFrames lint. `review-pack` requires a current
successful full build. `render --reuse-build true` requires inspection for every scene and matching hashes.

- Missing/invalid file, cue or asset: fix the named authoring input and rebuild.
- Composition runtime or lint failure: inspect the authored HTML/JavaScript and diagnostic. The pipeline
  root is generated; fix its generator only during software work, not by patching generated job files.
- Browser readiness, missing executable/module, localhost binding or exhausted disk/RAM: fix the actual
  environment issue. Do not redesign scenes to disguise infrastructure failure.
- Stale review/render: rebuild, regenerate evidence and review the changed sources. Do not edit receipts.
- Narration hash changed: prepare timing again from the intended recording. A new recording invalidates
  prior alignment and visual timings.

## Resource tuning

The renderer supports `--workers <positive integer|auto>`. Too many workers can exhaust memory;
reduce concurrency and retain the failed command/log when diagnosing. Use the existing configured render
path; do not upgrade or patch dependencies as a production workaround. Renderer output distinguishes
capture methods and GPU modes. A successful process alone is not verified delivery.

Native inspection uses the installed HyperFrames assembler/player through `lib/native.mjs`. Its pinned
version has no public assembly API, so that integration checks the installed snapshot exports and fails
explicitly when they change. After a renderer version change, run the native build/review integration tests.

If sampled seeking differs at the same timestamp, remove wall-clock/random/callback-driven animation or
supply deterministic states. If images look correct but encoded output does not, inspect actual encoded
frames and audio verification; HTML snapshots do not prove final media correctness.

For news source, speech or caption blockers use [news.md](news.md); for browser capture evidence use
[capture.md](capture.md). Missing inspection capability is a disclosed limitation, not a passing review.
