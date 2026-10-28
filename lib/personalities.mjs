// Editorial personalities are independent of chat.config.json's provider/model profiles.
import {readFileSync, existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PERSONALITIES = ['explainer', 'rules-story', 'news-financial', 'news-political', 'app-review'];
export const PROFILE_FILE = 'production-profile.json';
const FILES = ['PROFILE.md'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function profileId(id) {
  if (!PERSONALITIES.includes(id)) throw new Error(`Unknown personality "${id}". Choose ${PERSONALITIES.join(', ')}.`);
  return id;
}

// The host agent chooses the treatment from personalities/README.md.
export function requirePersonality(id) {
  if (!id || id === 'auto') throw new Error('Choose a treatment from personalities/README.md and pass --profile <id>.');
  return profileId(id);
}

export function loadPersonality(id, catalog = path.join(ROOT, 'personalities')) {
  profileId(id);
  const dir = path.join(catalog, id);
  const workflows = {explainer: 'faceless-explainer', 'rules-story': 'rules-story',
    'news-financial': 'news-edit', 'news-political': 'news-edit', 'app-review': 'app-review'};
  const profile = {id, name: id, version: 1, workflow: workflows[id], renderReady: true};
  validateDefinition(profile, id);
  const files = Object.fromEntries(FILES.map(name => {
    const content = readFileSync(path.join(dir, name), 'utf8');
    if (!content.trim()) throw new Error(`Empty personality instructions: ${id}/${name}`);
    return [name, content];
  }));
  return {profile, files, sha256: digest({profile, files})};
}

const WORKFLOWS = ['faceless-explainer', 'rules-story', 'news-edit', 'app-review'];
export const isAppReview = workflow => workflow === 'app-review';

function validateDefinition(profile, id) {
  if (profile.id !== id || !Number.isInteger(profile.version) || profile.version < 1 || typeof profile.renderReady !== 'boolean' ||
      typeof profile.name !== 'string' || !profile.name.trim() ||
      !WORKFLOWS.includes(profile.workflow) ||
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
    return loadPersonality('explainer');
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
  return loadPersonality(requirePersonality(explicit));
}


export function assertRenderReady(snapshot) {
  if (!snapshot.profile.renderReady) throw new Error(`Personality ${snapshot.profile.id}: ${snapshot.profile.blocker}`);
}

export const rendererAvailable = snapshot => { try { assertRenderReady(snapshot); return true; } catch { return false; } };
