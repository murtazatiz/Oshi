import type { NavigatorScreenParams } from '@react-navigation/native';

// ─────────────────────────────────────────────────────────────────────────────
// Auth Stack
// Screens shown when no Supabase session exists.
// PRD §3.5.1 — onboarding flow order: Onboarding → account creation → etc.
// ─────────────────────────────────────────────────────────────────────────────
export interface AuthStackParamList {
  Onboarding: undefined;
  Login: undefined;
  Signup: undefined;
  ForgotPassword: undefined;
  /** token comes from oshi://auth/reset?token=[token] deep link (PRD §4) */
  ResetPassword: { token: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// Library nested stack
// Allows deep-linking to a specific category tab via oshi://library/:categorySlug
// ─────────────────────────────────────────────────────────────────────────────
export interface LibraryStackParamList {
  /**
   * categorySlug matches the slug format from PRD §4:
   * lowercase, hyphenated — e.g. 'business', 'travel', 'learning'
   */
  LibraryHome: { categorySlug?: string } | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings nested stack
// Allows deep-linking directly to sub-screens via oshi://settings/reminders
// and oshi://settings/subscription (PRD §4)
// ─────────────────────────────────────────────────────────────────────────────
export interface SettingsStackParamList {
  SettingsHome: undefined;
  Profile: undefined;
  /** Deep link: oshi://settings/reminders */
  Reminders: undefined;
  /** Deep link: oshi://settings/subscription */
  Subscription: undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Bottom Tab Navigator
// Three tabs: Library, Search, Settings (PRD §5.1 navigation)
// ─────────────────────────────────────────────────────────────────────────────
export interface MainTabParamList {
  LibraryTab: NavigatorScreenParams<LibraryStackParamList>;
  SearchTab: undefined;
  SettingsTab: NavigatorScreenParams<SettingsStackParamList>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Stack (tabs + modal screens)
// ContentDetail slides up as a modal sheet over the tab bar (PRD §3.6)
// ─────────────────────────────────────────────────────────────────────────────
export interface MainStackParamList {
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  /** Deep link: oshi://save/:saveId (PRD §4) */
  ContentDetail: { saveId: string };
  /** PRD §8.3 — paywall shown on limit triggers */
  Paywall: undefined;
  /** Manual URL save modal — reliable fallback for sharing URLs */
  SaveUrl: { prefillUrl?: string } | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Root Stack
// Top-level navigator — conditionally renders Auth or Main based on session.
// ─────────────────────────────────────────────────────────────────────────────
export interface RootStackParamList {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<MainStackParamList>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Global React Navigation type augmentation
// Gives useNavigation() the correct type without explicit generics at every call.
// ─────────────────────────────────────────────────────────────────────────────
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
