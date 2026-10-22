// Repository TTS entry point: keep the legacy Kokoro options, with Gemini and whole-script narration added.
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { generateSpeech, TTS_PROVIDERS } from '../lib/tts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The UI loads .env too; standalone `npm run video -- tts` uses the same credentials.
if (await access(path.join(root, '.env')).then(() => true, () => false)) process.loadEnvFile(path.join(root, '.env'));
try {
  if (process.argv[2] === '--setup-ming') {
    const { setupMing } = await import('./setup-ming.mjs');
    await setupMing();
    process.exit(0);
  }
  if (process.argv[2] === '--benchmark') {
    const { benchmark } = await import('./tts-benchmark.mjs');
    await benchmark(process.argv.slice(3));
    process.exit(0);
  }
  const args = process.argv.slice(2), kokoroArgs = [];
  let performanceFile;
  let provider = process.env.VIDEO_TTS_PROVIDER || 'kokoro', narration = false, statusFile = process.env.VIDEO_TTS_STATUS || '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--narration') narration = true;
    else if (['--provider', '--status', '--performance'].includes(args[i])) {
      const flag = args[i], value = args[++i];
      if (!value || value.startsWith('-')) throw new Error(`${flag} needs a value.`);
      if (flag === '--provider') provider = value; else if (flag === '--performance') performanceFile = value; else statusFile = value;
    } else kokoroArgs.push(args[i]);
  }
  if (!TTS_PROVIDERS.includes(provider)) throw new Error('Choose kokoro, ming or gemini for narration.');
  if (performanceFile && provider !== 'ming') throw new Error('--performance is only supported for Ming.');
  if (!narration && provider === 'kokoro') {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, 'scripts/tts-kokoro.mjs'), ...kokoroArgs], { stdio: 'inherit' });
      child.on('error', reject); child.on('close', resolve);
    });
    process.exitCode = code ?? 1;
  } else {
    const opts = { voice: 'am_michael', speed: 1 };
    let input;
    for (let i = 0; i < kokoroArgs.length; i++) {
      const arg = kokoroArgs[i];
      if (['-v', '--voice', '-s', '--speed', '-o', '--output'].includes(arg)) {
        const value = kokoroArgs[++i];
        if (!value || value.startsWith('-')) throw new Error(`${arg} needs a value.`);
        if (['-v', '--voice'].includes(arg)) opts.voice = value;
        else if (['-s', '--speed'].includes(arg)) opts.speed = Number(value);
        else opts.output = path.resolve(value);
      } else if (arg.startsWith('-') || input) throw new Error(`Unsupported TTS argument: ${arg}`);
      else input = arg;
    }
    if (!input) throw new Error('Pass a script file to generate narration.');
    opts.output ||= path.resolve(path.dirname(input), narration ? 'narration.wav' : `${path.basename(input, path.extname(input))}.wav`);
    if (provider === 'ming' && narration) performanceFile ||= path.join(path.dirname(input), 'ming-performance.json');
    if (performanceFile) {
      try { opts.performance = JSON.parse(await readFile(performanceFile, 'utf8')); }
      catch (error) { throw new Error(`Cannot load Ming delivery plan ${performanceFile}: ${error.message}. See docs/tts.md.`); }
    }
    const status = await generateSpeech({ ...opts, text: await readFile(input, 'utf8'), provider, narration,
      ...(statusFile ? { statusFile: path.resolve(statusFile) } : {}) });
    console.log(`Narration saved: ${opts.output} (${status.usedProvider === 'gemini' ? status.model : status.usedProvider}${status.fallback ? '; Gemini quota fallback' : ''}).`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
