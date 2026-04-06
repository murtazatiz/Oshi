/**
 * SaveUrlScreen — manual URL save modal.
 *
 * Gives users a reliable way to save a URL by pasting it directly, acting as
 * the primary fallback while Android share-intent debugging is in progress and
 * as a permanent convenience for copying links from browsers/apps that don't
 * expose a share sheet target.
 *
 * Accessible via the "+" button in the Library header.
 * Accepts an optional `prefillUrl` route param so other parts of the app
 * (e.g. AndroidShareHandler on cold-start) can open it pre-filled.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

import { useTheme } from '../theme/ThemeContext';
import { apiClient } from '../services/apiClient';
import type { MainStackParamList } from '../navigation/types';
import { useSavesStore } from '../store/savesStore';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type NavProp = NativeStackNavigationProp<MainStackParamList, 'SaveUrl'>;
type RouteParam = RouteProp<MainStackParamList, 'SaveUrl'>;

type SaveState = 'idle' | 'saving' | 'success' | 'error';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isValidUrl(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function SaveUrlScreen(): React.JSX.Element {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RouteParam>();
  const { colors, theme } = useTheme();
  const { spacing, borderRadius, typography } = theme;

  const prefill = route.params?.prefillUrl ?? '';
  const [url, setUrl] = useState(prefill);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const addSaveToTop = useSavesStore((s) => s.addSaveToTop);

  const inputRef = useRef<TextInput>(null);
  const successScale = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Auto-focus the input when the modal opens (unless prefilled)
  useEffect(() => {
    if (!prefill) {
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [prefill]);

  // ── Animations ─────────────────────────────────────────────────────────────

  function playSuccess(): void {
    successScale.setValue(0);
    Animated.spring(successScale, {
      toValue: 1,
      useNativeDriver: true,
      tension: 80,
      friction: 7,
    }).start();
  }

  function playShake(): void {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }

  // ── Save logic ──────────────────────────────────────────────────────────────

  async function handleSave(): Promise<void> {
    const trimmed = url.trim();

    if (!trimmed) {
      setErrorMsg('Please enter a URL.');
      playShake();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    if (!isValidUrl(trimmed)) {
      setErrorMsg('That doesn\'t look like a valid URL. Make sure it starts with http:// or https://');
      playShake();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    setErrorMsg('');
    setSaveState('saving');

    try {
      const res = await apiClient.post('/saves', { url: trimmed });
      // Optimistically insert the new pending save so the user immediately
      // sees a processing card at the top of the Library.
      // The Supabase Realtime subscription will update it once AI completes.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      addSaveToTop(res.data as any);
      setSaveState('success');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      playSuccess();
      // Auto-dismiss after the success animation completes
      setTimeout(() => navigation.goBack(), 1400);
    } catch (err: unknown) {
      setSaveState('error');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const message =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setErrorMsg(message);
    }
  }

  function handleUrlChange(text: string): void {
    setUrl(text);
    if (saveState === 'error') setSaveState('idle');
    if (errorMsg) setErrorMsg('');
  }

  // ── Derived state ───────────────────────────────────────────────────────────

  const isSaving = saveState === 'saving';
  const isSuccess = saveState === 'success';
  const canSave = url.trim().length > 0 && !isSaving && !isSuccess;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              paddingHorizontal: spacing.md,
            },
          ]}
        >
          <Text style={[styles.title, { color: colors.textPrimary, ...typography.h3 }]}>
            Save a URL
          </Text>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={12}
            accessibilityLabel="Close"
            accessibilityRole="button"
            style={[
              styles.closeBtn,
              { backgroundColor: colors.border, borderRadius: borderRadius.full ?? 999 },
            ]}
          >
            <Text style={[styles.closeBtnText, { color: colors.textMuted }]}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <View style={[styles.body, { paddingHorizontal: spacing.md }]}>

          {isSuccess ? (
            /* ── Success state ──────────────────────────────────────────── */
            <Animated.View
              style={[styles.successContainer, { transform: [{ scale: successScale }] }]}
            >
              <Text style={styles.successEmoji}>✓</Text>
              <Text style={[styles.successText, { color: colors.success, ...typography.h3 }]}>
                Saved!
              </Text>
              <Text style={[styles.successSub, { color: colors.textMuted, ...typography.body }]}>
                Oshi is processing your link in the background.
              </Text>
            </Animated.View>
          ) : (
            <>
              <Text style={[styles.label, { color: colors.textSecondary, ...typography.caption }]}>
                Paste a link from Chrome, Instagram, YouTube, or anywhere else.
              </Text>

              {/* ── URL input ───────────────────────────────────────────── */}
              <Animated.View
                style={{ transform: [{ translateX: shakeAnim }] }}
              >
                <View
                  style={[
                    styles.inputWrapper,
                    {
                      backgroundColor: colors.surface,
                      borderColor:
                        saveState === 'error' ? colors.error : colors.border,
                      borderRadius: borderRadius.md,
                    },
                  ]}
                >
                  <Text style={styles.linkIcon}>🔗</Text>
                  <TextInput
                    ref={inputRef}
                    style={[
                      styles.input,
                      { color: colors.textPrimary, ...typography.body },
                    ]}
                    value={url}
                    onChangeText={handleUrlChange}
                    placeholder="https://..."
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="done"
                    onSubmitEditing={() => void handleSave()}
                    editable={!isSaving}
                    selectTextOnFocus
                    accessibilityLabel="URL input"
                  />
                  {url.length > 0 && !isSaving && (
                    <Pressable
                      onPress={() => {
                        setUrl('');
                        setErrorMsg('');
                        setSaveState('idle');
                        inputRef.current?.focus();
                      }}
                      hitSlop={8}
                      accessibilityLabel="Clear URL"
                    >
                      <Text style={[styles.clearBtn, { color: colors.textMuted }]}>✕</Text>
                    </Pressable>
                  )}
                </View>
              </Animated.View>

              {/* ── Inline error ─────────────────────────────────────────── */}
              {errorMsg ? (
                <Text
                  style={[styles.errorText, { color: colors.error, ...typography.caption }]}
                  accessibilityRole="alert"
                >
                  {errorMsg}
                </Text>
              ) : null}

              {/* ── Save button ──────────────────────────────────────────── */}
              <TouchableOpacity
                onPress={() => void handleSave()}
                disabled={!canSave}
                activeOpacity={0.8}
                accessibilityLabel="Save URL"
                accessibilityRole="button"
                style={[
                  styles.saveBtn,
                  {
                    backgroundColor: canSave ? colors.accent : colors.border,
                    borderRadius: borderRadius.md,
                    marginTop: spacing.md,
                  },
                ]}
              >
                {isSaving ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={[styles.saveBtnText, typography.button ?? {}]}>
                    Save to Oshi
                  </Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontWeight: '700',
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Body
  body: {
    flex: 1,
    paddingTop: 24,
    gap: 12,
  },
  label: {
    lineHeight: 20,
    marginBottom: 4,
  },

  // Input
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    gap: 8,
    minHeight: 52,
  },
  linkIcon: {
    fontSize: 18,
  },
  input: {
    flex: 1,
    padding: 0,
    fontSize: 15,
  },
  clearBtn: {
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 4,
  },

  // Error
  errorText: {
    lineHeight: 18,
    marginTop: 2,
  },

  // Save button
  saveBtn: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // Success
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingBottom: 60,
  },
  successEmoji: {
    fontSize: 56,
    color: '#22C55E',
    fontWeight: '300',
  },
  successText: {
    fontWeight: '700',
  },
  successSub: {
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 260,
  },
});
