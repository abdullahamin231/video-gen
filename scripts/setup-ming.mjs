// Invoked through npm run video -- tts --setup-ming. All downloads stay in this checkout.
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cacheDir } from '../lib/cache.mjs';
export async function setupMing() {
  const cache = cacheDir(), home = path.join(cache, 'ming-benchmark'), source = path.join(home, 'source');
  await mkdir(path.join(home, 'tmp'), { recursive: true });
  const env = { ...process.env, TMPDIR: path.join(home, 'tmp'), PIP_CACHE_DIR: path.join(cache, 'pip'), HF_HOME: path.join(cache, 'huggingface'), XDG_CACHE_HOME: cache };
  delete env.HF_HUB_OFFLINE;
  const run = (command, args) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
  const exists = file => access(file).then(() => true, () => false);
  if (!await exists(source)) {
    await run('git', ['clone', 'https://github.com/inclusionAI/Ming-3.0-tts.git', source]);
    await run('git', ['-C', source, 'checkout', '028c1eace193e7acdb256453da89b6e9207e052b']);
  }
  const modeling = path.join(source, 'modeling_bailingmm.py');
  const original = await readFile(modeling, 'utf8');
  await writeFile(modeling, original.replaceAll("torch.autocast(device_type='cuda', dtype=torch.bfloat16)", 'torch.autocast(device_type=self.device.type, dtype=torch.bfloat16)'));
  const python = path.join(home, 'env/bin/python');
  if (!await exists(python)) await run(process.env.MING_SETUP_PYTHON || 'python3.12', ['-m', 'venv', path.join(home, 'env')]);
  await run(python, ['-m', 'pip', 'install', 'torch==2.6.0', 'torchaudio==2.6.0', '--index-url', 'https://download.pytorch.org/whl/cpu']);
  await run(python, ['-m', 'pip', 'install', '-r', path.join(source, 'requirements.txt')]);
  await run(python, ['-c', 'from huggingface_hub import snapshot_download; import sys; snapshot_download(repo_id="inclusionAI/Ming-3.0-tts-0.5B", revision="8d66b70a00f05ad183fa8a863b4ce609fc83cbc0", local_dir=sys.argv[1])', path.join(home, 'model')]);
  console.log('Ming CPU narration is installed. Use --provider ming --narration with ming-performance.json.');
}
