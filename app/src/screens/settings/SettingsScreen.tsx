/**
 * SettingsScreen — PRD §3.7.2–3.7.5
 *
 * Sections:
 *   §3.7.2 — Reminder Settings (components/ReminderSettings, shared with RemindersScreen)
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

import { useTheme, ThemeMode } from '../../theme/ThemeContext';
import { useAuthStore } from '../../store/authStore';
import { apiClient, getApiError, isLimitError } from '../../services/apiClient';
import { openPaywall } from '../../services/paywall';
import { ReminderSettings } from '../../components/ReminderSettings';
import { TimePicker } from '../../components/TimePicker';
import { formatUtcTimetzLocal, localToUtcTimetz, utcTimetzToLocal } from '../../utils/reminderTime';
import { useSavesActions, useSavesStore, type CategoryData } from '../../store/savesStore';
import analytics, { optOutAnalytics, optInAnalytics, isOptedOut } from '../../services/analytics';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Categories come from savesStore — the same list the Library tabs render. */
type Category = CategoryData;

/** PRD §8.1 — free users may create up to 3 custom categories on top of the 11 defaults */
const FREE_CUSTOM_CATEGORY_LIMIT = 3;



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
  /** reminderOverrideTime: a time sets it, null clears it, undefined leaves it unchanged */
  onSave: (id: string, name: string, emoji: string, reminderOverrideTime: string | null | undefined) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { colors, theme } = useTheme();
  const [name, setName] = useState(cat?.name ?? '');
  const [emoji, setEmoji] = useState(cat?.emoji ?? '📌');
  // PRD §3.7.2 — Pro per-category reminder time, edited in local time
  const [hasOwnReminder, setHasOwnReminder] = useState(false);
  const [reminderHour, setReminderHour] = useState(19);
  const [reminderMinute, setReminderMinute] = useState(0);

  useEffect(() => {
    if (!cat) return;
    setName(cat.name);
    setEmoji(cat.emoji ?? '📌');
    setHasOwnReminder(cat.reminder_override_time !== undefined);
    if (cat.reminder_override_time) {
      const local = utcTimetzToLocal(cat.reminder_override_time);
      setReminderHour(local.hour);
      setReminderMinute(local.minute);
    }
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

          <View style={[ceStyles.reminderRow, { borderTopColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[ceStyles.reminderLabel, { color: colors.textPrimary }]}>Own reminder time</Text>
              <Text style={[ceStyles.reminderSub, { color: colors.textMuted }]}>
                Nudge me about this category separately · Pro
              </Text>
            </View>
            <Switch
              value={isPro && hasOwnReminder}
              onValueChange={(on) => {
                if (!isPro) {
                  onClose();
                  openPaywall('settings');
                  return;
                }
                setHasOwnReminder(on);
              }}
              trackColor={{ true: colors.accent }}
            />
          </View>
          {isPro && hasOwnReminder && (
            <TimePicker
              hour={reminderHour}
              minute={reminderMinute}
              onChangeHour={setReminderHour}
              onChangeMinute={setReminderMinute}
            />
          )}

          <TouchableOpacity
            onPress={() => {
              // Free users leave the field out entirely: setting is Pro-only on
              // the server, and a downgraded user's leftover override is kept
              // (ignored until they re-upgrade) rather than cleared by a rename.
              const override = isPro
                ? hasOwnReminder ? localToUtcTimetz(reminderHour, reminderMinute) : null
                : undefined;
              onSave(cat.id, name.trim(), emoji, override);
              onClose();
            }}
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
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
    marginBottom: 12,
  },
  reminderLabel: { fontSize: 15, fontWeight: '500' },
  reminderSub: { fontSize: 12 },
  saveBtn: { height: 50, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
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


  // ── Category state ────────────────────────────────────────────────────────
  const categories = useSavesStore((s) => s.categories);
  const {
    fetchCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    moveCategory: moveCategoryInStore,
  } = useSavesActions();
  const customCategoryCount = categories.filter((c) => c.is_system_default !== true).length;
  const isAtCategoryLimit = !isPro && customCategoryCount >= FREE_CUSTOM_CATEGORY_LIMIT;
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
    await fetchCategories();
  }



  // ── Category actions ─────────────────────────────────────────────────────

  function openCategoryEdit(cat: Category): void {
    setEditingCat(cat);
    setCatEditVisible(true);
  }

  async function saveCategoryEdit(
    id: string,
    name: string,
    emoji: string,
    reminderOverrideTime: string | null | undefined,
  ): Promise<void> {
    try {
      await updateCategory(id, {
        name,
        emoji,
        ...(reminderOverrideTime !== undefined ? { reminderOverrideTime } : {}),
      });
      analytics.settingsCategoryRenamed();
    } catch (err) {
      Alert.alert('Error', getApiError(err)?.message ?? 'Could not update category.');
    }
  }

  async function handleDeleteCategory(cat: Category): Promise<void> {
    if (cat.name === 'Other') {
      Alert.alert('Cannot delete', '"Other" is the default category and cannot be deleted.');
      return;
    }
    Alert.alert(
      `Delete ${cat.name}?`,
      `All ${cat.total_count} saves in this category will move to Other.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await deleteCategory(cat.id);
              analytics.settingsCategoryDeleted();
            } catch (e: unknown) {
              Alert.alert('Error', getApiError(e)?.message ?? 'Could not delete category.');
            }
          },
        },
      ],
    );
  }

  async function handleAddCategory(): Promise<void> {
    if (isAtCategoryLimit) {
      openPaywall('category_limit');
      return;
    }
    setNewCatName('');
    setNewCatVisible(true);
  }

  async function moveCategory(index: number, direction: 'up' | 'down'): Promise<void> {
    analytics.settingsCategoryReordered();
    await moveCategoryInStore(index, direction);
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

          <Text style={catStyles.emoji}>{item.emoji ?? '📌'}</Text>
          <View style={catStyles.info}>
            <Text style={[catStyles.name, { color: colors.textPrimary }]}>{item.name}</Text>
            <Text style={[catStyles.count, { color: colors.textMuted }]}>
              {item.total_count} saves
              {isPro && item.reminder_override_time
                ? `  ·  ⏰ ${formatUtcTimetzLocal(item.reminder_override_time)}`
                : ''}
            </Text>
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
    [colors, categories.length, handleDeleteCategory, moveCategory, isPro],
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
                  // Mirror to the server so its own events (subscriptions, AI
                  // processing, pushes) respect the choice too
                  void apiClient.patch('/users/me', { analytics_opt_out: !val }).catch(() => {
                    // Retried by the sign-in sync in App.tsx
                  });
                }}
                trackColor={{ true: colors.accent }}
              />
            }
            isLast
          />
        </Section>

        {/* ── Reminders §3.7.2 ─────────────────────────────────────── */}
        <Section title="Daily Reminder">
          <ReminderSettings />
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
            <Text style={[catStyles.addBtnText, { color: isAtCategoryLimit ? colors.textMuted : colors.accent }]}>
              + Add Category
              {isAtCategoryLimit ? '  (Pro)' : ''}
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
              onPress={() => openPaywall('settings')}
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
        onSave={(id, name, emoji, override) => void saveCategoryEdit(id, name, emoji, override)}
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
                    const name = newCatName.trim();
                    if (!name) return;
                    try {
                      await createCategory(name, '📌');
                      analytics.settingsCategoryCreated();
                      setNewCatVisible(false);
                    } catch (err) {
                      if (isLimitError(err)) {
                        // The interceptor has opened the paywall; this RN Modal
                        // renders above navigation and would hide it.
                        setNewCatVisible(false);
                        return;
                      }
                      Alert.alert('Error', getApiError(err)?.message ?? 'Could not create category.');
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
