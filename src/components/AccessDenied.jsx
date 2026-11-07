import React, { useEffect, useState } from 'react';
import { View, Text, Animated, Easing } from 'react-native';
import { BlurView } from 'expo-blur';
import { styles } from '../styles/mainStyles';

export default function AccessDenied() {
  const [pulseAnim] = useState(() => new Animated.Value(1));

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: 800,
          useNativeDriver: true,
          easing: Easing.out(Easing.quad),
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
          easing: Easing.in(Easing.quad),
        }),
      ])
    ).start();
  }, [pulseAnim]);

  return (
    <View style={styles.deniedContainer}>
      <BlurView intensity={90} tint="dark" style={styles.blurBox}>
        <Animated.Text
          style={[styles.lockIcon, { transform: [{ scale: pulseAnim }] }]}
        >
          🔒
        </Animated.Text>
        <Text style={styles.deniedText}>Access Denied</Text>
        <Text style={styles.subText}>Authentication Required</Text>
      </BlurView>
    </View>
  );
}
