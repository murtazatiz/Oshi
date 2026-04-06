/**
 * SortPicker — bottom-sheet-style modal for choosing sort order.
 *
 * PRD §3.3.7:
 *   AI Recommended (default) | Most Recent | Oldest First
 *   | Shortest First | Manual
 *
 * Selected preference is persisted per category via savesStore.setSortOption
 * which writes to AsyncStorage (key: oshi_sort_[category_id]).
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTheme } from '../theme/ThemeContext';
import type { SortOption } from '../store/savesStore';

// ─────────────────────────────────────────────────────────────────────────────
// Sort options metadata
// ─────────────────────────────────────────────────────────────────────────────

interface SortMeta {
  value: SortOption;
  label: string;
  icon: string;
}

const SORT_OPTIONS: SortMeta[] = [
  { value: 'ai_recommended', label: 'AI Recommended', icon: '✨' },
  { value: 'recent',         label: 'Most Recent',    icon: '🕐' },
  { value: 'oldest',         label: 'Oldest First',   icon: '📅' },
  { value: 'shortest',       label: 'Shortest First', icon: '⚡' },
  { value: 'manual',         label: 'Manual Order',   icon: '↕️' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface SortPickerProps {
  visible: boolean;
  currentSort: SortOption;
  onSelect: (option: SortOption) => void;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function SortPicker({
  visible,
  currentSort,
  onSelect,
  onClose,
}: SortPickerProps): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { borderRadius, spacing } = theme;

  const slideAnim = useRef(new Animated.Value(300)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible ? 0 : 300,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [visible, slideAnim]);

  function handleSelect(option: SortOption): void {
    onSelect(option);
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Scrim */}
      <Pressable style={styles.overlay} onPress={onClose}>
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
          {/* Handle bar */}
          <View style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
          </View>

          <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>
            Sort by
          </Text>

          {SORT_OPTIONS.map((opt) => {
            const isActive = opt.value === currentSort;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.optionRow,
                  {
                    backgroundColor: isActive ? colors.accent + '12' : 'transparent',
                    borderRadius: borderRadius.sm,
                    paddingVertical: spacing.sm + 4,
                    paddingHorizontal: spacing.md,
                  },
                ]}
                onPress={() => handleSelect(opt.value)}
                activeOpacity={0.65}
                accessibilityRole="radio"
                accessibilityState={{ checked: isActive }}
              >
                <Text style={styles.optionIcon}>{opt.icon}</Text>
                <Text
                  style={[
                    styles.optionLabel,
                    { color: isActive ? colors.accent : colors.textPrimary },
                  ]}
                >
                  {opt.label}
                </Text>
                {isActive && (
                  <Text style={[styles.checkmark, { color: colors.accent }]}>✓</Text>
                )}
              </TouchableOpacity>
            );
          })}

          <View style={{ height: spacing.xl }} />
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

export default SortPicker;

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    paddingTop: 8,
  },
  handleRow: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
    gap: 12,
  },
  optionIcon: {
    fontSize: 18,
  },
  optionLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  checkmark: {
    fontSize: 18,
    fontWeight: '700',
  },
});
