// Compare supported app-capture layers in the encoded film with their recorded source.
// This deliberately declines scenes where the layer's rendered footprint is ambiguous.
import {spawn} from 'node:child_process';
import path from 'node:path';

const W = 96, H = 54;
function frame(file, time, crop) {
  return new Promise((resolve, reject) => {
    const vf = `${crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},` : ''}scale=${W}:${H}:flags=area,format=rgb24`;
    const child = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, time)), '-i', file, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', 'pipe:1'], {stdio: ['ignore', 'pipe', 'pipe']});
    const chunks = []; let err = '';
    child.stdout.on('data', part => chunks.push(part)); child.stderr.on('data', part => err += part);
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(err.trim())));
  });
}

const overlaps = (a, b) => Math.abs(a.at[0] - b.at[0]) * 2 < a.size[0] + b.size[0] &&
  Math.abs(a.at[1] - b.at[1]) * 2 < a.size[1] + b.size[1];

export async function verifyCaptureVisibility(job, videoFile, world) {
  const videos = (world.objects || []).filter(o => o.type === 'video' && /app-capture\//.test(o.src || ''));
  const results = [];
  for (const v of videos) {
    const scene = (world.scenes || []).find(s => s.id === v.scene);
    const captureDuration = Number(v.clipDuration ?? v.mediaDuration);
    const interval = scene && captureDuration > 0 ? {start: scene.start, end: Math.min(scene.end, scene.start + captureDuration)} : undefined;
    const issues = [];
    if (!scene || !Array.isArray(v.at) || !Array.isArray(v.size) || v.size.length < 2) issues.push('missing scene or geometry');
    if (v.transform || v.zoom || v.rotation || v.scale) issues.push('capture layer has a transform');
    const others = (world.objects || []).filter(o => o !== v && o.scene === v.scene && o.visible !== false &&
      Array.isArray(o.at) && Array.isArray(o.size) && overlaps(v, o));
    if (others.length) issues.push(`overlapping composition objects: ${others.map(o => o.id).join(', ')}`);
    const actions = (world.actions || []).filter(a => a.target === v.id && ['move', 'zoom', 'rotate', 'scale'].includes(a.do));
    if (actions.length) issues.push('capture layer has animated geometry');
    if (issues.length) { results.push({id: v.id, scene: v.scene, interval, status: 'unverified', reason: issues.join('; ')}); continue; }
    const duration = Number(v.mediaDuration ?? v.clipDuration), start = Number(v.mediaStart ?? scene.start);
    if (!(duration > 0) || !Number.isFinite(start)) { results.push({id: v.id, scene: v.scene, interval, status: 'unverified', reason: 'missing playback interval'}); continue; }
    const x = Math.max(0, Math.round((v.at[0] - v.size[0] / 2) / world.width * world.width));
    const y = Math.max(0, Math.round((v.at[1] - v.size[1] / 2) / world.height * world.height));
    const w = Math.min(world.width - x, Math.round(v.size[0])), h = Math.min(world.height - y, Math.round(v.size[1]));
    if (x + w > world.width || y + h > world.height || w < 2 || h < 2) { results.push({id: v.id, scene: v.scene, interval, status: 'unverified', reason: 'capture geometry falls outside the render'}); continue; }
    const samples = [];
    // Sample on the same cadence as the global black-frame check. That lets a
    // recorded black run be exempted only where its source frames also match.
    for (let local = Math.min(1 / 6, duration / 2); local < duration; local += 1 / 6) {
      const t = start + local;
      try {
        const expected = await frame(path.resolve(job, v.src), local);
        const actual = await frame(videoFile, t, {x, y, w, h});
        if (expected.length !== W * H * 3 || actual.length !== expected.length) throw new Error('frame unavailable');
        let total = 0, changed = 0;
        for (let i = 0; i < expected.length; i += 3) {
          const d = Math.abs(expected[i] - actual[i]) + Math.abs(expected[i + 1] - actual[i + 1]) + Math.abs(expected[i + 2] - actual[i + 2]);
          total += d; if (d > 72) changed++;
        }
        const mean = total / expected.length, match = 1 - changed / (W * H);
        const sourceBlack = expected.every(channel => channel <= 20);
        const renderedBlack = actual.every(channel => channel <= 20);
        samples.push({t: Number(t.toFixed(3)), meanRgbError: Number(mean.toFixed(2)), matchingPixels: Number(match.toFixed(3)), blackMatch: sourceBlack && renderedBlack && mean <= 12});
      } catch (error) { samples.push({t: Number(t.toFixed(2)), error: error.message}); }
    }
    const failed = samples.some(s => s.error || s.meanRgbError > 32 || s.matchingPixels < 0.55);
    const blackIntervals = [];
    let blackStart = null, previous = null;
    for (const sample of samples) {
      if (sample.blackMatch && (previous == null || sample.t - previous <= 0.18)) { if (blackStart == null) blackStart = sample.t - 1 / 12; previous = sample.t; }
      else { if (blackStart != null && previous != null) blackIntervals.push({start: Math.max(start, blackStart), end: Math.min(start + duration, previous + 1 / 12)}); blackStart = sample.blackMatch ? sample.t - 1 / 12 : null; previous = sample.blackMatch ? sample.t : null; }
    }
    if (blackStart != null && previous != null) blackIntervals.push({start: Math.max(start, blackStart), end: Math.min(start + duration, previous + 1 / 12)});
    results.push({id: v.id, scene: v.scene, interval, status: failed ? 'failed' : 'verified', samples, ...(blackIntervals.length ? {blackIntervals} : {}),
      ...(failed ? {reason: 'rendered capture region does not match recorded footage'} : {})});
  }
  const counts = Object.fromEntries(['verified', 'failed', 'unverified'].map(status => [status, results.filter(r => r.status === status).length]));
  return {method: 'rendered capture regions sampled at 6fps and compared with their recorded source frames; exact untransformed geometry only', coverage: counts,
    complete: counts.unverified === 0 && counts.failed === 0, captures: results};
}
