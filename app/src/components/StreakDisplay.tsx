/**
 * StreakDisplay — PRD §3.4.4
 *
 * Flame emoji counter displayed in the Library header.
 * Reads streak count from subscriptionStore.
 * Shows nothing if streak is 0 (no visual when cold).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeContext';
import { useSubscriptionStore } from '../store/subscriptionStore';

interface StreakDisplayProps {
  /** Override the streak value — if not provided, reads from store */
  count?: number;
  /** Compact mode for use in tight header areas */
  compact?: boolean;
}

export default function StreakDisplay({ count, compact }: StreakDisplayProps): React.JSX.Element | null {
  const storeCount = useSubscriptionStore((s) => s.streakCount);
  const { colors, theme } = useTheme();

  const displayCount = count ?? storeCount;
  if (displayCount <= 0) return null;

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <Text style={[styles.flame, compact && styles.flameCompact]}>🔥</Text>
      <Text
        style={[
          styles.count,
          compact && styles.countCompact,
          { color: colors.accent },
        ]}
      >
        {displayCount}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  containerCompact: {
    gap: 2,
  },
  flame: {
    fontSize: 20,
  },
  flameCompact: {
    fontSize: 16,
  },
  count: {
    fontSize: 18,
    fontWeight: '800',
  },
  countCompact: {
    fontSize: 15,
  },
});
