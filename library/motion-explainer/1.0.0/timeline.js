/* Project-owned bridge for Motion Explainer-style pure frame drawing. */
(() => {
  function createTimeline(drawFrame, { duration, fps, gsap = window.gsap } = {}) {
    if (typeof drawFrame !== 'function' || !Number.isFinite(duration) || duration <= 0 ||
        !Number.isFinite(fps) || fps <= 0 || !gsap?.timeline) {
      throw new TypeError('Supply drawFrame, positive duration/fps and GSAP');
    }
    // A property setter runs even when seek suppresses GSAP callbacks. No onUpdate,
    // wall clock, shared window.renderFrame or preview loop owns the picture.
    const clock = { value: 0 };
    Object.defineProperty(clock, 'seconds', {
      get() { return clock.value; },
      set(seconds) {
        clock.value = Math.max(0, Math.min(duration, seconds));
        const frame = Math.min(Math.ceil(duration * fps) - 1,
          Math.floor(clock.value * fps + 1e-7));
        drawFrame(frame, frame / fps);
      }
    });
    clock.seconds = 0;
    return gsap.timeline({ paused: true }).fromTo(clock,
      { seconds: 0 }, { seconds: duration, duration, ease: 'none' }, 0);
  }
  window.MotionExplainer = Object.freeze({ createTimeline });
})();
