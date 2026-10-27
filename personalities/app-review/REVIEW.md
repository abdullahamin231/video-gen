# App-review review

Every product claim must match an actual observed result. Verify feature coverage, version/account limitations, successful and failed tasks, source-to-film cuts, cursor/target alignment, legible UI and privacy. Reject fabricated UI, staged results portrayed as tests, duplicate cursors, hidden material failures or claims of native coverage based on browser-only access.

Check the evidence directly: `capture/<task>/manifest.json` names the build, viewport and file hashes; `actions.jsonl` holds each action with its observed result; `edits.json` says which narration moment each cut serves. A cut whose click ring does not land on the recorded control, a failed result check that vanished from the film without being acknowledged, or a claim that only exists in the narration is a rejection. The compiled scene must be edited, not regenerated, when a framing or callout is wrong. `recorder.pointer` is always `composited`: a second cursor over the footage is a duplicate pointer, and the log's silence about typing means no keystroke may be described that it does not carry.

Use the technical evidence/report/independence contracts in docs/independent-review.md. Require screenshots/recordings plus action/result records, not a transcript-only review. The creative standard is a clear hands-on demonstration, not an animated scientific mechanism. Keep the person's checkpoints.

For final review, inspect the encoded MP4 clips at normal speed whenever playback is technically available. Stills and
contact sheets do not establish that the captured app remained visible or that typing, scrolling, loading and result
transitions played continuously. When only frame inspection is available, record that limitation and do not claim
motion verification. Do not claim to have listened to narration or other audio unless you actually did; attached audio,
waveforms and signal measurements are not listening evidence.
