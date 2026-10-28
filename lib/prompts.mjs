// Assignments contain task data only. Shared behavior lives in AGENTS.md and docs/orchestrator.md.
export function taskPrompt(role, data) {
  return '# Assignment\n\n```json\n' + JSON.stringify({role, ...data}, null, 2) + '\n```\n';
}
