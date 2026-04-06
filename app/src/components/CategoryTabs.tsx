/**
 * CategoryTabs — horizontal scrollable category tab bar.
 *
 * PRD §3.3: "All" tab first, each tab shows unread count badge.
 * Active tab uses accent colour. The bar must not conflict with
 * card swipe gestures (list view).
 */
import React, { useCallback, useRef } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTheme } from '../theme/ThemeContext';
import type { CategoryData } from '../store/savesStore';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CategoryTabsProps {
  categories: CategoryData[];
  activeCategoryId: string | null;
  onSelect: (categoryId: string | null) => void;
}

interface TabItem {
  id: string | null;
  name: string;
  unreadCount: number;
  totalCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function CategoryTabs({
  categories,
  activeCategoryId,
  onSelect,
}: CategoryTabsProps): React.JSX.Element {
  const { colors, theme } = useTheme();
  const { borderRadius, spacing } = theme;
  const listRef = useRef<FlatList<TabItem>>(null);

  const allUnread = categories.reduce((sum, c) => sum + c.unread_count, 0);
  const allTotal = categories.reduce((sum, c) => sum + c.total_count, 0);

  const tabs: TabItem[] = [
    { id: null, name: 'All', unreadCount: allUnread, totalCount: allTotal },
    ...categories.map((c) => ({
      id: c.id,
      name: c.name,
      unreadCount: c.unread_count,
      totalCount: c.total_count,
    })),
  ];

  const renderTab = useCallback(
    ({ item }: { item: TabItem }) => {
      const isActive = item.id === activeCategoryId;

      return (
        <TouchableOpacity
          onPress={() => onSelect(item.id)}
          style={[
            styles.tab,
            {
              backgroundColor: isActive ? colors.accent : colors.surface,
              borderColor: isActive ? colors.accent : colors.border,
              borderRadius: borderRadius.pill,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
            },
          ]}
          activeOpacity={0.7}
          accessibilityRole="tab"
          accessibilityState={{ selected: isActive }}
          accessibilityLabel={
            item.totalCount > 0
              ? `${item.name} category, ${item.unreadCount} unread of ${item.totalCount} total`
              : `${item.name} category`
          }
        >
          <Text
            style={[
              styles.tabLabel,
              { color: isActive ? '#FFFFFF' : colors.textPrimary },
            ]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          {item.totalCount > 0 && (
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: isActive ? '#FFFFFF' : colors.accent,
                  borderRadius: borderRadius.pill,
                },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  { color: isActive ? colors.accent : '#FFFFFF' },
                ]}
              >
                {item.totalCount > 99 ? '99+' : item.totalCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [activeCategoryId, colors, borderRadius, spacing, onSelect],
  );

  const keyExtractor = useCallback((item: TabItem) => item.id ?? 'all', []);

  return (
    <View style={[styles.container, { borderBottomColor: colors.border }]}>
      <FlatList<TabItem>
        ref={listRef}
        data={tabs}
        renderItem={renderTab}
        keyExtractor={keyExtractor}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.list, { paddingHorizontal: spacing.md }]}
        ItemSeparatorComponent={() => <View style={{ width: spacing.sm }} />}
      />
    </View>
  );
}

export default CategoryTabs;

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  list: {
    alignItems: 'center',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    gap: 6,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  badge: {
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
