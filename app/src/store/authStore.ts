import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { Session, User } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';
import { supabase } from '../services/supabase';
import { apiClient } from '../services/apiClient';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | undefined;
  subscriptionStatus: 'free' | 'trial' | 'pro' | 'cancelled';
  streakCount: number;
  itemsSavedThisMonth: number;
}

interface AuthState {
  user: AuthUser | null;
  session: Session | null;
  isLoading: boolean;
  isInitialised: boolean;
  /** Human-readable error message, cleared on next action */
  error: string | null;
  sessionExpiredMessage: string | null;
}

interface AuthActions {
  /** Called once on app open — PRD §3.5.3 */
  initialise: () => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  /** iOS Apple Sign In via Supabase OAuth — PRD §3.5.1 */
  signInWithApple: () => Promise<void>;
  /** Google Sign In via Supabase OAuth — PRD §3.5.1 */
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Sends reset email via backend POST /auth/reset-password — PRD §3.5.2 */
  sendPasswordReset: (email: string) => Promise<void>;
  /** Updates password using token from deep link — PRD §3.5.2 */
  updatePassword: (token: string, newPassword: string) => Promise<void>;
  clearError: () => void;
  clearSessionExpiredMessage: () => void;
  /** Internal: called by Supabase onAuthStateChange listener */
  _setSession: (session: Session | null) => void;
}

type AuthStore = AuthState & AuthActions;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as Record<string, unknown>).message);
  }
  return 'An unexpected error occurred.';
}

