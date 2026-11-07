import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Home from './src/screens/Home';
import { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { requestDeviceAuth } from './src/utils/auth';
import AccessDenied from './src/components/AccessDenied';

export default function App() {
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    (async () => {
      const success = await requestDeviceAuth();
      setUnlocked(success);
    })();
    Notifications.requestPermissionsAsync();
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    // Reminders are read aloud by JARVIS itself (see useJarvis).
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#05080f' }}>
        {unlocked ? <Home /> : <AccessDenied />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
