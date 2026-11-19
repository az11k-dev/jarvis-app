import { useEffect, useState, useSyncExternalStore } from 'react';
import { Animated } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { getJarvisRuntime } from '../core/jarvisRuntime';

/**
 * Connects the screen to the JARVIS runtime. The engine itself lives outside
 * React (see src/core/jarvisRuntime.js) so it keeps listening after the app is
 * swiped out of recents; unmounting only detaches the UI.
 */
export function useJarvis() {
  const [{ engine }] = useState(getJarvisRuntime);
  const [level] = useState(() => new Animated.Value(0));
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);

  // Keep the screen on while the app is open (it also listens in the
  // background through a foreground service, see modules/jarvis-background).
  useKeepAwake();

  // The mic level drives the arc reactor; only needed while it's on screen.
  useEffect(() => {
    engine.setLevelListener((value) =>
      Animated.timing(level, {
        toValue: value,
        duration: 90,
        useNativeDriver: true,
      }).start()
    );
    return () => engine.setLevelListener(null);
  }, [engine, level]);

  return { ...state, level, engine };
}
