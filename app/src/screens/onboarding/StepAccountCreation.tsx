import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';

import { useTheme } from '../../theme/ThemeContext';
import { useAuthActions, useAuthStore } from '../../store/authStore';

// ─────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(v: string): string | null {
  if (!v.trim()) return 'Email is required.';
  if (!EMAIL_RE.test(v.trim())) return 'Enter a valid email address.';
  return null;
}

function validatePassword(v: string): string | null {
  if (!v) return 'Password is required.';
  if (v.length < 8) return 'Password must be at least 8 characters.';
  if (!/\d/.test(v)) return 'Password must contain at least one number.';
  return null;
}

function validateConfirm(v: string, password: string): string | null {
  if (!v) return 'Please confirm your password.';
  if (v !== password) return 'Passwords do not match.';
  return null;
}

function validateName(v: string): string | null {
  if (!v.trim()) return 'Display name is required.';
  if (v.trim().length < 2) return 'Name must be at least 2 characters.';
  return null;
}

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────
interface Props {
  /** Called after successful sign-up — continue to step 6 (Reminder) */
  onSignUp: () => void;
  /** Called after successful sign-in — mark onboarding complete + go to Main */
  onSignIn: () => void;
}

export default function StepAccountCreation({ onSignUp, onSignIn }: Props): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { typography, spacing, borderRadius } = theme;
  const { signUp, signIn, signInWithApple, signInWithGoogle } = useAuthActions();
  const isLoading = useAuthStore((s) => s.isLoading);

  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Touched state tracks which fields have been blurred (for inline validation)
  const [touched, setTouched] = useState({
    name: false,
    email: false,
    password: false,
    confirm: false,
  });

  const nameErr = touched.name && mode === 'signup' ? validateName(name) : null;
  const emailErr = touched.email ? validateEmail(email) : null;
  const passErr = touched.password ? validatePassword(password) : null;
  const confirmErr = touched.confirm && mode === 'signup' ? validateConfirm(confirm, password) : null;

  const touch = useCallback((field: keyof typeof touched) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function handleEmailSubmit(): Promise<void> {
    // Touch all fields to reveal errors
    setTouched({ name: true, email: true, password: true, confirm: true });

    if (mode === 'signup') {
      if (validateName(name) || validateEmail(email) || validatePassword(password) || validateConfirm(confirm, password)) {
        return;
      }
      try {
        await signUp(email.trim(), password, name.trim());
        onSignUp();
      } catch (err) {
        Alert.alert('Sign up failed', err instanceof Error ? err.message : 'Please try again.');
      }
    } else {
      if (validateEmail(email) || validatePassword(password)) return;
      try {
        await signIn(email.trim(), password);
        onSignIn();
      } catch (err) {
        Alert.alert('Sign in failed', err instanceof Error ? err.message : 'Check your email and password.');
      }
    }
  }

  async function handleApple(): Promise<void> {
    try {
      await signInWithApple();
      onSignIn();
    } catch {
      // User cancelled or other error — already handled in store
    }
  }

  async function handleGoogle(): Promise<void> {
    try {
      await signInWithGoogle();
      onSignIn();
    } catch {
      // OAuth redirect — session arrives via onAuthStateChange
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const inputBorder = (err: string | null, touched_: boolean) => ({
    borderColor: err ? colors.error : touched_ ? colors.accent : colors.border,
  });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.kav}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
        >
          <ScrollView
            contentContainerStyle={[styles.scrollContent, { paddingHorizontal: spacing.xl }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Headline */}
            <Text
              style={[
                styles.headline,
                {
                  color: colors.textPrimary,
                  fontFamily: typography.display.fontFamily,
                  fontSize: 28,
                  lineHeight: 36,
                  marginBottom: spacing.xs,
                },
              ]}
            >
              {mode === 'signup' ? 'Create your account' : 'Welcome back'}
            </Text>
            <Text style={[{ color: colors.textSecondary, ...typography.body, marginBottom: spacing.lg }]}>
              {mode === 'signup'
                ? 'Start saving content in seconds.'
                : 'Sign in to continue to your library.'}
            </Text>

            {/* Apple Sign In — iOS only */}
            {Platform.OS === 'ios' && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={
                  mode === 'signup'
                    ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
                    : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
                }
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={borderRadius.pill}
                style={[styles.appleBtn]}
                onPress={handleApple}
              />
            )}

            {/* Google Sign In */}
            <TouchableOpacity
              onPress={handleGoogle}
              activeOpacity={0.85}
              style={[
                styles.socialBtn,
                {
                  borderColor: colors.border,
                  borderRadius: borderRadius.pill,
                  marginTop: Platform.OS === 'ios' ? spacing.sm : 0,
                  backgroundColor: colors.surface,
                },
              ]}
              accessibilityLabel={mode === 'signup' ? 'Sign up with Google' : 'Sign in with Google'}
              accessibilityRole="button"
            >
              <Text style={styles.googleIcon}>G</Text>
              <Text style={[{ color: colors.textPrimary, ...typography.button }]}>
                {mode === 'signup' ? 'Continue with Google' : 'Sign in with Google'}
              </Text>
            </TouchableOpacity>

            {/* Divider */}
            <View style={[styles.dividerRow, { marginVertical: spacing.lg }]}>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              <Text style={[styles.dividerText, { color: colors.textMuted, ...typography.bodySmall }]}>
                or continue with email
              </Text>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            </View>

            {/* Display Name (signup only) */}
            {mode === 'signup' && (
              <View style={[styles.fieldGroup, { marginBottom: spacing.md }]}>
                <Text style={[styles.label, { color: colors.textSecondary, ...typography.bodySmall }]}>
                  Display name
                </Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  onBlur={() => touch('name')}
                  placeholder="Your name"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="next"
                  style={[
                    styles.input,
                    {
                      color: colors.textPrimary,
                      backgroundColor: colors.surface,
                      borderColor: nameErr ? colors.error : touched.name ? colors.accent : colors.border,
                      borderRadius: borderRadius.md,
                      ...typography.body,
                    },
                  ]}
                />
                {nameErr && (
                  <Text style={[styles.errorText, { color: colors.error, ...typography.caption }]}>
                    {nameErr}
                  </Text>
                )}
              </View>
            )}

            {/* Email */}
            <View style={[styles.fieldGroup, { marginBottom: spacing.md }]}>
              <Text style={[styles.label, { color: colors.textSecondary, ...typography.bodySmall }]}>
                Email
              </Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                onBlur={() => touch('email')}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
                textContentType="emailAddress"
                style={[
                  styles.input,
                  {
                    color: colors.textPrimary,
                    backgroundColor: colors.surface,
                    ...inputBorder(emailErr, touched.email),
                    borderRadius: borderRadius.md,
                    ...typography.body,
                  },
                ]}
              />
              {emailErr && (
                <Text style={[styles.errorText, { color: colors.error, ...typography.caption }]}>
                  {emailErr}
                </Text>
              )}
            </View>

            {/* Password */}
            <View style={[styles.fieldGroup, { marginBottom: spacing.md }]}>
              <Text style={[styles.label, { color: colors.textSecondary, ...typography.bodySmall }]}>
                Password
              </Text>
              <View style={styles.passwordRow}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  onBlur={() => touch('password')}
                  placeholder={mode === 'signup' ? 'Min 8 chars, 1 number' : 'Your password'}
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType={mode === 'signup' ? 'next' : 'done'}
                  textContentType={mode === 'signup' ? 'newPassword' : 'password'}
                  style={[
                    styles.input,
                    styles.passwordInput,
                    {
                      color: colors.textPrimary,
                      backgroundColor: colors.surface,
                      ...inputBorder(passErr, touched.password),
                      borderRadius: borderRadius.md,
                      ...typography.body,
                      flex: 1,
                    },
                  ]}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((v) => !v)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.eyeBtn}
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Text style={{ color: colors.textMuted, fontSize: 18 }}>
                    {showPassword ? '🙈' : '👁'}
                  </Text>
                </TouchableOpacity>
              </View>
              {passErr && (
                <Text style={[styles.errorText, { color: colors.error, ...typography.caption }]}>
                  {passErr}
                </Text>
              )}
            </View>

            {/* Confirm password — signup only */}
            {mode === 'signup' && (
              <View style={[styles.fieldGroup, { marginBottom: spacing.lg }]}>
                <Text style={[styles.label, { color: colors.textSecondary, ...typography.bodySmall }]}>
                  Confirm password
                </Text>
                <TextInput
                  value={confirm}
                  onChangeText={setConfirm}
                  onBlur={() => touch('confirm')}
                  placeholder="Repeat your password"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  textContentType="newPassword"
                  style={[
                    styles.input,
                    {
                      color: colors.textPrimary,
                      backgroundColor: colors.surface,
                      ...inputBorder(confirmErr, touched.confirm),
                      borderRadius: borderRadius.md,
                      ...typography.body,
                    },
                  ]}
                />
                {confirmErr && (
                  <Text style={[styles.errorText, { color: colors.error, ...typography.caption }]}>
                    {confirmErr}
                  </Text>
                )}
              </View>
            )}

            {/* Submit */}
            <TouchableOpacity
              onPress={() => void handleEmailSubmit()}
              activeOpacity={0.85}
              disabled={isLoading}
              style={[
                styles.submitBtn,
                { backgroundColor: colors.accent, borderRadius: borderRadius.pill, marginBottom: spacing.md },
              ]}
              accessibilityLabel={mode === 'signup' ? 'Create Account' : 'Sign In'}
              accessibilityRole="button"
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={[{ color: '#FFFFFF', ...typography.button }]}>
                  {mode === 'signup' ? 'Create Account' : 'Sign In'}
                </Text>
              )}
            </TouchableOpacity>

            {/* Mode toggle */}
            <TouchableOpacity
              onPress={() => {
                setMode((m) => (m === 'signup' ? 'signin' : 'signup'));
                setTouched({ name: false, email: false, password: false, confirm: false });
              }}
              hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
              style={styles.toggleBtn}
              accessibilityRole="button"
            >
              <Text style={[{ color: colors.textSecondary, ...typography.bodySmall }]}>
                {mode === 'signup' ? 'Already have an account? ' : "Don't have an account? "}
                <Text style={{ color: colors.accent, fontWeight: '600' }}>
                  {mode === 'signup' ? 'Sign In' : 'Sign Up'}
                </Text>
              </Text>
            </TouchableOpacity>

            {/* Terms — signup only */}
            {mode === 'signup' && (
              <Text
                style={[
                  styles.termsText,
                  { color: colors.textMuted, ...typography.caption, marginTop: spacing.md, textAlign: 'center' },
                ]}
              >
                By creating an account you agree to our{' '}
                <Text style={{ color: colors.accent }}>Terms of Service</Text>
                {' '}and{' '}
                <Text style={{ color: colors.accent }}>Privacy Policy</Text>.
              </Text>
            )}

            <View style={{ height: spacing.xl }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  kav: { flex: 1 },
  scrollContent: { paddingTop: 32 },
  headline: { fontWeight: '700' },
  appleBtn: { width: '100%', height: 54 },
  socialBtn: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    gap: 10,
  },
  googleIcon: {
    fontSize: 20,
    fontWeight: '700',
    color: '#4285F4',
  },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: {},
  fieldGroup: {},
  label: { marginBottom: 6 },
  input: {
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    minHeight: 50,
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  passwordInput: {},
  eyeBtn: { paddingHorizontal: 4, minHeight: 44, justifyContent: 'center' },
  errorText: { marginTop: 4 },
  submitBtn: {
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBtn: { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
  termsText: { lineHeight: 20 },
});
