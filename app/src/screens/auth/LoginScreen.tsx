import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useTheme } from '../../theme/ThemeContext';
import { useAuthActions, useAuthStore } from '../../store/authStore';
import { useOnboardingActions } from '../../store/onboardingStore';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidPassword(value: string): boolean {
  return value.length >= 8 && /\d/.test(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function LoginScreen({ navigation }: Props): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { signIn, signInWithApple, signInWithGoogle, clearError } = useAuthActions();
  const { markComplete: markOnboardingComplete } = useOnboardingActions();
  const isLoading = useAuthStore((s) => s.isLoading);
  const storeError = useAuthStore((s) => s.error);
  const sessionExpiredMessage = useAuthStore((s) => s.sessionExpiredMessage);
  const clearSessionExpiredMessage = useAuthStore((s) => s.clearSessionExpiredMessage);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const passwordRef = useRef<TextInput>(null);

  // Show session-expired banner from a previous 401 sign-out
  useEffect(() => {
    if (sessionExpiredMessage) {
      Alert.alert('Session Expired', sessionExpiredMessage, [
        { text: 'OK', onPress: clearSessionExpiredMessage },
      ]);
    }
  }, [sessionExpiredMessage, clearSessionExpiredMessage]);

  // Clear store error when user starts typing
  useEffect(() => {
    if (storeError) clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, password]);

  function validateFields(): boolean {
    let isValid = true;

    if (!isValidEmail(email)) {
      setEmailError('Enter a valid email address.');
      isValid = false;
    } else {
      setEmailError('');
    }

    if (!password) {
      setPasswordError('Password is required.');
      isValid = false;
    } else {
      setPasswordError('');
    }

    return isValid;
  }

  async function handleSignIn(): Promise<void> {
    if (!validateFields()) return;
    try {
      await signIn(email.trim(), password);
      // Returning users who sign in via this screen skip onboarding steps 6-9
      await markOnboardingComplete();
    } catch {
      // Error is already in store — displayed via storeError below
    }
  }

  const styles = makeStyles(colors, theme);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.wordmark}>Oshi</Text>
            <Text style={styles.subtitle}>Welcome back</Text>
          </View>

          {/* Store-level error banner */}
          {storeError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{storeError}</Text>
            </View>
          ) : null}

          {/* Form */}
          <View style={styles.form}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={[styles.input, emailError ? styles.inputError : null]}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                editable={!isLoading}
                accessibilityLabel="Email address"
              />
              {emailError ? (
                <Text style={styles.fieldError}>{emailError}</Text>
              ) : null}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  ref={passwordRef}
                  style={[
                    styles.input,
                    styles.passwordInput,
                    passwordError ? styles.inputError : null,
                  ]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Your password"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!isPasswordVisible}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password"
                  returnKeyType="done"
                  onSubmitEditing={handleSignIn}
                  editable={!isLoading}
                  accessibilityLabel="Password"
                />
                <Pressable
                  style={styles.eyeButton}
                  onPress={() => setIsPasswordVisible((v) => !v)}
                  accessibilityLabel={
                    isPasswordVisible ? 'Hide password' : 'Show password'
                  }
                  hitSlop={8}
                >
                  <Text style={styles.eyeText}>
                    {isPasswordVisible ? '🙈' : '👁'}
                  </Text>
                </Pressable>
              </View>
              {passwordError ? (
                <Text style={styles.fieldError}>{passwordError}</Text>
              ) : null}
            </View>

            <Pressable
              style={styles.forgotLink}
              onPress={() => navigation.navigate('ForgotPassword')}
              accessibilityRole="button"
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </Pressable>

            {/* Primary CTA */}
            <Pressable
              style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
              onPress={handleSignIn}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
            >
              <Text style={styles.primaryButtonText}>
                {isLoading ? 'Signing in…' : 'Sign In'}
              </Text>
            </Pressable>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Apple Sign In — iOS only */}
            {Platform.OS === 'ios' ? (
              <Pressable
                style={[styles.socialButton, styles.appleButton]}
                onPress={signInWithApple}
                disabled={isLoading}
                accessibilityRole="button"
                accessibilityLabel="Continue with Apple"
              >
                <Text style={styles.appleButtonText}> Continue with Apple</Text>
              </Pressable>
            ) : null}

            {/* Google Sign In */}
            <Pressable
              style={[styles.socialButton, styles.googleButton]}
              onPress={signInWithGoogle}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
            >
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </Pressable>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <Pressable
              onPress={() => navigation.navigate('Signup')}
              accessibilityRole="link"
            >
              <Text style={[styles.footerText, styles.footerLink]}>Sign Up</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles — built from theme tokens, called once per render so colors respond
// to dark mode changes via ThemeContext
// ─────────────────────────────────────────────────────────────────────────────
function makeStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  theme: ReturnType<typeof useTheme>['theme'],
) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: theme.spacing.md,
      paddingBottom: theme.spacing.xl,
    },
    header: {
      alignItems: 'center',
      paddingTop: theme.spacing.xxl,
      paddingBottom: theme.spacing.xl,
    },
    wordmark: {
      ...theme.typography.display,
      color: colors.primary,
      marginBottom: theme.spacing.xs,
    },
    subtitle: {
      ...theme.typography.body,
      color: colors.textSecondary,
    },
    errorBanner: {
      backgroundColor: `${colors.error}18`,
      borderColor: colors.error,
      borderWidth: 1,
      borderRadius: theme.borderRadius.sm,
      padding: theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    errorBannerText: {
      ...theme.typography.bodySmall,
      color: colors.error,
    },
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
    fieldError: {
      ...theme.typography.caption,
      color: colors.error,
    },
    forgotLink: {
      alignSelf: 'flex-end',
      minHeight: 44,
      justifyContent: 'center',
    },
    forgotText: {
      ...theme.typography.bodySmall,
      color: colors.accent,
    },
    primaryButton: {
      height: 52,
      backgroundColor: colors.accent,
      borderRadius: theme.borderRadius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
    },
    buttonDisabled: { opacity: 0.6 },
    primaryButtonText: {
      ...theme.typography.button,
      color: '#FFFFFF',
    },
    divider: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginVertical: theme.spacing.xs,
    },
    dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
    dividerText: { ...theme.typography.caption, color: colors.textMuted },
    socialButton: {
      height: 52,
      borderRadius: theme.borderRadius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
    },
    appleButton: { backgroundColor: '#000000' },
    appleButtonText: {
      ...theme.typography.button,
      color: '#FFFFFF',
    },
    googleButton: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    googleButtonText: {
      ...theme.typography.button,
      color: colors.textPrimary,
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: theme.spacing.xl,
    },
    footerText: { ...theme.typography.body, color: colors.textSecondary },
    footerLink: { color: colors.accent, fontWeight: '600' },
  });
}
