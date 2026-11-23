/**
 * SubscriptionScreen — PRD §3.7.4 / §8.
 *
 * Deep-link target for oshi://settings/subscription (trial-expiry pushes
 * land here). Shows the current plan and routes to the paywall, restore,
 * or the store's own subscription management — RevenueCat owns billing,
 * so cancelling/changing plans happens in the App Store / Play Store.
 */
import React, { useCallback } from 'react';
import {
  Alert,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '../../theme/ThemeContext';
import { useAuthStore } from '../../store/authStore';
import { useSubscriptionStore } from '../../store/subscriptionStore';
import { openPaywall } from '../../services/paywall';
import type { AuthUser } from '../../store/authStore';

const PLAN_COPY: Record<AuthUser['subscriptionStatus'], { name: string; detail: string }> = {
  pro: { name: 'Oshi Pro', detail: 'Unlimited saves and categories, priority AI processing.' },
  trial: { name: 'Pro Trial', detail: 'You have every Pro feature until your 7-day trial ends.' },
  cancelled: {
    name: 'Pro (cancelled)',
    detail: 'Pro stays active until the end of your billing period, then you move to Free.',
  },
  free: { name: 'Free', detail: '20 saves a month and 3 custom categories.' },
};

const MANAGE_SUBSCRIPTION_URL = Platform.select({
  ios: 'https://apps.apple.com/account/subscriptions',
  default: 'https://play.google.com/store/account/subscriptions',
});

export default function SubscriptionScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const { colors, theme } = useTheme();
  const { spacing, borderRadius } = theme;

  const status = useAuthStore((s) => s.user?.subscriptionStatus ?? 'free');
  const restore = useSubscriptionStore((s) => s.restore);
  const isLoading = useSubscriptionStore((s) => s.isLoading);

  const plan = PLAN_COPY[status];
  const canUpgrade = status === 'free' || status === 'cancelled' || status === 'trial';
  const hasStoreSubscription = status === 'pro' || status === 'cancelled';

  const handleRestore = useCallback(async () => {
    const success = await restore();
    Alert.alert(
      success ? 'Restored!' : 'Nothing to restore',
      success ? 'Your Pro subscription has been restored.' : 'No previous purchases were found.',
    );
  }, [restore]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border, paddingHorizontal: spacing.md }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backBtn}
        >
          <Text style={[styles.backText, { color: colors.accent }]}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Subscription</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={{ padding: spacing.md }}>
        <View
          style={[
            styles.planCard,
            { backgroundColor: colors.surface, borderRadius: borderRadius.md, padding: spacing.md },
          ]}
        >
          <Text style={[styles.planLabel, { color: colors.textMuted }]}>Current plan</Text>
          <Text style={[styles.planName, { color: colors.textPrimary }]}>{plan.name}</Text>
          <Text style={[styles.planDetail, { color: colors.textSecondary }]}>{plan.detail}</Text>
        </View>

        {canUpgrade && (
          <TouchableOpacity
            onPress={() => openPaywall('settings')}
            style={[styles.primaryBtn, { backgroundColor: colors.accent, borderRadius: borderRadius.sm }]}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>
              {status === 'trial' ? 'Keep Pro after your trial' : 'Upgrade to Pro'}
            </Text>
          </TouchableOpacity>
        )}

        {hasStoreSubscription && (
          <TouchableOpacity
            onPress={() => void Linking.openURL(MANAGE_SUBSCRIPTION_URL)}
            style={[styles.secondaryBtn, { borderColor: colors.border, borderRadius: borderRadius.sm }]}
            accessibilityRole="button"
          >
            <Text style={[styles.secondaryBtnText, { color: colors.textPrimary }]}>
              Manage subscription
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={() => void handleRestore()}
          disabled={isLoading}
          style={styles.linkBtn}
          accessibilityRole="button"
        >
          <Text style={[styles.linkText, { color: colors.textMuted }]}>
            {isLoading ? 'Restoring…' : 'Restore purchases'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  backText: { fontSize: 17, fontWeight: '500' },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  planCard: { marginBottom: 24, gap: 4 },
  planLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  planName: { fontSize: 24, fontWeight: '800' },
  planDetail: { fontSize: 15, lineHeight: 21 },
  primaryBtn: { height: 52, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  primaryBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  secondaryBtn: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginBottom: 12,
  },
  secondaryBtnText: { fontSize: 16, fontWeight: '600' },
  linkBtn: { alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  linkText: { fontSize: 14 },
});
