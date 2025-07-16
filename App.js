import {SafeAreaView} from 'react-native';
import Home from "./src/screens/Home";
import {useEffect} from "react";
import * as Notifications from "expo-notifications";


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

    }, []);

    return (
        <SafeAreaView style={{flex: 1}}>
            <Home/>
        </SafeAreaView>
    );
}