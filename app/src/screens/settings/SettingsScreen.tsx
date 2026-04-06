/**
 * SettingsScreen — PRD §3.7.2–3.7.5
 *
 * Sections:
 *   §3.7.2 — Reminder Settings (time picker, day chips, morning digest toggle)
 *   §3.7.3 — Category Management (drag-to-reorder, rename, emoji, delete, add)
 *   §3.7.4 — Subscription / plan info
 *   §3.7.5 — Account Deletion (two-step confirmation with "DELETE" type-in)
 *
 * Also: dark mode toggle (ThemeContext.setMode), app version, sign out.
 *
 * The Settings tab in AppNavigator renders this screen wrapped in its own
 * SettingsStack — so we access navigation freely.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { useTheme, ThemeMode } from '../../theme/ThemeContext';
import { useAuthStore } from '../../store/authStore';
import { apiClient } from '../../services/apiClient';
import analytics, { optOutAnalytics, optInAnalytics, isOptedOut } from '../../services/analytics';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  name: string;
  emoji: string;
  save_count: number;
}

type ReminderDay = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sun
const DAY_LABELS: string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Maps ReminderDay (0=Sun) to backend reminder_days string values */
const REMINDER_DAY_API = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DEFAULT_DAYS: ReminderDay[] = [0, 1, 2, 3, 4, 5, 6];

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal time picker: scrolling HH / MM / AM-PM wheels on iOS-like experience
 *  using simple -/+ buttons (no native picker dependency). */
