import path from 'node:path';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from './backend/server.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Server settings (VG_UI_HOST, VG_UI_PASSWORD, PORT) may live in an ignored .env so they stay out of shell history.
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const flag = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const port = Number(flag('--port') ?? process.env.PORT ?? 4310);
const host = flag('--host') ?? process.env.VG_UI_HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Provide a port between 0 and 65535');
// Agents inherit this environment, so the password leaves it once read.
const password = process.env.VG_UI_PASSWORD || undefined; delete process.env.VG_UI_PASSWORD;
let app;
try { app = await createApp({ root, password }); }
catch (error) { console.error(error.message); process.exit(1); }
try {
  const url = await app.start(port, host);
  const actual = app.server.address().port;
  const addresses = ['0.0.0.0', '::'].includes(host)
    ? Object.values(networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => `http://${a.address}:${actual}`)
    : [];
  console.log(`\nVideo workspace\nLocal: ${url}${addresses.map(a => `\nNetwork: ${a}`).join('')}${password ? '\nPassword required (VG_UI_PASSWORD)' : ''}\nReal CLI runner · existing provider logins · state in .video/ui\n`);
}
catch (error) { console.error(error.message); process.exit(1); }
let closing = false;
for (const name of ['SIGINT', 'SIGTERM']) process.on(name, () => { if (closing) return; closing = true; const timer = setTimeout(() => process.exit(0), 6000); timer.unref(); void app.close().then(() => process.exit(0)); });
