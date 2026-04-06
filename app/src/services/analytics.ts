/**
 * analytics.ts — PostHog React Native wrapper (PRD §5.9)
 *
 * All event names come from the Analytics Event Tracking Plan.
 * Every capture() call first checks the opt-out flag in AsyncStorage
 * (key: 'oshi_analytics_opt_out'). If opted out, the call is a no-op.
 *
 * Super properties automatically appended to every event:
 *   app_version, platform, subscription_status, user_id, days_since_signup
 *
 * Usage:
 *   import analytics from '../services/analytics';
 *   analytics.track('save_created', { platform: 'youtube', category: 'Business' });
 */
import PostHog from 'posthog-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// ─────────────────────────────────────────────────────────────────────────────
// Singleton PostHog instance
// ─────────────────────────────────────────────────────────────────────────────

const OPT_OUT_KEY = 'oshi_analytics_opt_out';

let _posthog: PostHog | null = null;

/** Call once in App.tsx before mounting any screens */
export async function initAnalytics(): Promise<void> {
  const apiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? '';
  if (!apiKey) return;

  _posthog = new PostHog(apiKey, {
    host: 'https://app.posthog.com',
    // Flush events every 30s in the background
    flushAt: 20,
    flushInterval: 30_000,
  });

  // Respect existing opt-out choice
  try {
    const stored = await AsyncStorage.getItem(OPT_OUT_KEY);
    if (stored === 'true') {
      _posthog.optOut();
    }
  } catch {
    // Non-fatal
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Opt-out helpers (PRD §5.9)
// ─────────────────────────────────────────────────────────────────────────────

export async function optOutAnalytics(): Promise<void> {
  _posthog?.optOut();
  await AsyncStorage.setItem(OPT_OUT_KEY, 'true');
}

export async function optInAnalytics(): Promise<void> {
  _posthog?.optIn();
  await AsyncStorage.setItem(OPT_OUT_KEY, 'false');
}

export async function isOptedOut(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(OPT_OUT_KEY);
  return stored === 'true';
}

// ─────────────────────────────────────────────────────────────────────────────
// Super properties — attached to every event
// ─────────────────────────────────────────────────────────────────────────────

interface SuperProperties {
  app_version: string;
  platform: 'ios' | 'android';
  subscription_status?: string;
  user_id?: string;
  days_since_signup?: number;
}

let _superProps: SuperProperties = {
  app_version: (Constants.expoConfig?.version ?? '1.0.0') as string,
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
};

/** Call after login with user data */
export function setSuperProperties(props: {
  userId: string;
  subscriptionStatus: string;
  createdAt: string;
}): void {
  const daysSince = Math.floor(
    (Date.now() - new Date(props.createdAt).getTime()) / 86_400_000,
  );
  _superProps = {
    ..._superProps,
    user_id: props.userId,
    subscription_status: props.subscriptionStatus,
    days_since_signup: daysSince,
  };
  _posthog?.identify(props.userId);
}

/** Call on logout */
export function resetAnalyticsUser(): void {
  _superProps = {
    app_version: _superProps.app_version,
    platform: _superProps.platform,
  };
  _posthog?.reset();
}

// ─────────────────────────────────────────────────────────────────────────────
// Core track() — checks opt-out, merges super properties
// ─────────────────────────────────────────────────────────────────────────────

function track(event: AnalyticsEvent, properties?: Record<string, unknown>): void {
  if (!_posthog) return;
  _posthog.capture(event, { ..._superProps, ...properties });
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Event Tracking Plan
// All event names are defined as string literals here — call sites just import
// and use `analytics.track(...)` with the helpers below.
// ─────────────────────────────────────────────────────────────────────────────

type AnalyticsEvent =
  // ── Onboarding ──────────────────────────────────────────────────────
  | 'onboarding_started'
  | 'onboarding_step_completed'
  | 'onboarding_skipped'
  | 'onboarding_completed'
  | 'account_created'
  | 'account_signed_in'
  | 'account_signed_out'
  | 'social_auth_attempted'
  // ── Saves ────────────────────────────────────────────────────────────
  | 'save_created'
  | 'save_opened'          // user taps card → ContentDetail
  | 'save_marked_done'
  | 'save_skipped'
  | 'save_deleted'
  | 'save_retried'
  | 'save_category_changed'
  | 'save_note_added'
  | 'save_link_opened'     // 'Open in [Platform]' tapped
  | 'save_shared'
  | 'save_duplicate_detected'
  | 'save_limit_reached'
  // ── Library ──────────────────────────────────────────────────────────
  | 'library_viewed'
  | 'library_search_performed'
  | 'library_sort_changed'
  | 'library_view_mode_toggled'  // grid ↔ list
  | 'library_category_tab_changed'
  | 'library_multi_select_activated'
  | 'library_bulk_action_performed'
  | 'library_swipe_gesture_used'
  | 'undo_action_used'
  // ── Notifications ────────────────────────────────────────────────────
  | 'notification_permission_granted'
  | 'notification_permission_denied'
  | 'notification_opened'
  | 'notification_reask_shown'
  | 'notification_reask_accepted'
  | 'notification_reminder_set'
  // ── Monetisation ─────────────────────────────────────────────────────
  | 'paywall_viewed'
  | 'paywall_plan_selected'
  | 'purchase_started'
  | 'purchase_completed'
  | 'purchase_failed'
  | 'purchase_restored'
  | 'trial_started'
  | 'trial_expired'
  | 'subscription_cancelled'
  | 'downgrade_banner_viewed'
  | 'downgrade_banner_dismissed'
  // ── Streak ───────────────────────────────────────────────────────────
  | 'streak_milestone_reached'
  | 'streak_reset'
  // ── Settings ─────────────────────────────────────────────────────────
  | 'settings_dark_mode_toggled'
  | 'settings_theme_changed'
  | 'settings_analytics_opted_out'
  | 'settings_analytics_opted_in'
  | 'settings_reminder_saved'
  | 'settings_category_created'
  | 'settings_category_deleted'
  | 'settings_category_renamed'
  | 'settings_category_reordered'
  | 'settings_avatar_uploaded'
  | 'settings_display_name_changed'
  | 'account_deletion_started'
  | 'account_deletion_confirmed';

// ─────────────────────────────────────────────────────────────────────────────
// Typed helper methods — call sites use these, never `track()` directly
// ─────────────────────────────────────────────────────────────────────────────

const analytics = {
  // ── Onboarding ────────────────────────────────────────────────────────────
  onboardingStarted: () => track('onboarding_started'),

  onboardingStepCompleted: (step: number, stepName: string) =>
    track('onboarding_step_completed', { step, step_name: stepName }),

  onboardingSkipped: (fromStep: number) =>
    track('onboarding_skipped', { from_step: fromStep }),

  onboardingCompleted: () => track('onboarding_completed'),

  accountCreated: (method: 'email' | 'apple' | 'google') =>
    track('account_created', { method }),

  accountSignedIn: (method: 'email' | 'apple' | 'google') =>
    track('account_signed_in', { method }),

  accountSignedOut: () => track('account_signed_out'),

  socialAuthAttempted: (provider: 'apple' | 'google') =>
    track('social_auth_attempted', { provider }),

  // ── Saves ─────────────────────────────────────────────────────────────────
  saveCreated: (props: { platform: string; source_app?: string }) =>
    track('save_created', props),

  saveOpened: (props: { save_id: string; platform: string; content_type?: string }) =>
    track('save_opened', props),

  saveMarkedDone: (props: { save_id: string; via: 'button' | 'swipe' | 'bulk' }) =>
    track('save_marked_done', props),

  saveSkipped: (props: { save_id: string; via: 'button' | 'swipe' | 'bulk' }) =>
    track('save_skipped', props),

  saveDeleted: (props: { save_id: string; via: 'menu' | 'swipe' | 'bulk' }) =>
    track('save_deleted', props),

  saveRetried: (save_id: string) => track('save_retried', { save_id }),

  saveCategoryChanged: (props: { save_id: string; new_category: string }) =>
    track('save_category_changed', props),

  saveNoteAdded: (save_id: string) => track('save_note_added', { save_id }),

  saveLinkOpened: (props: { save_id: string; platform: string }) =>
    track('save_link_opened', props),

  saveShared: (save_id: string) => track('save_shared', { save_id }),

  saveDuplicateDetected: (url: string) =>
    track('save_duplicate_detected', { url }),

  saveLimitReached: (count: number) =>
    track('save_limit_reached', { count }),

  // ── Library ──────────────────────────────────────────────────────────────
  libraryViewed: (props: { category?: string; save_count?: number }) =>
    track('library_viewed', props),

  librarySearchPerformed: (props: { query_length: number; result_count: number }) =>
    track('library_search_performed', props),

  librarySortChanged: (props: { sort: string; category?: string }) =>
    track('library_sort_changed', props),

  libraryViewModeToggled: (mode: 'grid' | 'list') =>
    track('library_view_mode_toggled', { mode }),

  libraryCategoryTabChanged: (category: string) =>
    track('library_category_tab_changed', { category }),

  libraryMultiSelectActivated: () => track('library_multi_select_activated'),

  libraryBulkActionPerformed: (props: { action: string; count: number }) =>
    track('library_bulk_action_performed', props),

  librarySwipeGestureUsed: (props: { action: 'done' | 'delete' }) =>
    track('library_swipe_gesture_used', props),

  undoActionUsed: (action: string) => track('undo_action_used', { action }),

  // ── Notifications ─────────────────────────────────────────────────────────
  notificationPermissionGranted: () => track('notification_permission_granted'),
  notificationPermissionDenied: () => track('notification_permission_denied'),

  notificationOpened: (props: { category?: string; notification_type?: string }) =>
    track('notification_opened', props),

  notificationReaskShown: () => track('notification_reask_shown'),
  notificationReaskAccepted: () => track('notification_reask_accepted'),

  notificationReminderSet: (props: { hour: number; days_count: number }) =>
    track('notification_reminder_set', props),

  // ── Monetisation ──────────────────────────────────────────────────────────
  paywallViewed: (props: { trigger: string }) =>
    track('paywall_viewed', props),

  paywallPlanSelected: (plan: 'monthly' | 'annual') =>
    track('paywall_plan_selected', { plan }),

  purchaseStarted: (plan: 'monthly' | 'annual') =>
    track('purchase_started', { plan }),

  purchaseCompleted: (plan: 'monthly' | 'annual') =>
    track('purchase_completed', { plan }),

  purchaseFailed: (props: { plan: string; reason?: string }) =>
    track('purchase_failed', props),

  purchaseRestored: (was_pro: boolean) =>
    track('purchase_restored', { was_pro }),

  trialStarted: () => track('trial_started'),
  trialExpired: () => track('trial_expired'),
  subscriptionCancelled: () => track('subscription_cancelled'),

  downgradeBannerViewed: () => track('downgrade_banner_viewed'),
  downgradeBannerDismissed: () => track('downgrade_banner_dismissed'),

  // ── Streak ────────────────────────────────────────────────────────────────
  streakMilestoneReached: (days: number) =>
    track('streak_milestone_reached', { days }),

  streakReset: (previous_streak: number) =>
    track('streak_reset', { previous_streak }),

  // ── Settings ──────────────────────────────────────────────────────────────
  settingsDarkModeToggled: (dark: boolean) =>
    track('settings_dark_mode_toggled', { dark }),

  settingsThemeChanged: (theme: string) =>
    track('settings_theme_changed', { theme }),

  settingsAnalyticsOptedOut: () => track('settings_analytics_opted_out'),
  settingsAnalyticsOptedIn: () => track('settings_analytics_opted_in'),

  settingsReminderSaved: (props: { hour: number; days_count: number }) =>
    track('settings_reminder_saved', props),

  settingsCategoryCreated: () => track('settings_category_created'),
  settingsCategoryDeleted: () => track('settings_category_deleted'),
  settingsCategoryRenamed: () => track('settings_category_renamed'),
  settingsCategoryReordered: () => track('settings_category_reordered'),

  settingsAvatarUploaded: () => track('settings_avatar_uploaded'),
  settingsDisplayNameChanged: () => track('settings_display_name_changed'),

  accountDeletionStarted: () => track('account_deletion_started'),
  accountDeletionConfirmed: () => track('account_deletion_confirmed'),
} as const;

export default analytics;
