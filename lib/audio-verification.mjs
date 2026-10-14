import {spawn} from 'node:child_process';

const SAMPLE_RATE = 8000;
const METHOD = 'ffmpeg-8khz-mono-waveform-comparison-v1';
const LIMITATION = 'Heuristic comparison of decoded waveforms, not listening, exact sample preservation, word recognition, or proof of intelligibility. No time-shift or gain correction is applied. Significant mixes or processing may fail despite preserved narration.';

// Buffering keeps the comparison simple and deterministic. One hour of 8 kHz
// float32 audio occupies about 115 MB per input, plus temporary decoding copies.
function decode(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error',
      '-threads', '1', '-i', file, '-map', '0:a:0', '-vn', '-ac', '1',
      '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'],
    {stdio: ['ignore', 'pipe', 'pipe']});
    const chunks = [];
    let diagnostic = '';
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-2000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) :
      reject(new Error(`FFmpeg decode failed (${code}): ${diagnostic.trim()}`)));
  });
}

export async function compareNarration(renderPath, narrationPath) {
  const report = {ok: false, method: METHOD, sampleRate: SAMPLE_RATE,
    correlation: null, normalizedError: null, durationDifference: null,
    limitation: LIMITATION};
  try {
    const [render, narration] = await Promise.all([decode(renderPath), decode(narrationPath)]);
    if (render.length % 4 || narration.length % 4) throw new Error('Incomplete float32 decode');
    const renderLength = render.length / 4, narrationLength = narration.length / 4;
    report.durationDifference = Math.abs(renderLength - narrationLength) / SAMPLE_RATE;
    const count = Math.max(renderLength, narrationLength);
    if (!count) throw new Error('No decoded audio samples');
    let renderEnergy = 0, narrationEnergy = 0, product = 0, difference = 0;
    // Missing tail samples are zero-padded for metrics, never discarded. This
    // prevents an unchanged prefix from approving a truncated recording.
    for (let i = 0; i < count; i++) {
      const a = i < renderLength ? render.readFloatLE(i * 4) : 0;
      const b = i < narrationLength ? narration.readFloatLE(i * 4) : 0;
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Nonfinite decoded audio sample');
      renderEnergy += a * a;
      narrationEnergy += b * b;
      product += a * b;
      difference += (a - b) ** 2;
    }
    if (Math.sqrt(renderEnergy / count) <= 1e-5 || Math.sqrt(narrationEnergy / count) <= 1e-5) {
      throw new Error('Silent or near-silent audio cannot verify narration');
    }
    report.correlation = Math.max(-1, Math.min(1, product / Math.sqrt(renderEnergy * narrationEnergy)));
    report.normalizedError = Math.sqrt(difference / narrationEnergy);
    report.ok = report.correlation >= 0.995 && report.normalizedError <= 0.10 && report.durationDifference <= 0.05;
    return report;
  } catch (error) {
    report.limitation += ` Comparison unavailable: ${error.message}`;
    return report;
  }
}
