/**
 * ReminderSettings — PRD §3.7.2.
 *
 * The daily-reminder editor: notification permission, reminder time, reminder
 * days, and the Pro Morning Digest toggle (a paywall trigger for free users,
 * PRD §8.3). Rendered inline in Settings and as the RemindersScreen
 * (oshi://settings/reminders), so the two can never drift. Loads and saves
 * its own data: GET /users/me, PATCH /notifications/settings.
 */
import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { useTheme } from '../theme/ThemeContext';
import { useAuthStore } from '../store/authStore';
import { apiClient } from '../services/apiClient';
import { openPaywall } from '../services/paywall';
import analytics from '../services/analytics';
import { localToUtcTimetz, utcTimetzToLocal } from '../utils/reminderTime';
import { TimePicker } from './TimePicker';

type ReminderDay = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sun
const DAY_LABELS: string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Maps ReminderDay (0=Sun) to backend reminder_days string values */
const REMINDER_DAY_API = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DEFAULT_DAYS: ReminderDay[] = [0, 1, 2, 3, 4, 5, 6];


// ─────────────────────────────────────────────────────────────────────────────
// ReminderSettings
// ─────────────────────────────────────────────────────────────────────────────

export function ReminderSettings(): React.JSX.Element {
  const { colors, theme } = useTheme();
  const isPro = useAuthStore(
    (s) => s.user?.subscriptionStatus === 'pro' || s.user?.subscriptionStatus === 'trial',
  );

  // ── Reminder state ────────────────────────────────────────────────────────
  const [reminderHour, setReminderHour] = useState(19);
  const [reminderMinute, setReminderMinute] = useState(0);
  const [reminderDays, setReminderDays] = useState<ReminderDay[]>(DEFAULT_DAYS);
  const [morningDigest, setMorningDigest] = useState(false);
  const [isSavingReminder, setIsSavingReminder] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<
    'undetermined' | 'granted' | 'denied' | null
  >(null);
  const [isEnablingNotifications, setIsEnablingNotifications] = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    void loadReminders();
  }, []);

  async function loadReminders(): Promise<void> {
    try {
      const userRes = await apiClient.get<{
        reminder_time: string | null;
        reminder_days: string[] | null;
        morning_digest?: boolean;
      }>('/users/me');

      if (userRes.data.reminder_time) {
        const local = utcTimetzToLocal(userRes.data.reminder_time);
        setReminderHour(local.hour);
        setReminderMinute(local.minute);
      }
      if (Array.isArray(userRes.data.reminder_days)) {
        const days = userRes.data.reminder_days
          .map((s) => REMINDER_DAY_API.indexOf(s as (typeof REMINDER_DAY_API)[number]))
          .filter((i): i is ReminderDay => i >= 0);
        if (days.length > 0) setReminderDays(days.sort((a, b) => a - b));
      }
      setMorningDigest(userRes.data.morning_digest ?? false);
    } catch {
      // Non-fatal: UI shows default values
    }

    try {
      const { status } = await Notifications.getPermissionsAsync();
      setNotificationPermission(status);
    } catch {
      setNotificationPermission('undetermined');
    }
  }

  // ── Enable notifications ────────────────────────────────────────────────────

  async function handleEnableNotifications(): Promise<void> {
    setIsEnablingNotifications(true);
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      setNotificationPermission(status);

      if (status !== 'granted') {
        Alert.alert(
          'Notifications Disabled',
          'Enable notifications in your device settings to get daily reminders.',
        );
        return;
      }

      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;

      if (!projectId) {
        Alert.alert('Error', 'Could not find project ID. Push notifications may not work.');
        return;
      }

      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: String(projectId),
      });

      await apiClient.post('/notifications/token', {
        expo_push_token: tokenData.data,
      });

      Alert.alert('Done', 'You\'ll receive daily reminders at your chosen time.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not enable notifications.';
      Alert.alert('Error', message);
    } finally {
      setIsEnablingNotifications(false);
    }
  }

  // ── Save reminders ────────────────────────────────────────────────────────

  async function saveReminders(): Promise<void> {
    setIsSavingReminder(true);
    try {
      // Backend stores reminder times in UTC
      const timeStr = localToUtcTimetz(reminderHour, reminderMinute);

      const dayStrings = reminderDays
        .map((d) => (typeof d === 'number' && d >= 0 && d <= 6 ? REMINDER_DAY_API[d] : typeof d === 'string' ? d : null))
        .filter((d) => typeof d === 'string') as string[];

      await apiClient.patch('/notifications/settings', {
        reminder_time: timeStr,
        reminder_days: dayStrings,
        // Pro-only (PRD §3.7.2); free users never see the switch on
        ...(isPro ? { morning_digest: morningDigest } : {}),
      });
      analytics.settingsReminderSaved({ hour: reminderHour, days_count: reminderDays.length });
      Alert.alert('Saved', 'Reminder settings updated.');
    } catch {
      Alert.alert('Error', 'Could not save reminder settings.');
    } finally {
      setIsSavingReminder(false);
    }
  }

  // ── Toggle reminder day ───────────────────────────────────────────────────

  function toggleDay(day: ReminderDay): void {
    setReminderDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );
  }

  return (
    <View style={[reminderStyles.container, { paddingHorizontal: 16, paddingTop: 16 }]}>
      <View style={[reminderStyles.notifRow, { borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[reminderStyles.sublabel, { color: colors.textMuted }]}>
            Notifications
          </Text>
          <Text style={[reminderStyles.notifStatus, { color: colors.textPrimary }]}>
            {notificationPermission === null
              ? 'Checking…'
              : notificationPermission === 'granted'
                ? 'Enabled'
                : 'Off'}
          </Text>
        </View>
        {notificationPermission !== 'granted' && (
          <TouchableOpacity
            onPress={() => void handleEnableNotifications()}
            disabled={isEnablingNotifications}
            style={[
              reminderStyles.enableNotifBtn,
              {
                backgroundColor: colors.accent,
                borderRadius: theme.borderRadius.sm,
                opacity: isEnablingNotifications ? 0.7 : 1,
              },
            ]}
          >
            <Text style={reminderStyles.enableNotifBtnText}>
              {isEnablingNotifications ? 'Enabling…' : 'Enable Notifications'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={[reminderStyles.sublabel, { color: colors.textMuted, marginTop: 16 }]}>Reminder time</Text>
      <TimePicker
        hour={reminderHour}
        minute={reminderMinute}
        onChangeHour={setReminderHour}
        onChangeMinute={setReminderMinute}
      />

      <Text style={[reminderStyles.sublabel, { color: colors.textMuted, marginTop: 16 }]}>Reminder days</Text>
      <View style={reminderStyles.dayRow}>
        {DAY_LABELS.map((label, idx) => {
          const day = idx as ReminderDay;
          const active = reminderDays.includes(day);
          return (
            <TouchableOpacity
              key={label}
              onPress={() => toggleDay(day)}
              style={[
                reminderStyles.dayChip,
                {
                  backgroundColor: active ? colors.accent : colors.border,
                  borderRadius: theme.borderRadius.pill,
                },
              ]}
            >
              <Text style={[reminderStyles.dayLabel, { color: active ? '#FFFFFF' : colors.textSecondary }]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Shown to everyone: for free users the toggle is a paywall
          trigger (PRD §8.3 — tapping a Pro-only toggle shows the paywall) */}
      <View style={[reminderStyles.digestRow, { borderTopColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[reminderStyles.digestLabel, { color: colors.textPrimary }]}>Morning Digest</Text>
          <Text style={[reminderStyles.digestSub, { color: colors.textMuted }]}>8 AM summary of yesterday's saves · Pro</Text>
        </View>
        <Switch
          value={isPro && morningDigest}
          onValueChange={isPro ? setMorningDigest : () => openPaywall('settings')}
          trackColor={{ true: colors.accent }}
        />
      </View>

      <TouchableOpacity
        onPress={() => void saveReminders()}
        disabled={isSavingReminder}
        style={[reminderStyles.saveBtn, { backgroundColor: colors.accent, borderRadius: theme.borderRadius.sm }]}
      >
        <Text style={reminderStyles.saveBtnText}>
          {isSavingReminder ? 'Saving…' : 'Save Reminders'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const reminderStyles = StyleSheet.create({
  container: { paddingBottom: 16 },
  sublabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  notifStatus: { fontSize: 16, fontWeight: '500', marginTop: 2 },
  enableNotifBtn: { paddingHorizontal: 16, paddingVertical: 10 },
  enableNotifBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  dayChip: { paddingHorizontal: 10, paddingVertical: 6 },
  dayLabel: { fontSize: 13, fontWeight: '600' },
  digestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 16,
    paddingTop: 16,
  },
  digestLabel: { fontSize: 15, fontWeight: '500' },
  digestSub: { fontSize: 12 },
  saveBtn: { marginTop: 20, height: 48, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
