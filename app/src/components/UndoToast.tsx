/**
 * UndoToast — bottom toast shown after Done / Skip / Delete single actions.
 *
 * PRD §3.3.6:
 *   • '[Action] — Undo'  e.g. 'Marked as Done — Undo'
 *   • 5-second auto-dismiss with a visible progress bar shrinking full → zero.
 *   • Tapping 'Undo' reverses the action.
 *   • Only one toast active at a time (new action replaces previous).
 *   • NOT shown for bulk actions.
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeContext';

const AUTO_DISMISS_MS = 5_000;

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface UndoToastProps {
  label: string;
  onUndo: () => void;
  onDismiss: () => void;
  /** Re-key this when a new toast should replace the current one */
  entryId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function UndoToast({
  label,
  onUndo,
  onDismiss,
  entryId,
}: UndoToastProps): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { borderRadius, spacing } = theme;
  const insets = useSafeAreaInsets();
  // Sit above the tab bar (52px icon area) + system nav bar inset
  const toastBottom = 52 + insets.bottom + spacing.sm;

  const progressAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Reset on new entry
    progressAnim.setValue(1);
    opacityAnim.setValue(0);

    // Fade in
    Animated.timing(opacityAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: false,
    }).start();

    // Progress bar countdown
    const countdown = Animated.timing(progressAnim, {
      toValue: 0,
      duration: AUTO_DISMISS_MS,
      useNativeDriver: false,
    });

    countdown.start(({ finished }) => {
      if (finished) {
        // Fade out then dismiss
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 180,
          useNativeDriver: false,
        }).start(() => onDismiss());
      }
    });

    return () => {
      countdown.stop();
    };
    // entryId is the dependency that resets the toast
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: colors.primary,
          borderRadius: borderRadius.md,
          marginHorizontal: spacing.md,
          opacity: opacityAnim,
          bottom: toastBottom,
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={[styles.content, { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 }]}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <TouchableOpacity
          onPress={onUndo}
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
          accessibilityLabel="Undo action"
          accessibilityRole="button"
        >
          <Text style={[styles.undoText, { color: colors.accent }]}>Undo</Text>
        </TouchableOpacity>
      </View>

      {/* Shrinking progress bar */}
      <View style={[styles.progressTrack, { backgroundColor: colors.accent + '30' }]}>
        <Animated.View
          style={[
            styles.progressBar,
            { backgroundColor: colors.accent, width: progressWidth },
          ]}
        />
      </View>
    </Animated.View>
  );
}

export default UndoToast;

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    // bottom is set dynamically via useSafeAreaInsets() — see component above
    left: 0,
    right: 0,
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: 12,
  },
  undoText: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  progressTrack: {
    height: 3,
    width: '100%',
  },
  progressBar: {
    height: 3,
  },
});
