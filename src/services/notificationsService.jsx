import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

export async function initNotifications() {
    if (!Device.isDevice) return;

    const {status: existingStatus} = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
        const {status} = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }

    if (finalStatus !== 'granted') {
        console.log('❌ Уведомления запрещены');
        return;
    }

    console.log('✅ Разрешения на уведомления получены');

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    console.log('✅ Expo Push Token:', token);
}

export async function scheduleReminder(message, seconds) {
    await Notifications.scheduleNotificationAsync({
        content: {
            title: "J.A.R.V.I.S. напоминание",
            body: `Сэр, ${message}`,
            sound: 'default',
            priority: Notifications.AndroidNotificationPriority.HIGH,
        },
        trigger: {
            type: 'timeInterval',
            seconds,
            repeats: false,
        },
    });
}

export async function cancelAllReminders() {
    await Notifications.cancelAllScheduledNotificationsAsync();
    console.log('🛑 Все напоминания отменены');
}

export function parseSecondsFromPhrase(text) {
    const secondMatch = text.match(/через (\d+)\s?секунд/);
    const minMatch = text.match(/через (\d+)\s?минут/);
    const hourMatch = text.match(/через (\d+)\s?час/);

    if (secondMatch) return parseInt(secondMatch[1], 10);
    if (minMatch) return parseInt(minMatch[1], 10) * 60;
    if (hourMatch) return parseInt(hourMatch[1], 10) * 3600;

    return null;
}