# Workflow repairs and verification

Implemented after the audit, at the user's request. The previous draft remains preserved; replacement production is in
`jobs/local-ai-cost-rebuild`, using the same first 30 seconds and measured word timings.

| Failure | Change | Verification |
|---|---|---|
| Prototype missing its introduction | Build scenes in order through the prototype; defer later scenes | `next` regression test; actual replacement job dispatched `local-intent` before `price-reveal` |
| Camera pan counted as development | Measure object bounds in world coordinates; exclude camera changes | Real Chrome regression: static circles now have `[0,0,0,0]` activity and a 6-second stillness error |
| Arbitrary activity quota encouraged filler | Low element counts are advisory; unexplained stillness remains an error | Same browser test; brief and quality contract updated |
| Transcript-only visual approval | Require explicit visual capability and inspected frozen image/video paths | Validator rejects unavailable visual input; templates leave capability and coverage unclaimed |
| Blind pass anchored by source log | Image-only first pass, diagnostics afterward, observations retained per pack | Reviewer brief generation updated |
| Repairs trapped with builders | Plan-scoped/repeated visual failures return to director; boundary findings can name an earlier owner | New state-machine regression tests |
| Repeated next calls consumed rounds | Count each failed pack once | Two calls stay in repair, consume one round and preserve source hash |
| Administrative counters invalidated renders | Exclude review progress from production fingerprints | Original audit probe now has identical before/after fingerprints |
| Complete status bypassed qualification | Requalify delivery evidence before reporting done | Bare complete fixture no longer returns done |
| Future visible objects leaked into opening | Initial visibility is scheduled at the owning scene start | Compiler regression test |
| Partial film could reach final pack preparation | Reject missing scenes at final-pack and delivery gates | Regression test rejects missing final scene |
| Audio policy contradicted docs | Document gain-fitted comparison and its limitations | Existing audio integrity tests remain passing |
| Dashed outlines stalled the encoder at frame 730 | Switch dash patterns discretely; translate `setNow` SVG attributes correctly | Browser regression and exact 24.32–24.50 s snapshots pass; full re-encode required |
| Harmless cue syntax consumed builder repair iterations | Accept leading-dot offsets such as `cue+.2` | Scene-spec compilation test |

`npm test`: **50 passed, 0 failed, 0 skipped**, including eight new film workflow tests and strengthened existing review tests.
`git diff --check` passes. [after-fixes.json](after-fixes.json) retains reruns of the original isolated probes.

These checks establish repairs to the demonstrated workflow failures. A new render still requires actual independent
prototype/final reviews; passing tests is not evidence of creative quality, listening, or normal-speed playback inspection.
