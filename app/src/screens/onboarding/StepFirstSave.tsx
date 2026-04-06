/**
 * Step 9 — First Save Prompt
 * "Try saving something right now." Shows a sample save card.
 * CTA opens Instagram; skip/done button completes onboarding.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../../theme/ThemeContext';

interface Props {
  onDone: () => void;
}

export default function StepFirstSave({ onDone }: Props): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { typography, spacing, borderRadius, shadows } = theme;

  // Subtle floating animation on the sample card
  const floatY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const floatAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(floatY, {
          toValue: -6,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(floatY, {
          toValue: 0,
          duration: 1800,
          useNativeDriver: true,
        }),
      ]),
    );
    floatAnim.start();
    return () => floatAnim.stop();
  }, [floatY]);

  async function openInstagram(): Promise<void> {
    const fallbackUrl = 'https://www.instagram.com/explore/';
    try {
      const canOpen = await Linking.canOpenURL('instagram://explore');
      await Linking.openURL(canOpen ? 'instagram://explore' : fallbackUrl);
    } catch {
      await Linking.openURL(fallbackUrl);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Skip */}
        <TouchableOpacity
          onPress={onDone}
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
          style={styles.skipBtn}
          accessibilityLabel="I'll try later"
          accessibilityRole="button"
        >
          <Text style={[{ color: colors.textMuted, ...typography.bodySmall }]}>I'll try later</Text>
        </TouchableOpacity>

        <View style={[styles.content, { paddingHorizontal: spacing.xl }]}>
          <Text
            style={[
              {
                color: colors.textPrimary,
                fontFamily: typography.display.fontFamily,
                fontSize: 28,
                lineHeight: 36,
                fontWeight: '700',
                marginBottom: spacing.xs,
              },
            ]}
          >
            Try saving something right now
          </Text>
          <Text
            style={[{ color: colors.textSecondary, ...typography.body, marginBottom: spacing.xl }]}
          >
            Head to Instagram (or any app), find something interesting, and share it to Oshi. It takes 3 seconds.
          </Text>

          {/* Floating sample card */}
          <Animated.View
            style={[
              styles.sampleCard,
              {
                backgroundColor: colors.surface,
                borderRadius: borderRadius.lg,
                ...shadows.card,
                borderColor: colors.border,
                transform: [{ translateY: floatY }],
              },
            ]}
          >
            {/* Thumbnail */}
            <View
              style={[
                styles.cardThumb,
                { backgroundColor: colors.primary, borderRadius: borderRadius.md },
              ]}
            >
              <Text style={{ fontSize: 36 }}>📸</Text>
              <View
                style={[
                  styles.platformBadge,
                  { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: borderRadius.sm },
                ]}
              >
                <Text style={[{ color: '#FFFFFF', ...typography.caption }]}>Instagram</Text>
              </View>
            </View>

            <View style={[styles.cardBody, { padding: spacing.md }]}>
              <Text style={[{ color: colors.textMuted, ...typography.caption, marginBottom: 4 }]}>
                ARTICLE  •  4 MIN READ
              </Text>
              <Text
                style={[{ color: colors.textPrimary, ...typography.heading2, marginBottom: 4 }]}
                numberOfLines={2}
              >
                10 Productivity Habits That Actually Stick
              </Text>
              <Text
                style={[{ color: colors.textSecondary, ...typography.bodySmall }]}
                numberOfLines={2}
              >
                AI summary will appear here once Oshi analyses your saved content.
              </Text>
              <View style={[styles.statusRow, { marginTop: spacing.sm }]}>
                <View
                  style={[
                    styles.statusChip,
                    { backgroundColor: colors.warning + '22', borderRadius: borderRadius.sm },
                  ]}
                >
                  <Text style={[{ color: colors.warning, ...typography.caption }]}>⏳ AI processing</Text>
                </View>
              </View>
            </View>
          </Animated.View>
        </View>

        {/* CTAs */}
        <View style={[styles.ctaContainer, { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl }]}>
          <TouchableOpacity
            onPress={() => void openInstagram()}
            activeOpacity={0.85}
            style={[
              styles.ctaBtn,
              { backgroundColor: colors.accent, borderRadius: borderRadius.pill, marginBottom: spacing.sm },
            ]}
            accessibilityLabel="Open Instagram"
            accessibilityRole="button"
          >
            <Text style={[{ color: '#FFFFFF', ...typography.button }]}>Open Instagram</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onDone}
            hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
            style={[styles.skipLink, { minHeight: 44 }]}
            accessibilityLabel="Go to my library"
            accessibilityRole="button"
          >
            <Text style={[{ color: colors.accent, ...typography.button }]}>Go to my library →</Text>
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
  sampleCard: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardThumb: {
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  platformBadge: {
    position: 'absolute',
    bottom: 8,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  cardBody: {},
  statusRow: { flexDirection: 'row' },
  statusChip: { paddingHorizontal: 8, paddingVertical: 4 },
  ctaContainer: {},
  ctaBtn: { height: 54, alignItems: 'center', justifyContent: 'center' },
  skipLink: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
});
