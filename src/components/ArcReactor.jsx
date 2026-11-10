import React, { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Line,
  RadialGradient,
  Stop,
} from 'react-native-svg';

export const SIZE = 260;
const C = SIZE / 2;

export const STATUS_COLORS = {
  off: '#3a4f5c',
  standby: '#2bb8d9',
  listening: '#4fe3ff',
  thinking: '#ffb54a',
  speaking: '#7fe9ff',
};

const SPIN_MS = {
  off: 0,
  standby: 40000,
  listening: 14000,
  thinking: 2600,
  speaking: 9000,
};

const TICKS = 90;
const TICK_LINES = Array.from({ length: TICKS }, (_, i) => {
  const a = (2 * Math.PI * i) / TICKS;
  const major = i % 5 === 0;
  const r1 = major ? C - 15 : C - 10;
  const r2 = C - 5;
  return {
    x1: C + r1 * Math.sin(a),
    y1: C - r1 * Math.cos(a),
    x2: C + r2 * Math.sin(a),
    y2: C - r2 * Math.cos(a),
    major,
  };
});

// Dash patterns: arcs of uneven length read as "machined" rather than drawn.
const ARC_R = C * 0.8;
const ARC_LEN = 2 * Math.PI * ARC_R;
const ARC_DASH = [
  0.23, 0.03, 0.01, 0.03, 0.13, 0.03, 0.01, 0.03, 0.28, 0.03, 0.01, 0.03, 0.13,
]
  .map((f) => f * ARC_LEN)
  .join(' ');
const COIL_R = C * 0.62;
const COIL_SEG = (2 * Math.PI * COIL_R) / 12;
const COIL_DASH = `${COIL_SEG - 7} 7`;

