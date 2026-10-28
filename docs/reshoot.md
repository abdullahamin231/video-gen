# Browser recording with reshoot

Use this when the video demonstrates or reviews an application. Explore and test the actual app; write
narration from observed results. Use a clean workspace and demo data, preserving the build/version,
viewport, account capabilities, important failure states and limits of the test.

Reshoot records browser tasks in headless Chromium and composites a cursor into the clean recording.
Native desktop windows and OS dialogs are outside this browser recorder. Report that boundary instead
of fabricating the surface. Do not capture unrelated private data or uncleared commercial media.

## Recording

Use the installed `reshoot --help` and its `run` help for the current capture syntax. Keep the recording
project and run folders inside the repository. A storyboard describes real browser actions and result
checks; use scoped selectors and verify the actual result rather than a loose text match. Trial runs can
help locate controls; the ingested run must contain the claimed task, not just the final screenshot.

`reshoot run` writes a run folder with a clean take, action log, checks and recording metadata. Use the
specific run directory, not a moving `latest` pointer. The clean take contains the cursor and is the
source used here; a caption-burned demo export is not the source recording.

```bash
npm run video -- capture-ingest --job jobs/scripts/<slug> --run <repository run folder> --task <id>
```

Ingest copies the supported evidence into the pipeline contract. Failed result checks remain evidence;
report them rather than describing a successful flow. The source log may not include every typing or
keypress event, so do not infer coverage beyond what the recorder actually retained.

Use [capture.md](capture.md) for source ranges, native cut generation, omission evidence and review.
The agent owns any additional graphics and camera moves. No third-party reshoot skill installation is
required by this repository.

## Operational limits

Headless capture works without a display server. Privacy scans require their configured local OCR tools;
without those tools, do not claim a scan was performed. Ambiguous selectors and failed checks can require
a new take. Keep source runs intact so the film's claims and derived cuts remain auditable.
