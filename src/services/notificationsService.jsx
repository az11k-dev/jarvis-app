import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

export async function initNotifications() {
  if (!Device.isDevice) return;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
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
      title: 'J.A.R.V.I.S. напоминание',
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
