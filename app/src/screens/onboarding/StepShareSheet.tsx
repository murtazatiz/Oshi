/**
 * Step 8 — Share Sheet Setup Guide
 * Animated step-by-step guide for adding Oshi to the iOS share sheet.
 * Uses RN Animated API for the sequential card highlight cycle.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../../theme/ThemeContext';

const GUIDE_STEPS = [
  {
    number: '1',
    icon: '📱',
    title: 'Open any app',
    body: 'Find something worth saving — an article, video, podcast, or link.',
  },
  {
    number: '2',
    icon: '⬆️',
    title: 'Tap the Share button',
    body: "Look for the share icon — it's the square with an arrow pointing up.",
  },
  {
    number: '3',
    icon: '🔍',
    title: 'Find Oshi in the list',
    body: "Scroll the bottom row of apps. Tap \"More\" if you don't see Oshi yet.",
  },
  {
    number: '4',
    icon: '✅',
    title: 'Tap Oshi to save',
    body: 'Oshi instantly saves and categorises your content with AI.',
  },
] as const;

interface Props {
  onNext: () => void;
  onSkip: () => void;
}

export default function StepShareSheet({ onNext, onSkip }: Props): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { typography, spacing, borderRadius, shadows } = theme;

  const [activeStep, setActiveStep] = useState(0);

  // One Animated.Value per card for scale and opacity
  const cardScales = useRef(GUIDE_STEPS.map(() => new Animated.Value(1))).current;
  const cardOpacities = useRef(
    GUIDE_STEPS.map((_, i) => new Animated.Value(i === 0 ? 1 : 0.55)),
  ).current;

  // Animate all cards whenever activeStep changes
  useEffect(() => {
    const anims = GUIDE_STEPS.map((_, i) => {
      const isActive = i === activeStep;
      return Animated.parallel([
        Animated.timing(cardScales[i]!, {
          toValue: isActive ? 1.03 : 1,
          duration: 350,
          useNativeDriver: true,
        }),
        Animated.timing(cardOpacities[i]!, {
          toValue: isActive ? 1 : 0.55,
          duration: 350,
          useNativeDriver: true,
        }),
      ]);
    });
    Animated.parallel(anims).start();
  }, [activeStep, cardScales, cardOpacities]);

  // Cycle the active step every 2 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % GUIDE_STEPS.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Skip */}
        <TouchableOpacity
          onPress={onSkip}
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
          style={styles.skipBtn}
          accessibilityLabel="Skip share sheet setup"
          accessibilityRole="button"
        >
          <Text style={[{ color: colors.textMuted, ...typography.bodySmall }]}>Skip</Text>
        </TouchableOpacity>

        <View style={[styles.content, { paddingHorizontal: spacing.xl }]}>
          <Text style={{ fontSize: 52, marginBottom: spacing.md }}>📤</Text>

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
            Save from anywhere
          </Text>
          <Text
            style={[{ color: colors.textSecondary, ...typography.body, marginBottom: spacing.xl }]}
          >
            Add Oshi to your iOS share sheet to save with one tap.
          </Text>

          {/* Animated guide cards */}
          <View style={styles.guideList}>
            {GUIDE_STEPS.map((step, idx) => (
              <Animated.View
                key={step.number}
                style={[
                  styles.guideCard,
                  {
                    backgroundColor: colors.surface,
                    borderRadius: borderRadius.md,
                    ...shadows.card,
                    marginBottom: spacing.sm,
                    transform: [{ scale: cardScales[idx]! }],
                    opacity: cardOpacities[idx],
                  },
                ]}
              >
                <View
                  style={[
                    styles.stepNumber,
                    { backgroundColor: colors.accent, borderRadius: borderRadius.pill },
                  ]}
                >
                  <Text style={[{ color: '#FFFFFF', ...typography.button }]}>{step.number}</Text>
                </View>
                <View style={styles.cardText}>
                  <Text
                    style={[{ color: colors.textPrimary, ...typography.heading2, marginBottom: 2 }]}
                  >
                    {step.icon}{'  '}{step.title}
                  </Text>
                  <Text style={[{ color: colors.textSecondary, ...typography.bodySmall }]}>
                    {step.body}
                  </Text>
                </View>
              </Animated.View>
            ))}
          </View>

          {Platform.OS !== 'ios' && (
            <Text
              style={[
                {
                  color: colors.textMuted,
                  ...typography.caption,
                  textAlign: 'center',
                  marginTop: spacing.md,
                },
              ]}
            >
              The share sheet extension is available on iOS only.
            </Text>
          )}
        </View>

        {/* CTA */}
        <View style={[styles.ctaContainer, { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl }]}>
          <TouchableOpacity
            onPress={onNext}
            activeOpacity={0.85}
            style={[
              styles.ctaBtn,
              { backgroundColor: colors.accent, borderRadius: borderRadius.pill },
            ]}
            accessibilityLabel="Done, let's go"
            accessibilityRole="button"
          >
            <Text style={[{ color: '#FFFFFF', ...typography.button }]}>Done — Let's Go</Text>
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
  guideList: {},
  guideCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  stepNumber: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardText: { flex: 1 },
  ctaContainer: {},
  ctaBtn: { height: 54, alignItems: 'center', justifyContent: 'center' },
});
