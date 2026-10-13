import {useCurrentFrame, useVideoConfig, interpolate, spring} from 'remotion';

export const VideoGen: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const scale = spring({
    frame,
    fps,
    config: {
      damping: 200,
    },
  });

  const opacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0a0a0a',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          opacity,
          textAlign: 'center',
        }}
      >
        <h1
          style={{
            color: '#ffffff',
            fontSize: '4rem',
            fontWeight: 'bold',
            margin: 0,
          }}
        >
          Audio + Script → Video
        </h1>
        <p
          style={{
            color: '#888888',
            fontSize: '1.5rem',
            marginTop: '1rem',
          }}
        >
          Powered by Remotion, Hyperframes & Manim
        </p>
      </div>
    </div>
  );
};
