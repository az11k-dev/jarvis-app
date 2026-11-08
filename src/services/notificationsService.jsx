import * as Notifications from 'expo-notifications';

const REMINDER_TITLE = 'J.A.R.V.I.S. напоминание';

/** Schedules a reminder. Returns its id and the time it fires. */
export async function scheduleReminder(message, seconds) {
  const firesAt = Date.now() + seconds * 1000;
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: REMINDER_TITLE,
      body: `Сэр, ${message}`,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.HIGH,
      // A timeInterval trigger read back later has no start time, so keep
      // the fire time (and the bare text) here for listReminders.
      data: { kind: 'reminder', text: message, firesAt },
    },
    trigger: {
      type: 'timeInterval',
      seconds,
      repeats: false,
    },
  });
  return { id, firesAt: new Date(firesAt) };
}

/** Pending reminders, soonest first: `{ id, text, firesAt: Date | null }`. */
export async function listReminders() {
  const requests = await Notifications.getAllScheduledNotificationsAsync();
  return requests
    .filter(
      (r) =>
        r.content.data?.kind === 'reminder' ||
        r.content.title === REMINDER_TITLE
    )
    .map((r) => {
      const { text, firesAt } = r.content.data ?? {};
      return {
        id: r.identifier,
        text: text ?? r.content.body ?? '',
        firesAt: typeof firesAt === 'number' ? new Date(firesAt) : null,
      };
    })
    .sort((a, b) => (a.firesAt ?? Infinity) - (b.firesAt ?? Infinity));
}

/** Cancels a pending reminder. Returns false if there is no such reminder. */
export async function cancelReminder(id) {
  const pending = await listReminders();
  if (!pending.some((r) => r.id === id)) return false;
  await Notifications.cancelScheduledNotificationAsync(id);
  return true;
}
