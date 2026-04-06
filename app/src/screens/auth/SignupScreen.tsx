import React, { useRef, useState } from 'react';
import {
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
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Signup'>;

// ─────────────────────────────────────────────────────────────────────────────
// Validation — PRD §3.5.1: min 8 chars, 1 number
// ─────────────────────────────────────────────────────────────────────────────
function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function isValidPassword(v: string): boolean {
  return v.length >= 8 && /\d/.test(v);
}

interface FieldErrors {
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

const NO_ERRORS: FieldErrors = {
  displayName: '',
  email: '',
  password: '',
  confirmPassword: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function SignupScreen({ navigation }: Props): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { signUp, signInWithApple, signInWithGoogle, clearError } = useAuthActions();
  const isLoading = useAuthStore((s) => s.isLoading);
  const storeError = useAuthStore((s) => s.error);

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>(NO_ERRORS);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  function clearStoreErrorOnChange(): void {
    if (storeError) clearError();
  }

  function validate(): boolean {
    const next: FieldErrors = { ...NO_ERRORS };
    let isValid = true;

    if (!displayName.trim()) {
      next.displayName = 'Name is required.';
      isValid = false;
    }
    if (!isValidEmail(email)) {
      next.email = 'Enter a valid email address.';
      isValid = false;
    }
    if (!isValidPassword(password)) {
      next.password = 'Password must be at least 8 characters and contain a number.';
      isValid = false;
    }
    if (password !== confirmPassword) {
      next.confirmPassword = 'Passwords do not match.';
      isValid = false;
    }

    setErrors(next);
    return isValid;
  }

  async function handleSignUp(): Promise<void> {
    if (!validate()) return;
    try {
      await signUp(email.trim(), password, displayName.trim());
    } catch {
      // Error in store — rendered below
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
          {/* Back button */}
          <Pressable
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
          >
            <Text style={styles.backText}>← Back</Text>
          </Pressable>

          <View style={styles.header}>
            <Text style={styles.title}>Create your account</Text>
            <Text style={styles.subtitle}>7-day free Pro trial included</Text>
          </View>

          {storeError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{storeError}</Text>
            </View>
          ) : null}

          <View style={styles.form}>
            {/* Display Name */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={[styles.input, errors.displayName ? styles.inputError : null]}
                value={displayName}
                onChangeText={(v) => { setDisplayName(v); clearStoreErrorOnChange(); }}
                placeholder="Your name"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
                autoComplete="name"
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
                editable={!isLoading}
                accessibilityLabel="Display name"
              />
              {errors.displayName ? (
                <Text style={styles.fieldError}>{errors.displayName}</Text>
              ) : null}
            </View>

            {/* Email */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                ref={emailRef}
                style={[styles.input, errors.email ? styles.inputError : null]}
                value={email}
                onChangeText={(v) => { setEmail(v); clearStoreErrorOnChange(); }}
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
              {errors.email ? (
                <Text style={styles.fieldError}>{errors.email}</Text>
              ) : null}
            </View>

            {/* Password */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  ref={passwordRef}
                  style={[
                    styles.input,
                    styles.passwordInput,
                    errors.password ? styles.inputError : null,
                  ]}
                  value={password}
                  onChangeText={(v) => { setPassword(v); clearStoreErrorOnChange(); }}
                  placeholder="Min 8 chars, 1 number"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!isPasswordVisible}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => confirmRef.current?.focus()}
                  editable={!isLoading}
                  accessibilityLabel="Password"
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
              {errors.password ? (
                <Text style={styles.fieldError}>{errors.password}</Text>
              ) : null}
            </View>

            {/* Confirm Password */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Confirm Password</Text>
              <TextInput
                ref={confirmRef}
                style={[styles.input, errors.confirmPassword ? styles.inputError : null]}
                value={confirmPassword}
                onChangeText={(v) => { setConfirmPassword(v); clearStoreErrorOnChange(); }}
                placeholder="Repeat your password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!isPasswordVisible}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSignUp}
                editable={!isLoading}
                accessibilityLabel="Confirm password"
              />
              {errors.confirmPassword ? (
                <Text style={styles.fieldError}>{errors.confirmPassword}</Text>
              ) : null}
            </View>

            <Pressable
              style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
              onPress={handleSignUp}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel="Create account"
            >
              <Text style={styles.primaryButtonText}>
                {isLoading ? 'Creating account…' : 'Create Account'}
              </Text>
            </Pressable>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

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

            <Pressable
              style={[styles.socialButton, styles.googleButton]}
              onPress={signInWithGoogle}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
            >
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </Pressable>

            {/* ToS — PRD §3.5.1 */}
            <Text style={styles.legal}>
              By creating an account you agree to our{' '}
              <Text style={styles.legalLink}>Terms of Service</Text> and{' '}
              <Text style={styles.legalLink}>Privacy Policy</Text>.
            </Text>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Pressable
              onPress={() => navigation.navigate('Login')}
              accessibilityRole="link"
            >
              <Text style={[styles.footerText, styles.footerLink]}>Sign In</Text>
            </Pressable>
          </View>
        </ScrollView>
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
    scroll: {
      flexGrow: 1,
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
    },
    title: { ...theme.typography.heading1, color: colors.textPrimary },
    subtitle: {
      ...theme.typography.body,
      color: colors.textSecondary,
      marginTop: theme.spacing.xs,
    },
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
    appleButtonText: { ...theme.typography.button, color: '#FFFFFF' },
    googleButton: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    googleButtonText: { ...theme.typography.button, color: colors.textPrimary },
    legal: {
      ...theme.typography.caption,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 18,
    },
    legalLink: { color: colors.accent },
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
