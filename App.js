import {SafeAreaView} from 'react-native';
import Home from "./src/screens/Home";
import {useEffect, useState} from "react";
import * as Notifications from "expo-notifications";
import {requestDeviceAuth} from "./src/utils/auth";
import AccessDenied from "./src/components/AccessDenied";


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

    }, []);

    return (
        <SafeAreaView style={{flex: 1}}>
            {unlocked ? <Home/> : <AccessDenied/>}
        </SafeAreaView>
    );
}