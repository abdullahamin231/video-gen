// Which model each role runs on. Shared by the server and the browser so the form previews exactly what will run.
export const ROLES = [
  { role: 'orchestrator', label: 'Orchestrator', field: 'main' },
  { role: 'script-writer', label: 'Script writer', field: 'directorModel', pin: 'script-writer' },
  { role: 'script-reviewer', label: 'Script reviewer', field: 'reviewerModel', pin: 'script-reviewer' },
  { role: 'director', label: 'Director', field: 'directorModel', pin: 'video-director' },
  { role: 'builder', label: 'Scene builders', field: 'sub', pin: 'video-builder' },
  { role: 'reviewer', label: 'Film reviewers', field: 'reviewerModel', pin: 'video-reviewer' },
  { role: 'thumbnail-maker', label: 'Thumbnail maker', field: 'directorModel', pin: 'video-director' },
  { role: 'thumbnail-reviewer', label: 'Thumbnail reviewer', field: 'reviewerModel', pin: 'video-reviewer' },
];
export const DELEGATE_ROLES = ROLES.filter(item => item.role !== 'orchestrator').map(item => item.role);

// Claude runs these roles as the repository's own agent types (.claude/agents/*.md).
export const CLAUDE_AGENT_TYPES = { director: 'video-director', builder: 'video-builder', reviewer: 'video-reviewer', 'script-writer': 'script-writer', 'script-reviewer': 'script-reviewer' };

// Precedence: your per-role override → the repository's pinned model (Claude only) → your main model → the CLI default.
export function routeModel(job, role, pins = {}) {
  const spec = ROLES.find(item => item.role === role) || { field: 'main' };
  const override = (job[spec.field] || '').trim();
  if (override && spec.field !== 'main') return { model: override, source: 'your override' };
  const pin = job.provider === 'Claude' && spec.pin ? pins[spec.pin] : '';
  if (pin) return { model: pin, source: `repo pin (.claude/agents/${spec.pin}.md)` };
  const main = (job.main || '').trim();
  if (main) return { model: main, source: role === 'orchestrator' ? 'your main model' : 'inherits main model' };
  return { model: '', source: 'CLI default' };
}
