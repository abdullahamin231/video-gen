// Human review: the person who asked for the film watches the built HTML and approves it or leaves notes at moments in
// it. A decision belongs to one review pack (the exact sources the reviewers saw); a newer build needs a new decision.
// Notes go to the scenes they point at as repair findings, word for word: nobody paraphrases them.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {loadReviewPack, writeReviewFile} from './review.mjs';

export const HUMAN_STAGES = ['final'];
// "prototype" is a retired stage. Old projects that still name it wait for one final review instead of losing their
// requested checkpoint.
const normalizeStage = stage => stage === 'prototype' ? 'final' : stage;
const json = async file => JSON.parse(await readFile(file, 'utf8'));

/** Which stages wait for the person (job.json humanReview). */
export async function humanStages(job) {
  const manifest = await json(path.join(job, 'job.json'));
  return Array.isArray(manifest.humanReview)
    ? [...new Set(manifest.humanReview.map(normalizeStage).filter(s => HUMAN_STAGES.includes(s)))] : [];
}

export function parseStages(value) {
  const list = String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (list.length === 1 && ['none', 'off'].includes(list[0])) return [];
  const bad = list.filter(s => !['prototype', ...HUMAN_STAGES].includes(s));
  if (bad.length) throw new Error(`Human review stages are ${HUMAN_STAGES.join(', ')} (or none); not ${bad.join(', ')}.`);
  return [...new Set(list.map(normalizeStage))];
}

// "12.5: text", "12.5-14: text" or plain text (about the whole stretch).
export function parseNote(value) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:[-–]\s*(\d+(?:\.\d+)?))?\s*s?\s*:\s*([\s\S]+)$/.exec(String(value));
  return m ? {start: Number(m[1]), end: m[2] ? Number(m[2]) : Number(m[1]), text: m[3].trim()} : {text: String(value).trim()};
}

/** Record the person's decision on the current review pack of a stage. */
export async function recordHumanReview(job, {stage, decision, notes = []}) {
  stage = normalizeStage(stage);
  if (!HUMAN_STAGES.includes(stage)) throw new Error(`Stage must be ${HUMAN_STAGES.join(' or ')}.`);
  if (!['approve', 'revise'].includes(decision)) throw new Error('Decision must be approve or revise.');
  const {pack, packSha256} = await loadReviewPack(job, stage);
  const timing = await json(path.join(job, 'timing.json')), missing = new Set(timing.missing || []), clean = [];
  for (const [i, note] of notes.entries()) {
    const text = String(note?.text ?? '').trim();
    if (!text) throw new Error(`Note ${i + 1} is empty.`);
    let start = note.start ?? null, end = note.end ?? note.start ?? null;
    if (start != null && (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > pack.duration + 0.05))
      throw new Error(`Note ${i + 1} has an invalid time (0–${pack.duration.toFixed(1)} s).`);
    // The player shows the whole film; a note keeps its own moment. Scenes that are not built yet have nothing to repair.
    const at = start == null ? [] : timing.scenes.filter(s => s.start <= end && s.end > start);
    const unbuilt = at.filter(s => missing.has(s.id));
    if (unbuilt.length && unbuilt.length === at.length) throw new Error(`Note ${i + 1} is about "${unbuilt[0].id}", which is not built yet.`);
    const sceneIds = Array.isArray(note.sceneIds) ? note.sceneIds.filter(id => typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id)) : [];
    clean.push({start, end, sceneIds, text: text.slice(0, 4000)});
  }
  if (decision === 'revise' && !clean.length) throw new Error('Say what should change: give at least one note.');
  const record = {version: 1, stage, decision, sourceHash: pack.sourceHash, packSha256, notes: clean, decidedAt: new Date().toISOString()};
  await writeReviewFile(job, `review/human/${stage}.json`, JSON.stringify(record, null, 2) + '\n');
  return record;
}

/** The person's decision on the current pack, or null when none was made for it. */
export async function humanDecision(job, stage, packSha256) {
  const record = await json(path.join(job, `review/human/${normalizeStage(stage)}.json`)).catch(() => null);
  return record && record.version === 1 && record.packSha256 === packSha256 ? record : null;
}

/** Notes as repair findings, each tied to its moment (or to every scene in the reviewed stretch). */
export function humanFindings(record, pack) {
  return record.notes.map(n => {
    const start = n.start ?? pack.interval.start, end = n.end ?? pack.interval.end;
    const when = n.start == null ? 'whole stretch' : n.end > n.start ? `${n.start.toFixed(1)}–${n.end.toFixed(1)}s` : `${n.start.toFixed(1)}s`;
    return {text: `[the person who asked for the film, ${when}] ${n.text}`, start, end,
      sceneIds: n.sceneIds.length ? n.sceneIds : n.start == null ? pack.scenes.map(s => s.id) : undefined};
  });
}

/** Set which stages wait for the person (the UI's film checkpoints). A job that does not exist yet is left alone. */
export async function setHumanStages(job, stages) {
  const {writeFile} = await import('node:fs/promises');
  const file = path.join(job, 'job.json');
  let manifest;
  try { manifest = await json(file); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  const wanted = parseStages(stages.join(','));
  if (JSON.stringify(manifest.humanReview || []) === JSON.stringify(wanted)) return false;
  manifest.humanReview = wanted;
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
  return true;
}
