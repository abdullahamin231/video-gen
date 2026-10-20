// The visual plan (VISUALS.md) the script writer leaves next to SCRIPT.md. It carries the film's creative direction
// (concept, theme, per-scene events) so the director and builders, on a weaker model, carry it out rather than invent it.
import path from 'node:path';
import {readdir} from 'node:fs/promises';

export const VISUALS_FILE = 'inputs/visuals.md';

/** VISUALS.md beside the script, if the writer left one. */
export async function findVisualPlan(scriptPath) {
  const dir = path.dirname(scriptPath), base = path.basename(scriptPath, path.extname(scriptPath)).toLowerCase();
  const names = await readdir(dir).catch(() => []);
  const match = names.find(n => n.toLowerCase() === 'visuals.md') || names.find(n => n.toLowerCase() === `${base}.visuals.md`);
  return match ? path.join(dir, match) : null;
}

// "## Heading" sections, keyed by lower-case heading.
function sections(markdown, level, lower = true) {
  const out = new Map(), marker = '#'.repeat(level) + ' ';
  let key = null, lines = [], fenced = false;
  const flush = () => { if (key) out.set(key, lines.join('\n').trim()); };
  for (const line of String(markdown).split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = !fenced && line.startsWith(marker) ? line.slice(marker.length).trim() : null;
    const higher = !fenced && /^#{1,6} /.test(line) && line.match(/^#+/)[0].length < level;
    if (heading != null || higher) { flush(); key = heading != null ? (lower ? heading.toLowerCase() : heading) : null; lines = []; continue; }
    if (key) lines.push(line);
  }
  flush();
  return out;
}

/** The plan's per-scene sections: Map scene id → its text, in order. */
export function visualScenes(markdown) {
  const scenes = new Map();
  for (const [heading, body] of sections(sections(markdown, 2).get('scenes') || '', 3, false)) {
    const id = heading.replace(/[`*]/g, '').split(/\s+[—–-]\s+|[\s:]/)[0];
    if (id) scenes.set(id, body);
  }
  return scenes;
}

export const visualSection = (markdown, name) => sections(markdown, 2).get(name.toLowerCase()) || '';

/** What makes a plan unusable for the director. */
export function visualPlanErrors(markdown) {
  const errors = [], top = sections(markdown, 2);
  for (const name of ['Concept', 'Theme', 'Prototype', 'Scenes', 'Thumbnail']) if (!top.get(name.toLowerCase())) errors.push(`missing "## ${name}" section`);
  const theme = top.get('theme') || '', json = /```json\s*\n([\s\S]*?)```/.exec(theme)?.[1];
  if (theme && !json) errors.push('"## Theme" has no ```json block (the director copies it into film.json "theme")');
  else if (json) { try { JSON.parse(json); } catch (error) { errors.push(`"## Theme" JSON does not parse: ${error.message}`); } }
  const scenes = visualScenes(markdown);
  if (top.get('scenes') && !scenes.size) errors.push('"## Scenes" has no "### <scene-id>" sections');
  for (const [id, body] of scenes) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) errors.push(`scene "${id}": ids are kebab-case`);
    // Accept "- Idea:" and the bold "- **Idea:**" / "- **Idea**:" forms.
    for (const field of ['Starts at', 'Idea', 'Events', 'Payoff']) if (!new RegExp(`^\\s*-\\s*(\\*\\*)?${field}(\\*\\*)?\\s*:`, 'mi').test(body)) errors.push(`scene "${id}": no "- ${field}:" line`);
  }
  return errors;
}
