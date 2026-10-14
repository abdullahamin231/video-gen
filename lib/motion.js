/* Seek-safe primitives. Timelines and cue times belong to the calling scene. */
window.VideoMotion = Object.freeze({
  reveal(tl, target, at, {duration = 0.65, x = 0, y = 35, scale = 1} = {}) {
    tl.fromTo(target, {opacity: 0, x, y, scale},
      {opacity: 1, x: 0, y: 0, scale: 1, duration, ease: 'power3.out'}, at);
  },
  draw(tl, target, at, {duration = 0.8, length = 1000} = {}) {
    tl.fromTo(target, {strokeDasharray: length, strokeDashoffset: length, opacity: 1},
      {strokeDashoffset: 0, duration, ease: 'power2.inOut'}, at);
  },
  flow(tl, target, at, {duration = 0.8, fromX = 0, toX = 200, fromY = 0, toY = 0} = {}) {
    tl.fromTo(target, {opacity: 0, x: fromX, y: fromY},
      {opacity: 1, x: fromX, y: fromY, duration: 0.12}, at);
    tl.to(target, {x: toX, y: toY, duration, ease: 'none'}, at + 0.12);
    tl.to(target, {opacity: 0, duration: 0.12}, at + duration);
  }
});
