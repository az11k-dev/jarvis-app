import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Home from './src/screens/Home';
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import {
  useFonts,
  Jura_400Regular,
  Jura_500Medium,
  Jura_700Bold,
} from '@expo-google-fonts/jura';
import {
  Orbitron_500Medium,
  Orbitron_700Bold,
} from '@expo-google-fonts/orbitron';
import { COLORS } from './src/styles/mainStyles';

export default function App() {
  // Bundled font files load in a few ms; until then only the dark
  // background shows, so the HUD never flashes in the system font. A font
  // error must not keep the assistant from starting, hence `|| fontError`.
  const [fontsLoaded, fontError] = useFonts({
    Jura_400Regular,
    Jura_500Medium,
    Jura_700Bold,
    Orbitron_500Medium,
    Orbitron_700Bold,
  });

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
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        {(fontsLoaded || fontError) && <Home />}
      </View>
    </SafeAreaProvider>
  );
}
