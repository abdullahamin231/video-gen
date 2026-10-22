import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {createProject} from '../lib/project.mjs';
import {serveWatch} from '../lib/watch.mjs';
import {REVIEW_URL, watchInstructions} from '../lib/review-location.mjs';

test('T3 review serves the script and film read-only without starting the old UI', async t => {
  const cache = path.resolve('.cache/tests');
  await mkdir(cache, {recursive: true});
  const root = await mkdtemp(path.join(cache, 'watch-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await createProject(root, {name: 'demo', brief: 'A fixture film'});
  const script = path.join(root, 'jobs/scripts/demo');
  await writeFile(path.join(script, 'SCRIPT.md'), '# Fixture script\nRead this in your browser.');
  await writeFile(path.join(script, 'review.md'), 'Disposition: pass');
  const job = path.join(root, 'jobs/demo');
  await mkdir(job, {recursive: true});
  await writeFile(path.join(job, 'index.html'), '<html><head></head><body>Fixture film</body></html>');
  await writeFile(path.join(job, 'timing.json'), '{"scenes":[]}');
  const projectBefore = await readFile(path.join(script, 'project.json'), 'utf8');
  const {server, url} = await serveWatch(root, 'demo');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

  const instructions = watchInstructions(url, 'demo', false);
  assert.ok(instructions.includes(`tailscale serve --bg --https=8443 ${url}`));
  assert.ok(instructions.includes(`Review: ${REVIEW_URL}`));
  assert.match(instructions, /only change the review route on 8443/);
  assert.doesNotMatch(instructions, /preview_open/);

  const overview = await fetch(url).then(r => r.text());
  assert.match(overview, /Fixture script/);
  assert.match(overview, /Disposition: pass/);
  assert.match(overview, /href="player\/"/);
  assert.match(overview, /Reply in the chat to approve/);
  const player = await fetch(url + 'player/').then(r => r.text());
  assert.match(player, /hyperframes-player/);
  const film = await fetch(url + 'player/film/index.html').then(r => r.text());
  assert.match(film, /Fixture film/);
  assert.match(film, /src="\/player\/runtime.js"/);
  assert.equal((await fetch(url + 'player/player.js')).status, 200);
  assert.equal((await fetch(url, {method: 'POST', body: 'approve'})).status, 405);
  assert.equal((await fetch(url + 'file/jobs/scripts/demo/BRIEF.md')).status, 200);
  assert.equal((await fetch(url + 'file/video.config.json')).status, 403);
  assert.equal(await readFile(path.join(script, 'project.json'), 'utf8'), projectBefore);
});
