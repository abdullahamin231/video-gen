# Video personalities

AGENTS.md routes normal requests to a personality-specific ORCHESTRATOR.md. The agent selects the ID; the user does not need to name it. Four families have five concrete packages:

| Folder | Treatment | Current renderer |
| --- | --- | --- |
| explainer | Existing scientific/educational/technical explanation | Supported |
| rules-story | Fixed Bradikinin-style fictional rule/survival storytelling | Supported; prototype approval tunes the style |
| news-financial | Real financial sources and original commentary | Media/audio timeline adapter required |
| news-political | Real political footage/articles, commentary and circular presenter | Media/audio timeline adapter required |
| app-review | Actual hands-on app recordings and cursor-guided review | Capture/action-log and cursor mapping adapter required |

Every folder contains profile.json, ORCHESTRATOR.md, EDITORIAL.md, DESIGN.md, TOOLS.md and REVIEW.md. Edit the appropriate package, not the shared runbook, to change that personality. Explainer design/vocabulary were moved out of lib/briefs.mjs. All generated research, writing, direction, building, repair, review and thumbnail briefs receive the selected package. Generic skills/schema examples cannot change the chosen genre.

The agent can inspect routing without creating a project:

```bash
npm run video -- profiles
npm run video -- profile-route --prompt "Make a horror story about an elevator"
```

Once the user requests production, the agent passes --profile with its inferred choice to project-new or start/prepare. Omitted choices use conservative inference from the agreed brief (or supplied script). Ambiguous news requests return no ID and require one clarification. Explicit choices are validated. Unknown IDs fail. Resuming uses saved state rather than reclassifying the latest message.

New projects store ID/version/SHA-256 in project.json and the complete frozen package in production-profile.json. Prepared jobs inherit that snapshot from the script folder and store its metadata in job.json. Missing/changed/mismatched snapshots fail; changing global instructions does not alter existing jobs. Reviews include the frozen snapshot in the source fingerprint. Existing jobs with no metadata retain the explainer default. project-set cannot switch personalities; create a new project for a different treatment.

News and app-review renderReady=false is intentional until their actual media adapters are implemented and tested. News may gather evidence and plan, but stops before narration/preparation. App reviews must stop before commissioning an invented script; actual capture/test evidence and its adapter come first. No profile can silently fall back to the explainer. Never change renderReady solely to bypass that check.

No video.config.json changes, T3 fork, native picker or provider-model change is needed. T3 reads AGENTS.md and the selected orchestrator; its usual delegated-role lifecycle remains in docs/t3-orchestrator.md. The video-gen web UI also receives profile routing instructions. chat.config.json provider profiles stay separate.
