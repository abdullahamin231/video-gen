// Brief code provides task data and paths. There is no injected role instruction package.
import path from 'node:path';
import {mkdir, writeFile} from 'node:fs/promises';
import {readPersonality} from './personalities.mjs';
// Assignments contain task data only. Shared behavior lives in AGENTS.md and docs/orchestrator.md.
export function taskPrompt(role, data) {
  return '# Assignment\n\n```json\n' + JSON.stringify({role, ...data}, null, 2) + '\n```\n';
}


export function wordTable(alignment, from = 0, to = Infinity) {
  return alignment.words.filter(w => w.start >= from - .01 && w.start < to)
    .map(w => `${w.start.toFixed(2)} ${w.text}`).join('  ');
}
function inputs(job, manifest) {
  return {job, duration: manifest.duration, width: manifest.width, height: manifest.height,
    script: 'inputs/source-script.md', timing: 'alignment.json', profile: 'production-profile.json',
    visualIntent: manifest.visuals?.path || null, channelReference: manifest.channelTheme?.path || null};
}
export function newsDirectorBrief(job) {
  return taskPrompt('news', {job, profile: 'production-profile.json', contract: 'docs/news.md', outputs: ['news-sources.json', 'news.json']});
}
export function directorBrief(job, manifest, alignment, {repair = null, planErrors = null} = {}) {
  return taskPrompt(readPersonality(job).profile.workflow === 'news-edit' ? 'news' : 'director',
    {...inputs(job, manifest), contract: 'docs/composition.md', outputs: ['film.json', 'compositions/*.html'], findings: repair, planErrors});
}
export function directorSceneBrief(job, manifest, film, timings, alignment, {repair = null} = {}) {
  return taskPrompt('build', {...inputs(job, manifest), ownsPlan: true, film: 'film.json', contract: 'docs/composition.md',
    scenes: timings.map(t => ({id: t.id, start: t.start, end: t.end, file: film.scenes.find(s => s.id === t.id).file || `shots/${t.id}.json`})), findings: repair});
}
export function builderBrief(job, manifest, film, timing, alignment, {repair = null, prior = []} = {}) {
  const scene = film.scenes.find(s => s.id === timing.id);
  return taskPrompt('build', {...inputs(job, manifest), ownsPlan: false, film: 'film.json', contract: 'docs/composition.md', sceneId: scene.id,
    start: timing.start, end: timing.end, file: scene.file || `shots/${scene.id}.json`, sharedSubjects: prior.map(p => p.id), findings: repair});
}
export function visualsBrief(job, manifest) {
  return taskPrompt('visual-intent', {...inputs(job, manifest), output: 'inputs/visuals.md'});
}
export function reviewerBrief(job, role, pack, packPath, packSha256, directions, manifest) {
  return taskPrompt('reviewer', {job, role, stage: pack.stage, profile: 'production-profile.json', pack: packPath,
    packSha256, interval: pack.interval, contract: 'docs/independent-review.md', priorReviewHistory: manifest.priorReviewHistoryPath || null});
}
export async function writeBrief(job, name, text) {
  await mkdir(path.join(job, 'briefs'), {recursive: true});
  const file = path.join(job, 'briefs', name);
  await writeFile(file, text);
  return file;
}
