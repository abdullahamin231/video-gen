import React from 'react';
import {CamState, layerTransform} from './camera';

/** A parallax layer: content laid out in screen coords, moved by the camera
 *  according to `depth` (0 = far/slow, 1 = locked, >1 = foreground). */
export const Par: React.FC<{
  cam: CamState;
  depth: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({cam, depth, children, style}) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      transform: layerTransform(cam, depth),
      transformOrigin: 'center center',
      willChange: 'transform',
      ...style,
    }}
  >
    {children}
  </div>
);

/** Absolutely-positioned world object anchored by its center. */
export const At: React.FC<{
  x: number;
  y: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({x, y, children, style}) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: y,
      transform: 'translate(-50%, -50%)',
      ...style,
    }}
  >
    {children}
  </div>
);
