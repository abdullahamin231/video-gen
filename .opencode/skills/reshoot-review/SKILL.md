---
name: reshoot-review
description: Inspect a reshoot recording and its check report for failed actions, privacy findings, coverage gaps, and readability before sharing.
---

# Review a recording

When the owner uses the studio, its Compare section shows the checked result
frames of the run on the page beside an earlier run, step by step, and its
Review and Download sections refer to that run too. The frames are the
recorded pages, without captions, zoom, framing, cards or cuts: inspect the
actual exports as well. A matching file hash, a comparison or a downloaded ZIP
is not the owner's acceptance. The studio accepts only once every saved change
is in the run.

For `tours.json`, open the actual `tours/NAME.html` and inspect every step,
explanation, alt description and click marker. Next/Back, step numbers and
arrow/Home/End keys navigate captured screens; they do not perform live app
actions. The HTML embeds its images and works offline. Check the source-image
scan and direct title/explanation/alt scan when enabled, and compare the prior
walkthrough.
Inspect marker placement and crops after layout changes. GitHub shows HTML
source, so download and open it locally for interactive review. No tour is
accepted or hosted by exporting it.

Requires reshoot CLI 0.3.9 or newer. Run `reshoot --version`; if it is older, or `reshoot doctor` says a newer release is out, upgrade with `uv tool install --upgrade 'reshoot[browser]'` before going on. Read the project's brief and, for a versioned project, its current run report. Confirm which run produced the files, and distinguish execution, result checks, automatic scanning and human review.

For standalone native media, read its capture/edit recipe and exact source/export paths instead of requiring or inventing a run report. Compare old and new recordings manually and identify the result visually; do not claim browser result checks or automated beat comparison. Use a video player and check sheets rather than `reshoot review RUN`, which requires a versioned run manifest. Preserve existing reviews; generate any new scan in a separate directory.

Use `reshoot check SOURCES --review REVIEW_DIR` to generate a check report and sheets. Include final exports as well as available source images. Use `--full` for final exports when feasible. The default video scan samples every three seconds and can miss brief content. Read the reported coverage and unavailable detectors. A clean scan does not prove a recording contains no private content.

Check exits 0 for accepted supplied items, 1 for human review pending, and 2 for an error. Missing or unreadable sources must be fixed before accepting the review. `--no-scan` explicitly skips detectors; it is not a scan pass.

Inspect sheets and original frames, then watch the final video, with sound when present. Check the stated result, text size, caption wrapping, timing, audio, end card, and any mock or speed labels. Use only made-up data. Fail private names, accounts, files, tokens, or unintended people shown in the recording.

For runs with `screenshots.json`, inspect every named documentation PNG at image
size and read its alt text. The manifest binds the image, source result frame and
take metadata; PNGs join the run's check sources, and alt text is scanned directly
when detection is enabled. These are page viewport frames, with privacy masks
and possibly the cursor, without video captions, zoom or framing. A passing beat
does not certify a crop or description. Compare changed images as well as videos;
PNG/alt decisions belong to this exact run and do not inherit acceptance.

For runs with `.readability.json`, use `reshoot frame check RUN` and the studio's
Inspect at viewing size to inspect measured font sizes, crop clipping and
subtitle reading time at the intended browser width. The review page also
shows these hints. They describe the rendered run, not unsaved settings,
and never replace human review or establish accessibility. Missing app samples,
camera zoom, canvas/iframe text and custom placement need visual inspection.
Recommend a narrower recording view only when it helps the intended export;
that requires a fresh capture with the existing task and result checks.

For a versioned run, use the local page from `reshoot review RUN` to inspect timestamps and comparisons. For a native capture, which has no run, use the sheets and a video player, and say so.
Previous and current GIFs display as images in the comparison page; inspect their
animation and loop as well as the MP4 playback.

The owner decides whether a recording is accepted. For a versioned run, give the owner the exact command: `reshoot accept RUN`, plus `--flagged F1` for each finding they must inspect, or `--reject F1` for one that fails. A finding, such as F1, covers every frame the same text was found in. The owner can also run `reshoot review RUN --serve` or `reshoot studio DIR` and decide on the page; these wait for them, so do not start them and do not click their buttons yourself. Do not run `accept`, `check --ok` or an import, pass `--yes`, or change the accepted run merely because your inspection found nothing. Carry out those actions only when the owner explicitly authorizes the decision. Give the owner the files, evidence, and unresolved findings; do not publish without authorization.

`check --text-file FINAL.srt` scans exact caption text. Runs also check generated
subtitle and narration sidecars. Inspect text findings at their recorded cue times.