function TimePicker({
  hour,
  minute,
  onChangeHour,
  onChangeMinute,
}: {
  hour: number;
  minute: number;
  onChangeHour: (h: number) => void;
  onChangeMinute: (m: number) => void;
}): React.JSX.Element {
  const { colors, theme } = useTheme();
  const isAM = hour < 12;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;

  function toggleMeridiem(): void {
    onChangeHour(isAM ? hour + 12 : hour - 12);
  }

  return (
    <View style={timStyles.row}>
      {/* Hour */}
      <View style={timStyles.spinnerCol}>
        <TouchableOpacity onPress={() => onChangeHour((hour + 1) % 24)} hitSlop={6} style={timStyles.arrow}>
          <Text style={[timStyles.arrowText, { color: colors.accent }]}>▲</Text>
        </TouchableOpacity>
        <Text style={[timStyles.digit, { color: colors.textPrimary }]}>
          {String(h12).padStart(2, '0')}
        </Text>
        <TouchableOpacity onPress={() => onChangeHour((hour - 1 + 24) % 24)} hitSlop={6} style={timStyles.arrow}>
          <Text style={[timStyles.arrowText, { color: colors.accent }]}>▼</Text>
        </TouchableOpacity>
      </View>
      <Text style={[timStyles.colon, { color: colors.textPrimary }]}>:</Text>
      {/* Minute */}
      <View style={timStyles.spinnerCol}>
        <TouchableOpacity onPress={() => onChangeMinute((minute + 1) % 60)} hitSlop={6} style={timStyles.arrow}>
          <Text style={[timStyles.arrowText, { color: colors.accent }]}>▲</Text>
        </TouchableOpacity>
        <Text style={[timStyles.digit, { color: colors.textPrimary }]}>
          {String(minute).padStart(2, '0')}
        </Text>
        <TouchableOpacity onPress={() => onChangeMinute((minute - 1 + 60) % 60)} hitSlop={6} style={timStyles.arrow}>
          <Text style={[timStyles.arrowText, { color: colors.accent }]}>▼</Text>
        </TouchableOpacity>
      </View>
      {/* AM/PM toggle */}
      <TouchableOpacity
        onPress={toggleMeridiem}
        style={[timStyles.meridiem, { backgroundColor: colors.border, borderRadius: theme.borderRadius.sm }]}
      >
        <Text style={[timStyles.meridiemText, { color: colors.textPrimary }]}>
          {isAM ? 'AM' : 'PM'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const timStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  spinnerCol: { alignItems: 'center', gap: 4 },
  arrow: { padding: 4 },
  arrowText: { fontSize: 14 },
  digit: { fontSize: 32, fontWeight: '700', minWidth: 48, textAlign: 'center' },
  colon: { fontSize: 28, fontWeight: '700', marginBottom: 4 },
  meridiem: { paddingHorizontal: 12, paddingVertical: 8, marginLeft: 8 },
  meridiemText: { fontSize: 16, fontWeight: '700' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Category rename modal
// ─────────────────────────────────────────────────────────────────────────────

function CategoryEditModal({
  cat,
  visible,
  isPro,
  onSave,
  onClose,
}: {
  cat: Category | null;
  visible: boolean;
  isPro: boolean;
  onSave: (id: string, name: string, emoji: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { colors, theme } = useTheme();
  const [name, setName] = useState(cat?.name ?? '');
  const [emoji, setEmoji] = useState(cat?.emoji ?? '📌');

  useEffect(() => {
    if (cat) { setName(cat.name); setEmoji(cat.emoji); }
  }, [cat]);

  if (!cat) return <></>;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={ceStyles.overlay} onPress={onClose}>
        <View style={[ceStyles.sheet, { backgroundColor: colors.surface, borderTopLeftRadius: theme.borderRadius.lg, borderTopRightRadius: theme.borderRadius.lg }]}>
          <View style={ceStyles.handleRow}>
            <View style={[ceStyles.handle, { backgroundColor: colors.border }]} />
          </View>
          <Text style={[ceStyles.title, { color: colors.textPrimary }]}>Edit Category</Text>

          <View style={ceStyles.row}>
            <TextInput
              value={emoji}
              onChangeText={setEmoji}
              style={[ceStyles.emojiInput, { color: colors.textPrimary, borderColor: colors.border }]}
              maxLength={2}
            />
            <TextInput
              value={name}
              onChangeText={setName}
              style={[ceStyles.nameInput, { color: colors.textPrimary, borderColor: colors.border, borderRadius: theme.borderRadius.sm }]}
              placeholder="Category name"
              placeholderTextColor={colors.textMuted}
              maxLength={40}
            />
          </View>

          <TouchableOpacity
            onPress={() => { onSave(cat.id, name.trim(), emoji); onClose(); }}
            style={[ceStyles.saveBtn, { backgroundColor: colors.accent, borderRadius: theme.borderRadius.sm }]}
          >
            <Text style={ceStyles.saveBtnText}>Save Changes</Text>
          </TouchableOpacity>
          <View style={{ height: 32 }} />
        </View>
      </Pressable>
    </Modal>
  );
}

const ceStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  kbWrapper: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  sheet: { padding: 16 },
  handleRow: { alignItems: 'center', paddingBottom: 12 },
  handle: { width: 36, height: 4, borderRadius: 2 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 20 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  emojiInput: { fontSize: 22, width: 52, height: 48, textAlign: 'center', borderWidth: 1, borderRadius: 8 },
  nameInput: { flex: 1, fontSize: 16, height: 48, borderWidth: 1, paddingHorizontal: 12 },
  saveBtn: { height: 50, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
});

// ─────────────────────────────────────────────────────────────────────────────
// SettingsSection wrapper
// ─────────────────────────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { colors, theme } = useTheme();
  return (
    <View style={secStyles.wrapper}>
      <Text style={[secStyles.label, { color: colors.textMuted }]}>{title.toUpperCase()}</Text>
      <View style={[secStyles.card, { backgroundColor: colors.surface, borderRadius: theme.borderRadius.md }]}>
        {children}
      </View>
    </View>
  );
}

const secStyles = StyleSheet.create({
  wrapper: { marginBottom: 24 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.8, marginBottom: 8, paddingHorizontal: 16 },
  card: { overflow: 'hidden' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Row helpers
// ─────────────────────────────────────────────────────────────────────────────

function SettingRow({
  label,
  sublabel,
  right,
  onPress,
  isLast,
}: {
  label: string;
  sublabel?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  isLast?: boolean;
}): React.JSX.Element {
  const { colors } = useTheme();
  const Row = onPress ? TouchableOpacity : View;
  return (
    <Row
      onPress={onPress}
      style={[rowStyles.row, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
      activeOpacity={0.65}
    >
      <View style={rowStyles.labelGroup}>
        <Text style={[rowStyles.label, { color: colors.textPrimary }]}>{label}</Text>
        {sublabel ? <Text style={[rowStyles.sublabel, { color: colors.textMuted }]}>{sublabel}</Text> : null}
      </View>
      {right}
    </Row>
  );
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, minHeight: 52 },
  labelGroup: { flex: 1, gap: 2 },
  label: { fontSize: 16 },
  sublabel: { fontSize: 13 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const { colors, theme, mode, setMode, isDark } = useTheme();
  const { spacing } = theme;
  const insets = useSafeAreaInsets();

  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const isPro = user?.subscriptionStatus === 'pro' || user?.subscriptionStatus === 'trial';

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

  // ── Category state ────────────────────────────────────────────────────────
  const [categories, setCategories] = useState<Category[]>([]);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [catEditVisible, setCatEditVisible] = useState(false);
  const [newCatVisible, setNewCatVisible] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  // ── Account deletion state ────────────────────────────────────────────────
  const [deleteStep, setDeleteStep] = useState<'idle' | 'confirm1' | 'confirm2'>('idle');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  // ── Theme state ───────────────────────────────────────────────────────────
  const darkSwitchValue = mode === 'dark' || (mode === 'system' && isDark);

  // ── Analytics opt-out state ───────────────────────────────────────────────
  const [analyticsOptedOut, setAnalyticsOptedOut] = useState(false);

  // ── Load data ─────────────────────────────────────────────────────────────

  useEffect(() => {
    void loadSettings();
    void isOptedOut().then(setAnalyticsOptedOut);
  }, []);

  async function loadSettings(): Promise<void> {
    try {
      const [catRes, userRes] = await Promise.all([
        apiClient.get<{ categories: Category[] }>('/categories'),
        apiClient.get<{
          reminder_time: string | null;
          reminder_days: number[] | null;
          morning_digest: boolean;
        }>('/users/me'),
      ]);
      setCategories(catRes.data.categories);

      if (userRes.data.reminder_time) {
        const [hStr, mStr] = userRes.data.reminder_time.split(':');
        const utcH = parseInt(hStr ?? '19', 10);
        const utcM = parseInt(mStr ?? '0', 10);
        const utcDate = new Date(Date.UTC(1970, 0, 1, utcH, utcM, 0, 0));
        setReminderHour(utcDate.getHours());
        setReminderMinute(utcDate.getMinutes());
      }
      if (userRes.data.reminder_days && Array.isArray(userRes.data.reminder_days)) {
        const apiToDay = (s: string): ReminderDay | null => {
          const i = REMINDER_DAY_API.indexOf(s as (typeof REMINDER_DAY_API)[number]);
          return i >= 0 ? (i as ReminderDay) : null;
        };
        const raw = userRes.data.reminder_days as unknown as string[];
        const days = raw
          .map(apiToDay)
          .filter((d): d is ReminderDay => d != null);
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
      // Convert selected local time to UTC for storage (backend expects UTC)
      const now = new Date();
      const localDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        reminderHour,
        reminderMinute,
        0,
        0,
      );
      const utcHours = localDate.getUTCHours();
      const utcMinutes = localDate.getUTCMinutes();
      const timeStr = `${String(utcHours).padStart(2, '0')}:${String(utcMinutes).padStart(2, '0')}:00+00`;
      console.log('[settings] Sending reminder_time (UTC):', timeStr);

      const dayStrings = reminderDays
        .map((d) => (typeof d === 'number' && d >= 0 && d <= 6 ? REMINDER_DAY_API[d] : typeof d === 'string' ? d : null))
        .filter((d) => typeof d === 'string') as string[];

      await apiClient.patch('/notifications/settings', {
        reminder_time: timeStr,
        reminder_days: dayStrings,
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

  // ── Category actions ─────────────────────────────────────────────────────

  function openCategoryEdit(cat: Category): void {
    setEditingCat(cat);
    setCatEditVisible(true);
  }

  async function saveCategoryEdit(id: string, name: string, emoji: string): Promise<void> {
    try {
      await apiClient.patch(`/categories/${id}`, { name, emoji });
      setCategories((prev) => prev.map((c) => c.id === id ? { ...c, name, emoji } : c));
      analytics.settingsCategoryRenamed();
    } catch {
      Alert.alert('Error', 'Could not update category.');
    }
  }

  async function handleDeleteCategory(cat: Category): Promise<void> {
    if (cat.name === 'Other') {
      Alert.alert('Cannot delete', '"Other" is the default category and cannot be deleted.');
      return;
    }
    Alert.alert(
      `Delete ${cat.name}?`,
      `All ${cat.save_count} saves in this category will move to Other.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.delete(`/categories/${cat.id}`);
              setCategories((prev) => prev.filter((c) => c.id !== cat.id));
              analytics.settingsCategoryDeleted();
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : 'Could not delete category.';
              Alert.alert('Error', msg);
            }
          },
        },
      ],
    );
  }

  async function handleAddCategory(): Promise<void> {
    if (!isPro && categories.length >= 3) {
      Alert.alert(
        'Upgrade to Pro',
        'Free users can have up to 3 categories. Upgrade to Pro for unlimited categories.',
      );
      return;
    }
    console.log(
      '[settings] handleAddCategory pressed — existing categories:',
      categories.length,
    );
    setNewCatName('');
    setNewCatVisible(true);
  }

  async function moveCategory(index: number, direction: 'up' | 'down'): Promise<void> {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= categories.length) return;

    const reordered = [...categories];
    const temp = reordered[index]!;
    reordered[index] = reordered[targetIndex]!;
    reordered[targetIndex] = temp;

    setCategories(reordered);
    analytics.settingsCategoryReordered();
    try {
      await apiClient.patch(`/categories/${temp.id}`, {
        sort_order: targetIndex,
      });
    } catch {
      // Non-fatal — revert optimistic update
      setCategories(categories);
    }
  }

  // ── Account deletion ──────────────────────────────────────────────────────

  function startDeleteAccount(): void {
    analytics.accountDeletionStarted();
    setDeleteStep('confirm1');
  }

  function proceedToDeleteStep2(): void {
    setDeleteStep('confirm2');
    setDeleteConfirmText('');
  }

  async function confirmDeleteAccount(): Promise<void> {
    if (deleteConfirmText !== 'DELETE') {
      Alert.alert('Type DELETE', 'Please type DELETE (all caps) to confirm.');
      return;
    }
    setIsDeletingAccount(true);
    try {
      await apiClient.delete('/users/me');
      analytics.accountDeletionConfirmed();
      // signOut navigates user back to onboarding
      await signOut();
    } catch {
      Alert.alert('Error', 'Could not delete account. Please try again.');
      setIsDeletingAccount(false);
    }
  }

  // ── Render category item ──────────────────────────────────────────────────

  const renderCategoryItem = useCallback(
    ({ item, index }: { item: Category; index: number }) => {
      const isFirst = index === 0;
      const isLast = index === categories.length - 1;
      return (
        <TouchableOpacity
          onPress={() => openCategoryEdit(item)}
          style={[catStyles.row, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
          activeOpacity={0.7}
        >
          {/* Up / down order controls */}
          <View style={catStyles.orderBtns}>
            <TouchableOpacity
              onPress={() => void moveCategory(index, 'up')}
              disabled={isFirst}
              hitSlop={6}
              style={catStyles.orderBtn}
            >
              <Text style={[catStyles.orderArrow, { color: isFirst ? colors.border : colors.accent }]}>↑</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void moveCategory(index, 'down')}
              disabled={isLast}
              hitSlop={6}
              style={catStyles.orderBtn}
            >
              <Text style={[catStyles.orderArrow, { color: isLast ? colors.border : colors.accent }]}>↓</Text>
            </TouchableOpacity>
          </View>

          <Text style={catStyles.emoji}>{item.emoji}</Text>
          <View style={catStyles.info}>
            <Text style={[catStyles.name, { color: colors.textPrimary }]}>{item.name}</Text>
            <Text style={[catStyles.count, { color: colors.textMuted }]}>{item.save_count} saves</Text>
          </View>
          {item.name !== 'Other' && (
            <TouchableOpacity
              onPress={() => void handleDeleteCategory(item)}
              hitSlop={8}
              style={catStyles.deleteBtn}
            >
              <Text style={[catStyles.deleteIcon, { color: colors.error }]}>🗑</Text>
            </TouchableOpacity>
          )}
          <Text style={[catStyles.chevron, { color: colors.textMuted }]}>›</Text>
        </TouchableOpacity>
      );
    },
    [colors, categories.length, handleDeleteCategory, moveCategory],
  );

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.navBar, { borderBottomColor: colors.border }]}>
        <Text style={[styles.navTitle, { color: colors.textPrimary }]}>Settings</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: 0, paddingBottom: 60 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Appearance ─────────────────────────────────────────────── */}
        <Section title="Appearance">
          <SettingRow
            label="Dark Mode"
            right={
              <Switch
                value={darkSwitchValue}
                onValueChange={(val) => {
                  analytics.settingsDarkModeToggled(val);
                  void setMode(val ? 'dark' : 'light');
                }}
                trackColor={{ true: colors.accent }}
              />
            }
            isLast={false}
          />
          <SettingRow
            label="Use System Theme"
            right={
              <Switch
                value={mode === 'system'}
                onValueChange={(val) => {
                  const next = val ? 'system' : isDark ? 'dark' : 'light';
                  analytics.settingsThemeChanged(next);
                  void setMode(next);
                }}
                trackColor={{ true: colors.accent }}
              />
            }
            isLast
          />
        </Section>

        {/* ── App Settings — Analytics opt-out (PRD §5.9) ─────────────── */}
        <Section title="App Settings">
          <SettingRow
            label="Analytics"
            sublabel="Help improve Oshi by sharing anonymous usage data"
            right={
              <Switch
                value={!analyticsOptedOut}
                onValueChange={async (val) => {
                  if (val) {
                    await optInAnalytics();
                    analytics.settingsAnalyticsOptedIn();
                    setAnalyticsOptedOut(false);
                  } else {
                    analytics.settingsAnalyticsOptedOut();
                    await optOutAnalytics();
                    setAnalyticsOptedOut(true);
                  }
                }}
                trackColor={{ true: colors.accent }}
              />
            }
            isLast
          />
        </Section>

        {/* ── Reminders §3.7.2 ─────────────────────────────────────── */}
        <Section title="Daily Reminder">
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

            {isPro && (
              <View style={[reminderStyles.digestRow, { borderTopColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[reminderStyles.digestLabel, { color: colors.textPrimary }]}>Morning Digest</Text>
                  <Text style={[reminderStyles.digestSub, { color: colors.textMuted }]}>8 AM summary of yesterday's saves · Pro</Text>
                </View>
                <Switch
                  value={morningDigest}
                  onValueChange={setMorningDigest}
                  trackColor={{ true: colors.accent }}
                />
              </View>
            )}

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
        </Section>

        {/* ── Categories §3.7.3 ─────────────────────────────────────── */}
        <Section title="Categories">
          <FlatList
            data={categories}
            keyExtractor={(item) => item.id}
            renderItem={renderCategoryItem}
            scrollEnabled={false}
          />
          <TouchableOpacity
            onPress={() => void handleAddCategory()}
            style={[catStyles.addBtn, { borderTopColor: colors.border }]}
          >
            <Text style={[catStyles.addBtnText, { color: !isPro && categories.length >= 3 ? colors.textMuted : colors.accent }]}>
              + Add Category
              {!isPro && categories.length >= 3 ? '  (Pro)' : ''}
            </Text>
          </TouchableOpacity>
        </Section>

        {/* ── Subscription §3.7.4 ──────────────────────────────────── */}
        <Section title="Subscription">
          <SettingRow
            label="Current Plan"
            right={
              <Text style={[styles.rightLabel, { color: colors.textSecondary }]}>
                {user?.subscriptionStatus === 'pro' ? 'Oshi Pro' :
                 user?.subscriptionStatus === 'trial' ? 'Pro Trial' :
                 user?.subscriptionStatus === 'cancelled' ? 'Cancelled' : 'Free'}
              </Text>
            }
            isLast={isPro}
          />
          {!isPro && (
            <SettingRow
              label="Upgrade to Pro"
              sublabel="Unlimited saves, categories & more"
              right={<Text style={[styles.chevron, { color: colors.accent }]}>›</Text>}
              onPress={() => {/* navigate to paywall */}}
              isLast
            />
          )}
        </Section>

        {/* ── Account §3.7.5 ─────────────────────────────────────────── */}
        <Section title="Account">
          <SettingRow
            label="Sign Out"
            right={<Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>}
            onPress={() => {
              Alert.alert('Sign out?', 'You will need to sign in again.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign Out', style: 'destructive', onPress: () => void signOut() },
              ]);
            }}
            isLast={false}
          />
          <SettingRow
            label="Delete Account"
            sublabel="Permanently removes your account after 30 days"
            right={<Text style={[styles.chevron, { color: colors.error }]}>›</Text>}
            onPress={startDeleteAccount}
            isLast
          />
        </Section>

        {/* App version */}
        <Text style={[styles.version, { color: colors.textMuted }]}>
          Oshi {(Constants.expoConfig?.version ?? '1.0.0') as string}
        </Text>
      </ScrollView>

      {/* ── Category edit modal ──────────────────────────────────────── */}
      <CategoryEditModal
        cat={editingCat}
        visible={catEditVisible}
        isPro={isPro}
        onSave={(id, name, emoji) => void saveCategoryEdit(id, name, emoji)}
        onClose={() => setCatEditVisible(false)}
      />

      {/* ── New category modal (cross-platform replacement for Alert.prompt) ── */}
      <Modal
        visible={newCatVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setNewCatVisible(false)}
      >
        <Pressable style={ceStyles.overlay} onPress={() => setNewCatVisible(false)}>
          <KeyboardAvoidingView
            behavior="padding"
            style={[ceStyles.kbWrapper, { paddingBottom: insets.bottom + 24 }]}
            keyboardVerticalOffset={0}
          >
            <View
              style={[
                ceStyles.sheet,
                { backgroundColor: colors.surface, borderRadius: theme.borderRadius.md },
              ]}
            >
              <Text style={[ceStyles.title, { color: colors.textPrimary }]}>New Category</Text>
              <TextInput
                value={newCatName}
                onChangeText={setNewCatName}
                placeholder="Category name"
                placeholderTextColor={colors.textSecondary}
                style={{
                  height: 56,
                  fontSize: 16,
                  paddingHorizontal: 12,
                  color: colors.textPrimary,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                }}
                maxLength={40}
                autoFocus
              />
              <View style={{ height: 16 }} />
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
                <TouchableOpacity onPress={() => setNewCatVisible(false)}>
                  <Text style={{ color: colors.textMuted, fontSize: 15 }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    console.log('[settings] Create category pressed');
                    console.log('[settings] newCatName before trim:', newCatName);
                    const name = newCatName.trim();
                    if (!name) {
                      console.log('[settings] Create aborted — empty name');
                      return;
                    }
                    try {
                      console.log('[settings] POST /categories payload:', { name, emoji: '📌' });
                      const res = await apiClient.post<Category>('/categories', {
                        name,
                        emoji: '📌',
                      });
                      console.log('[settings] POST /categories response:', res.data);
                      setCategories((prev) => [...prev, res.data]);
                      analytics.settingsCategoryCreated();
                      setNewCatVisible(false);
                    } catch (err) {
                      console.log('[settings] POST /categories error:', err);
                      Alert.alert('Error', 'Could not create category.');
                    }
                  }}
                >
                  <Text style={{ color: colors.accent, fontSize: 15, fontWeight: '600' }}>
                    Create
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* ── Delete account step 1: consequences ─────────────────────── */}
      <Modal
        visible={deleteStep === 'confirm1'}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteStep('idle')}
      >
        <Pressable style={delStyles.overlay} onPress={() => setDeleteStep('idle')}>
          <View style={[delStyles.dialog, { backgroundColor: colors.surface, borderRadius: theme.borderRadius.md }]}>
            <Text style={[delStyles.title, { color: colors.textPrimary }]}>Delete Account?</Text>
            <Text style={[delStyles.body, { color: colors.textSecondary }]}>
              • All your saves and categories will be retained for 30 days.{'\n'}
              • After 30 days, all data is permanently deleted.{'\n'}
              • You will be signed out immediately.{'\n'}
              • You can restore your account within 30 days by signing back in.
            </Text>
            <View style={delStyles.btnRow}>
              <TouchableOpacity
                style={[delStyles.btn, { borderColor: colors.border }]}
                onPress={() => setDeleteStep('idle')}
              >
                <Text style={[delStyles.btnText, { color: colors.textPrimary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[delStyles.btn, { backgroundColor: colors.error }]}
                onPress={proceedToDeleteStep2}
              >
                <Text style={[delStyles.btnText, { color: '#FFF' }]}>Continue</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* ── Delete account step 2: type DELETE ──────────────────────── */}
      <Modal
        visible={deleteStep === 'confirm2'}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteStep('idle')}
      >
        <Pressable style={delStyles.overlay} onPress={() => setDeleteStep('idle')}>
          <View style={[delStyles.dialog, { backgroundColor: colors.surface, borderRadius: theme.borderRadius.md }]}>
            <Text style={[delStyles.title, { color: colors.error }]}>Final Confirmation</Text>
            <Text style={[delStyles.body, { color: colors.textSecondary }]}>
              Type <Text style={{ fontWeight: '700' }}>DELETE</Text> below to permanently delete your account.
            </Text>
            <TextInput
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder="DELETE"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              style={[
                delStyles.deleteInput,
                {
                  color: colors.textPrimary,
                  borderColor: deleteConfirmText === 'DELETE' ? colors.error : colors.border,
                  backgroundColor: colors.background,
                  borderRadius: theme.borderRadius.sm,
                },
              ]}
            />
            <View style={delStyles.btnRow}>
              <TouchableOpacity
                style={[delStyles.btn, { borderColor: colors.border }]}
                onPress={() => setDeleteStep('idle')}
              >
                <Text style={[delStyles.btnText, { color: colors.textPrimary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[delStyles.btn, { backgroundColor: deleteConfirmText === 'DELETE' ? colors.error : colors.border }]}
                onPress={() => void confirmDeleteAccount()}
                disabled={isDeletingAccount}
              >
                <Text style={[delStyles.btnText, { color: '#FFF' }]}>
                  {isDeletingAccount ? 'Deleting…' : 'Delete Forever'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reminder sub-styles
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Category sub-styles
// ─────────────────────────────────────────────────────────────────────────────

const catStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  orderBtns: { flexDirection: 'column', alignItems: 'center', width: 28, gap: 2 },
  orderBtn: { padding: 2 },
  orderArrow: { fontSize: 16, fontWeight: '700', lineHeight: 20 },
  emoji: { fontSize: 22, width: 32, textAlign: 'center' },
  info: { flex: 1 },
  name: { fontSize: 16, fontWeight: '500' },
  count: { fontSize: 12 },
  deleteBtn: { padding: 4 },
  deleteIcon: { fontSize: 18 },
  chevron: { fontSize: 20 },
  addBtn: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  addBtnText: { fontSize: 16, fontWeight: '600' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Delete dialog sub-styles
// ─────────────────────────────────────────────────────────────────────────────

const delStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', padding: 24 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 16 },
  body: { fontSize: 15, lineHeight: 22, marginBottom: 20 },
  deleteInput: {
    height: 48,
    borderWidth: 2,
    paddingHorizontal: 12,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 20,
  },
  btnRow: { flexDirection: 'row', gap: 12 },
  btn: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1 },
  btnText: { fontSize: 16, fontWeight: '700' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Root styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  navBar: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  navTitle: { fontSize: 17, fontWeight: '700' },
  content: { paddingTop: 24 },
  rightLabel: { fontSize: 15 },
  chevron: { fontSize: 20 },
  version: { textAlign: 'center', fontSize: 13, marginTop: 4, paddingBottom: 32 },
});
