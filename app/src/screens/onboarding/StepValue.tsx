/**
 * Reusable value proposition screen — used for steps 2, 3, and 4.
 * Each has a large emoji icon, headline, body text, Skip + Next buttons.
 */
import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../../theme/ThemeContext';

export interface ValueStepContent {
  icon: string;          // emoji or symbol
  headline: string;
  body: string;
  ctaLabel?: string;     // defaults to 'Next'
}

interface Props {
  content: ValueStepContent;
  stepIndex: number;     // 1-based display index
  totalSteps: number;
  onNext: () => void;
  onSkip: () => void;
}

export default function StepValue({
  content,
  stepIndex,
  totalSteps,
  onNext,
  onSkip,
}: Props): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { typography, spacing, borderRadius } = theme;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Skip */}
        <TouchableOpacity
          onPress={onSkip}
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
          style={styles.skipBtn}
          accessibilityLabel={`Skip step ${stepIndex}`}
          accessibilityRole="button"
        >
          <Text style={[{ color: colors.textMuted, ...typography.bodySmall }]}>Skip</Text>
        </TouchableOpacity>

        {/* Progress dots */}
        <View style={styles.dotsRow}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    i + 1 === stepIndex ? colors.accent : colors.border,
                  width: i + 1 === stepIndex ? 20 : 8,
                },
              ]}
            />
          ))}
        </View>

        {/* Content */}
        <View style={[styles.content, { paddingHorizontal: spacing.xl }]}>
          <Text style={styles.icon}>{content.icon}</Text>

          <Text
            style={[
              styles.headline,
              { color: colors.textPrimary, fontFamily: typography.display.fontFamily, fontSize: 32, lineHeight: 40, marginTop: spacing.lg },
            ]}
          >
            {content.headline}
          </Text>

          <Text
            style={[
              styles.body,
              { color: colors.textSecondary, ...typography.body, marginTop: spacing.md },
            ]}
          >
            {content.body}
          </Text>
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
            accessibilityLabel={content.ctaLabel ?? 'Next'}
            accessibilityRole="button"
          >
            <Text style={[styles.ctaLabel, { color: '#FFFFFF', ...typography.button }]}>
              {content.ctaLabel ?? 'Next'}
            </Text>
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
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    marginBottom: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  icon: { fontSize: 72 },
  headline: { fontWeight: '700' },
  body: { lineHeight: 26 },
  ctaContainer: {},
  ctaBtn: {
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: {},
});
