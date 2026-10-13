import React, {useEffect, useRef, useState} from 'react';
import {continueRender, delayRender, staticFile, useCurrentFrame} from 'remotion';

/**
 * Hyperframes renderer.
 * The Hyperframes authoring lives in public/hf/index.html — a single paused,
 * seek-safe GSAP master timeline exposing window.seekTo(seconds).
 * We drive it frame-accurately from Remotion via a same-origin iframe.
 */
export const HyperframesVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [handle] = useState(() => delayRender('hyperframes-load', {timeoutInMilliseconds: 90000}));
  const [loaded, setLoaded] = useState(false);
  const resumed = useRef(false);

  // Seek the paused timeline to the current frame's timestamp.
  useEffect(() => {
    if (!loaded) return;
    const win = iframeRef.current?.contentWindow as
      | (Window & {seekTo?: (s: number) => boolean})
      | undefined;
    if (!win || typeof win.seekTo !== 'function') return;
    try {
      win.seekTo(t);
      if (!resumed.current) {
        resumed.current = true;
        continueRender(handle);
      }
    } catch (e) {
      // Surface timeline errors instead of silently hanging.
      // eslint-disable-next-line no-console
      console.error('HF seekTo failed', e);
      if (!resumed.current) {
        resumed.current = true;
        continueRender(handle);
      }
    }
  });

  return (
    <div style={{width: 1920, height: 1080, background: '#f4f1ea'}}>
      <iframe
        ref={iframeRef}
        src={staticFile('hf/index.html')}
        width={1920}
        height={1080}
        style={{border: 'none', display: 'block'}}
        title="hyperframes"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
};
