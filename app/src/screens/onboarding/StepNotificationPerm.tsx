import React, { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

import { useTheme } from '../../theme/ThemeContext';
import { apiClient } from '../../services/apiClient';

interface Props {
  onNext: () => void;
  onSkip: () => void;
}

export default function StepNotificationPerm({ onNext, onSkip }: Props): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { typography, spacing, borderRadius } = theme;
  const [isRequesting, setIsRequesting] = useState(false);

  async function requestPermission(): Promise<void> {
    setIsRequesting(true);
    try {
      const { status } = await Notifications.requestPermissionsAsync();

      // Record the permission status in the backend regardless of outcome
      void apiClient.patch('/users/me', {
        notification_permission: status === 'granted' ? 'granted' : 'denied',
      }).catch(() => undefined);

      if (status === 'granted') {
        // Obtain the Expo push token and register it with the backend
        try {
          const extra = Constants.expoConfig?.extra as
              | { eas?: { projectId?: string } }
              | undefined;
          const projectId = extra?.eas?.projectId;
          const tokenResponse = await Notifications.getExpoPushTokenAsync(
            projectId ? { projectId } : undefined,
          );
          void apiClient.post('/notifications/token', {
            expo_push_token: tokenResponse.data,
          }).catch(() => undefined);
        } catch {
          // Push token unavailable in dev/simulator — non-fatal
        }
      }
    } catch {
      // Permission request failed — continue silently (day-3 modal handles this)
    } finally {
      setIsRequesting(false);
      onNext();
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Skip */}
        <TouchableOpacity
          onPress={onSkip}
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
          style={styles.skipBtn}
          accessibilityLabel="Skip notifications setup"
          accessibilityRole="button"
        >
          <Text style={[{ color: colors.textMuted, ...typography.bodySmall }]}>Skip</Text>
        </TouchableOpacity>

        <View style={[styles.content, { paddingHorizontal: spacing.xl }]}>
          <Text style={{ fontSize: 72, marginBottom: spacing.lg }}>🔔</Text>

          <Text
            style={[
              {
                color: colors.textPrimary,
                fontFamily: typography.display.fontFamily,
                fontSize: 28,
                lineHeight: 36,
                fontWeight: '700',
                marginBottom: spacing.md,
              },
            ]}
          >
            Never forget a save
          </Text>

          <Text style={[{ color: colors.textSecondary, ...typography.body, lineHeight: 26, marginBottom: spacing.lg }]}>
            Oshi sends you a gentle daily reminder to revisit your saved content — just once a day, at your chosen time.
          </Text>

          {/* Feature bullets */}
          {[
            '📚  Reminds you of unread saves',
            '⏰  Sent at the time you choose',
            '🔕  Easy to adjust or turn off anytime',
          ].map((line) => (
            <Text
              key={line}
              style={[{ color: colors.textSecondary, ...typography.body, marginBottom: spacing.sm }]}
            >
              {line}
            </Text>
          ))}
        </View>

        {/* CTA */}
        <View style={[styles.ctaContainer, { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl }]}>
          <TouchableOpacity
            onPress={() => void requestPermission()}
            activeOpacity={0.85}
            disabled={isRequesting}
            style={[
              styles.ctaBtn,
              { backgroundColor: colors.accent, borderRadius: borderRadius.pill, marginBottom: spacing.sm },
            ]}
            accessibilityLabel="Enable Notifications"
            accessibilityRole="button"
          >
            {isRequesting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={[{ color: '#FFFFFF', ...typography.button }]}>Enable Notifications</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onSkip}
            hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
            style={[styles.notNowBtn, { minHeight: 44 }]}
            accessibilityLabel="Not now"
            accessibilityRole="button"
          >
            <Text style={[{ color: colors.textMuted, ...typography.bodySmall }]}>Not now</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  skipBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 12 : 4,
    minHeight: 44,
    justifyContent: 'center',
  },
  content: { flex: 1, justifyContent: 'center' },
  ctaContainer: {},
  ctaBtn: { height: 54, alignItems: 'center', justifyContent: 'center' },
  notNowBtn: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
});
