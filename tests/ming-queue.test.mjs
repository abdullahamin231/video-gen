import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('Ming serializes separate processes in FIFO order and recovers after cancellation, crash and failure', async () => {
  await promisify(execFile)('python3', [fileURLToPath(new URL('./ming_queue_test.py', import.meta.url))], { timeout: 30000 });
});
