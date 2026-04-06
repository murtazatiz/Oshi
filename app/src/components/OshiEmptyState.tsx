/**
 * OshiEmptyState — shown when a category or the whole library has no saves.
 *
 * PRD §3.3.2 requirements:
 *
 * 'global' type (new user, no saves at all):
 *   • Animated phone-inbox illustration (Animated.View, since lottie-react-native
 *     is incompatible with Expo Go and has been removed).
 *   • Headline: 'Your saved content will appear here'
 *   • Subtext:  'Go to Instagram or YouTube, find something you love, tap Share,
 *               and choose Oshi.'
 *   • CTA: 'How to Save Your First Item' → 3-step bottom sheet tutorial.
 *
 * 'category' type (category exists but has no saves):
 *   • Large category emoji illustration.
 *   • Headline: 'Nothing in [categoryName] yet'
 *   • Subtext: category-specific tip.
 *   • No CTA (PRD: "keep it minimal").
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeContext';

// ─────────────────────────────────────────────────────────────────────────────
// Category metadata — emoji + saving tip per category
// ─────────────────────────────────────────────────────────────────────────────
interface CategoryMeta {
  emoji: string;
  tip: string;
}

const CATEGORY_META: Record<string, CategoryMeta> = {
  // Standard Oshi categories (§3.2.1 AI prompt)
  learning: {
    emoji: '🎓',
    tip: 'Drop articles, courses, and educational videos here. Your personal knowledge base, always growing.',
  },
  business: {
    emoji: '💼',
    tip: 'Save business tips, startup advice, productivity hacks, and money content here.',
  },
  travel: {
    emoji: '✈️',
    tip: 'Save destination guides, bucket-list places, and travel tips you want to revisit.',
  },
  food: {
    emoji: '🍜',
    tip: 'Recipes, restaurant finds, and foodie videos — save them before you forget.',
  },
  fitness: {
    emoji: '💪',
    tip: 'Workouts, nutrition guides, and wellness content. Your health, saved in one place.',
  },
  entertainment: {
    emoji: '🎬',
    tip: 'Shows, movies, podcasts, and games on your radar — save them here to watch later.',
  },
  shopping: {
    emoji: '🛍️',
    tip: 'Products you\'re eyeing, gift ideas, and deals worth remembering.',
  },
  inspiration: {
    emoji: '✨',
    tip: 'Quotes, stories, and content that moves you. Your personal mood board.',
  },
  tech: {
    emoji: '💻',
    tip: 'Tools, tutorials, tech news, and deep dives. Stay sharp on what\'s new.',
  },
  people: {
    emoji: '👥',
    tip: 'Creators, profiles, and people worth following. Keep tabs on who inspires you.',
  },
  other: {
    emoji: '📦',
    tip: 'Everything that doesn\'t fit neatly elsewhere — Oshi keeps it safe.',
  },
};

function getCategoryMeta(categoryName: string): CategoryMeta {
  const key = categoryName.toLowerCase().trim();
  return (
    CATEGORY_META[key] ?? {
      emoji: '📌',
      tip: `Save anything related to ${categoryName} here. Oshi will organise it automatically.`,
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Animated phone-inbox illustration (replaces Lottie per §3.3.2)
//
// Visual: a phone frame with an inbox slot at the bottom, and a small
// document arrow that flies downward into the inbox slot in a 2-second loop.
// ─────────────────────────────────────────────────────────────────────────────
function PhoneInboxIllustration({ accent }: { accent: string }): React.JSX.Element {
  const arrowY = useRef(new Animated.Value(0)).current;
  const arrowOpacity = useRef(new Animated.Value(0)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Arrow: fade in from above → enter inbox → fade out → reset
    const arrowLoop = Animated.loop(
      Animated.sequence([
        // Appear above inbox
        Animated.parallel([
          Animated.timing(arrowOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(arrowY, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
        // Drop into inbox
        Animated.timing(arrowY, { toValue: 44, duration: 700, useNativeDriver: true }),
        // Fade out as it enters
        Animated.timing(arrowOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
        // Hold at bottom
        Animated.delay(600),
        // Reset position silently
        Animated.timing(arrowY, { toValue: 0, duration: 0, useNativeDriver: true }),
        // Hold before next cycle
        Animated.delay(250),
      ]),
    );

    // Phone: gentle pulse
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseScale, { toValue: 1.04, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseScale, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );

    arrowLoop.start();
    pulseLoop.start();

    return () => {
      arrowLoop.stop();
      pulseLoop.stop();
    };
  }, [arrowY, arrowOpacity, pulseScale]);

  return (
    <View style={styles.illustrationContainer}>
      {/* Phone frame */}
      <Animated.View
        style={[
          styles.phone,
          { borderColor: accent, transform: [{ scale: pulseScale }] },
        ]}
      >
        {/* Screen area */}
        <View style={styles.phoneScreen}>
          {/* Inbox icon on screen */}
          <Text style={styles.inboxEmoji}>📥</Text>

          {/* Animated arrow dropping into the inbox */}
          <Animated.View
            style={[
              styles.arrowContainer,
              {
                opacity: arrowOpacity,
                transform: [{ translateY: arrowY }],
              },
            ]}
          >
            <View style={[styles.arrowBody, { backgroundColor: accent }]} />
            <View style={[styles.arrowHead, { borderTopColor: accent }]} />
            <View style={[styles.docEmoji]}>
              <Text style={{ fontSize: 14 }}>📄</Text>
            </View>
          </Animated.View>
        </View>

        {/* Phone home indicator */}
        <View style={[styles.homeIndicator, { backgroundColor: accent }]} />
      </Animated.View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3-step tutorial bottom sheet (modal)
