import React from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

// Thin line icons on a 24×24 grid, drawn to match the HUD strokes.
const ICONS = {
  mic: () => (
    <>
      <Rect x="9" y="3" width="6" height="11" rx="3" />
      <Path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <Line x1="12" y1="17.5" x2="12" y2="21" />
      <Line x1="8.5" y1="21" x2="15.5" y2="21" />
    </>
  ),
  micOff: () => (
    <>
      <Path d="M15 10V6a3 3 0 0 0-5.6-1.5" />
      <Path d="M9 9v2a3 3 0 0 0 4.8 2.4" />
      <Path d="M5.5 11a6.5 6.5 0 0 0 10.6 5" />
      <Path d="M18.4 12.5a6.5 6.5 0 0 0 .1-1.5" />
      <Line x1="12" y1="17.5" x2="12" y2="21" />
      <Line x1="8.5" y1="21" x2="15.5" y2="21" />
      <Line x1="3.5" y1="3.5" x2="20.5" y2="20.5" />
    </>
  ),
  voice: () => (
    <>
      <Line x1="3" y1="10.5" x2="3" y2="13.5" />
      <Line x1="6.5" y1="8" x2="6.5" y2="16" />
      <Line x1="10" y1="4" x2="10" y2="20" />
      <Line x1="13.5" y1="7" x2="13.5" y2="17" />
      <Line x1="17" y1="9.5" x2="17" y2="14.5" />
      <Line x1="20.5" y1="11" x2="20.5" y2="13" />
    </>
  ),
  send: () => (
    <>
      <Path d="M21 3.5 2.8 10.6l6.4 2.3L19 6.5l-7.6 8 .9 6 3.3-4.4 4.7 3.4z" />
    </>
  ),
  reset: () => (
    <>
      <Path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <Path d="M19.5 3.5v4.5H15" />
      <Circle cx="12" cy="12" r="1.2" />
    </>
  ),
};

export default function HudIcon({ name, size = 24, color, strokeWidth = 1.4 }) {
  const Glyph = ICONS[name];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Glyph />
    </Svg>
  );
}
