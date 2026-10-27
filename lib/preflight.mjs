// Review evidence preflight. The pack itself is validated by loadReviewPack; this check answers the question those
// structural checks do not: can a reviewer actually inspect every assigned scene with the evidence provided?
const covers = (ranges, start, end) => {
  let cursor = start;
  for (const range of [...ranges].filter(r => Number.isFinite(r.start) && Number.isFinite(r.end)).sort((a, b) => a.start - b.start)) {
    if (range.start > cursor + 0.05) return false;
    cursor = Math.max(cursor, range.end);
    if (cursor >= end - 0.05) return true;
  }
  return cursor >= end - 0.05;
};

/** Return a report; throw one consolidated error if a reviewer would be missing required evidence. */
export function preflightReviewPack(pack) {
  const errors = [], warnings = [];
  const frames = pack.evidence.filter(item => item.kind === 'frames');
  const audio = pack.evidence.filter(item => item.kind === 'audio');
  const clips = pack.evidence.filter(item => item.kind === 'clip');
  for (const scene of pack.scenes) {
    if (!frames.some(frame => frame.start >= scene.start - 0.05 && frame.start <= scene.end + 0.05))
      errors.push(`scene "${scene.id}" (${scene.start.toFixed(2)}–${scene.end.toFixed(2)}s) has no image evidence inside it`);
  }
  if (!audio.some(item => item.start <= 0.001 && item.end >= pack.duration - 0.12))
    errors.push(`audio evidence does not span the full film (0–${pack.duration.toFixed(2)}s)`);
  if (pack.source !== 'html') {
    for (const scene of pack.scenes)
      if (!covers(clips.filter(item => item.sceneId === scene.id), scene.start, scene.end))
        errors.push(`encoded clips do not cover scene "${scene.id}" (${scene.start.toFixed(2)}–${scene.end.toFixed(2)}s)`);
    for (const capture of pack.appCaptureIntervals || [])
      if (!covers(clips, capture.start, capture.end))
        errors.push(`encoded clips do not cover app capture "${capture.id}" (${capture.start.toFixed(2)}–${capture.end.toFixed(2)}s)`);
  }
  if (!pack.evidence.some(item => item.kind === 'motion')) warnings.push('no motion transcript is frozen in the pack');
  if (!pack.evidence.some(item => item.kind === 'checks')) warnings.push('no automated build checks are frozen in the pack');
  if (pack.source !== 'html' && !pack.evidence.some(item => item.kind === 'verification'))
    warnings.push('no render verification receipt is frozen in the pack');
  const report = {version: 1, ok: !errors.length, stage: pack.stage, source: pack.source || 'render',
    interval: pack.interval, scenes: pack.scenes.map(scene => ({id: scene.id, frames: frames.filter(frame => frame.start >= scene.start - 0.05 && frame.start <= scene.end + 0.05).length})),
    counts: {frames: frames.length, clips: clips.length, audio: audio.length}, errors, warnings, checkedAt: new Date().toISOString()};
  if (errors.length) throw new Error(`Review evidence preflight failed; reviewers were not started:\n- ${errors.join('\n- ')}`);
  return report;
}
