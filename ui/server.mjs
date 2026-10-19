import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './backend/server.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = process.argv.indexOf('--port');
const port = Number(index < 0 ? process.env.PORT || 4310 : process.argv[index + 1]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Provide a port between 1 and 65535');
const app = await createApp({ root });
try { const url = await app.start(port); console.log(`\nVideo workspace\nLocal: ${url}\nReal CLI runner · existing provider logins · state in .video/ui\n`); }
catch (error) { console.error(error.message); process.exit(1); }
let closing = false;
for (const name of ['SIGINT', 'SIGTERM']) process.on(name, () => { if (closing) return; closing = true; const timer = setTimeout(() => process.exit(0), 6000); timer.unref(); void app.close().then(() => process.exit(0)); });