function useLoop(make, deps) {
  useEffect(() => {
    const anim = make();
    anim?.start();
    return () => anim?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const spinLoop = (value, ms) =>
  Animated.loop(
    Animated.timing(value, {
      toValue: 1,
      duration: ms,
      easing: Easing.linear,
      useNativeDriver: true,
    })
  );

export default function ArcReactor({ status, level, userSpeaking, onPress }) {
  const [spin] = useState(() => new Animated.Value(0));
  const [counterSpin] = useState(() => new Animated.Value(0));
  const [breath] = useState(() => new Animated.Value(0));
  const color = STATUS_COLORS[status] || STATUS_COLORS.standby;

  useLoop(() => {
    const ms = SPIN_MS[status];
    if (!ms) return null;
    spin.setValue(0);
    counterSpin.setValue(0);
    return Animated.parallel([
      spinLoop(spin, ms),
      spinLoop(counterSpin, ms * 0.7),
    ]);
  }, [status]);

  useLoop(() => {
    const ms = status === 'speaking' ? 420 : 2000;
    breath.setValue(0);
    const step = (toValue) =>
      Animated.timing(breath, {
        toValue,
        duration: ms,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      });
    return Animated.loop(Animated.sequence([step(1), step(0)]));
  }, [status]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const rotateBack = counterSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['360deg', '0deg'],
  });
  const coilRotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '120deg'],
  });
  const breathScale = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [1, status === 'speaking' ? 1.09 : 1.035],
  });
  const reactsToVoice = status === 'standby' || status === 'listening';
  const levelScale = level.interpolate({
    inputRange: [0, 1],
    outputRange: [1, reactsToVoice ? 1.35 : 1],
  });
  const voiceRingScale = level.interpolate({
    inputRange: [0, 1],
    outputRange: [1, reactsToVoice ? 1.55 : 1],
  });
  const voiceRingOpacity = level.interpolate({
    inputRange: [0, 0.05, 1],
    outputRange: [0, reactsToVoice ? 0.5 : 0, reactsToVoice ? 0.9 : 0],
  });
  const haloOpacity = Animated.add(
    breath.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.75] }),
    level.interpolate({
      inputRange: [0, 1],
      outputRange: [0, reactsToVoice ? 0.25 : 0],
    })
  );
  const dim = status === 'off' ? 0.35 : status === 'standby' ? 0.75 : 1;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="JARVIS"
      style={styles.wrap}
    >
      {/* Ambient glow behind everything */}
      <Animated.View style={[styles.layer, { opacity: haloOpacity }]}>
        <Svg width={SIZE} height={SIZE}>
          <Defs>
            <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={color} stopOpacity="0.35" />
              <Stop offset="0.45" stopColor={color} stopOpacity="0.1" />
              <Stop offset="1" stopColor={color} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx={C} cy={C} r={C} fill="url(#halo)" />
        </Svg>
      </Animated.View>

      {/* Outer tick ring */}
      <Animated.View
        style={[styles.layer, { opacity: dim, transform: [{ rotate }] }]}
      >
        <Svg width={SIZE} height={SIZE}>
          <Circle
            cx={C}
            cy={C}
            r={C - 2}
            stroke={color}
            strokeOpacity={0.18}
            strokeWidth={0.75}
            fill="none"
          />
          {TICK_LINES.map((t, i) => (
            <Line
              key={i}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke={color}
              strokeWidth={t.major ? 1.6 : 0.9}
              strokeOpacity={t.major ? 0.95 : 0.4}
            />
          ))}
        </Svg>
      </Animated.View>

      {/* Counter-rotating arc segments */}
      <Animated.View
        style={[
          styles.layer,
          { opacity: dim, transform: [{ rotate: rotateBack }] },
        ]}
      >
        <Svg width={SIZE} height={SIZE}>
          <Circle
            cx={C}
            cy={C}
            r={ARC_R}
            stroke={color}
            strokeWidth={2.2}
            strokeDasharray={ARC_DASH}
            fill="none"
          />
          <Circle
            cx={C}
            cy={C}
            r={ARC_R - 9}
            stroke={color}
            strokeOpacity={0.45}
            strokeWidth={1}
            strokeDasharray="1.5 5"
            fill="none"
          />
        </Svg>
      </Animated.View>

      {/* Segmented coil ring */}
      <Animated.View
        style={[
          styles.layer,
          {
            opacity: dim,
            transform: [{ rotate: coilRotate }, { scale: breathScale }],
          },
        ]}
      >
        <Svg width={SIZE} height={SIZE}>
          <Circle
            cx={C}
            cy={C}
            r={COIL_R + 9}
            stroke={color}
            strokeOpacity={0.35}
            strokeWidth={0.8}
            fill="none"
          />
          <Circle
            cx={C}
            cy={C}
            r={COIL_R}
            stroke={color}
            strokeOpacity={0.85}
            strokeWidth={9}
            strokeDasharray={COIL_DASH}
            fill="none"
          />
          <Circle
            cx={C}
            cy={C}
            r={COIL_R - 9}
            stroke={color}
            strokeOpacity={0.35}
            strokeWidth={0.8}
            fill="none"
          />
        </Svg>
      </Animated.View>

      {/* Voice ring: expands with the microphone level */}
      <Animated.View
        style={[
          styles.layer,
          { opacity: voiceRingOpacity, transform: [{ scale: voiceRingScale }] },
        ]}
      >
        <Svg width={SIZE} height={SIZE}>
          <Circle
            cx={C}
            cy={C}
            r={C * 0.36}
            stroke={color}
            strokeWidth={1.5}
            fill="none"
          />
        </Svg>
      </Animated.View>

      {/* Core */}
      <Animated.View
        style={[
          styles.layer,
          {
            opacity: userSpeaking ? 1 : 0.85 * dim + 0.15,
            transform: [{ scale: Animated.multiply(breathScale, levelScale) }],
          },
        ]}
      >
        <Svg width={SIZE} height={SIZE}>
          <Defs>
            <RadialGradient id="core" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#ffffff" stopOpacity="1" />
              <Stop offset="0.22" stopColor="#e6fbff" stopOpacity="0.95" />
              <Stop offset="0.4" stopColor={color} stopOpacity="0.85" />
              <Stop offset="0.7" stopColor={color} stopOpacity="0.18" />
              <Stop offset="1" stopColor={color} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx={C} cy={C} r={C * 0.42} fill="url(#core)" />
          <Circle
            cx={C}
            cy={C}
            r={C * 0.2}
            stroke="#e6fbff"
            strokeOpacity={0.55}
            strokeWidth={1}
            fill="none"
          />
        </Svg>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: SIZE,
    height: SIZE,
  },
  // Explicit size instead of absoluteFill: with the native-driven rotation,
  // an absoluteFill layer spun around the wrong pivot on Android.
  layer: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SIZE,
    height: SIZE,
  },
});
