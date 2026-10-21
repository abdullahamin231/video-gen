# Local video workspace

Start with `npm run ui`, then open http://127.0.0.1:4310. By default the server binds to loopback only. Use `npm run ui -- --port 4311` to choose another port. No new application dependencies are needed.

## Running on a server (phone or laptop access)

On the server, sign in to the agent CLI you will use (`claude`, `codex`, `opencode` or `pi`), install Node 22+, FFmpeg,
uv and (recommended) [Tailscale](https://tailscale.com/download/linux), then run:

```bash
scripts/server-setup.sh tailscale   # HTTPS at https://<server>.<tailnet>.ts.net, reachable only from your own devices
scripts/server-setup.sh lan         # http://<server-ip>:4310 on every interface; use only on a network you trust
```

It installs dependencies, writes `VG_UI_HOST`, `VG_UI_PASSWORD` (generated) and `PORT` to the ignored `.env`, installs
and starts a systemd user service (`video-gen-ui`, restarted on failure, kept running after logout), and for Tailscale
runs `tailscale serve --bg 4310`. It prints the address and password. Install Tailscale on the phone and laptop, sign in
to the same tailnet, open the address and sign in once per device (the session lasts 30 days).

| Variable / flag | Default | Effect |
|---|---|---|
| `VG_UI_HOST` / `--host` | `127.0.0.1` | Address to listen on. Anything but loopback requires a password. |
| `VG_UI_PASSWORD` | unset | At least 12 characters. When set, every page and API call needs a sign-in, whatever the Host header says, and the loopback-only Host check is lifted so a proxy or network name works. Changing it signs out every device. Removed from the environment before agents start. |
| `PORT` / `--port` | `4310` | Port. |

The server reads these from `.env` in the repository if present. Five wrong passwords from one address lock it out for
15 minutes. Cross-origin writes are still refused. Agents call the server back over loopback. Never expose the port
directly to the internet: whoever signs in can run agents with this machine's accounts and files. In LAN mode the
password crosses the network unencrypted; Tailscale (or another HTTPS proxy) avoids that.

Manage the service with `systemctl --user status|restart|stop video-gen-ui` and read logs with
`journalctl --user -u video-gen-ui -f`. Restarting it interrupts running jobs; **Continue** resumes them.

The sidebar contains threads and New video. Each new thread starts a real CLI orchestrator, using the existing Codex, Claude Code, OpenCode or Pi installation and account. Model IDs are passed as arguments, never shell-interpolated. Codex suggestions come from its installed model cache; Claude's suggestions are CLI aliases. OpenCode accepts its provider/model IDs; Pi's suggestions come from `pi --list-models`. Pi takes MCP servers only from config files or extensions, so the runner loads `backend/pi-extension.mjs` with `-e` to register its bridge for each session, leaving `~/.pi` untouched. Pi roles get the instructions and model pins from `.claude/agents/`; a pin such as `opus` is passed as `anthropic/opus`, which Pi resolves to the newest Anthropic opus, so Pi needs an Anthropic login for pinned roles. Authentication, model availability, and provider policy errors appear in the thread and event log.

Give a high-level prompt. Name a length in it (“a 3-minute explainer”, “90 seconds”) only if you want one; otherwise the script writer chooses a length that fits the topic and records why, and the script reviewer checks that choice. Optionally upload a script or recording (250 MB maximum each), or provide repository-relative paths. Choose Kokoro (local, the default) or Gemini for narration. Gemini uses the server’s `GEMINI_API_KEY` from its environment or ignored `.env`; see [TTS setup](../docs/tts.md). If Gemini reaches its usage limit, the whole narration is regenerated with Kokoro and a persistent notice appears in the conversation and Progress. Without a recording, the orchestrator follows that selected narration workflow. A supplied recording stays unchanged. The high-level prompt drives research, independently reviewed script, narration, the existing `npm run video -- next` loop, and a separately reviewed thumbnail.

## Ideas

**Ideas** in the sidebar shows video ideas found by `npm run video -- ideas` (the same code). Each search reads Hugging Face trending models and daily papers, r/LocalLLaMA's top posts (RSS, because Reddit's JSON API now needs OAuth), Hacker News, new GitHub repositories and the outlier videos of reference channels (views ÷ the channel's median, 2× or more). It groups items about the same model or repository, scores them on momentum, how close they are to the questions that did best for Kai (what to buy, whether your machine is enough, what it costs), freshness, how many sources agree and whether there is primary evidence, then shows a few cards. An idea is never shown twice, and ideas matching a folder in `jobs/` are skipped, so **Find more ideas** always brings new ones. Type a topic to ask for more about it: the search also queries the sources for those words and keeps only matching ideas. **Make video** opens the new-video form with the angle and the source links filled in, and marks the idea as made once the thread starts. **Not for us** records a reason (wrong audience, already covered, weak evidence, wrong angle, too expensive). Feeds, keywords and reference channels are in `ideas.config.json`; state lives in `.video/ideas/`. Without `YOUTUBE_API_KEY` the reference channels' public Videos pages are read; with it, the official API is used (2 quota units per channel). A source that fails is listed and skipped; the rest still produce ideas. Model sizes on cards are 4-bit estimates from the model's name or its unquantized weights, and are labelled as estimates.

## Following a job

Progress is never taken from the agent's word. The runner reads it from three sources:

- **The pipeline's own state.** `npm run video -- status --json` is a read-only twin of `next`: the same checks in the same order, writing nothing. The runner calls it whenever the job's files change. It reports each step (plan, prototype scenes, build, render, review, final cycle, delivery) with its detail, every scene (owner, timing, built or not, check and review problems) and each reviewer's verdict.
- **The running processes.** Every sub-agent is a separate CLI process started through the runner's `delegate` tools. Each CLI's built-in sub-agent tool is switched off (Codex `--disable multi_agent` plus `features.multi_agent_v2.max_concurrent_threads_per_session=1`, because Codex 0.163 still offers `spawn_agent` with multi_agent disabled and the one-thread cap is what makes a spawn fail; Claude `--disallowedTools Agent,Task`; OpenCode `permission.task: deny`). A Codex `collab_tool_call` in the stream is recorded as a problem, and any helper session that still appears in Codex's rollout files is counted and shown in run health. Every role agent's prompt ends with a runner note: do only the brief, never run `next`, `render`, `review-pack`, `deliver` or `save-all`, never start sub-agents, and reply in under 150 words. The pipeline enforces the same boundary: with `VIDEO_AGENT_ROLE` set to any role but `orchestrator`, those commands (and a whole-film `build`) refuse to run. Each agent records its parent, brief, scene, pipeline step, model and where it came from, current file, last tool, tool and failure counts, and tokens.
- **The job's files** (script, review, narration, thumbnail, archive), polled from disk.

Views: **Thread** (your messages, the orchestrator, milestones and a live *Now* card), **Progress** (all steps from script to verified delivery, a scene strip and review verdicts, plus what `next` last told the agent), **Agents** (the live tree; open one to see its brief, prompt, messages and activity), **Activity** (filterable events; full tool output on demand), **Files** and **Outputs**. *Run health* comes from facts: stalls, repeated tool failures, failed sub-agents, review rounds, blocked steps. A failed `grep` is not an error.

Script review progress requires an explicit `pass` disposition in `review.md`; `revise` and `incomplete` remain repair steps. A newer script, research note or saved source makes that review stale. This reads the reviewer's recorded verdict; final video qualification still belongs to the pipeline. Failed status reads appear in run health as well as Progress.

The browser receives batched updates and re-renders only the parts that changed, so a playing video is left alone. Snapshots hold no events: events go to an append-only JSONL log, and the latest 600 stay in memory.

## Human in the loop

- **Checkpoints** (optional) and **questions** (the agent can ask at any time with `ask`) keep the agent's tool call open until you answer, so it cannot carry on past them. A decision made while the server was down reaches the resumed orchestrator. There are three: after the independent script review, and two on the film itself: **watch the prototype** (before the rest is built) and **watch the whole film** (before its one render).
- **Watching the film.** Nothing is rendered until the final reviews pass: the reviewers and you see the built HTML. At a film checkpoint, **Watch and review** opens HyperFrames' own player on the job's HTML (served read-only from `/api/jobs/<id>/player/`, so unlike Studio it changes no job file), with the narration, a scene strip to jump between scenes and the words spoken in each. Pause where something should change and **Add note** at that moment (or about the whole film). **Request changes** records your notes in the job (`review/human/<stage>.json`, bound to the exact build the reviewers passed) and the pipeline sends each note, word for word, to the scene at its moment; the repaired build is reviewed again and comes back to you. **Approve** lets it continue. The Progress tab's **Watch the current build** plays any built film without a decision.
- **Thumbnails.** Each thread makes several thumbnail variants (Thumbnail variants in the job settings, 1–6; the default comes from `thumbnails` in `video.config.json`), each from a different angle, all independently reviewed. With **Let me pick the thumbnail** on (the default), the thread stops on a grid of them: **Use this** makes one the thumbnail; **Make again** with a note sends only that variant back to a maker, in your words, then to review, while the others stay. The same grid stays in Outputs after delivery: picking another passing variant needs no agent, and asking for a new version reopens the thread for just that variant. Outside the UI, `npm run video -- play --job <job>` serves the same player and `human-review` records a decision.
- **Messages** you send queue until the orchestrator next calls `feedback` or gets a `delegate`/`delegate_parallel` result, which carries them in `userMessages`. Only the orchestrator can read them; reviewers never see your notes.
- **Pause** holds every agent at its next runner call, without freezing processes or dropping provider connections. **Cancel** stops the processes. Any thread that is not running, queued or waiting on you can be archived, or **deleted**: deletion removes the thread and its event log, `jobs/<slug>/`, `jobs/scripts/<slug>/`, `library/thumbnails/<slug>/`, the inputs it uploaded, and a `.video/latest.json` pointer to it. Reusable assets the film saved to the library stay, because other films search for them there. A live thread refuses deletion until it is cancelled.

## Models

Choose the provider, then a model for each role: orchestrator, script writer, script reviewer, director, scene builders, film reviewers, thumbnail maker and thumbnail reviewer. Every row shows what that role will run on, and why. A blank row uses the repository's pinned model from `.claude/agents/` (Claude, and Pi as `anthropic/<model>`), otherwise the provider's strong or weak default for that role: the orchestrator and scene builders are weak, every other role is strong. Defaults: Claude `claude-opus-5-5` / `claude-haiku-5-5`, Pi `anthropic/claude-opus-5-5` / `anthropic/claude-haiku-5-5`, Codex `gpt-6.1-sol` / `gpt-6-luna`, OpenCode `opencode/deepseek-v4.1-flash-free` / `opencode/glm-5.3-flash` (see `ui/shared/routing.mjs`). With Claude, pinned roles still run as their agent type, with your chosen model in place of the pin. Threads created before per-role models keep their old shared builder, creative and reviewer fields until you save their configuration.

## Execution and recovery

Default concurrency is one video job, with more threads queued; workspace settings allow up to three. Each job runs at most four CLI processes at once, including the orchestrator, so three independent reviewers can run together. Jobs use separate artifact directories but share the repository and asset library; this is not OS-level isolation. The orchestrator always names its job with `start --name <thread slug>`, so the UI and the pipeline agree on the job folder.

The runner injects a per-process MCP bridge without changing global CLI configuration. The orchestrator gets `delegate`, `delegate_parallel`, `feedback`, `progress`, `checkpoint`, `ask` and `complete`; role agents only get `note`. A resumed orchestrator receives a short continuation prompt, not the whole brief again. `delegate` returns only the agent's final reply (at most 3,000 characters), since everything returned stays in the orchestrator's context. Every director brief (plan, revision, repair) runs in a fresh session: the runner ignores an `agentId` for a director, because a resumed director re-sends its whole earlier run with every request. On Codex, the orchestrator and role agents are told to start every exec cell that calls a runner tool or a long command with `// @exec: {"yield_time_ms": 3600000}` and to loop on `write_stdin` inside that one cell, so a wait costs one request instead of one per 30 seconds. Claude agents get `BASH_DEFAULT_TIMEOUT_MS` and `BASH_MAX_TIMEOUT_MS` of one hour, so a render finishes in one Bash call instead of being backgrounded and polled. Agents run with `NODE_NO_WARNINGS=1` and a silent npm, which keeps the deprecation notice and npm banner out of every command's output. After a crash, recorded Linux PID start times prevent signalling reused PIDs, and active jobs become **interrupted**; Continue resumes the saved CLI session.

CLIs run from the repository and use their existing credentials and permissions. Codex uses workspace-write with networking and no interactive approvals. Claude uses acceptEdits and an explicit tool allowlist. OpenCode uses automatic approvals while keeping explicit denials. No adapter requests a global sandbox bypass.

## Token and quota accounting

The inspector shows the selected job's reported input, output, cached input, and total tokens, including its tracked role agents. The Usage dialog shows per-agent counts, workspace totals per CLI, and account quota where available. Input totals include cache read/write tokens; cache counts are a subset, never added to the headline total twice. Counts are provider reports, not locally estimated tokenization. A provider crash can leave partial usage.

- **Codex:** counts come from Codex's own rollout files (`~/.codex/sessions`, or `$CODEX_HOME`): the last cumulative `token_count` of the agent's session plus every session it spawned (`parent_thread_id`), read when the agent exits and every 30 s while it runs. `turn.completed.usage` is used until then. The stream alone missed cancelled turns and helper agents: an audited run showed 20.7M tokens in the UI against 136.8M in the rollouts. Account quota is read through the installed app-server's `account/rateLimits/read` method and cached for 60 seconds. Remaining percentages and reset timestamps reflect each returned quota window. Percentage quota is not converted into an invented remaining-token allowance. API-key-only logins may not expose subscription quotas.
- **Claude:** assistant-message IDs deduplicate repeated tool blocks. The final turn usage reconciles provisional per-step counts, including placeholder output counts. Session-cumulative cost is differenced across resumes. Rate-limit stream events are shown when supplied; no private OAuth endpoint or credential scraping is used to obtain missing balances.
- **OpenCode:** step-finish token and cost reports are deduplicated by step ID. A remaining account balance is shown only if the CLI actually reports it. The underlying provider may not expose this through OpenCode.

Context availability, when the CLI reports a context limit, is shown separately as an estimate from the latest request. It is not account quota. CLI-reported USD is an estimate, not authoritative billing. Missing values stay unknown.

Primary references used for adapters and accounting: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Claude headless CLI](https://code.claude.com/docs/en/headless), [Claude usage accounting](https://code.claude.com/docs/en/agent-sdk/cost-tracking), [OpenCode CLI](https://opencode.ai/docs/cli/), and [OpenCode MCP](https://opencode.ai/docs/mcp-servers/). Installed CLI help is checked against the flags used by each adapter.

## Completion boundary

An agent writing “done” does not complete a thread. `complete` re-reads the pipeline with the read-only `status` and requires state `done`, an MP4, a 1280×720 PNG, an editable thumbnail source, a thumbnail brief, a fresh independently invoked thumbnail reviewer with a passing `thumbnail/REVIEW.json`, and a matching archive under `library/thumbnails/<slug>/`. The qualified film's evidence is not modified by the UI. Reviewer judgments still depend on the actual agents inspecting the material; a server cannot mechanically prove subjective creative quality.

## Local state and tests

All state is local under ignored `.video/ui/`: atomic thread snapshots, append-only event logs, settings, and uploaded inputs. Actual film work lives in `jobs/`; archived thumbnails live in `library/thumbnails/`. Prototype browser fixtures are not imported. The UI adds no external hosting, account signup, tracking, or database service.

`npm run test:ui` runs unit and integration tests with **fixture subprocesses**, without paid provider calls. It covers stream normalization, pipeline command and `next` parsing, role model routing and disabled built-in sub-agents, the sub-agent tree, feedback isolation, process launch/pause/cancel, queue ordering, event storage cost, restart recovery, blocking checkpoints and questions, thread deletion down to the folders on disk, progress and health, token deduplication/reconciliation, origin restrictions, runner authentication, artifact path boundaries, and media ranges. `npm run test:ui:browser` drives the real page in headless Chrome and saves screenshots to `.video/ui-qa/`. Browser and live-provider smoke tests are separate commands because they need the installed browser or real CLI accounts.

Validation on 2026-10-19: 89 pipeline tests and 17 UI tests passed, and the browser run covered deletion (dialog, disk cleanup, empty workspace) alongside the earlier checks. Real bridge checks passed for Codex and OpenCode; Claude reported its session limit, so that smoke command correctly exited with a failure. The earlier sky explainer demo stopped at prototype review without qualifying delivery; this validation does not claim an end-to-end production pass.

### Mobile browser checks

`npm run test:ui:mobile` runs isolated, seeded conversations without starting agents or changing real jobs.
Set `UI_BROWSER_EXECUTABLE` if Chrome is not at `/usr/bin/google-chrome`. It checks latest-message following,
history anchoring during streamed updates, per-thread drafts, multiline input, simulated keyboard viewport
resizes, accessible drawers, and phone/tablet/landscape/desktop layouts. Screenshots go to `.video/ui-qa/`.
The keyboard resize is simulated in Chromium; physical iOS keyboard behavior still needs device verification.

Threads open at their latest message and follow updates until you scroll up. The Latest button resumes following.
Touch input text stays at least 16px without disabling browser zoom. The app and dialogs fit the visual viewport,
so the composer stays above the keyboard.
