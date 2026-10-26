import { spawn } from 'node:child_process';

// A Stop must reach the model (and ffmpeg), not leave an orphan burning CPU.
export function spawnTts(command, args, options) {
  const child = spawn(command, args, { ...options, detached: process.platform !== 'win32' });
  let cancelled = false, escalation;
  const kill = signal => {
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const stop = () => {
    cancelled = true;
    kill('SIGTERM');
    escalation ||= setTimeout(() => kill('SIGKILL'), 5000);
    escalation.unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  const cleanup = () => {
    clearTimeout(escalation);
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  };
  child.once('close', cleanup);
  child.once('error', cleanup);
  return { child, isCancelled: () => cancelled };
}
