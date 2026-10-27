---
name: reshoot-demo
description: Create a repeatable software demo with reshoot from an app and demo data. Use for product demos, release videos, README clips, and launch recordings.
---

# Create a demo

## Set up

Requires reshoot CLI 0.3.9 or newer. Run `reshoot --version`. If it is older, or `reshoot doctor` says a newer release is out, upgrade with `uv tool install --upgrade 'reshoot[browser]'`. If the CLI is missing, use the repository's documented installation; do not invent commands for another version.

Run `reshoot doctor --config CONFIG --probe` for a project. It tests encoding, a TOML browser capture and the configured text scan on temporary synthetic data; it does not test the app, face detection or final media. Fix what it reports instead of turning scans off. If `RESHOOT_CHROME` is set, it must name an executable browser. Restart reshoot after changing shell settings or its Python environment.

## Choose the story

Identify the target: app source, a running web URL, or an installed macOS app. Source is optional: inspect code and demo fixtures when you have them, otherwise the page or window itself. Choose one useful task with a visible result, an audience and a destination. Ask only for missing details that change the story.

Use made-up data in a separate account, folder or database. Document its reset and run it before each take. When an app keeps data and has no reset, ask for one, or check the item the take created rather than totals earlier takes change. Log in with an isolated demo account in a fresh profile.

Record only a headless browser page, a VHS terminal, or one macOS window by ID. Never capture the whole screen or reuse a person's browser profile.

## Write a browser project

1. `reshoot init DIR --url DEMO_URL` writes the project; without `--url` it writes the notes example. An external URL has no managed server unless you add `[app]`. The files are in the project, not in this skill folder.
2. Fill in `BRIEF.md`.
3. Replace the placeholder storyboard with real actions and result checks, keeping an `end` beat if the edit uses it. Read the DOM, or run `reshoot rec URL DRAFT.toml` when there is no source. A recorder draft marks suggested checks `# suggested`: keep the ones that show the result, delete the rest, then add captions, purposes and clear beat IDs.
4. Read `reshoot web --help` for storyboard settings and `reshoot run --help` for the configuration.

If the owner wants to show the task themselves, offer `reshoot create URL --directory demo`. It records in a browser with a toolbar, makes a preview and opens the studio. It waits for a person, so do not start it during an autonomous recording. `reshoot create --resume --directory demo` continues one after setup is fixed; do not give it another URL or size. If the storyboard changed while the owner was recording, keep both versions and compare them; never overwrite those changes. Repair any `recording_issue` step it leaves; never delete one to make a recording pass.

For combined web and VHS edits, give both takes the same dimensions.

## Write a native macOS project

Save a brief, a capture recipe and an edit script in a demo folder. `reshoot window --list` finds the exact demo window; `reshoot window APP NEW_TAKE.mov --id ID -s SECONDS` records it. Check Screen Recording permission for the command's host. The window command does not operate controls: drive the app with app-specific automation or the owner's hands. Look up the ID each take and use new output paths. Versioned projects support web and VHS only, so do not invent a run manifest, overlay or result checks. Export with `reshoot edit EDIT.toml NEW_TAKE.mov`, using numeric cuts and a GIF export profile, or a Python edit. This route needs no supporting plugin skills.

## Make it readable

- Keep captions short and explain the result, not the click. Leave time to read.
- Judge text in the README GIF, usually 800 px wide. When the content is a narrow column in a 1280x720 frame, set a narrower `size`, such as `"960x540"`, or `zoom = true`. A narrower viewport enlarges text; a higher pixel ratio does not.
- For a dropdown, use a `select` action with the option's visible label.
- TOML captions are drawn after recording, so `reshoot recut RUN` can change their words and look. Python captions are drawn in the page.
- Say when a response is mocked or a wait was shortened. Do not change the product claim to make a recording finish.

## Record and check

For browser and VHS projects, run `reshoot preview CONFIG`, inspect its frames and result checks, then record the final with `reshoot run CONFIG`. Read `run.json` for detail. For a native app, inspect a test take, then capture and edit a fresh final in a new folder, and make check sheets with `reshoot check SOURCES --full --review NEW_REVIEW_DIR`.

Inspect the actual outputs. A run that completes has not passed its scan or been reviewed. Fix failing inputs and actions rather than weakening a check. If the owner wants a quicker refresh, follow the guide's `speed.md` and say which checks you reduced. Always read agent-written terminal text.

## Hand off

End the same way each time:

1. One sentence on the task and its result.
2. The MP4, GIF and review page paths, opened when possible, and the run's status line.
3. Anything the owner must look at: flagged items, reduced checks, mocked data.
4. "Reply accept, or ask for changes such as:" with two or three that fit, such as shorter captions, a longer hold on the result or a narrower viewport for GIF text.
5. The `reshoot accept` command the run printed. Mention `reshoot review RUN --serve` for deciding on a page and `reshoot studio DIR` for shaping the demo by pointing. Both wait for the owner: do not start them or click their buttons.

Changes the owner makes in the studio are saved to the storyboard, `edit.toml` and `reshoot.toml`; read the files again before editing them. Run `reshoot accept RUN --yes` only when the owner replies accept or explicitly asks. Then offer `reshoot export demo/accepted --directory docs/demo` and the README Markdown it prints.

## Stay in bounds

Commit, push or publish only within the owner's existing authorization; creating local files is not publishing. Keep changes in the demo folder. Do not edit the app's README, `.gitignore` or other files unless asked: offer the Markdown that would add the GIF instead.
