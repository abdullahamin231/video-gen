import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {evalCam, livingCam} from './camera';
import {S1_CAM, Scene1} from './Scene1';
import {S2_CAM, Scene2} from './Scene2';
import {B, F, S1_SHAKE, S2_SHAKE, SCENE_CUT} from './beats';
import {Background} from './Background';
import {Chrome, IntroTitle, TransitionFX, Glitch, zoomBlur} from './Overlay';
import {clamp01, E} from './ease';

export const Bonkers: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const isS1 = frame < F(SCENE_CUT);

  // continuous virtual camera (keyframes + idle drift + impact shake)
  const base = evalCam(isS1 ? S1_CAM : S2_CAM, frame);
  const cam = livingCam(base, frame, {driftAmp: 9, shake: isS1 ? S1_SHAKE : S2_SHAKE});

  // zoom-through transition state
  const {blur, scale} = zoomBlur(frame);

  // brain-glitch intensity (scene 1)
  const brainGlitch = isS1
    ? clamp01(1 - Math.abs(frame - (F(B.brain) + 8)) / 14) * 0.9
    : 0;

  return (
    <AbsoluteFill style={{background: '#05060a', overflow: 'hidden'}}>
      {/* living background (far layer, self-animating) */}
      <Background frame={frame} hue={isS1 ? [205, 262] : [262, 320]} intensity={1} />

      {/* the world (parallax + camera), blurred/scaled through the cut */}
      <AbsoluteFill
        style={{
          filter: blur > 0.4 ? `blur(${blur}px)` : 'none',
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        {isS1 ? <Scene1 frame={frame} cam={cam} /> : <Scene2 frame={frame} cam={cam} />}
      </AbsoluteFill>

      {/* overlays */}
      <Glitch frame={frame} intensity={brainGlitch} />
      {isS1 ? <IntroTitle frame={frame} /> : null}
      <TransitionFX frame={frame} />
      <Chrome frame={frame} duration={durationInFrames} />
    </AbsoluteFill>
  );
};
