/**
 * ProfileScreen — PRD §3.7.1
 *
 *   • Large avatar circle: shows photo or initials on accent bg
 *   • Tap avatar → Action sheet: Take Photo / Choose from Library
 *   • expo-image-picker → expo-image-manipulator (compress ≤500KB, JPEG 0.7)
 *   • POST /users/avatar (multipart/form-data)
 *   • Display name: editable inline
 *   • Email: read-only display
 *   • Streak counter with flame icon
 *   • Pro badge when subscription_status = 'pro'
 *   • Stats: items saved, categories
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '../../theme/ThemeContext';
import { useAuthStore } from '../../store/authStore';
import { apiClient } from '../../services/apiClient';
import analytics from '../../services/analytics';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ProfileScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const { colors, theme } = useTheme();
  const { spacing, borderRadius } = theme;

  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s._setSession); // we patch user via store internals
  const authStore = useAuthStore();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | undefined>(user?.avatarUrl);

  const nameInputRef = useRef<TextInput>(null);

  if (!user) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  const initials = getInitials(user.displayName || user.email);

  // ── Avatar upload ────────────────────────────────────────────────────────

  async function pickAndUploadAvatar(source: 'camera' | 'library'): Promise<void> {
    // Request permission
    const permResult =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permResult.granted) {
      Alert.alert('Permission required', `Please allow ${source === 'camera' ? 'camera' : 'photo library'} access in Settings.`);
      return;
    }

    const pickerResult =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1, 1], quality: 1 });

    if (pickerResult.canceled || !pickerResult.assets[0]) return;

    const asset = pickerResult.assets[0];

    setIsUploadingAvatar(true);
    try {
      // Compress: quality 0.7, max ~600px, JPEG — targets ≤500KB (PRD §3.7.1)
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 600 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
      );

      // Build FormData
      const formData = new FormData();
      formData.append('avatar', {
        uri: manipulated.uri,
        name: 'profile.jpg',
        type: 'image/jpeg',
      } as unknown as Blob);

      const res = await apiClient.post<{ avatar_url: string }>('/users/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      // Update local display immediately
      setAvatarUri(res.data.avatar_url);
      analytics.settingsAvatarUploaded();

      // Patch authStore user — update avatarUrl via direct store mutation
      const current = useAuthStore.getState();
      if (current.user) {
        useAuthStore.setState({
          user: { ...current.user, avatarUrl: res.data.avatar_url },
        });
      }
    } catch {
      Alert.alert('Upload failed', 'Could not upload your photo. Please try again.');
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  function showAvatarPicker(): void {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Take Photo', 'Choose from Library', 'Cancel'], cancelButtonIndex: 2 },
        (idx) => {
          if (idx === 0) void pickAndUploadAvatar('camera');
          else if (idx === 1) void pickAndUploadAvatar('library');
        },
      );
    } else {
      Alert.alert('Profile Photo', undefined, [
        { text: 'Take Photo',            onPress: () => void pickAndUploadAvatar('camera') },
        { text: 'Choose from Library',   onPress: () => void pickAndUploadAvatar('library') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

  // ── Display name save ─────────────────────────────────────────────────────

  async function saveName(): Promise<void> {
    const trimmed = displayName.trim();
    if (!trimmed || trimmed === user?.displayName) {
      setDisplayName(user?.displayName ?? '');
      setIsEditingName(false);
      return;
    }
    setIsSavingName(true);
    try {
      await apiClient.patch('/users/me', { display_name: trimmed });
      analytics.settingsDisplayNameChanged();
      const current = useAuthStore.getState();
      if (current.user) {
        useAuthStore.setState({ user: { ...current.user, displayName: trimmed } });
      }
      setIsEditingName(false);
    } catch {
      Alert.alert('Error', 'Could not save display name.');
    } finally {
      setIsSavingName(false);
    }
  }

  const isPro = user.subscriptionStatus === 'pro' || user.subscriptionStatus === 'trial';

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Text style={[styles.backIcon, { color: colors.accent }]}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Profile</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {/* ── Avatar ────────────────────────────────────────────────────── */}
        <View style={styles.avatarSection}>
          <TouchableOpacity
            onPress={showAvatarPicker}
            style={[styles.avatarCircle, { backgroundColor: colors.accent }]}
            disabled={isUploadingAvatar}
            accessibilityLabel="Change profile photo"
          >
            {avatarUri ? (
              <Image
                source={{ uri: avatarUri }}
                style={styles.avatarImage}
                contentFit="cover"
              />
            ) : (
              <Text style={styles.avatarInitials}>{initials}</Text>
            )}
            {isUploadingAvatar && (
              <View style={styles.avatarOverlay}>
                <ActivityIndicator color="#FFFFFF" />
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={showAvatarPicker} disabled={isUploadingAvatar}>
            <Text style={[styles.avatarChangeLabel, { color: colors.accent }]}>
              Change Photo
            </Text>
          </TouchableOpacity>

          {/* Pro badge */}
          {isPro && (
            <View style={[styles.proBadge, { backgroundColor: colors.accent, borderRadius: borderRadius.pill }]}>
              <Text style={styles.proBadgeText}>✦ PRO</Text>
            </View>
          )}

          {/* Streak */}
          {user.streakCount > 0 && (
            <View style={styles.streakRow}>
              <Text style={styles.streakFlame}>🔥</Text>
              <Text style={[styles.streakCount, { color: colors.textPrimary }]}>
                {user.streakCount} day streak
              </Text>
            </View>
          )}
        </View>

        {/* ── Fields ───────────────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderRadius: borderRadius.md, marginHorizontal: spacing.md }]}>
          {/* Display name */}
          <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Name</Text>
            {isEditingName ? (
              <View style={styles.fieldEditRow}>
                <TextInput
                  ref={nameInputRef}
                  style={[styles.fieldInput, { color: colors.textPrimary }]}
                  value={displayName}
                  onChangeText={setDisplayName}
                  autoFocus
                  onSubmitEditing={() => void saveName()}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  onPress={() => void saveName()}
                  disabled={isSavingName}
                  style={[styles.saveBtn, { backgroundColor: colors.accent, borderRadius: borderRadius.sm }]}
                >
                  {isSavingName
                    ? <ActivityIndicator size="small" color="#FFF" />
                    : <Text style={styles.saveBtnText}>Save</Text>
                  }
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.fieldValueRow}
                onPress={() => {
                  setIsEditingName(true);
                  setTimeout(() => nameInputRef.current?.focus(), 50);
                }}
              >
                <Text style={[styles.fieldValue, { color: colors.textPrimary }]}>
                  {user.displayName || 'Tap to set name'}
                </Text>
                <Text style={[styles.editIcon, { color: colors.accent }]}>✎</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Email — read-only */}
          <View style={styles.fieldRow}>
            <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Email</Text>
            <Text style={[styles.fieldValue, { color: colors.textSecondary }]}>{user.email}</Text>
          </View>
        </View>

        {/* ── Stats ─────────────────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderRadius: borderRadius.md, marginHorizontal: spacing.md, marginTop: spacing.md }]}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted, padding: spacing.md, paddingBottom: spacing.sm }]}>
            STATS THIS MONTH
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <Text style={[styles.statNumber, { color: colors.accent }]}>{user.itemsSavedThisMonth}</Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>Saved</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statCell}>
              <Text style={[styles.statNumber, { color: colors.accent }]}>{user.streakCount}</Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>Streak</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statCell}>
              <Text style={[styles.statNumber, { color: colors.accent }]}>
                {user.subscriptionStatus === 'pro' ? '∞' : '20'}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textMuted }]}>Monthly limit</Text>
            </View>
          </View>
        </View>

        {/* Subscription status */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderRadius: borderRadius.md, marginHorizontal: spacing.md, marginTop: spacing.md }]}>
          <View style={[styles.fieldRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Plan</Text>
            <View style={styles.fieldValueRow}>
              <Text style={[styles.fieldValue, { color: colors.textPrimary }]}>
                {user.subscriptionStatus === 'pro' ? 'Oshi Pro' :
                 user.subscriptionStatus === 'trial' ? 'Pro Trial' :
                 user.subscriptionStatus === 'cancelled' ? 'Cancelled' : 'Free'}
              </Text>
              {!isPro && (
                <TouchableOpacity
                  style={[styles.upgradeBtn, { backgroundColor: colors.accent, borderRadius: borderRadius.pill }]}
                >
                  <Text style={styles.upgradeBtnText}>Upgrade</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const AVATAR_SIZE = 96;

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backIcon: { fontSize: 28, lineHeight: 34 },
  headerTitle: { fontSize: 17, fontWeight: '600' },

  avatarSection: {
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 20,
    gap: 8,
  },
  avatarCircle: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: AVATAR_SIZE, height: AVATAR_SIZE },
  avatarInitials: { color: '#FFFFFF', fontSize: 34, fontWeight: '700' },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarChangeLabel: { fontSize: 15, fontWeight: '600' },

  proBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 2,
  },
  proBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', letterSpacing: 1 },

  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  streakFlame: { fontSize: 18 },
  streakCount: { fontSize: 15, fontWeight: '600' },

  card: { overflow: 'hidden' },

  sectionLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.8 },

  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  fieldLabel: { fontSize: 14, fontWeight: '500', width: 60 },
  fieldValue: { fontSize: 16, flex: 1 },
  fieldValueRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  editIcon: { fontSize: 18 },
  fieldEditRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldInput: { flex: 1, fontSize: 16, padding: 0 },
  saveBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  saveBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

  statsRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 16 },
  statCell: { flex: 1, alignItems: 'center', gap: 4 },
  statNumber: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 12 },
  statDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: 8 },

  upgradeBtn: { paddingHorizontal: 12, paddingVertical: 5 },
  upgradeBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});
