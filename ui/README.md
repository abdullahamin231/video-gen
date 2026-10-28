# Local video workspace

Run `npm run ui` and open http://127.0.0.1:4310. The UI manages production threads, agent work, files,
review checkpoints and delivered outputs. [The shared runbook](../docs/orchestrator.md) describes production;
the UI does not define another creative workflow.

## Server access

`scripts/server-setup.sh tailscale` installs the user service and configures access on the current tailnet;
`scripts/server-setup.sh lan` binds for LAN access. Sign in to the chosen agent CLI on the server first.
The setup prints the address. Use the actual configured hostname rather than a hardcoded review URL.

| Setting | Default | Purpose |
|---|---|---|
| `VG_UI_HOST` / `--host` | `127.0.0.1` | Bind address; non-loopback access requires a password |
| `VG_UI_PASSWORD` | unset | At least 12 characters; changing it invalidates sessions |
| `PORT` / `--port` | `4310` | Listening port |

The ignored `.env` holds local configuration. The UI password is removed from agent environments. Raw
recordings may contain private data, so prepare an appropriate test workspace before recording.

## Production and decisions

The brief specifies format, optional duration and any supplied script/recording. Without a recording,
Ming generates narration locally. A supplied recording stays intact. Agents receive data-only assignments
that identify inputs, expected outputs and relevant technical references.

The UI tracks agent sessions and configured model choices. Explicit role selections take precedence over
repository pins/defaults. Creative and review roles can reason about and inspect the work; they do not
merely transcribe a visual plan. Independent reviewers did not produce the artifact they judge.

Requested script, film and thumbnail checkpoints show current artifacts and wait for the user's decision.
Feedback returns to the host, which coordinates revisions. A running job can be stopped; do not start
another narration invocation to bypass a queued Ming worker.

## State, recovery and verification

UI state lives under `.video/ui/`; production artifacts live in the thread's script/job directories.
On restart, the runner recovers saved sessions, artifacts and pending decisions. It validates qualified
video delivery and thumbnail review/selection rather than trusting an agent's completion message.
Missing tools, evidence or permissions remain explicit blockers.

Usage figures are provider/CLI reports and estimates, not billing receipts. Unknown quotas remain unknown.
Progress comes from actual commands and saved artifacts, not a model's self-reported stage.

Run `npm run test:ui` for server/runner contracts. `test:ui:browser` and `test:ui:mobile` exercise browser
flows; `test:ui:live` requires configured real agent access and should be used only for an intentional live test.
