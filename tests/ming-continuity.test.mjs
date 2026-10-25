import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('Ming holds its acoustic reference across fragments and performance segments', async () => {
  await promisify(execFile)('python3', [fileURLToPath(new URL('./ming_continuity_test.py', import.meta.url))]);
});
