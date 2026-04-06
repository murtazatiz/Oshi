/**
 * subscriptionStore — Zustand store for RevenueCat subscription state
 *
 * Manages:
 *   • Whether the user holds the 'pro' entitlement
 *   • Available packages (monthly / annual) for the paywall
 *   • Purchase and restore flows
 *   • Streak data + milestone celebrations
 *   • Downgrade banner visibility (§3.7.4)
 *   • Trial expiry banner flag (§3.4.3)
 */
import { create } from 'zustand';
import type { PurchasesPackage } from 'react-native-purchases';
import * as Haptics from 'expo-haptics';
import {
  ENTITLEMENT_ID,
  getCustomerInfo,
  getOfferings,
  purchasePackage,
  restorePurchases,
} from '../services/purchases';
import { apiClient } from '../services/apiClient';

// PRD §3.4.4 — milestone thresholds
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100] as const;

export interface SubscriptionState {
  isPro: boolean;
  isTrial: boolean;
  packages: PurchasesPackage[];
  isLoading: boolean;
  error: string | null;

  /** Streak counter — mirrors users.streak_count from the server */
  streakCount: number;
  /** When non-null, the milestone celebration modal should display */
  activeMilestone: number | null;

  /** §3.7.4 — show persistent soft banner for downgraded users */
  showDowngradeBanner: boolean;
  /** §3.4.3 — trial_expiry_banner_due from GET /users/me */
  showTrialExpiryBanner: boolean;
  /** Dismissible once per session */
  downgradeBannerDismissed: boolean;
}

interface SubscriptionActions {
  /** Fetch entitlement status + offerings from RevenueCat */
  refresh: () => Promise<void>;

  /** Purchase a package, fire success haptic, update authStore */
  purchase: (pkg: PurchasesPackage) => Promise<boolean>;

  /** Restore previous purchases */
  restore: () => Promise<boolean>;

  /** Update streak from server data */
  setStreak: (count: number) => void;

  /** Check if the new streak hits a milestone and trigger celebration */
  checkMilestone: (count: number) => void;

  /** Clear the active milestone after celebration animation */
  clearMilestone: () => void;

  /** Set flags from GET /users/me response */
  setServerFlags: (flags: {
    subscriptionStatus: string;
    trialExpiryBannerDue?: boolean;
  }) => void;

  dismissDowngradeBanner: () => void;
  dismissTrialExpiryBanner: () => void;
}

export const useSubscriptionStore = create<SubscriptionState & SubscriptionActions>(
  (set, get) => ({
    isPro: false,
    isTrial: false,
    packages: [],
    isLoading: false,
    error: null,
    streakCount: 0,
    activeMilestone: null,
    showDowngradeBanner: false,
    showTrialExpiryBanner: false,
    downgradeBannerDismissed: false,

    refresh: async () => {
      set({ isLoading: true, error: null });
      try {
        const [info, pkgs] = await Promise.all([
          getCustomerInfo(),
          getOfferings(),
        ]);
        const isPro = info.entitlements.active[ENTITLEMENT_ID] !== undefined;
        set({ isPro, packages: pkgs, isLoading: false });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Could not load subscription info.';
        set({ error: msg, isLoading: false });
      }
    },

    purchase: async (pkg) => {
      set({ isLoading: true, error: null });
      try {
        const info = await purchasePackage(pkg);
        const isPro = info.entitlements.active[ENTITLEMENT_ID] !== undefined;

        // PRD: NotificationFeedbackType.Success on purchase complete
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        set({ isPro, isLoading: false });
        return isPro;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Purchase failed.';
        set({ error: msg, isLoading: false });
        return false;
      }
    },

    restore: async () => {
      set({ isLoading: true, error: null });
      try {
        const info = await restorePurchases();
        const isPro = info.entitlements.active[ENTITLEMENT_ID] !== undefined;
        set({ isPro, isLoading: false });
        return isPro;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Could not restore purchases.';
        set({ error: msg, isLoading: false });
        return false;
      }
    },

    setStreak: (count) => set({ streakCount: count }),

    checkMilestone: (count) => {
      if ((STREAK_MILESTONES as readonly number[]).includes(count)) {
        set({ activeMilestone: count });
        // PRD §3.4.4 — NotificationFeedbackType.Success on milestone
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    },

    clearMilestone: () => set({ activeMilestone: null }),

    setServerFlags: ({ subscriptionStatus, trialExpiryBannerDue }) => {
      const isPro = subscriptionStatus === 'pro';
      const isTrial = subscriptionStatus === 'trial';
      const isFreeOrCancelled =
        subscriptionStatus === 'free' || subscriptionStatus === 'cancelled';

      set({
        isPro: isPro || isTrial,
        isTrial,
        showDowngradeBanner: isFreeOrCancelled,
        showTrialExpiryBanner: trialExpiryBannerDue === true,
      });
    },

    dismissDowngradeBanner: () => set({ downgradeBannerDismissed: true }),
    dismissTrialExpiryBanner: () => set({ showTrialExpiryBanner: false }),
  }),
);
