import {Composition} from 'remotion';
import {VideoGen} from './VideoGen';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="VideoGen"
        component={VideoGen}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