// ─────────────────────────────────────────────────────────────────────────────
const TUTORIAL_STEPS = [
  {
    icon: '📱',
    title: 'Open any app',
    body: 'Browse Instagram, YouTube, Safari, or any app and find something worth saving.',
  },
  {
    icon: '⬆️',
    title: 'Tap the Share button',
    body: "Tap the share icon — the square with an upward arrow — and scroll to find Oshi.",
  },
  {
    icon: '✅',
    title: 'Oshi saves and organises',
    body: 'Oshi adds it to your library and uses AI to categorise it automatically.',
  },
] as const;

interface TutorialSheetProps {
  visible: boolean;
  onClose: () => void;
}

function TutorialSheet({ visible, onClose }: TutorialSheetProps): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { typography, spacing, borderRadius } = theme;
  const slideAnim = useRef(new Animated.Value(400)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 400,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Scrim */}
      <Pressable style={styles.scrim} onPress={onClose} />

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface,
            borderTopLeftRadius: borderRadius.lg,
            borderTopRightRadius: borderRadius.lg,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        <SafeAreaView edges={['bottom']}>
          {/* Handle */}
          <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />

          <Text
            style={[
              styles.sheetTitle,
              {
                color: colors.textPrimary,
                fontFamily: typography.heading1.fontFamily,
                fontSize: typography.heading1.fontSize,
                padding: spacing.lg,
                paddingBottom: spacing.md,
              },
            ]}
          >
            How to save your first item
          </Text>

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
            showsVerticalScrollIndicator={false}
          >
            {TUTORIAL_STEPS.map((step, idx) => (
              <View
                key={step.title}
                style={[
                  styles.tutorialStep,
                  { marginBottom: idx < TUTORIAL_STEPS.length - 1 ? spacing.lg : 0 },
                ]}
              >
                {/* Step number + connector line */}
                <View style={styles.stepLeft}>
                  <View style={[styles.stepBadge, { backgroundColor: colors.accent }]}>
                    <Text style={[{ color: '#FFFFFF', ...typography.button, fontSize: 14 }]}>
                      {idx + 1}
                    </Text>
                  </View>
                  {idx < TUTORIAL_STEPS.length - 1 && (
                    <View style={[styles.connector, { backgroundColor: colors.border }]} />
                  )}
                </View>

                <View style={[styles.stepContent, { paddingLeft: spacing.md }]}>
                  <Text style={{ fontSize: 36, marginBottom: 6 }}>{step.icon}</Text>
                  <Text
                    style={[
                      { color: colors.textPrimary, ...typography.heading2, marginBottom: 4 },
                    ]}
                  >
                    {step.title}
                  </Text>
                  <Text style={[{ color: colors.textSecondary, ...typography.body }]}>
                    {step.body}
                  </Text>
                </View>
              </View>
            ))}

            {/* Close CTA */}
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.85}
              style={[
                styles.closeBtn,
                {
                  backgroundColor: colors.accent,
                  borderRadius: borderRadius.pill,
                  marginTop: spacing.xl,
                },
              ]}
              accessibilityLabel="Got it"
              accessibilityRole="button"
            >
              <Text style={[{ color: '#FFFFFF', ...typography.button }]}>Got it</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OshiEmptyState — public component
