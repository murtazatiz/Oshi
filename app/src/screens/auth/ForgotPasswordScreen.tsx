import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useTheme } from '../../theme/ThemeContext';
import { useAuthActions, useAuthStore } from '../../store/authStore';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// PRD §3.5.2 — Forgot password flow:
// Single email field → POST /auth/reset-password → show success state.
// API always returns 200 even if email not found (security: don't reveal existence).
// ─────────────────────────────────────────────────────────────────────────────
export default function ForgotPasswordScreen({ navigation }: Props): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { sendPasswordReset } = useAuthActions();
  const isLoading = useAuthStore((s) => s.isLoading);
  const storeError = useAuthStore((s) => s.error);

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [hasSent, setHasSent] = useState(false);

  async function handleSend(): Promise<void> {
    if (!isValidEmail(email)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailError('');

    try {
      await sendPasswordReset(email.trim());
      setHasSent(true);
    } catch {
      // Error is in store — displayed below
    }
  }

  const styles = makeStyles(colors, theme);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.container}>
          <Pressable
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
          >
            <Text style={styles.backText}>← Back</Text>
          </Pressable>

          {hasSent ? (
            // ── Success state ──
            <View style={styles.successContainer}>
              <Text style={styles.successIcon}>📬</Text>
              <Text style={styles.title}>Check your email</Text>
              <Text style={styles.successBody}>
                We've sent a password reset link to{' '}
                <Text style={styles.emailHighlight}>{email.trim()}</Text>.
                {'\n\n'}
                Tap the link in the email to set a new password.
              </Text>
              <Pressable
                style={styles.primaryButton}
                onPress={() => navigation.navigate('Login')}
                accessibilityRole="button"
                accessibilityLabel="Back to Login"
              >
                <Text style={styles.primaryButtonText}>Back to Login</Text>
              </Pressable>
            </View>
          ) : (
            // ── Form state ──
            <>
              <View style={styles.header}>
                <Text style={styles.title}>Reset your password</Text>
                <Text style={styles.subtitle}>
                  Enter your email address and we'll send you a link to reset your password.
                </Text>
              </View>

              {storeError ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorBannerText}>{storeError}</Text>
                </View>
              ) : null}

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={[styles.input, emailError ? styles.inputError : null]}
                  value={email}
                  onChangeText={(v) => {
                    setEmail(v);
                    if (emailError) setEmailError('');
                  }}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  returnKeyType="send"
                  onSubmitEditing={handleSend}
                  editable={!isLoading}
                  accessibilityLabel="Email address"
                />
                {emailError ? (
                  <Text style={styles.fieldError}>{emailError}</Text>
                ) : null}
              </View>

              <Pressable
                style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
                onPress={handleSend}
                disabled={isLoading}
                accessibilityRole="button"
                accessibilityLabel="Send reset link"
              >
                <Text style={styles.primaryButtonText}>
                  {isLoading ? 'Sending…' : 'Send Reset Link'}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  theme: ReturnType<typeof useTheme>['theme'],
) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    container: {
      flex: 1,
      paddingHorizontal: theme.spacing.md,
      paddingBottom: theme.spacing.xl,
    },
    backButton: {
      paddingTop: theme.spacing.md,
      minHeight: 44,
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    backText: { ...theme.typography.body, color: colors.accent },
    header: {
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.xl,
      gap: theme.spacing.sm,
    },
    title: { ...theme.typography.heading1, color: colors.textPrimary },
    subtitle: { ...theme.typography.body, color: colors.textSecondary },
    errorBanner: {
      backgroundColor: `${colors.error}18`,
      borderColor: colors.error,
      borderWidth: 1,
      borderRadius: theme.borderRadius.sm,
      padding: theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    errorBannerText: { ...theme.typography.bodySmall, color: colors.error },
    fieldGroup: { gap: theme.spacing.xs, marginBottom: theme.spacing.md },
    label: {
      ...theme.typography.bodySmall,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    input: {
      height: 52,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: theme.borderRadius.sm,
      paddingHorizontal: theme.spacing.md,
      ...theme.typography.body,
      color: colors.textPrimary,
    },
    inputError: { borderColor: colors.error },
    fieldError: { ...theme.typography.caption, color: colors.error },
    primaryButton: {
      height: 52,
      backgroundColor: colors.accent,
      borderRadius: theme.borderRadius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
    },
    buttonDisabled: { opacity: 0.6 },
    primaryButtonText: { ...theme.typography.button, color: '#FFFFFF' },
    // Success state
    successContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
    },
    successIcon: { fontSize: 56 },
    successBody: {
      ...theme.typography.body,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 24,
    },
    emailHighlight: { color: colors.textPrimary, fontWeight: '600' },
  });
}
