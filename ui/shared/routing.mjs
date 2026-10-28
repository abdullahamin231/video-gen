// Which model each role runs on. Shared by the server and the browser so the form previews exactly what will run.
// Explicit per-role choices take precedence over pins and provider-tier defaults.
export const ROLES = [
  { role: 'orchestrator', label: 'Orchestrator', hint: 'Follows the pipeline and starts every other role', tier: 'strong' },
  { role: 'script-researcher', label: 'Script researcher', hint: 'Fetches every source and its primary evidence before the writer starts', tier: 'weak', pin: 'script-researcher' },
  { role: 'script-writer', label: 'Script writer', hint: 'Narration script and visual plan, from the saved sources', tier: 'strong', pin: 'script-writer' },
  { role: 'script-reviewer', label: 'Script reviewer', hint: 'Independent script review', tier: 'strong', pin: 'script-reviewer' },
  { role: 'director', label: 'Director', hint: 'Designs and authors the film; builds the scenes it owns', tier: 'strong', pin: 'video-director' },
  { role: 'builder', label: 'Scene builders', hint: 'Delegated scenes and their repairs', tier: 'strong', pin: 'video-builder' },
  { role: 'reviewer', label: 'Film reviewers', hint: 'The three independent film reviews', tier: 'strong', pin: 'video-reviewer' },
  { role: 'thumbnail-maker', label: 'Thumbnail maker', hint: 'Thumbnail brief and design', tier: 'strong', pin: 'video-director' },
  { role: 'thumbnail-reviewer', label: 'Thumbnail reviewer', hint: 'Independent thumbnail review', tier: 'strong', pin: 'video-reviewer' },
];
// Creative and review work use the strong tier; explicit per-role selections still win.
export const DEFAULT_MODELS = {
  Codex: { strong: 'gpt-6.1-sol', weak: 'gpt-6-luna' },
  Claude: { strong: 'claude-opus-5-5', weak: 'claude-haiku-5-5' },
  OpenCode: { strong: 'opencode/deepseek-v4.1-flash-free', weak: 'opencode/glm-5.3-flash' },
  Pi: { strong: 'anthropic/claude-opus-5-5', weak: 'anthropic/claude-haiku-5-5' },
};
export const DELEGATE_ROLES = ROLES.filter(item => item.role !== 'orchestrator').map(item => item.role);

// Claude runs these roles as the repository's own agent types (.claude/agents/*.md); Pi appends their instructions.
export const CLAUDE_AGENT_TYPES = { director: 'video-director', builder: 'video-builder', reviewer: 'video-reviewer', 'script-researcher': 'script-researcher', 'script-writer': 'script-writer', 'script-reviewer': 'script-reviewer' };

// The per-role overrides a thread has chosen. Older threads stored shared fields; they map onto the same roles.
export function roleModels(job = {}) {
  return Object.fromEntries(DELEGATE_ROLES.map(role=>[role,String(job.models?.[role] || '').trim()]));
}

// Precedence: your choice → the repository's pinned model (Claude, and Pi as an Anthropic model) → the provider's default for the role's tier → the CLI default.
export function routeModel(job, role, pins = {}) {
  const spec = ROLES.find(item => item.role === role) || { role, tier: 'strong' };
  const choice = role === 'orchestrator' ? String(job.main || '').trim() : roleModels(job)[role] || '';
  if (choice) return { model: choice, source: 'your choice' };
  const pin = ['Claude', 'Pi'].includes(job.provider) && spec.pin ? pins[spec.pin] : '';
  // Pi takes provider/model IDs; a bare Claude pin means an Anthropic model.
  if (pin) return { model: job.provider === 'Pi' && !pin.includes('/') ? `anthropic/${pin}` : pin, source: `repo pin (.claude/agents/${spec.pin}.md)` };
  const fallback = DEFAULT_MODELS[job.provider]?.[spec.tier];
  if (fallback) return { model: fallback, source: `${job.provider} ${spec.tier} default` };
  return { model: '', source: 'CLI default' };
}
