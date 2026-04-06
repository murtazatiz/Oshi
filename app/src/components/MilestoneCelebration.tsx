/**
 * MilestoneCelebration — PRD §3.4.4
 *
 * Full-screen confetti animation (react-native-confetti-cannon) +
 * NotificationFeedbackType.Success haptic + in-app badge modal.
 *
 * Milestones: 3, 7, 14, 30, 60, 100 days.
 *
 * Reads `activeMilestone` from subscriptionStore. When non-null, the
 * overlay is shown. Dismissed by tapping "Continue" or auto-dismiss
 * after 5 seconds.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ConfettiCannon from 'react-native-confetti-cannon';

import { useTheme } from '../theme/ThemeContext';
import { useSubscriptionStore } from '../store/subscriptionStore';
import analytics from '../services/analytics';

// ─────────────────────────────────────────────────────────────────────────────
// Milestone copy
// ─────────────────────────────────────────────────────────────────────────────

const MILESTONE_COPY: Record<number, { badge: string; title: string; subtitle: string }> = {
  3:   { badge: '🥉', title: '3-Day Streak!',   subtitle: "You're building a habit — keep going!" },
  7:   { badge: '🥈', title: '7-Day Streak!',   subtitle: 'A full week of intentional content!' },
  14:  { badge: '🥇', title: '14-Day Streak!',  subtitle: 'Two weeks strong — impressive!' },
  30:  { badge: '🏆', title: '30-Day Streak!',  subtitle: "One month of consistency — you're unstoppable!" },
  60:  { badge: '💎', title: '60-Day Streak!',  subtitle: 'Two months — content mastery unlocked!' },
  100: { badge: '👑', title: '100-Day Streak!', subtitle: 'Legendary! You are a true Oshi.' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function MilestoneCelebration(): React.JSX.Element | null {
  const activeMilestone = useSubscriptionStore((s) => s.activeMilestone);
  const clearMilestone = useSubscriptionStore((s) => s.clearMilestone);
  const { colors, theme } = useTheme();
  const { borderRadius } = theme;

  const confettiRef = useRef<ConfettiCannon | null>(null);

  // Auto-dismiss after 5 seconds
  useEffect(() => {
    if (activeMilestone === null) return;
    const timer = setTimeout(clearMilestone, 5000);
    return () => clearTimeout(timer);
  }, [activeMilestone, clearMilestone]);

  // Trigger confetti + analytics when milestone appears
  useEffect(() => {
    if (activeMilestone !== null) {
      confettiRef.current?.start();
      analytics.streakMilestoneReached(activeMilestone);
    }
  }, [activeMilestone]);

  if (activeMilestone === null) return null;

  const copy = MILESTONE_COPY[activeMilestone] ?? {
    badge: '⭐',
    title: `${activeMilestone}-Day Streak!`,
    subtitle: 'Amazing progress!',
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        {/* Confetti cannon */}
        <ConfettiCannon
          ref={confettiRef}
          count={120}
          origin={{ x: -10, y: 0 }}
          autoStart
          fadeOut
          fallSpeed={3000}
          explosionSpeed={350}
        />

        {/* Milestone card */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderRadius: borderRadius.lg }]}>
          <Text style={styles.badge}>{copy.badge}</Text>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{copy.title}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{copy.subtitle}</Text>

          <View style={styles.streakRow}>
            <Text style={styles.streakFlame}>🔥</Text>
            <Text style={[styles.streakNumber, { color: colors.accent }]}>
              {activeMilestone}
            </Text>
            <Text style={[styles.streakLabel, { color: colors.textMuted }]}>
              day streak
            </Text>
          </View>

          <TouchableOpacity
            onPress={clearMilestone}
            style={[styles.ctaBtn, { backgroundColor: colors.accent, borderRadius: borderRadius.sm }]}
            activeOpacity={0.8}
          >
            <Text style={styles.ctaBtnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    padding: 32,
    alignItems: 'center',
    gap: 8,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  badge: { fontSize: 56, marginBottom: 4 },
  title: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 12 },

  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  streakFlame: { fontSize: 28 },
  streakNumber: { fontSize: 36, fontWeight: '900' },
  streakLabel: { fontSize: 16 },

  ctaBtn: { width: '100%', height: 50, alignItems: 'center', justifyContent: 'center' },
  ctaBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
});
