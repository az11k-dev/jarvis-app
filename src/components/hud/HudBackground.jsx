import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, {
  Defs,
  Path,
  Pattern,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { COLORS } from '../../styles/mainStyles';

const CELL = 26;

/** Faint holographic grid with a glow behind the reactor and dark edges. */
export default function HudBackground() {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <Pattern
          id="grid"
          width={CELL}
          height={CELL}
          patternUnits="userSpaceOnUse"
        >
          <Path
            d={`M ${CELL} 0 L 0 0 0 ${CELL}`}
            stroke={COLORS.cyan}
            strokeOpacity={0.045}
            strokeWidth={0.75}
            fill="none"
          />
        </Pattern>
        <RadialGradient id="glow" cx="50%" cy="27%" r="60%">
          <Stop offset="0" stopColor="#0b3247" stopOpacity="0.55" />
          <Stop offset="1" stopColor={COLORS.bg} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="vignette" cx="50%" cy="45%" r="75%">
          <Stop offset="0.55" stopColor={COLORS.bg} stopOpacity="0" />
          <Stop offset="1" stopColor="#000000" stopOpacity="0.85" />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#glow)" />
      <Rect width="100%" height="100%" fill="url(#grid)" />
      <Rect width="100%" height="100%" fill="url(#vignette)" />
    </Svg>
  );
}
