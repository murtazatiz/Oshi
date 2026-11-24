/**
 * AccountRestorePrompt — PRD §3.7.5.
 *
 * Shown when the account that just signed in is pending deletion (inside the
 * 30-day window). "Restore" clears the deletion; "Keep it deleted" signs out.
 * Mounted once at the app root; the auth store decides when it's visible,
 * whichever sign-in path brought the user back.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../theme/ThemeContext';
import { useAuthStore } from '../store/authStore';
import { getApiError } from '../services/apiClient';

export function AccountRestorePrompt(): React.JSX.Element | null {
  const { colors, theme } = useTheme();
  const pending = useAuthStore((s) => s.pendingAccountRestore);
  const restoreAccount = useAuthStore((s) => s.restoreAccount);
  const declineAccountRestore = useAuthStore((s) => s.declineAccountRestore);
  const [isWorking, setIsWorking] = useState(false);

  if (!pending) return null;

  const purgeDay = new Date(pending.purgeAfter).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  async function handleRestore(): Promise<void> {
    setIsWorking(true);
    try {
      await restoreAccount();
    } catch (err) {
      Alert.alert(
        "Couldn't restore your account",
        getApiError(err)?.message ?? 'Please check your connection and try again.',
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function handleDecline(): Promise<void> {
    setIsWorking(true);
    try {
      await declineAccountRestore();
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.overlay}>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderRadius: theme.borderRadius.md, padding: theme.spacing.lg },
          ]}
        >
          <Text style={[styles.title, { color: colors.textPrimary }]}>Welcome back</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Your Oshi account is scheduled for deletion. Restore it now to keep your saves and
            categories, or it will be permanently deleted on {purgeDay}.
          </Text>

          <TouchableOpacity
            onPress={() => void handleRestore()}
            disabled={isWorking}
            style={[styles.primaryBtn, { backgroundColor: colors.accent, borderRadius: theme.borderRadius.sm }]}
            accessibilityRole="button"
          >
            {isWorking ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>Restore my account</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => void handleDecline()}
            disabled={isWorking}
            style={styles.secondaryBtn}
            accessibilityRole="button"
          >
            <Text style={[styles.secondaryBtnText, { color: colors.textMuted }]}>
              Keep it deleted and sign out
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: { gap: 12 },
  title: { fontSize: 22, fontWeight: '800' },
  body: { fontSize: 15, lineHeight: 22, marginBottom: 8 },
  primaryBtn: { height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  secondaryBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontSize: 15 },
});
