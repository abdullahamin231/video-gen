// Run under `flock -x`: the same process that owns the kernel lock performs the
// complete omission ledger read/modify/atomic-replace transaction.
import path from 'node:path';
import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const {captureDir, update: {scene, capture, actionsSha256, records, ranges, expectedActionIndexes}} = JSON.parse(input);
const file = path.join(captureDir, 'omissions.json');
let saved = null;
try { saved = JSON.parse(await readFile(file, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (saved && (!Array.isArray(saved.records) || saved.records.some(record => !record || typeof record.scene !== 'string' || !record.scene)))
  throw new Error('capture/omissions.json contains legacy or malformed scene-less records that cannot be scoped safely. Migrate each record to the scene proved by its edits.json and action-log evidence, or recapture the affected scene; no records were changed.');
// Deterministic crash-window hook used only by the lock regression test.
if (process.env.APPREVIEW_OMISSION_TEST_PAUSE_FILE) {
  await writeFile(process.env.APPREVIEW_OMISSION_TEST_PAUSE_FILE, 'read-under-lock\n');
  await new Promise(() => {});
}
const preserved = (saved?.records ?? []).filter(record => record.scene !== scene);
const nextRecords = [...preserved, ...records.map(record => ({scene, ...record}))];
const scenes = (saved?.scenes ?? []).filter(item => item.scene !== scene);
scenes.push({scene, actionsSha256, omissionCount: records.length, ranges, expectedActionIndexes});
const next = {version: 2, capture, actionsSha256, scenes, records: nextRecords};
const temporary = path.join(captureDir, `.omissions.${process.pid}.${randomUUID()}.tmp`);
try {
  await writeFile(temporary, JSON.stringify(next, null, 2) + '\n');
  await rename(temporary, file);
} finally {
  await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
