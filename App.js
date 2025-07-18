import {SafeAreaView} from 'react-native';
import Home from "./src/screens/Home";
import {useEffect, useState} from "react";
import * as Notifications from "expo-notifications";
import {requestDeviceAuth} from "./src/utils/auth";
import AccessDenied from "./src/components/AccessDenied";
import * as Speech from 'expo-speech';


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

        const subscription = Notifications.addNotificationReceivedListener(notification => {
            const message = notification.request.content.body;
            if (message) {
                Speech.speak(message, {
                    language: "ru-RU",
                    voice: "ru-ru-x-ruf-network",
                    rate: 0.9,
                    pitch: 1.0,
                });
            }
        });

        return () => subscription.remove();
    }, []);


    return (
        <SafeAreaView style={{flex: 1}}>
            {unlocked ? <Home/> : <AccessDenied/>}
        </SafeAreaView>
    );
}