import {Composition} from 'remotion';
import {RemotionVideo} from './remotion/VideoGen';
import {HyperframesVideo} from './hyperframes/VideoGen';
import {DiscretionVideo} from './discretion/VideoGen';
import {Bonkers} from './bonkers/Bonkers';
import {TOTAL_FRAMES, FPS} from './timeline';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Bonkers"
        component={Bonkers}
        durationInFrames={1800}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="RemotionOnly"
        component={RemotionVideo}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="HyperframesOnly"
        component={HyperframesVideo}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="AgentDiscretion"
        component={DiscretionVideo}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
      />
    </>
  );
};