// ─────────────────────────────────────────────────────────────────────────────
export interface OshiEmptyStateProps {
  /** 'global' = no saves anywhere; 'category' = this category is empty */
  type: 'global' | 'category';
  /** Required when type = 'category' */
  categoryName?: string;
}

export function OshiEmptyState({ type, categoryName }: OshiEmptyStateProps): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { typography, spacing, borderRadius } = theme;
  const [tutorialVisible, setTutorialVisible] = useState(false);

  if (type === 'global') {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <PhoneInboxIllustration accent={colors.accent} />

        <Text
          style={[
            styles.headline,
            {
              color: colors.textPrimary,
              fontFamily: typography.display.fontFamily,
              fontSize: 24,
              lineHeight: 32,
              fontWeight: '700',
              textAlign: 'center',
              marginBottom: spacing.sm,
              paddingHorizontal: spacing.xl,
            },
          ]}
        >
          Your saved content will appear here
        </Text>

        <Text
          style={[
            {
              color: colors.textSecondary,
              ...typography.body,
              textAlign: 'center',
              lineHeight: 26,
              paddingHorizontal: spacing.xl,
              marginBottom: spacing.xl,
            },
          ]}
        >
          Go to Instagram or YouTube, find something you love, tap Share, and choose Oshi.
        </Text>

        <TouchableOpacity
          onPress={() => setTutorialVisible(true)}
          activeOpacity={0.85}
          style={[
            styles.ctaBtn,
            {
              backgroundColor: colors.accent,
              borderRadius: borderRadius.pill,
              marginHorizontal: spacing.xl,
            },
          ]}
          accessibilityLabel="How to Save Your First Item"
          accessibilityRole="button"
        >
          <Text style={[{ color: '#FFFFFF', ...typography.button }]}>
            How to Save Your First Item
          </Text>
        </TouchableOpacity>

        <TutorialSheet
          visible={tutorialVisible}
          onClose={() => setTutorialVisible(false)}
        />
      </View>
    );
  }

  // ── Category empty state ──────────────────────────────────────────────────
  const name = categoryName ?? 'this category';
  const meta = getCategoryMeta(name);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Text style={styles.categoryEmoji}>{meta.emoji}</Text>

      <Text
        style={[
          styles.headline,
          {
            color: colors.textPrimary,
            fontFamily: typography.display.fontFamily,
            fontSize: 22,
            lineHeight: 30,
            fontWeight: '700',
            textAlign: 'center',
            marginBottom: spacing.sm,
            paddingHorizontal: spacing.xl,
          },
        ]}
      >
        Nothing in {name} yet
      </Text>

      <Text
        style={[
          {
            color: colors.textSecondary,
            ...typography.body,
            textAlign: 'center',
            lineHeight: 26,
            paddingHorizontal: spacing.xl,
          },
        ]}
      >
        {meta.tip}
      </Text>
    </View>
  );
}

export default OshiEmptyState;

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },

  // Phone illustration
  illustrationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
    height: 200,
  },
  phone: {
    width: 110,
    height: 185,
    borderRadius: 20,
    borderWidth: 3,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  phoneScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  inboxEmoji: {
    fontSize: 44,
  },
  arrowContainer: {
    position: 'absolute',
    top: 4,
    alignItems: 'center',
  },
  arrowBody: {
    width: 3,
    height: 18,
    borderRadius: 2,
  },
  arrowHead: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
  },
  docEmoji: {
    marginTop: 4,
  },
  homeIndicator: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
    opacity: 0.6,
  },

  // Category
  categoryEmoji: {
    fontSize: 80,
    marginBottom: 20,
    textAlign: 'center',
  },

  headline: {},

  // CTA
  ctaBtn: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    minHeight: 44,
  },

  // Tutorial sheet
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '85%',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
      },
      android: { elevation: 16 },
    }),
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: 12,
    marginBottom: 0,
  },
  sheetTitle: {
    fontWeight: '700',
  },
  tutorialStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepLeft: {
    alignItems: 'center',
    width: 36,
  },
  stepBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: {
    width: 2,
    flex: 1,
    marginTop: 6,
    minHeight: 40,
    borderRadius: 1,
  },
  stepContent: {
    flex: 1,
    paddingBottom: 16,
  },
  closeBtn: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
});
