# App-review review

Every product claim must match an actual observed result. Verify feature coverage, version/account limitations, successful and failed tasks, source-to-film cuts, cursor/target alignment, legible UI and privacy. Reject fabricated UI, staged results portrayed as tests, duplicate cursors, hidden material failures or claims of native coverage based on browser-only access.

Check the evidence directly: `capture/<task>/manifest.json` names the build, viewport and file hashes; `actions.jsonl` holds each action with its observed result; `edits.json` says which narration moment each cut serves. A cut whose click does not line up with the pointer, a failed `assert` that vanished from the film without being acknowledged, or a claim that only exists in the narration is a rejection. `app-capture`'s compiled scene must be edited, not regenerated, when a framing or callout is wrong.

Use the technical evidence/report/independence contracts in docs/independent-review.md. Require screenshots/recordings plus action/result records, not a transcript-only review. The creative standard is a clear hands-on demonstration, not an animated scientific mechanism. Keep the person's checkpoints.