// Map Supabase user + backend profile into our AuthUser shape
function mapUser(supabaseUser: User, profile?: Partial<AuthUser>): AuthUser {
  return {
    id: supabaseUser.id,
    email: supabaseUser.email ?? '',
    displayName:
      profile?.displayName ??
      (supabaseUser.user_metadata?.display_name as string | undefined) ??
      '',
    avatarUrl:
      profile?.avatarUrl ??
      (supabaseUser.user_metadata?.avatar_url as string | undefined),
    subscriptionStatus: profile?.subscriptionStatus ?? 'trial',
    streakCount: profile?.streakCount ?? 0,
    itemsSavedThisMonth: profile?.itemsSavedThisMonth ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────
export const useAuthStore = create<AuthStore>((set, get) => ({
  // ── State ──
  user: null,
  session: null,
  isLoading: false,
  isInitialised: false,
  error: null,
  sessionExpiredMessage: null,

  // ── Actions ──

  /**
   * Restores session from SecureStore on app open.
   * Subscribes to auth state changes for the lifetime of the app.
   * PRD §3.5.3
   */
  async initialise(): Promise<void> {
    set({ isLoading: true });

    try {
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (session) {
        // Fetch full profile from backend
        let profile: Partial<AuthUser> | undefined;
        try {
          const res = await apiClient.get<{
            id: string;
            display_name: string;
            avatar_url?: string;
            subscription_status: AuthUser['subscriptionStatus'];
            streak_count: number;
            items_saved_this_month: number;
          }>('/users/me');
          profile = {
            displayName: res.data.display_name,
            avatarUrl: res.data.avatar_url,
            subscriptionStatus: res.data.subscription_status,
            streakCount: res.data.streak_count,
            itemsSavedThisMonth: res.data.items_saved_this_month,
          };
        } catch {
          // Profile fetch failed — proceed with minimal user data from JWT
        }

        set({ session, user: mapUser(session.user, profile) });
      }
    } catch {
      // Could not restore session — user will see onboarding
    } finally {
      set({ isLoading: false, isInitialised: true });
    }

    // Keep session in sync with Supabase events
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        set({
          user: null,
          session: null,
          // Preserve the expired message so LoginScreen can show it
          sessionExpiredMessage: get().sessionExpiredMessage,
        });
      } else if (session) {
        set({ session, user: mapUser(session.user) });
      }
    });
  },

  /**
   * Email sign up — calls backend POST /auth/signup.
   * Backend creates Supabase user + 11 default categories + sets trial_started_at.
   * API contract: { email, password, display_name } → { user, session }
   */
  async signUp(email, password, displayName): Promise<void> {
    set({ isLoading: true, error: null });

    try {
      const res = await apiClient.post<{
        user: { id: string; email: string; display_name: string };
        session: { access_token: string; refresh_token: string };
      }>('/auth/signup', { email, password, display_name: displayName });

      // Set the session returned from the backend into Supabase so the SDK
      // manages token refresh from this point forward
      await supabase.auth.setSession({
        access_token: res.data.session.access_token,
        refresh_token: res.data.session.refresh_token,
      });

      const { data } = await supabase.auth.getSession();
      if (data.session) {
        set({
          session: data.session,
          user: mapUser(data.session.user, {
            displayName: res.data.user.display_name,
            subscriptionStatus: 'trial',
          }),
        });
      }
    } catch (err) {
      set({ error: extractErrorMessage(err) });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  /**
   * Email sign in — calls Supabase directly.
   * Session is persisted to SecureStore via the adapter in services/supabase.ts.
   */
  async signIn(email, password): Promise<void> {
    set({ isLoading: true, error: null, sessionExpiredMessage: null });

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      if (!data.session) throw new Error('Sign in failed — no session returned.');

      // Fetch full profile
      let profile: Partial<AuthUser> | undefined;
      try {
        const res = await apiClient.get<{
          display_name: string;
          avatar_url?: string;
          subscription_status: AuthUser['subscriptionStatus'];
          streak_count: number;
          items_saved_this_month: number;
        }>('/users/me');
        profile = {
          displayName: res.data.display_name,
          avatarUrl: res.data.avatar_url,
          subscriptionStatus: res.data.subscription_status,
          streakCount: res.data.streak_count,
          itemsSavedThisMonth: res.data.items_saved_this_month,
        };
      } catch {
        // Proceed with JWT data on profile fetch failure
      }

      set({ session: data.session, user: mapUser(data.session.user, profile) });
    } catch (err) {
      set({ error: extractErrorMessage(err) });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  /**
   * Apple Sign In — iOS only.
   * Gets Apple credential → sends idToken to Supabase signInWithIdToken.
   * PRD §3.5.1 — social auth via Supabase OAuth.
   */
  async signInWithApple(): Promise<void> {
    if (Platform.OS !== 'ios') return;

    set({ isLoading: true, error: null });

    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        ],
      });

      if (!credential.identityToken) {
        throw new Error('Apple Sign In did not return an identity token.');
      }

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });

      if (error) throw error;
      if (!data.session) throw new Error('Apple Sign In — no session returned.');

      set({ session: data.session, user: mapUser(data.session.user) });
    } catch (err) {
      // User cancelled Apple Sign In — do not show an error
      const code = (err as Record<string, unknown>).code;
      if (code !== 'ERR_REQUEST_CANCELED') {
        set({ error: extractErrorMessage(err) });
      }
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  /**
   * Google Sign In via Supabase OAuth.
   * Opens the Supabase OAuth URL in a browser; Supabase handles the redirect
   * back to the app via the oshi:// deep link scheme.
   * Full native Google Sign In (with idToken) requires @react-native-google-signin/google-signin
   * and is wired in a future task.
   */
  async signInWithGoogle(): Promise<void> {
    set({ isLoading: true, error: null });

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: 'oshi://auth/callback' },
      });

      if (error) throw error;
      // Session arrives via onAuthStateChange after the OAuth redirect
    } catch (err) {
      set({ error: extractErrorMessage(err) });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  async signOut(): Promise<void> {
    set({ isLoading: true });
    try {
      await supabase.auth.signOut();
    } finally {
      set({ user: null, session: null, isLoading: false, error: null });
    }
  },

  /**
   * Sends password reset email via backend POST /auth/reset-password.
   * API contract: always returns 200 even if email not found (security).
   * PRD §3.5.2
   */
  async sendPasswordReset(email): Promise<void> {
    set({ isLoading: true, error: null });

    try {
      await apiClient.post('/auth/reset-password', { email });
    } catch (err) {
      set({ error: extractErrorMessage(err) });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  /**
   * Updates password using token from oshi://auth/reset?token= deep link.
   * Calls backend POST /auth/update-password.
   * PRD §3.5.2
   */
  async updatePassword(token, newPassword): Promise<void> {
    set({ isLoading: true, error: null });

    try {
      await apiClient.post('/auth/update-password', {
        token,
        new_password: newPassword,
      });
    } catch (err) {
      set({ error: extractErrorMessage(err) });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  clearError(): void {
    set({ error: null });
  },

  clearSessionExpiredMessage(): void {
    set({ sessionExpiredMessage: null });
  },

  _setSession(session): void {
    if (session) {
      set({ session, user: mapUser(session.user) });
    } else {
      // 401 unrecoverable — signal the expired message for LoginScreen
      set({
        user: null,
        session: null,
        sessionExpiredMessage: 'Your session expired — please sign in again.',
      });
    }
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Typed selectors using useShallow to prevent unnecessary re-renders
// PRD cursor rule: always use useShallow for Zustand selectors
// ─────────────────────────────────────────────────────────────────────────────
export function useAuthUser(): AuthUser | null {
  return useAuthStore((s) => s.user);
}

export function useIsAuthenticated(): boolean {
  return useAuthStore((s) => s.session !== null);
}

export function useAuthLoading(): boolean {
  return useAuthStore((s) => s.isLoading);
}

export function useAuthError(): string | null {
  return useAuthStore((s) => s.error);
}

export function useAuthActions() {
  return useAuthStore(
    useShallow((s) => ({
      signIn: s.signIn,
      signUp: s.signUp,
      signOut: s.signOut,
      signInWithApple: s.signInWithApple,
      signInWithGoogle: s.signInWithGoogle,
      sendPasswordReset: s.sendPasswordReset,
      updatePassword: s.updatePassword,
      clearError: s.clearError,
    })),
  );
}
