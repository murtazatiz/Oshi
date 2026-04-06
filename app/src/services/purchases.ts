/**
 * RevenueCat SDK initialisation — PRD §5.6
 *
 * Configures RevenueCat with the platform-specific API key,
 * logs in the current Supabase user, and exposes helpers for
 * fetching entitlements and making purchases.
 */
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesPackage,
} from 'react-native-purchases';
import { Platform } from 'react-native';

// Product identifiers — must match RevenueCat dashboard configuration
export const PRODUCT_IDS = {
  monthly: 'oshi_pro_monthly',
  annual: 'oshi_pro_annual',
} as const;

export const ENTITLEMENT_ID = 'pro' as const;

/**
 * Call once after the user has authenticated.
 * Configures RevenueCat with the correct platform key and
 * associates the Supabase user ID so entitlements are tied
 * to the same identity across devices.
 */
export async function initialisePurchases(userId: string): Promise<void> {
  const apiKey =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY!
      : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY!;

  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);

  await Purchases.configure({ apiKey });
  await Purchases.logIn(userId);
}

/**
 * Returns the latest `CustomerInfo` from RevenueCat,
 * which contains the active entitlements.
 */
export async function getCustomerInfo(): Promise<CustomerInfo> {
  return Purchases.getCustomerInfo();
}

/**
 * Check if the user currently holds the 'pro' entitlement.
 */
export async function isProEntitled(): Promise<boolean> {
  const info = await getCustomerInfo();
  return info.entitlements.active[ENTITLEMENT_ID] !== undefined;
}

/**
 * Fetch available packages (monthly + annual) for the paywall.
 */
export async function getOfferings(): Promise<PurchasesPackage[]> {
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  if (!current) return [];
  return current.availablePackages;
}

/**
 * Purchase a specific package.
 * Returns the updated CustomerInfo on success.
 */
export async function purchasePackage(
  pkg: PurchasesPackage,
): Promise<CustomerInfo> {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return customerInfo;
}

/**
 * Restore previous purchases (e.g. re-install or new device).
 */
export async function restorePurchases(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}
