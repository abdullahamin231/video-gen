// Editorial personalities are independent of chat.config.json's provider/model profiles.
import {readFileSync, existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PERSONALITIES = ['explainer', 'rules-story', 'news-financial', 'news-political', 'app-review'];
export const PROFILE_FILE = 'production-profile.json';
const FILES = ['ORCHESTRATOR.md', 'EDITORIAL.md', 'DESIGN.md', 'TOOLS.md', 'REVIEW.md'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function profileId(id) {
  if (!PERSONALITIES.includes(id)) throw new Error(`Unknown personality "${id}". Choose ${PERSONALITIES.join(', ')}.`);
  return id;
}

/** Conservative deterministic fallback. AGENTS.md also uses semantic routing before invoking the CLI. */
export function inferPersonality(prompt, explicit) {
  if (explicit && explicit !== 'auto') return {id: profileId(explicit), reason: 'explicit', candidates: []};
  const text = String(prompt || '').toLowerCase();
  const app = /\b(?:app|application|software|t3\s*code|website|browser|dashboard|figma|notion|n8n)\b/.test(text);
  if (app && /\b(?:review|walkthrough|hands.on|screen\s*record|screencast|test|tour|tutorial|use the app)\b/.test(text))
    return {id: 'app-review', reason: 'hands-on application task', candidates: []};
  if (/bradikinin|bratkin|creepypasta|\bhorror\b|survival protocols?|\bfiction(?:al)?\b/.test(text) ||
      /\b(?:write|make|create|tell|produce)\b.{0,60}\b(?:story|storytelling)\b/.test(text) && !/\bnews\b/.test(text))
    return {id: 'rules-story', reason: 'storytelling uses the fixed rules-story style', candidates: []};
  const news = /\b(?:news|today|latest|cover|coverage|commentary|briefing|update|earnings|breaking|report on)\b/.test(text);
  const financial = /\b(?:financial|finance|stocks?|markets?|earnings|inflation|gdp|economy|economic|investing|federal reserve)\b/.test(text);
  const political = /\b(?:political|politics|elections?|parliament|congress|president|senate|government|legislation|campaign)\b/.test(text);
  if (/\b(?:explain|teach|how .* works?|educational|science|scientific)\b/.test(text) && !/\b(?:news|commentary|coverage|breaking)\b/.test(text))
    return {id: 'explainer', reason: 'educational treatment', candidates: []};
  const candidates = news ? [financial && 'news-financial', political && 'news-political'].filter(Boolean) : [];
  if (candidates.length === 1) return {id: candidates[0], reason: 'news subject', candidates: []};
  if (candidates.length > 1 || news && !financial && !political)
    return {id: null, reason: 'Clarify whether this news treatment is financial or political.', candidates: candidates.length ? candidates : ['news-financial', 'news-political']};
  return {id: 'explainer', reason: 'educational/explainer default', candidates: []};
}

export function loadPersonality(id, catalog = path.join(ROOT, 'personalities')) {
  profileId(id);
  const dir = path.join(catalog, id);
  const profile = JSON.parse(readFileSync(path.join(dir, 'profile.json'), 'utf8'));
  validateDefinition(profile, id);
  const files = Object.fromEntries(FILES.map(name => {
    const content = readFileSync(path.join(dir, name), 'utf8');
    if (!content.trim()) throw new Error(`Empty personality instructions: ${id}/${name}`);
    return [name, content];
  }));
  return {profile, files, sha256: digest({profile, files})};
}

function validateDefinition(profile, id) {
  if (profile.id !== id || !Number.isInteger(profile.version) || profile.version < 1 || typeof profile.renderReady !== 'boolean' ||
      typeof profile.name !== 'string' || !profile.name.trim() ||
      !['faceless-explainer', 'rules-story', 'news-edit', 'app-capture'].includes(profile.workflow) ||
      !profile.renderReady && (typeof profile.blocker !== 'string' || !profile.blocker.trim()))
    throw new Error(`Invalid personality descriptor: ${id}`);
}

export const personalityMetadata = snapshot => ({id: snapshot.profile.id, version: snapshot.profile.version, sha256: snapshot.sha256});
export async function freezePersonality(dir, snapshot) {
  validateSnapshot(snapshot);
  await mkdir(dir, {recursive: true});
  const file = path.join(dir, PROFILE_FILE);
  if (existsSync(file)) {
    const old = readPersonality(dir);
    if (old.sha256 !== snapshot.sha256) throw new Error('Personality is frozen for this project. Create a new project to change it.');
    return personalityMetadata(old);
  }
  await writeFile(file, JSON.stringify(snapshot, null, 2) + '\n', {flag: 'wx'});
  return personalityMetadata(snapshot);
}

function validateSnapshot(snapshot) {
  profileId(snapshot?.profile?.id);
  validateDefinition(snapshot.profile, snapshot.profile.id);
  if (FILES.some(name => typeof snapshot.files?.[name] !== 'string' || !snapshot.files[name].trim()) ||
      digest({profile: snapshot.profile, files: snapshot.files}) !== snapshot.sha256)
    throw new Error('Frozen personality instructions changed or are invalid. Restore the original production-profile.json.');
}

export function readPersonality(dir) {
  let metadata;
  for (const name of ['job.json', 'project.json']) {
    const file = path.join(dir, name);
    if (existsSync(file)) { metadata = JSON.parse(readFileSync(file, 'utf8')).productionProfile; break; }
  }
  const file = path.join(dir, PROFILE_FILE);
  if (!existsSync(file)) {
    if (metadata) throw new Error('Missing frozen production-profile.json; refusing to switch personality silently.');
    return loadPersonality('explainer'); // Legacy projects keep their original behaviour.
  }
  const snapshot = JSON.parse(readFileSync(file, 'utf8'));
  validateSnapshot(snapshot);
  if (metadata && (metadata.id !== snapshot.profile.id || metadata.version !== snapshot.profile.version || metadata.sha256 !== snapshot.sha256))
    throw new Error('Project personality does not match its frozen instructions.');
  return snapshot;
}

export function preparationPersonality(scriptDir, script, explicit) {
  if (existsSync(path.join(scriptDir, PROFILE_FILE)) || existsSync(path.join(scriptDir, 'project.json'))) {
    const snapshot = readPersonality(scriptDir);
    if (explicit && explicit !== 'auto' && profileId(explicit) !== snapshot.profile.id)
      throw new Error('Requested personality differs from the script project\'s frozen personality. Create a new project.');
    return snapshot;
  }
  const selection = inferPersonality(script, explicit);
  if (!selection.id) throw new Error(selection.reason);
  return loadPersonality(selection.id);
}

export function personalityBrief(dir, body) {
  const snapshot = readPersonality(dir);
  const {id, version} = snapshot.profile;
  const instructions = ['EDITORIAL.md', 'DESIGN.md', 'TOOLS.md', 'REVIEW.md'].filter(name => !body.includes(snapshot.files[name])).map(name =>
    `### Frozen ${id}/${name}\n${snapshot.files[name]}`).join('\n\n');
  const context = `## Production personality: ${id} v${version}\n` +
    `Frozen instructions: ${PROFILE_FILE} (SHA-256 ${snapshot.sha256}). Apply this personality's design and editorial rules; generic skill examples are only technical examples. Do not read another personality's design or orchestrator.\n\n${instructions}`;
  // Keep role titles/boundaries first and retain the task's exact closing reply contract.
  const split = body.startsWith('# ') ? body.indexOf('\n') : body.indexOf('\n\n');
  return split < 0 ? `${context}\n\n${body}` : `${body.slice(0, split)}\n\n${context}\n\n${body.slice(split + 1)}`;
}

export function assertRenderReady(snapshot) {
  if (!snapshot.profile.renderReady) throw new Error(`Personality ${snapshot.profile.id}: ${snapshot.profile.blocker} Follow its ORCHESTRATOR.md; do not substitute an animated explainer.`);
}
