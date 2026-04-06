import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, View } from 'react-native';
import {
  createNavigationContainerRef,
  NavigationContainer,
  type LinkingOptions,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase';
import { theme } from '../theme';
import { useOnboardingStore } from '../store/onboardingStore';

import type {
  AuthStackParamList,
  LibraryStackParamList,
  MainStackParamList,
  MainTabParamList,
  RootStackParamList,
  SettingsStackParamList,
} from './types';

// Auth screens
import OnboardingScreen from '../screens/onboarding/OnboardingScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import SignupScreen from '../screens/auth/SignupScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import ResetPasswordScreen from '../screens/auth/ResetPasswordScreen';

// Library screens
import LibraryScreen from '../screens/library/LibraryScreen';
import ContentDetailScreen from '../screens/library/ContentDetailScreen';

// Paywall
import PaywallScreen from '../screens/PaywallScreen';

// Save URL modal
import SaveUrlScreen from '../screens/SaveUrlScreen';

// Import screen
import ImportScreen from '../screens/ImportScreen';

// Settings screens
import SettingsScreen from '../screens/settings/SettingsScreen';
import ProfileScreen from '../screens/settings/ProfileScreen';
import RemindersScreen from '../screens/settings/RemindersScreen';
import SubscriptionScreen from '../screens/settings/SubscriptionScreen';

// ─────────────────────────────────────────────────────────────────────────────
// Navigator instances — typed with their param lists
// ─────────────────────────────────────────────────────────────────────────────
const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainStack = createNativeStackNavigator<MainStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();
const LibraryStack = createNativeStackNavigator<LibraryStackParamList>();
const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();

// ─────────────────────────────────────────────────────────────────────────────
// Navigation ref — exported so App.tsx can navigate outside React tree
// and so deep links can be handled on cold start per PRD §4
// ─────────────────────────────────────────────────────────────────────────────
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

// ─────────────────────────────────────────────────────────────────────────────
// Deep link configuration
// All patterns from PRD §4. Prefix: 'oshi://'
// oshi://notifications/enable is handled separately (opens OS settings).
// ─────────────────────────────────────────────────────────────────────────────
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['oshi://'],
  config: {
    screens: {
      Auth: {
        screens: {
          /** oshi://auth/reset?token=xxx — PRD §4 */
          ResetPassword: {
            path: 'auth/reset',
            parse: { token: (token: string) => decodeURIComponent(token) },
          },
          Onboarding: 'onboarding',
          Login: 'login',
          Signup: 'signup',
          ForgotPassword: 'forgot-password',
        },
      },
      Main: {
        screens: {
          MainTabs: {
            screens: {
              LibraryTab: {
                screens: {
                  /**
                   * oshi://library → Library home (all categories)
                   * oshi://library/:categorySlug → Library pre-scrolled to category
                   * PRD §4: slug is lowercase, hyphenated, e.g. 'business'
                   */
                  LibraryHome: 'library/:categorySlug?',
                },
              },
              SearchTab: { path: 'search' },
              SettingsTab: {
                screens: {
                  SettingsHome: 'settings',
                  /** oshi://settings/reminders — PRD §4 */
                  Reminders: 'settings/reminders',
                  /** oshi://settings/subscription — PRD §4 */
                  Subscription: 'settings/subscription',
                },
              },
            },
          },
          /** oshi://save/:saveId — PRD §4 */
          ContentDetail: 'save/:saveId',
        },
      },
    },
  },
  /**
   * oshi://notifications/enable deep links to the OS notification settings
   * for Oshi (PRD §4). This URL does not map to an in-app screen, so we
   * intercept it here and open the system settings instead.
   */
  getStateFromPath(path, options) {
    if (path === 'notifications/enable' || path.startsWith('notifications/enable')) {
      void Linking.openSettings();
      return undefined;
    }
    // Fall through to the default resolver for all other paths
    const { getStateFromPath: defaultGetState } =
      require('@react-navigation/native') as typeof import('@react-navigation/native');
    return defaultGetState(path, options);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Auth state hook
// PRD §3.5.3: call supabase.auth.getSession() on app open.
// On 401: one silent refresh → if failed, clear session and redirect to Login.
// Session is persisted in SecureStore via the adapter in src/lib/supabase.ts.
// ─────────────────────────────────────────────────────────────────────────────
function useAuthSession(): { session: Session | null; isLoading: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Restore session from SecureStore on mount
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
      })
      .catch(() => {
        setSession(null);
      })
      .finally(() => {
        setIsLoading(false);
      });

    // Keep session in sync with Supabase auth events (sign in, sign out,
    // token refresh, password recovery, etc.)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, updatedSession) => {
      setSession(updatedSession);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return { session, isLoading };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth Stack navigator
// ─────────────────────────────────────────────────────────────────────────────
function AuthNavigator(): React.JSX.Element {
  return (
    <AuthStack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <AuthStack.Screen name="Onboarding" component={OnboardingScreen} />
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Signup" component={SignupScreen} />
      <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <AuthStack.Screen name="ResetPassword" component={ResetPasswordScreen} />
    </AuthStack.Navigator>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Library nested stack
// Allows the Library tab to push additional screens while keeping the tab bar.
// ─────────────────────────────────────────────────────────────────────────────
function LibraryNavigator(): React.JSX.Element {
  return (
    <LibraryStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <LibraryStack.Screen name="LibraryHome" component={LibraryScreen} />
    </LibraryStack.Navigator>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings nested stack
// Allows deep-linking to Reminders and Subscription sub-screens (PRD §4).
// ─────────────────────────────────────────────────────────────────────────────
function SettingsNavigator(): React.JSX.Element {
  return (
    <SettingsStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <SettingsStack.Screen name="SettingsHome" component={SettingsScreen} />
      <SettingsStack.Screen name="Profile" component={ProfileScreen} />
      <SettingsStack.Screen name="Reminders" component={RemindersScreen} />
      <SettingsStack.Screen name="Subscription" component={SubscriptionScreen} />
    </SettingsStack.Navigator>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Bottom Tab Navigator
// Three tabs per PRD: Library (Home), Search, Settings (Gear)
// Tab icon min touch target 44×44px enforced via tabBarStyle (PRD §7.5)
//
// Safe-area handling: we read the real bottom inset via useSafeAreaInsets()
// so the tab bar always sits above the system navigation bar on Android
// gesture-nav devices (e.g. Samsung Galaxy S22 Ultra) without being
// clipped by or overlapping the phone's own nav gestures.
// ─────────────────────────────────────────────────────────────────────────────
function MainTabNavigator(): React.JSX.Element {
  const insets = useSafeAreaInsets();

  // On iOS the home indicator is included in the inset (≈34px on Face ID devices).
  // On Android the gesture bar / 3-button nav bar height is in insets.bottom
  // (ranges from 0 on gesture-only mode up to ~48dp on button-nav mode).
  // We always add the actual inset on top of a baseline content padding.
  const CONTENT_PADDING = 8; // space between icons and inset
  const bottomPad = insets.bottom + CONTENT_PADDING;
  const tabBarHeight = 52 + bottomPad; // 52 is icon+label area, bottomPad fills the inset

  return (
    <MainTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: tabBarHeight,
          paddingBottom: bottomPad,
          paddingTop: CONTENT_PADDING,
        },
        tabBarLabelStyle: {
          ...theme.typography.caption,
          marginTop: 2,
        },
        // Enforce 44×44px min touch target per PRD §7.5 and cursor rule
        tabBarItemStyle: { minHeight: 44 },
      }}
    >
      <MainTab.Screen
        name="LibraryTab"
        component={LibraryNavigator}
        options={{
          title: 'Library',
          tabBarIcon: ({ color, size }) => (
            <TabIcon symbol="⊡" color={color} size={size} />
          ),
        }}
      />
      <MainTab.Screen
        name="SearchTab"
        component={ImportScreen}
        options={{
          title: 'Import',
          tabBarIcon: ({ color, size }) => (
            <TabIcon symbol="⬇" color={color} size={size} />
          ),
        }}
      />
      <MainTab.Screen
        name="SettingsTab"
        component={SettingsNavigator}
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <TabIcon symbol="⚙" color={color} size={size} />
          ),
        }}
      />
    </MainTab.Navigator>
  );
}

// Minimal icon component — replace with @expo/vector-icons Ionicons once installed
function TabIcon({
  symbol,
  color,
  size,
}: {
  symbol: string;
  color: string;
  size: number;
}): React.JSX.Element {
  return (
    <View style={styles.tabIconContainer}>
      {/* eslint-disable-next-line react-native/no-inline-styles */}
      <React.Fragment>
        {React.createElement(
          require('react-native').Text,
          { style: { fontSize: size, color } },
          symbol,
        )}
      </React.Fragment>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Stack navigator
// Hosts the tab navigator + ContentDetail modal sheet (PRD §3.6)
// ─────────────────────────────────────────────────────────────────────────────
function MainNavigator(): React.JSX.Element {
  return (
    <MainStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <MainStack.Screen name="MainTabs" component={MainTabNavigator} />
      {/*
       * ContentDetail slides up as a modal sheet from the bottom (PRD §3.6).
       * presentation='formSheet' gives the iOS card/sheet appearance.
       */}
      <MainStack.Screen
        name="ContentDetail"
        component={ContentDetailScreen}
        options={{
          presentation: 'formSheet',
          animation: 'slide_from_bottom',
          gestureEnabled: true,
          gestureDirection: 'vertical',
        }}
      />
      <MainStack.Screen
        name="Paywall"
        component={PaywallScreen}
        options={{
          presentation: 'formSheet',
          animation: 'slide_from_bottom',
          gestureEnabled: true,
          gestureDirection: 'vertical',
        }}
      />
      <MainStack.Screen
        name="SaveUrl"
        component={SaveUrlScreen}
        options={{
          presentation: 'formSheet',
          animation: 'slide_from_bottom',
          gestureEnabled: true,
          gestureDirection: 'vertical',
        }}
      />
    </MainStack.Navigator>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root navigator — auth + onboarding gate
// Shows Main only when BOTH a session AND completed onboarding are present.
// This lets OnboardingScreen continue through all 9 steps even after sign-up
// sets the Supabase session (step 5), because onboardingDone stays false
// until markComplete() is called at the end of step 9.
// ─────────────────────────────────────────────────────────────────────────────
function RootNavigator(): React.JSX.Element {
  const { session, isLoading: sessionLoading } = useAuthSession();

  const isOnboardingComplete = useOnboardingStore((s) => s.isComplete);
  const isOnboardingLoaded = useOnboardingStore((s) => s.isLoaded);
  const loadOnboarding = useOnboardingStore((s) => s.load);

  useEffect(() => {
    void loadOnboarding();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLoading = sessionLoading || !isOnboardingLoaded;

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  // Show Main only when both authenticated AND onboarding is done
  const showMain = session !== null && isOnboardingComplete;

  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {showMain ? (
        <RootStack.Screen name="Main" component={MainNavigator} />
      ) : (
        <RootStack.Screen name="Auth" component={AuthNavigator} />
      )}
    </RootStack.Navigator>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AppNavigator — entry point
// Wraps the full navigation tree with:
//   GestureHandlerRootView — required for RNGH (PRD cursor rule)
//   SafeAreaProvider — required for SafeAreaView (PRD §7.5 / cursor rule)
//   NavigationContainer — React Navigation root with deep link config
// ─────────────────────────────────────────────────────────────────────────────
export default function AppNavigator(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <NavigationContainer ref={navigationRef} linking={linking}>
          <RootNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  tabIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
    minHeight: 44,
  },
});
