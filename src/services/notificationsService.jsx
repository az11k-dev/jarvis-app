import * as Notifications from 'expo-notifications';

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
