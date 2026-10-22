// The stage bar a T3 chat shows the person: a self-contained HTML page for T3's html_render, drawn from
// pipelineStages() (lib/project.mjs). Stage names sit above their sub-steps; every sub-step is a node on one line;
// the current step is highlighted and spelled out below with the steps of its stage.
const esc = value => String(value ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);

export const STAGE_BAR_HEIGHT = 150;

export function renderStageBar(slug, stages) {
  const groups = stages.groups.map(g => {
    const done = g.steps.filter(s => s.status === 'done').length;
    const cells = g.steps.map(s => `<div class="cell ${s.status}${s.problem ? ' problem' : ''}" title="${esc(s.label)}${s.detail ? ` · ${esc(s.detail)}` : ''}"><i></i></div>`).join('');
    return `<div class="group ${g.status}" style="flex:${Math.max(g.steps.length, 2)} 1 0"><div class="gl"><b>${esc(g.label)}</b>${g.steps.length > 1 ? `<span>${done}/${g.steps.length}</span>` : ''}</div><div class="row">${cells}</div></div>`;
  }).join('');
  const cur = stages.current, group = stages.groups.find(g => g.status === 'current');
  const head = cur ? `<b>${esc(cur.group)}</b> <span class="sep">›</span> <b class="${cur.problem ? 'warn' : 'now'}">${esc(cur.step)}</b>${cur.detail ? ` <span class="muted">· ${esc(cur.detail)}</span>` : ''}`
    : '<b class="ok">Delivered</b> <span class="muted">· film and thumbnail are done</span>';
  const chips = group ? group.steps.map(s => `<span class="chip ${s.status}">${{done: '✓', current: '●', pending: '○'}[s.status]} ${esc(s.label)}${s.detail && s.status !== 'current' ? ` <em>${esc(s.detail)}</em>` : ''}</span>`).join('') : '';
  const waiting = stages.delegated?.length ? `<div class="muted small">${stages.delegated.length} delegated task(s) running</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
.w{font-family:var(--font-sans);padding:6px 0 4px;color:var(--foreground)}
.bar{display:flex;gap:6px}.group{min-width:0}
.gl{display:flex;gap:6px;align-items:baseline;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 2px 6px;border-bottom:2px solid var(--border);margin-bottom:8px;color:var(--muted-foreground)}
.gl span{font-size:10px;opacity:.8}.group.done .gl{border-color:var(--success);color:var(--foreground)}
.group.current .gl{border-color:var(--accent);color:var(--foreground)}
.row{display:flex}.cell{flex:1;position:relative;height:16px;display:flex;justify-content:center;align-items:center}
.cell::before{content:"";position:absolute;left:0;right:0;top:7px;height:2px;background:var(--border)}
.cell.done::before{background:var(--success)}.cell.current::before{background:linear-gradient(90deg,var(--success) 50%,var(--border) 50%)}
.group:first-child .cell:first-child::before{left:50%}.group:last-child .cell:last-child::before{right:50%}
.cell i{position:relative;width:10px;height:10px;border-radius:50%;box-sizing:border-box;border:2px solid var(--border);background:var(--background)}
.cell.done i{background:var(--success);border-color:var(--success)}
.cell.current i{width:14px;height:14px;background:var(--accent);border-color:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 25%,transparent)}
.cell.problem i{background:var(--warning);border-color:var(--warning);box-shadow:0 0 0 4px color-mix(in srgb,var(--warning) 25%,transparent)}
.now{color:var(--accent)}.warn{color:var(--warning)}.ok{color:var(--success)}.sep,.muted{color:var(--muted-foreground)}
.head{margin-top:12px;font-size:13px}.small{font-size:11px;margin-top:4px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chip{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--border);color:var(--muted-foreground);white-space:nowrap}
.chip.done{color:var(--foreground)}.chip.current{border-color:var(--accent);color:var(--foreground)}.chip em{font-style:normal;opacity:.7}
.slug{font-size:11px;color:var(--muted-foreground);margin-bottom:8px}
</style></head><body><div class="w"><div class="slug">${esc(slug)} · ${esc(stages.phase)}</div><div class="bar">${groups}</div>
<div class="head">${head}</div>${waiting}<div class="chips">${chips}</div></div></body></html>`;
}
