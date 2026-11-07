import React, { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

const SIZE = 240;
const TICKS = 36;

export const STATUS_COLORS = {
  off: '#334155',
  standby: '#0891b2',
  listening: '#00e5ff',
  thinking: '#f59e0b',
  speaking: '#38bdf8',
};

const SPIN_MS = {
  off: 0,
  standby: 24000,
  listening: 9000,
  thinking: 1800,
  speaking: 6000,
};

function useLoop(make, deps) {
  useEffect(() => {
    const anim = make();
    anim?.start();
    return () => anim?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

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
      Animated.loop(
        Animated.timing(spin, {
          toValue: 1,
          duration: ms,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ),
      Animated.loop(
        Animated.timing(counterSpin, {
          toValue: 1,
          duration: ms * 1.6,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ),
    ]);
  }, [status]);

  useLoop(() => {
    breath.setValue(0);
    return Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: status === 'speaking' ? 450 : 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: status === 'speaking' ? 450 : 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
  }, [status]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const rotateBack = counterSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['360deg', '0deg'],
  });
  const breathScale = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [1, status === 'speaking' ? 1.12 : 1.05],
  });
  const reactsToVoice = status === 'standby' || status === 'listening';
  const levelScale = level.interpolate({
    inputRange: [0, 1],
    outputRange: [1, reactsToVoice ? 1.45 : 1],
  });
  const haloOpacity = Animated.add(
    breath.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.28] }),
    level.interpolate({
      inputRange: [0, 1],
      outputRange: [0, reactsToVoice ? 0.45 : 0],
    })
  );
  const dim = status === 'off' ? 0.35 : status === 'standby' ? 0.7 : 1;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="JARVIS"
      style={styles.wrap}
    >
      <Animated.View
        style={[
          styles.halo,
          {
            backgroundColor: color,
            opacity: haloOpacity,
            transform: [{ scale: levelScale }],
          },
        ]}
      />

      <Animated.View
        style={[styles.layer, { opacity: dim, transform: [{ rotate }] }]}
      >
        {Array.from({ length: TICKS }, (_, i) => (
          <View
            key={i}
            style={[
              styles.tick,
              {
                backgroundColor: color,
                height: i % 3 === 0 ? 14 : 7,
                opacity: i % 3 === 0 ? 1 : 0.5,
                transform: [
                  { rotate: `${(360 / TICKS) * i}deg` },
                  { translateY: -SIZE / 2 + 10 },
                ],
              },
            ]}
          />
        ))}
      </Animated.View>

      <Animated.View
        style={[
          styles.ring,
          styles.ringOuter,
          {
            borderColor: color,
            opacity: dim,
            transform: [{ rotate: rotateBack }],
          },
        ]}
      >
        <View style={[styles.gap, { top: -3 }]} />
        <View style={[styles.gap, { bottom: -3 }]} />
      </Animated.View>

      <Animated.View
        style={[
          styles.ring,
          styles.ringInner,
          {
            borderColor: color,
            opacity: dim,
            transform: [{ scale: breathScale }],
          },
        ]}
      />

      <Animated.View
        style={[
          styles.core,
          {
            backgroundColor: color,
            shadowColor: color,
            opacity: userSpeaking ? 1 : 0.85 * dim + 0.15,
            transform: [{ scale: Animated.multiply(breathScale, levelScale) }],
          },
        ]}
      >
        <View style={styles.coreInner} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: SIZE * 0.62,
    height: SIZE * 0.62,
    borderRadius: SIZE,
  },
  tick: {
    position: 'absolute',
    width: 3,
    borderRadius: 2,
  },
  ring: {
    position: 'absolute',
    borderRadius: SIZE,
    alignItems: 'center',
  },
  ringOuter: {
    width: SIZE * 0.78,
    height: SIZE * 0.78,
    borderWidth: 2,
  },
  ringInner: {
    width: SIZE * 0.56,
    height: SIZE * 0.56,
    borderWidth: 6,
  },
  gap: {
    position: 'absolute',
    width: 26,
    height: 8,
    backgroundColor: '#05080f',
  },
  core: {
    width: SIZE * 0.3,
    height: SIZE * 0.3,
    borderRadius: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.9,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  coreInner: {
    width: SIZE * 0.13,
    height: SIZE * 0.13,
    borderRadius: SIZE,
    backgroundColor: '#e0fbff',
    opacity: 0.9,
  },
});
