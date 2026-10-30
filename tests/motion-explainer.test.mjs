import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import pkg from 'gsap/dist/gsap.js';

const source = await readFile(new URL('../library/motion-explainer/1.0.0/timeline.js', import.meta.url), 'utf8');

test('Canvas bridge redraws on callback-suppressed backward seeks and isolates clocks', () => {
  const window = { gsap: pkg.gsap };
  vm.runInNewContext(source, { window });
  let frame, otherFrame;
  const timeline = window.MotionExplainer.createTimeline(f => { frame = f; }, { duration: 6, fps: 30 });
  const other = window.MotionExplainer.createTimeline(f => { otherFrame = f; }, { duration: 2, fps: 24 });
  try {
    for (const t of [0, 3, 5.9, 1, 3, 0, 6]) {
      timeline.seek(t, true);
      assert.equal(frame, Math.min(179, Math.floor(t * 30 + 1e-7)));
      assert.equal(otherFrame, 0);
    }
    other.seek(1, true);
    assert.equal(otherFrame, 24);
    assert.equal(frame, 179);
    assert.throws(() => window.MotionExplainer.createTimeline(() => {}, { duration: 0, fps: 30 }), /positive duration/);
  } finally {
    timeline.kill(); other.kill(); pkg.gsap.ticker.sleep();
  }
});
