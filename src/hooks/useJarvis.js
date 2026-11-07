import { useEffect, useState, useSyncExternalStore } from 'react';
import { Animated, AppState } from 'react-native';
import { useAudioStream } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { useKeepAwake } from 'expo-keep-awake';
import { AUDIO_FORMAT } from '../config/jarvis';
import { JarvisEngine } from '../core/jarvisEngine';
import * as Background from '../../modules/jarvis-background';

/** Wires the JARVIS engine to the microphone, app lifecycle and React. */
export function useJarvis() {
  const [engine] = useState(() => new JarvisEngine());
  const [level] = useState(() => new Animated.Value(0));
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);

  const { stream } = useAudioStream({
    ...AUDIO_FORMAT,
    onBuffer: engine.handleBuffer,
  });

  // Keep the screen on while the app is open (it also listens in the
  // background through a foreground service, see modules/jarvis-background).
  useKeepAwake();

  // "Выключить" tapped in the listening notification.
  useEffect(
    () =>
      Background.addStopRequestedListener(() => engine.setMicEnabled(false)),
    [engine]
  );

  useEffect(() => {
    engine.setLevelListener((value) =>
      Animated.timing(level, {
        toValue: value,
        duration: 90,
        useNativeDriver: true,
      }).start()
    );
  }, [engine, level]);

  // Dev-only: adb test hooks + state logging (see src/dev/debugBridge.js).
  useEffect(() => {
    if (!__DEV__) return;
    return require('../dev/debugBridge').attachDebugBridge(engine);
  }, [engine]);

  useEffect(() => {
    engine.attachStream(stream);
    engine.boot();
    return () => engine.dispose();
  }, [engine, stream]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) =>
      engine.setAppActive(next === 'active')
    );
    return () => sub.remove();
  }, [engine]);

  // Reminders fire as notifications; JARVIS reads them out when the app is open.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const body = n.request.content.body;
      if (body) engine.announce(body);
    });
    return () => sub.remove();
  }, [engine]);

  return { ...state, level, engine };
}
