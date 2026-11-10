import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView } from 'expo-camera';
import { VISION_PHOTO_QUALITY, VISION_SCAN } from '../config/jarvis';
import { setScannerHandler } from '../services/scanner';
import { COLORS, FONTS } from '../styles/mainStyles';

const FRAME = 260;

/**
 * Full-screen HUD that JARVIS opens for analyze_image: live camera preview,
 * scan frame and sweep line. It shoots by itself once focus has settled;
 * a tap anywhere cancels.
 */
export default function VisionScanner() {
  const [request, setRequest] = useState(null); // { facing }
  const pending = useRef(null); // { resolve, reject, timers, cleanup }
  const camera = useRef(null);
  const [sweep] = useState(() => new Animated.Value(0));

  const finish = useCallback((result, error) => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    p.timers.forEach(clearTimeout);
    p.cleanup?.();
    setRequest(null);
    if (error) p.reject(error);
    else p.resolve(result);
  }, []);

  useEffect(
    () =>
      setScannerHandler(
        ({ facing, signal }) =>
          new Promise((resolve, reject) => {
            finish(null); // a previous scan still open
            const onAbort = () => finish(null);
            signal?.addEventListener('abort', onAbort);
            pending.current = {
              resolve,
              reject,
              cleanup: () => signal?.removeEventListener('abort', onAbort),
              timers: [
                setTimeout(
                  () => finish(null, new Error('Camera did not start.')),
                  VISION_SCAN.readyTimeoutMs
                ),
              ],
            };
            setRequest({ facing });
          })
      ),
    [finish]
  );

  useEffect(() => {
    if (!request) return;
    sweep.setValue(0);
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [request, sweep]);

  const onReady = () => {
    const p = pending.current;
    if (!p) return;
    p.timers.forEach(clearTimeout);
    // Give autofocus and exposure a moment, then shoot.
    p.timers = [
      setTimeout(async () => {
        try {
          const photo = await camera.current?.takePictureAsync({
            base64: true,
            quality: VISION_PHOTO_QUALITY,
            exif: false,
            shutterSound: false,
          });
          finish(photo?.base64 || null);
        } catch (e) {
          finish(null, e);
        }
      }, VISION_SCAN.settleMs),
    ];
  };

  const translateY = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [0, FRAME - 2],
  });

  return (
    <Modal
      visible={!!request}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => finish(null)}
    >
      {request && (
        <Pressable style={s.root} onPress={() => finish(null)}>
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing={request.facing}
            animateShutter={false}
            onCameraReady={onReady}
            onMountError={(e) =>
              finish(null, new Error(e?.message || 'Camera error.'))
            }
          />
          <View style={s.overlay} pointerEvents="none">
            <Text style={s.title}>SCANNING</Text>
            <View style={s.frame}>
              <View style={[s.corner, s.tl]} />
              <View style={[s.corner, s.tr]} />
              <View style={[s.corner, s.bl]} />
              <View style={[s.corner, s.br]} />
              <Animated.View
                style={[s.sweep, { transform: [{ translateY }] }]}
              />
            </View>
            <Text style={s.hint}>Hold steady · tap to cancel</Text>
          </View>
        </Pressable>
      )}
    </Modal>
  );
}

const C = 34; // corner bracket length
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 20, 30, 0.25)',
  },
  title: {
    color: COLORS.cyan,
    fontFamily: FONTS.bold,
    fontSize: 16,
    letterSpacing: 6,
    marginBottom: 24,
    textShadowColor: COLORS.cyan,
    textShadowRadius: 10,
  },
  frame: { width: FRAME, height: FRAME, overflow: 'hidden' },
  corner: {
    position: 'absolute',
    width: C,
    height: C,
    borderColor: COLORS.cyan,
  },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  sweep: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: 2,
    backgroundColor: COLORS.cyan,
    shadowColor: COLORS.cyan,
    shadowRadius: 8,
    shadowOpacity: 1,
    elevation: 4,
  },
  hint: {
    color: COLORS.text,
    fontFamily: FONTS.regular,
    fontSize: 13,
    marginTop: 24,
    opacity: 0.8,
  },
});
