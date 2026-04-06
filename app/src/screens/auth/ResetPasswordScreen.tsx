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

type Props = NativeStackScreenProps<AuthStackParamList, 'ResetPassword'>;

// ─────────────────────────────────────────────────────────────────────────────
// Validation — same rules as Signup per PRD §3.5.1
// ─────────────────────────────────────────────────────────────────────────────
function isValidPassword(v: string): boolean {
  return v.length >= 8 && /\d/.test(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// PRD §3.5.2 — Reset password flow:
// Token arrives from deep link oshi://auth/reset?token=[token] (PRD §4).
// AppNavigator parses the token and passes it as a route param.
// Calls backend POST /auth/update-password with { token, new_password }.
// ─────────────────────────────────────────────────────────────────────────────
export default function ResetPasswordScreen({ route, navigation }: Props): React.JSX.Element {
  const { token } = route.params;
  const { colors, theme } = useTheme();
  const { updatePassword } = useAuthActions();
  const isLoading = useAuthStore((s) => s.isLoading);
  const storeError = useAuthStore((s) => s.error);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [hasSaved, setHasSaved] = useState(false);

  function validate(): boolean {
    let isValid = true;

    if (!isValidPassword(password)) {
      setPasswordError('Password must be at least 8 characters and contain a number.');
      isValid = false;
    } else {
      setPasswordError('');
    }

    if (password !== confirmPassword) {
      setConfirmError('Passwords do not match.');
      isValid = false;
    } else {
      setConfirmError('');
    }

    return isValid;
  }

  async function handleUpdate(): Promise<void> {
    if (!validate()) return;

    try {
      await updatePassword(token, password);
      setHasSaved(true);
    } catch {
      // Error in store — shown below
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
          {hasSaved ? (
            // ── Success state ──
            <View style={styles.successContainer}>
              <Text style={styles.successIcon}>✅</Text>
              <Text style={styles.title}>Password updated!</Text>
              <Text style={styles.successBody}>
                Your password has been reset successfully. Sign in with your new password.
              </Text>
              <Pressable
                style={styles.primaryButton}
                onPress={() => navigation.navigate('Login')}
                accessibilityRole="button"
                accessibilityLabel="Sign in"
              >
                <Text style={styles.primaryButtonText}>Sign In</Text>
              </Pressable>
            </View>
          ) : (
            // ── Form state ──
            <>
              <View style={styles.header}>
                <Text style={styles.title}>Set new password</Text>
                <Text style={styles.subtitle}>
                  Choose a strong password — at least 8 characters and one number.
                </Text>
              </View>

              {storeError ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorBannerText}>{storeError}</Text>
                </View>
              ) : null}

              {/* Guard: token must be present — deep link required */}
              {!token ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorBannerText}>
                    Invalid reset link. Please request a new one.
                  </Text>
                </View>
              ) : null}

              <View style={styles.form}>
                {/* New Password */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>New Password</Text>
                  <View style={styles.passwordRow}>
                    <TextInput
                      style={[
                        styles.input,
                        styles.passwordInput,
                        passwordError ? styles.inputError : null,
                      ]}
                      value={password}
                      onChangeText={(v) => {
                        setPassword(v);
                        if (passwordError) setPasswordError('');
                      }}
                      placeholder="Min 8 chars, 1 number"
                      placeholderTextColor={colors.textMuted}
                      secureTextEntry={!isPasswordVisible}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="next"
                      editable={!isLoading && !!token}
                      accessibilityLabel="New password"
                    />
                    <Pressable
                      style={styles.eyeButton}
                      onPress={() => setIsPasswordVisible((v) => !v)}
                      hitSlop={8}
                      accessibilityLabel={isPasswordVisible ? 'Hide password' : 'Show password'}
                    >
                      <Text style={styles.eyeText}>{isPasswordVisible ? '🙈' : '👁'}</Text>
                    </Pressable>
                  </View>
                  {passwordError ? (
                    <Text style={styles.fieldError}>{passwordError}</Text>
                  ) : null}
                </View>

                {/* Confirm Password */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Confirm Password</Text>
                  <TextInput
                    style={[
                      styles.input,
                      confirmError ? styles.inputError : null,
                    ]}
                    value={confirmPassword}
                    onChangeText={(v) => {
                      setConfirmPassword(v);
                      if (confirmError) setConfirmError('');
                    }}
                    placeholder="Repeat your new password"
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry={!isPasswordVisible}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    onSubmitEditing={handleUpdate}
                    editable={!isLoading && !!token}
                    accessibilityLabel="Confirm new password"
                  />
                  {confirmError ? (
                    <Text style={styles.fieldError}>{confirmError}</Text>
                  ) : null}
                </View>

                <Pressable
                  style={[
                    styles.primaryButton,
                    (isLoading || !token) && styles.buttonDisabled,
                  ]}
                  onPress={handleUpdate}
                  disabled={isLoading || !token}
                  accessibilityRole="button"
                  accessibilityLabel="Set new password"
                >
                  <Text style={styles.primaryButtonText}>
                    {isLoading ? 'Saving…' : 'Set New Password'}
                  </Text>
                </Pressable>
              </View>
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
    header: {
      paddingTop: theme.spacing.xxl,
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
    form: { gap: theme.spacing.md },
    fieldGroup: { gap: theme.spacing.xs },
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
    passwordRow: { flexDirection: 'row', alignItems: 'center' },
    passwordInput: { flex: 1 },
    eyeButton: {
      position: 'absolute',
      right: theme.spacing.md,
      height: 52,
      justifyContent: 'center',
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
    },
    eyeText: { fontSize: 18 },
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
  });
}
