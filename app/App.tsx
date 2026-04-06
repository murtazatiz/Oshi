import 'react-native-gesture-handler'; // Must be the very first import — required by RNGH

// Sentry must be initialised before anything else can throw (PRD §5.8)
import { initSentry, setSentryUser, clearSentryUser, wrapWithSentry } from './src/services/errorMonitoring';
initSentry();

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ShareIntentProvider } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';

import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import AppNavigator from './src/navigation/AppNavigator';
import { useAuthStore } from './src/store/authStore';
import { useSubscriptionStore } from './src/store/subscriptionStore';
import { initialisePurchases } from './src/services/purchases';
import {
  initAnalytics,
  setSuperProperties,
  resetAnalyticsUser,
} from './src/services/analytics';
import MilestoneCelebration from './src/components/MilestoneCelebration';
import ShareExtensionHandler from './share-extension/ShareExtension';
import { syncSessionToAppGroup } from './src/services/shareExtension';
import ShareHandlerScreen from './src/screens/ShareHandlerScreen';
import {
  startOfflineQueueProcessor,
  stopOfflineQueueProcessor,
  setStatusListener,
  type SyncStatus,
} from './src/services/offlineQueue';

// Initialise PostHog analytics (PRD §5.9) — async, non-blocking
void initAnalytics();

// ─────────────────────────────────────────────────────────────────────────────
// AuthInitialiser — restores session on mount, syncs JWT to App Group
// ─────────────────────────────────────────────────────────────────────────────

function AuthInitialiser(): null {
  const initialise = useAuthStore((s) => s.initialise);
  const session = useAuthStore((s) => s.session);
  const user = useAuthStore((s) => s.user);
  const refreshSubs = useSubscriptionStore((s) => s.refresh);
  const setServerFlags = useSubscriptionStore((s) => s.setServerFlags);
  const setStreak = useSubscriptionStore((s) => s.setStreak);
  const checkMilestone = useSubscriptionStore((s) => s.checkMilestone);

  useEffect(() => {
    void initialise();
  }, [initialise]);

  // Sync JWT to App Group whenever the session changes so the iOS Share
  // Extension always has a valid token (PRD §3.1.3)
  useEffect(() => {
    void syncSessionToAppGroup();
  }, [session]);

  // Initialise RevenueCat + sync subscription state + Sentry/PostHog user context
  useEffect(() => {
    if (!user) {
      // User signed out — clear monitoring context
      clearSentryUser();
      resetAnalyticsUser();
      return;
    }

    // PRD §5.8: Sentry.setUser({ id: user.id }) — no PII
    setSentryUser(user.id);

    // PRD §5.9: PostHog super properties
    setSuperProperties({
      userId: user.id,
      subscriptionStatus: user.subscriptionStatus,
      createdAt: new Date().toISOString(), // best-effort; authStore doesn't expose createdAt
    });

    void (async () => {
      try {
        await initialisePurchases(user.id);
        await refreshSubs();
      } catch {
        // RevenueCat may not be available in Expo Go — non-fatal
      }
      setServerFlags({ subscriptionStatus: user.subscriptionStatus });
      setStreak(user.streakCount);
      checkMilestone(user.streakCount);
    })();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// OfflineQueueBanner — shows sync status from offlineQueue.ts
// ─────────────────────────────────────────────────────────────────────────────

function OfflineQueueBanner(): React.JSX.Element | null {
  const { colors, theme } = useTheme();
  const [status, setStatus] = useState<SyncStatus>({ type: 'idle' });

  useEffect(() => {
    setStatusListener(setStatus);
    startOfflineQueueProcessor();
    return () => {
      stopOfflineQueueProcessor();
    };
  }, []);

  if (status.type === 'idle') return null;

  let message: string;
  let bg: string;
  if (status.type === 'syncing') {
    message = `${status.count} save${status.count === 1 ? '' : 's'} syncing…`;
    bg = colors.primary;
  } else if (status.type === 'done') {
    const { result } = status;
    message =
      result.failed === 0
        ? `${result.processed} save${result.processed === 1 ? '' : 's'} synced ✓`
        : `${result.processed} synced, ${result.remaining} still queued`;
    bg = result.failed === 0 ? colors.success : colors.warning;
  } else {
    message = status.message;
    bg = colors.error;
  }

  return (
    <View style={[rootStyles.syncBanner, { backgroundColor: bg, borderRadius: theme.borderRadius.sm }]}>
      <Text style={rootStyles.syncBannerText}>{message}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App root
// ─────────────────────────────────────────────────────────────────────────────

function AppRoot(): React.JSX.Element {
  return (
    <ShareIntentProvider>
      <ThemeProvider>
        <StatusBar style="auto" />
        <AuthInitialiser />
        <AppNavigator />
        {/* iOS: processes pending shares from App Group on foreground (PRD §3.1.3) */}
        <ShareExtensionHandler />
        {/* Cross-platform share intent handler — expo-share-intent (PRD §3.1.4) */}
        <ShareHandlerScreen />
        {/* Offline queue sync banner (PRD §3.1.5) */}
        <OfflineQueueBanner />
        {/* PRD §3.4.4 — streak milestone celebration overlay */}
        <MilestoneCelebration />
      </ThemeProvider>
    </ShareIntentProvider>
  );
}

// Wrap with Sentry error boundary (PRD §5.8)
export default wrapWithSentry(AppRoot);

// ─────────────────────────────────────────────────────────────────────────────
// Root-level styles
// ─────────────────────────────────────────────────────────────────────────────

const rootStyles = StyleSheet.create({
  syncBanner: {
    position: 'absolute',
    top: 54,
    left: 16,
    right: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    zIndex: 998,
    elevation: 8,
  },
  syncBannerText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
