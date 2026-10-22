// Applies the live-update deltas produced by ui/backend/http.mjs (`diff`, `jobDelta`). Inputs are never mutated.
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function applyPatch(target, patch) {
  const out = plain(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === '$unset') { for (const name of value) delete out[name]; continue; }
    out[key] = plain(value) && plain(out[key]) ? applyPatch(out[key], value) : value;
  }
  return out;
}

// `skip` names top-level fields the local copy does not hold (a sidebar card has no agents or pipeline).
export function applyJobDelta(job, delta, skip = []) {
  let patch = delta.patch || {};
  if (skip.length) patch = Object.fromEntries(Object.entries(patch).filter(([key]) => !skip.includes(key)));
  const next = applyPatch(job, patch);
  if (!Array.isArray(job.agents)) return next;
  const agents = new Map(job.agents.map(agent => [agent.id, agent]));
  for (const [id, change] of Object.entries(delta.agents || {})) agents.set(id, change.$full ? change.$full : applyPatch(agents.get(id), change));
  const order = delta.agentIds || [...job.agents.map(agent => agent.id), ...Object.keys(delta.agents || {}).filter(id => !job.agents.some(agent => agent.id === id))];
  next.agents = order.map(id => agents.get(id)).filter(Boolean);
  return next;
}
