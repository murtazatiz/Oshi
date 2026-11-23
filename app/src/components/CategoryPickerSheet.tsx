/**
 * CategoryPickerSheet — the one bottom sheet for choosing a category.
 *
 * Used by the Library (single "Edit Category" and bulk "Move to Category"),
 * Content Detail ("Change Category"), and the share handler. Each previously
 * carried its own copy; two of them rendered every category in a plain
 * column with no scrolling, which ran off-screen with the 11 defaults plus
 * custom categories.
 *
 * Selecting a row calls onSelect, then onClose.
 */
import React, { useCallback } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../theme/ThemeContext';

export interface CategoryOption {
  id: string;
  name: string;
  emoji?: string | null;
}

interface CategoryPickerSheetProps {
  visible: boolean;
  title: string;
  categories: CategoryOption[];
  onSelect: (category: CategoryOption) => void;
  onClose: () => void;
}

export function CategoryPickerSheet({
  visible,
  title,
  categories,
  onSelect,
  onClose,
}: CategoryPickerSheetProps): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { spacing, borderRadius } = theme;

  const renderItem = useCallback(
    ({ item }: { item: CategoryOption }) => (
      <TouchableOpacity
        style={[styles.row, { paddingVertical: spacing.sm + 4, paddingHorizontal: spacing.md }]}
        onPress={() => {
          onSelect(item);
          onClose();
        }}
        activeOpacity={0.65}
        accessibilityRole="button"
        accessibilityLabel={item.name}
      >
        <Text style={styles.emoji}>{item.emoji ?? '📌'}</Text>
        <Text style={[styles.name, { color: colors.textPrimary }]}>{item.name}</Text>
      </TouchableOpacity>
    ),
    [onSelect, onClose, colors.textPrimary, spacing],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: borderRadius.lg,
              borderTopRightRadius: borderRadius.lg,
            },
          ]}
        >
          <View style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
          </View>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
          <FlatList
            data={categories}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            style={styles.list}
            removeClippedSubviews
            windowSize={5}
          />
          <View style={{ height: spacing.xl }} />
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { paddingTop: 8 },
  handleRow: { alignItems: 'center', paddingBottom: 8 },
  handle: { width: 36, height: 4, borderRadius: 2 },
  title: { fontSize: 18, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 12 },
  list: { maxHeight: 420 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  emoji: { fontSize: 20 },
  name: { fontSize: 16, fontWeight: '500' },
});
