import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
// A neutral native scene fixture for state/evidence tests; no creative judgment is simulated here.
export async function nativeFixture(job,film) {
  await mkdir(path.join(job,'compositions'),{recursive:true});
  for(const scene of film.scenes) {
    scene.kind='html';scene.file=`compositions/${scene.id}.html`;
    await writeFile(path.join(job,scene.file),`<template><div data-composition-id="${scene.id}" style="position:absolute;inset:0;background:#234567"></div><script>window.__timelines['${scene.id}']=gsap.timeline({paused:true});</script></template>`);
  }
  await writeFile(path.join(job,'film.json'),JSON.stringify(film));
}
