import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../../theme/ThemeContext';

interface Props {
  onNext: () => void;
  onSkip: () => void;
}

export default function StepWelcome({ onNext, onSkip }: Props): React.JSX.Element {
  const { theme } = useTheme();
  const { colors, typography, spacing, borderRadius } = theme;

  // ── Pulsing circle animation (replaces Lottie) ────────────────────────────
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const scaleAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseScale, {
          toValue: 1.18,
          duration: 1600,
          useNativeDriver: true,
        }),
        Animated.timing(pulseScale, {
          toValue: 1,
          duration: 1600,
          useNativeDriver: true,
        }),
      ]),
    );
    const opacityAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, {
          toValue: 0.15,
          duration: 1600,
          useNativeDriver: true,
        }),
        Animated.timing(pulseOpacity, {
          toValue: 0.6,
          duration: 1600,
          useNativeDriver: true,
        }),
      ]),
    );

    scaleAnim.start();
    opacityAnim.start();

    return () => {
      scaleAnim.stop();
      opacityAnim.stop();
    };
  }, [pulseScale, pulseOpacity]);

  return (
    <View style={[styles.root, { backgroundColor: colors.primary }]}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Skip */}
        <TouchableOpacity
          onPress={onSkip}
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
          style={styles.skipBtn}
          accessibilityLabel="Skip welcome"
          accessibilityRole="button"
        >
          <Text style={[{ color: 'rgba(255,255,255,0.6)', ...typography.bodySmall }]}>Skip</Text>
        </TouchableOpacity>

        {/* Animated pulse circle */}
        <View style={styles.animContainer}>
          {/* Outer glow ring */}
          <Animated.View
            style={[
              styles.outerRing,
              {
                borderColor: colors.accent,
                transform: [{ scale: pulseScale }],
                opacity: pulseOpacity,
              },
            ]}
          />
          {/* Inner filled circle */}
          <View style={[styles.innerCircle, { backgroundColor: colors.accent }]}>
            <Text style={styles.logoText}>O</Text>
          </View>
        </View>

        {/* Text block */}
        <View style={[styles.textBlock, { paddingHorizontal: spacing.xl }]}>
          <Text
            style={[
              styles.headline,
              {
                color: '#FFFFFF',
                fontFamily: typography.display.fontFamily,
                fontSize: 38,
                lineHeight: 46,
              },
            ]}
          >
            {'Your content.\nOrganised.\nRevisited.'}
          </Text>
          <Text
            style={[
              {
                color: 'rgba(255,255,255,0.7)',
                ...typography.body,
                marginTop: spacing.md,
              },
            ]}
          >
            Save anything from the web. AI sorts it into categories. Your library, always at hand.
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
            accessibilityLabel="Get Started"
            accessibilityRole="button"
          >
            <Text style={[{ color: '#FFFFFF', ...typography.button }]}>Get Started</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const CIRCLE_SIZE = 160;

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
  animContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerRing: {
    position: 'absolute',
    width: CIRCLE_SIZE + 48,
    height: CIRCLE_SIZE + 48,
    borderRadius: (CIRCLE_SIZE + 48) / 2,
    borderWidth: 3,
  },
  innerCircle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 72,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 80,
  },
  textBlock: { marginBottom: 32 },
  headline: { fontWeight: '700' },
  ctaContainer: {},
  ctaBtn: {
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
