/**
 * PaywallScreen — PRD §8.2 / §8.3
 *
 * Shows monthly ($4.99) and annual ($39.99) plans with a 7-day free trial
 * callout, a feature comparison list, and a restore-purchases option.
 *
 * Trigger points (PRD §8.3):
 *   1. 21st save attempt in a month   → SAVE_LIMIT_REACHED
 *   2. 4th category creation attempt   → CATEGORY_LIMIT_REACHED
 *   3. Tapping a Pro-only feature in Settings
 *   4. Day 5 soft upsell banner on Library
 *   5. Trial expiry banner CTA
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import type { PurchasesPackage } from 'react-native-purchases';

import { useTheme } from '../theme/ThemeContext';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { PRODUCT_IDS } from '../services/purchases';
import analytics from '../services/analytics';

// ─────────────────────────────────────────────────────────────────────────────
// Feature comparison rows
// ─────────────────────────────────────────────────────────────────────────────

const FEATURES: { label: string; free: string; pro: string }[] = [
  { label: 'Monthly saves',         free: '20',        pro: 'Unlimited' },
  { label: 'Categories',            free: '3',         pro: 'Unlimited' },
  { label: 'AI summary',            free: '✓',         pro: '✓' },
  { label: 'AI tags',               free: '—',         pro: '✓' },
  { label: 'Per-category reminders', free: '—',        pro: '✓' },
  { label: 'Morning digest',        free: '—',         pro: '✓' },
  { label: 'Priority AI processing', free: '~30s',     pro: '~5s' },
  { label: 'Export library',         free: '—',        pro: 'CSV / JSON' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function PaywallScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const { colors, theme } = useTheme();
  const { spacing, borderRadius } = theme;

  const packages = useSubscriptionStore((s) => s.packages);
  const isLoading = useSubscriptionStore((s) => s.isLoading);
  const isPro = useSubscriptionStore((s) => s.isPro);
  const refresh = useSubscriptionStore((s) => s.refresh);
  const purchase = useSubscriptionStore((s) => s.purchase);
  const restore = useSubscriptionStore((s) => s.restore);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    analytics.paywallViewed({ trigger: 'direct' });
    void refresh();
  }, [refresh]);

  // Auto-select annual by default
  useEffect(() => {
    if (packages.length > 0 && !selectedId) {
      const annual = packages.find((p) => p.product.identifier === PRODUCT_IDS.annual);
      setSelectedId(annual?.identifier ?? packages[0]?.identifier ?? null);
    }
  }, [packages, selectedId]);

  // If the user is already Pro (e.g. just purchased), go back
  useEffect(() => {
    if (isPro) {
      const timer = setTimeout(() => navigation.goBack(), 400);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isPro, navigation]);

  const handlePurchase = useCallback(async () => {
    const pkg = packages.find((p) => p.identifier === selectedId);
    if (!pkg) return;
    const isAnnual = pkg.product.identifier === PRODUCT_IDS.annual;
    const plan = isAnnual ? 'annual' : 'monthly';
    analytics.purchaseStarted(plan);
    const success = await purchase(pkg);
    if (success) {
      analytics.purchaseCompleted(plan);
      Alert.alert('Welcome to Oshi Pro!', 'You now have unlimited access.');
    } else {
      analytics.purchaseFailed({ plan });
    }
  }, [packages, selectedId, purchase]);

  const handleRestore = useCallback(async () => {
    const success = await restore();
    analytics.purchaseRestored(success);
    if (success) {
      Alert.alert('Restored!', 'Your Pro subscription has been restored.');
    } else {
      Alert.alert('Nothing to restore', 'No previous purchases were found.');
    }
  }, [restore]);

  function formatPrice(pkg: PurchasesPackage): string {
    return pkg.product.priceString;
  }

  function getPeriodLabel(pkg: PurchasesPackage): string {
    if (pkg.product.identifier === PRODUCT_IDS.annual) return '/ year';
    return '/ month';
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Text style={[styles.closeIcon, { color: colors.textMuted }]}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: spacing.md }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <Text style={[styles.heroEmoji]}>✦</Text>
        <Text style={[styles.heroTitle, { color: colors.textPrimary }]}>Upgrade to Oshi Pro</Text>
        <Text style={[styles.heroSub, { color: colors.textSecondary }]}>
          Unlimited saves, smart reminders, and priority AI processing.
        </Text>

        {/* Trial callout */}
        <View style={[styles.trialBanner, { backgroundColor: colors.accent + '14', borderColor: colors.accent, borderRadius: borderRadius.sm }]}>
          <Text style={[styles.trialText, { color: colors.accent }]}>
            Start with a 7-day free trial — cancel anytime
          </Text>
        </View>

        {/* Plan options */}
        {isLoading && packages.length === 0 ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: 32 }} />
        ) : (
          <View style={styles.planRow}>
            {packages.map((pkg) => {
              const isSelected = pkg.identifier === selectedId;
              const isAnnual = pkg.product.identifier === PRODUCT_IDS.annual;
              return (
                <TouchableOpacity
                  key={pkg.identifier}
                  style={[
                    styles.planCard,
                    {
                      borderColor: isSelected ? colors.accent : colors.border,
                      borderWidth: isSelected ? 2 : 1,
                      backgroundColor: colors.surface,
                      borderRadius: borderRadius.md,
                    },
                  ]}
                  onPress={() => {
                    setSelectedId(pkg.identifier);
                    analytics.paywallPlanSelected(isAnnual ? 'annual' : 'monthly');
                  }}
                  activeOpacity={0.8}
                >
                  {isAnnual && (
                    <View style={[styles.saveBadge, { backgroundColor: colors.success, borderRadius: borderRadius.pill }]}>
                      <Text style={styles.saveBadgeText}>Save 33%</Text>
                    </View>
                  )}
                  <Text style={[styles.planLabel, { color: colors.textPrimary }]}>
                    {isAnnual ? 'Annual' : 'Monthly'}
                  </Text>
                  <Text style={[styles.planPrice, { color: colors.textPrimary }]}>
                    {formatPrice(pkg)}
                  </Text>
                  <Text style={[styles.planPeriod, { color: colors.textMuted }]}>
                    {getPeriodLabel(pkg)}
                  </Text>
                  {isAnnual && (
                    <Text style={[styles.planPerMonth, { color: colors.textSecondary }]}>
                      ~$3.33/mo
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* CTA */}
        <TouchableOpacity
          onPress={() => void handlePurchase()}
          disabled={isLoading || !selectedId}
          style={[
            styles.ctaBtn,
            {
              backgroundColor: isLoading ? colors.border : colors.accent,
              borderRadius: borderRadius.sm,
            },
          ]}
          activeOpacity={0.8}
        >
          <Text style={styles.ctaBtnText}>
            {isLoading ? 'Processing…' : 'Start Free Trial'}
          </Text>
        </TouchableOpacity>

        {/* Restore */}
        <TouchableOpacity onPress={() => void handleRestore()} style={styles.restoreBtn}>
          <Text style={[styles.restoreText, { color: colors.textMuted }]}>
            Restore Purchases
          </Text>
        </TouchableOpacity>

        {/* Feature comparison */}
        <Text style={[styles.compTitle, { color: colors.textPrimary }]}>What you get</Text>
        <View style={[styles.compTable, { backgroundColor: colors.surface, borderRadius: borderRadius.md }]}>
          {/* Table header */}
          <View style={[styles.compRow, styles.compHeaderRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.compCell, styles.compFeatureCell, { color: colors.textMuted }]}>Feature</Text>
            <Text style={[styles.compCell, styles.compPlanCell, { color: colors.textMuted }]}>Free</Text>
            <Text style={[styles.compCell, styles.compPlanCell, { color: colors.accent }]}>Pro</Text>
          </View>
          {FEATURES.map((feat, idx) => (
            <View
              key={feat.label}
              style={[
                styles.compRow,
                idx < FEATURES.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              ]}
            >
              <Text style={[styles.compCell, styles.compFeatureCell, { color: colors.textPrimary }]}>
                {feat.label}
              </Text>
              <Text style={[styles.compCell, styles.compPlanCell, { color: colors.textMuted }]}>
                {feat.free}
              </Text>
              <Text style={[styles.compCell, styles.compPlanCell, { color: colors.textPrimary, fontWeight: '600' }]}>
                {feat.pro}
              </Text>
            </View>
          ))}
        </View>

        {/* Legal */}
        <Text style={[styles.legalText, { color: colors.textMuted }]}>
          Payment will be charged to your App Store or Google Play account.
          Subscription renews automatically unless cancelled at least 24 hours before the end of the current period.
        </Text>

        <View style={{ height: 48 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeIcon: { fontSize: 20, fontWeight: '600', padding: 4 },

  content: { paddingTop: 32, paddingBottom: 40 },

  heroEmoji: { fontSize: 48, textAlign: 'center', marginBottom: 12 },
  heroTitle: { fontSize: 26, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  heroSub: { fontSize: 16, textAlign: 'center', lineHeight: 22, marginBottom: 24 },

  trialBanner: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 28,
  },
  trialText: { fontSize: 15, fontWeight: '700' },

  planRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  planCard: {
    flex: 1,
    paddingVertical: 20,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 4,
    position: 'relative',
    overflow: 'visible',
  },
  saveBadge: {
    position: 'absolute',
    top: -10,
    right: -4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  saveBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  planLabel: { fontSize: 14, fontWeight: '600' },
  planPrice: { fontSize: 24, fontWeight: '800' },
  planPeriod: { fontSize: 13 },
  planPerMonth: { fontSize: 12, marginTop: 2 },

  ctaBtn: { height: 56, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  ctaBtnText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },

  restoreBtn: { alignItems: 'center', paddingVertical: 10, marginBottom: 32 },
  restoreText: { fontSize: 14 },

  compTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  compTable: { overflow: 'hidden', marginBottom: 24 },
  compRow: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 14 },
  compHeaderRow: { borderBottomWidth: 1 },
  compCell: { fontSize: 14 },
  compFeatureCell: { flex: 2 },
  compPlanCell: { flex: 1, textAlign: 'center' },

  legalText: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
