import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Home from './src/screens/Home';
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';

export default function App() {
  useEffect(() => {
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
      {/* Home applies its own safe-area insets; wrapping it in another
          SafeAreaView doubled the top/bottom padding. */}
      <View style={{ flex: 1, backgroundColor: '#05080f' }}>
        <Home />
      </View>
    </SafeAreaProvider>
  );
}
