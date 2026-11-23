/**
 * Paywall entry point — PRD §8.3.
 *
 * Every trigger opens the paywall through openPaywall(), so the "is it
 * already open / can we navigate yet" rules live in one place:
 *   save_limit     — 21st save of the month (403 SAVE_LIMIT_REACHED)
 *   category_limit — 4th custom category (403 CATEGORY_LIMIT_REACHED)
 *   settings       — "Upgrade to Pro" rows and Pro-only toggles in Settings
 *   trial_expiry   — trial-expiry banner CTA on the Library
 *
 * The two limit triggers fire automatically from apiClient's response
 * interceptor, so call sites never need to detect them to show the paywall.
 */
import { navigationRef } from '../navigation/navigationRef';

export type PaywallTrigger =
  | 'save_limit'
  | 'category_limit'
  | 'settings'
  | 'trial_expiry'
  | 'direct';

export type LimitErrorCode = 'SAVE_LIMIT_REACHED' | 'CATEGORY_LIMIT_REACHED';

export const LIMIT_TRIGGERS: Record<LimitErrorCode, PaywallTrigger> = {
  SAVE_LIMIT_REACHED: 'save_limit',
  CATEGORY_LIMIT_REACHED: 'category_limit',
};

/**
 * Open the paywall modal. No-op when navigation isn't mounted yet (cold
 * start, or the iOS share extension's separate JS context) or the paywall
 * is already showing — a batch import can hit the save limit repeatedly
 * and must not stack paywalls.
 */
export function openPaywall(trigger: PaywallTrigger): void {
  if (!navigationRef.isReady()) return;
  if (navigationRef.getCurrentRoute()?.name === 'Paywall') return;
  navigationRef.navigate('Main', { screen: 'Paywall', params: { trigger } });
}
