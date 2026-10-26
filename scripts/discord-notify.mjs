#!/usr/bin/env node

// Send one approval/checkpoint message to the configured Discord webhook.
// Usage: node scripts/discord-notify.mjs --request-id <stable-id> --message <text>
import {mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
const cacheDir = path.join(root, '.cache');
const ledgerFile = path.join(cacheDir, 'discord-approval-notified.json');
const lockDir = `${ledgerFile}.lock`;

function argsOf(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--request-id' || key === '-r') options.requestId = argv[++i];
    else if (key === '--message' || key === '-m') options.message = argv[++i];
    else throw new Error('Unknown argument.');
  }
  return options;
}

async function acquireLock() {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      await mkdir(lockDir);
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - (await stat(lockDir)).mtimeMs > 120_000) await rm(lockDir, {recursive: true, force: true});
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  throw new Error('Notification lock is busy.');
}

async function readLedger() {
  try {
    const value = JSON.parse(await readFile(ledgerFile, 'utf8'));
    return Array.isArray(value.sent) ? value : {sent: []};
  } catch (error) {
    if (error.code === 'ENOENT') return {sent: []};
    throw error;
  }
}

let requestId, message;
try {
  ({requestId, message} = argsOf(process.argv.slice(2)));
} catch {
  console.error('Usage: node scripts/discord-notify.mjs --request-id <stable-id> --message <text>');
  process.exit(2);
}
if (!requestId?.trim() || !message?.trim()) {
  console.error('Both --request-id and --message are required.');
  process.exit(2);
}
if (message.length > 2000) {
  console.error('Message exceeds Discord’s 2000-character limit.');
  process.exit(2);
}

try {
  if (!process.env.DISCORD_WEBHOOK_URL) process.loadEnvFile(envFile);
} catch {
  console.error('Could not load Discord webhook configuration from .env.');
  process.exit(1);
}

let endpoint;
try {
  endpoint = new URL(process.env.DISCORD_WEBHOOK_URL || '');
  if (endpoint.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(endpoint.hostname) || !endpoint.pathname.startsWith('/api/webhooks/'))
    throw new Error('Invalid webhook endpoint.');
} catch {
  console.error('DISCORD_WEBHOOK_URL is missing or is not a Discord webhook.');
  process.exit(1);
}

await mkdir(cacheDir, {recursive: true});
let locked = false;
try {
  await acquireLock();
  locked = true;
  const ledger = await readLedger();
  if (ledger.sent.some(entry => entry.requestId === requestId)) {
    console.log('Notification already delivered for this request; skipped.');
  } else {
    endpoint.searchParams.set('wait', 'true');
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({content: message, allowed_mentions: {parse: []}}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      console.error('Discord notification request failed; webhook details suppressed.');
      process.exitCode = 1;
    }

    if (response && !response.ok) {
      console.error(`Discord rejected the notification (HTTP ${response.status}); no delivery was confirmed.`);
      process.exitCode = 1;
    } else if (response?.ok) {
      let messageId = null;
      try { messageId = JSON.parse(await response.text()).id ?? null; } catch {}
      const tempFile = `${ledgerFile}.${process.pid}.tmp`;
      ledger.sent.push({requestId, sentAt: new Date().toISOString(), messageId});
      await writeFile(tempFile, JSON.stringify(ledger, null, 2) + '\n', {mode: 0o600});
      await rename(tempFile, ledgerFile);
      console.log(`Discord notification delivered (HTTP ${response.status}${messageId ? ', message confirmed' : ''}).`);
    }
  }
} catch {
  console.error('Discord notification could not be completed; webhook details suppressed.');
  process.exitCode = 1;
} finally {
  if (locked) await rm(lockDir, {recursive: true, force: true}).catch(() => {});
}
