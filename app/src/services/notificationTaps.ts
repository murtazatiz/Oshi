/**
 * Push notification taps.
 *
 * The backend attaches { url, notification_log_id, notification_type } to
 * every push (notificationService.sendLoggedPush). On a tap we record the
 * open (POST /notifications/log-open + PostHog notification_opened) and hand
 * the URL to React Navigation's linking config, which routes it like any
 * oshi:// deep link — e.g. a daily reminder opens its category tab.
 *
 * Before this module nothing handled taps: notifications just opened the
 * app on whatever screen it was last on, and opens were never logged.
 */
import * as Notifications from 'expo-notifications';

import { apiClient } from './apiClient';
import analytics from './analytics';

function dataString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Record the open and return the notification's deep link, if any. */
function recordOpen(response: Notifications.NotificationResponse): string | null {
  const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
  const notificationType = dataString(data, 'notification_type');
  const logId = dataString(data, 'notification_log_id');

  analytics.notificationOpened(notificationType ? { notification_type: notificationType } : {});
  if (logId) {
    void apiClient
      .post('/notifications/log-open', { notification_log_id: logId })
      .catch(() => {
        // Non-fatal: the open just isn't counted
      });
  }
  // Consume it so the same tap isn't replayed as the "launch" tap next time
  void Notifications.clearLastNotificationResponseAsync().catch(() => {});

  return dataString(data, 'url');
}

/** The deep link of the notification tap that launched the app, if any (cold start). */
export async function getLaunchNotificationUrl(): Promise<string | null> {
  const response = await Notifications.getLastNotificationResponseAsync();
  return response ? recordOpen(response) : null;
}

/** Call `listener` with the deep link of each notification tapped while the app runs. */
export function subscribeToNotificationUrls(listener: (url: string) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const url = recordOpen(response);
    if (url) listener(url);
  });
  return () => subscription.remove();
}
