---
name: reshoot-refresh
description: Update an existing reshoot demo after an app or release changes. Use when a saved storyboard, video, or README clip needs recording again.
---

# Refresh a demo

The owner may shape the demo in the studio, which saves to the project files:
read them again before editing. Its comparison and downloads show the run on
its page, which may not be the newest. Its undo history lives in the ignored
`takes/studio/`. Do not start the studio or click its buttons, and never take a
studio session, comparison or download as the owner accepting a run. The
studio can't see a remote app or an undeclared dependency: after those change,
record a fresh preview.

Keep optional `[tour]` and `[[tour.step]]` selections with the demo source.
`reshoot tour create --title 'Explore the demo' --project demo` starts from checked
beats; `tour set STEP` edits title, text, alt and optional `--x`/`--y` marker
percentages. `tour move STEP --to POSITION`, `add --take 1 --beat BEAT`, `remove
STEP` and `disable` share studio edits. Numbers start at 1; each takes `--project`.
Update preview/re-cut reuses checked frames; a fresh recording refreshes them.
Local export includes the self-contained `tours/NAME.html` by default. Add that
path to an explicit `--file` list. Review every step and marker offline, the
scanned words/images and the comparison; a successful run never accepts it.

Keep `[[screenshot]]` selections in `reshoot.toml` beside the video settings.
Their named PNGs come from checked TOML browser result frames, not a fresh
unverified capture. `reshoot screenshot set NAME --beat BEAT --alt 'Visible result'
--project demo` selects one; optional `--width 960` downsizes and `--crop LEFT TOP
WIDTH HEIGHT` uses fractions inside the captured viewport. Update preview or
re-cut to render settings; a fresh recording refreshes pixels. Keep every result
check. `reshoot export RUN --directory docs/demo --replace --record demo/accepted
--markdown media.md` includes PNGs and alt text by default. An explicit `--file`
list must include `screenshots/NAME.png`. Inspect image and alt text in the same
review as the videos. Comparison reports screenshot changes; old copied files
are not deleted when a selection is removed. Nothing is published by these commands.

For combined web and VHS edits, keep take dimensions matched. Mixed previews retain the configured browser dimensions to match the unchanged VHS output size.

Requires reshoot CLI 0.3.9 or newer. Run `reshoot --version`; if it is older, or `reshoot doctor` says a newer release is out, upgrade with `uv tool install --upgrade 'reshoot[browser]'` before going on. For a versioned browser/VHS project, read its brief, config, storyboard and previous run before changing anything, then run `reshoot doctor --config CONFIG`. Use `reshoot runs PROJECT` to list runs; a run path ending in `accepted` or `latest` resolves to the newest accepted or successful run. Record the exact ID of the run you compare against, since aliases move as new runs finish. When there is no `demo/accepted`, compare against the newest final run in `reshoot runs`, and tell the owner it was never accepted.

For a standalone native recording, read the brief, capture/edit scripts and exact previous media instead of expecting a versioned config or run report. Look up the current demo window ID, reset synthetic data, and use `reshoot window APP NEW_TAKE.mov --id ID -s SECONDS` with app-specific automation or coordinated manual interaction. Keep test and fresh final takes in new folders; edit and scan final exports. Compare the old/new MP4s and animated GIFs manually. Disclose that browser result checks, versioned `preview`/`run`, and automated beat comparison do not apply. Follow the versioned flow below only for browser/VHS projects.

Reset the made-up demo data and record the current app using `reshoot preview CONFIG`. Retain stable beat names. Diagnose failures using the beat, the failure image, and the result check. A selector repair should still perform the same task; it must not delete a failed result check or replace the intended result with whatever the app happens to show.

For a missing control, read the failed run with `reshoot repair RUN`. The failure says in words what is missing. A replacement is suggested when the recorder's fallbacks agree on one visible, compatible element, or when one control matches what the missing one was in the last good run: the same link, id or place. Within authorization for local fixes, `reshoot repair RUN --apply` starts the configured demo app, replays the prefix, rechecks the current suggestion and changes only the locator. It refuses changed source or settings and preserves expected values. Run a fresh preview afterwards. The studio also shows the failure frame and offers a suggested or visual repair; `reshoot repair RUN --pick` lets the owner select and confirm the replacement without activating it. The picker waits for interaction, so do not launch it unattended. Use only resettable synthetic data. Count mismatches and wrong result values need their real cause fixed, not a locator substituted to make a check pass.

When authorized to make local fixes, update the smallest necessary part, then rerun the affected flow. Use a full fresh `reshoot run CONFIG` for the final take. Keep the previous run. Read the report for execution errors, scan coverage, and pending human review.

A failed or missing browser take leaves the result checks unverified unless one explicitly failed. Earlier passed result checks do not establish the result of an incomplete flow.

Compare the previous and new runs by beat with `reshoot compare` and inspect the actual frames. For a native capture, which has no run, show the old and new recordings and say that comparison is manual. A successful run must not silently replace the accepted run or inherit its acceptance.

Use only made-up data and page, terminal, or single-window capture. Call out changes to the story's claim, fixture meaning, speed, or narration. Present the new files and unresolved items. The new run needs its own verdict: give the owner its `reshoot accept RUN` command, and do not run it without their explicit instruction. Publishing and repository changes follow the owner's existing authorization.
