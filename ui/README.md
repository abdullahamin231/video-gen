# Local video workspace

Start with `npm run ui`, then open http://127.0.0.1:4310. The server binds to loopback only. Use `npm run ui -- --port 4311` to choose another port. No new application dependencies are needed.

The sidebar contains conversations and New video. Each new thread starts a real CLI orchestrator, using the existing Codex, Claude Code, or OpenCode installation and account. Choose the main and builder models, with optional director and independent-reviewer overrides. Blank model fields use the CLI's default or inherit the main model; arbitrary model IDs are passed as arguments, never shell-interpolated. Codex suggestions come from its installed model cache; Claude's suggestions are CLI aliases. OpenCode accepts its provider/model IDs. Authentication, model availability, and provider policy errors appear in the thread and event log.

Give a high-level prompt and a target duration. Optionally upload a script or recording (250 MB maximum each), or provide repository-relative paths. Without a recording, the orchestrator follows the repository narration workflow. A supplied recording stays unchanged. The high-level prompt drives research, independently reviewed script, narration, the existing `npm run video -- next` loop, and a separately reviewed thumbnail.

## Following a job

- **Thread:** actual agent responses, pipeline reports, checkpoints, and user feedback. Messages sent during a run queue until the agent next calls the runner's feedback tool. This is not native mid-token steering.
- **Activity:** normalized tool starts/results, provider errors, filesystem changes, role launches, and token usage. Each event records its source. Full JSONL history can be downloaded; the UI shows the latest 300 events and thread snapshots keep the latest 1,000.
- **Files:** actual files under the thread's script and job directories. Text inspection is read-only. Artifact requests reject traversal, outside-thread paths, and symlinks leaving the allowed directories.
- **Outputs:** playable MP4s, thumbnail images, downloads, editable source, and review evidence. Unqualified files are explicitly labeled drafts. MP4 delivery supports byte ranges for seeking.

Pipeline stage reports are labeled **agent-reported**. File modifications are observed separately from disk. Health does not invent passing checks: tool errors and the actual delivery evidence are retained.

## Execution and recovery

Default concurrency is one video job, with more threads queued. Workspace settings permit up to three jobs. Each job has at most four simultaneous CLI processes, including the orchestrator, so three independent review roles can run together. Jobs use separate artifact directories; agents still share the repository and reusable asset library. This is not OS-level filesystem isolation between jobs.

The runner injects a per-process MCP bridge without changing global CLI configuration. Its tools launch fresh, role-specific agent sessions; resume a director when continuity is needed; report progress; read feedback; honor checkpoints; and request verified completion. Independent reviewers cannot resume a producer role. The backend provides actual runtime agent IDs in MCP initialization and results, and the orchestrator follows `docs/independent-review.md` when recording them.

Pause/resume uses process-group signals on Linux/macOS. Cancel terminates the associated CLI process groups and escalates after five seconds if needed. A graceful server shutdown stops agents. After a crash, recorded Linux PID start times prevent signaling reused PIDs; previously active jobs become **interrupted** rather than silently running again. Continue resumes the saved provider session and consults existing artifacts.

Optional checkpoints pause after independent script or prototype review. Approve continues; request changes requires feedback. These gates supplement, and never replace, independent reviews. Checkpoint preferences and model changes apply to future dispatches; an active provider process retains the model it started with.

CLIs run from the repository and use their existing credentials and permissions. Codex uses workspace-write with networking and no interactive approvals. Claude uses acceptEdits and an explicit allowlist of production tools. OpenCode uses automatic approvals while retaining explicit denials. No adapter requests a global sandbox bypass. Provider denials or environmental restrictions can still block a production run.

## Token and quota accounting

The inspector shows the selected job's reported input, output, cached input, and total tokens, including its tracked role agents. The Usage dialog shows per-agent counts, workspace totals per CLI, and account quota where available. Input totals include cache read/write tokens; cache counts are a subset, never added to the headline total twice. Counts are provider reports, not locally estimated tokenization. A provider crash can leave partial usage.

- **Codex:** `turn.completed.usage` drives job counts. Account quota is read through the installed app-server's `account/rateLimits/read` method and cached for 60 seconds. Remaining percentages and reset timestamps reflect each returned quota window. Percentage quota is not converted into an invented remaining-token allowance. API-key-only logins may not expose subscription quotas.
- **Claude:** assistant-message IDs deduplicate repeated tool blocks. The final turn usage reconciles provisional per-step counts, including placeholder output counts. Session-cumulative cost is differenced across resumes. Rate-limit stream events are shown when supplied; no private OAuth endpoint or credential scraping is used to obtain missing balances.
- **OpenCode:** step-finish token and cost reports are deduplicated by step ID. A remaining account balance is shown only if the CLI actually reports it. The underlying provider may not expose this through OpenCode.

Context availability, when the CLI reports a context limit, is shown separately as an estimate from the latest request. It is not account quota. CLI-reported USD is an estimate, not authoritative billing. Missing values stay unknown.

Primary references used for adapters and accounting: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Claude headless CLI](https://code.claude.com/docs/en/headless), [Claude usage accounting](https://code.claude.com/docs/en/agent-sdk/cost-tracking), [OpenCode CLI](https://opencode.ai/docs/cli/), and [OpenCode MCP](https://opencode.ai/docs/mcp-servers/). Installed CLI help is checked against the flags used by each adapter.

## Completion boundary

An agent writing “done” does not complete a thread. `complete` reruns the public `next` command and requires `STATE: done`, an MP4, a 1280×720 PNG, an editable thumbnail source, a thumbnail brief, a fresh independently invoked thumbnail reviewer with a passing `thumbnail/REVIEW.json`, and a matching archive under `library/thumbnails/<slug>/`. The qualified film's evidence is not modified by the UI. Reviewer judgments still depend on the actual agents inspecting the material; a server cannot mechanically prove subjective creative quality.

## Local state and tests

All state is local under ignored `.video/ui/`: atomic thread snapshots, append-only event logs, settings, and uploaded inputs. Actual film work lives in `jobs/`; archived thumbnails live in `library/thumbnails/`. Prototype browser fixtures are not imported. The UI adds no external hosting, account signup, tracking, or database service.

`npm run test:ui` runs unit and integration tests with **fixture subprocesses**, without paid provider calls. It covers stream normalization, role models, actual process launch/pause/resume/cancel, queue ordering, persisted sessions/messages/events, restart recovery, gate decisions, token deduplication/reconciliation, origin restrictions, runner authentication, artifact path boundaries, and media ranges. Browser and live-provider smoke tests are separate commands because they need the installed browser or real CLI accounts.
