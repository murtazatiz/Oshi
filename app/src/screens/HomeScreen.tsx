/**
 * HomeScreen — the Library.
 *
 * PRD §3.3 — complete implementation:
 *   1.  Category tabs (horizontal scroll, unread badges, accent active)
 *   2.  Search bar (debounced 300ms, highlights matches)
 *   3.  Sort picker (per-category, AsyncStorage-persisted)
 *   4.  Grid/List view toggle
 *   5.  Skeleton loading / empty states
 *   6.  Swipe gestures (list only): right = Done, left = Delete
 *   7.  Long-press multi-select (500ms), action bar, bulk actions
 *   8.  Undo toast (5s, progress bar, reversal)
 *   9.  Supabase Realtime subscription (saves table)
 *  10.  Day-3 notification re-ask modal
 *  11.  Trial expiry banner
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated as RNAnimated,
  AppState,
  Dimensions,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type AppStateStatus,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ParamListBase } from '@react-navigation/native';

import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import { useAuthStore } from '../store/authStore';
import {
  useSavesStore,
  useSaves,
  useCategories,
  useSavesLoading,
  useSavesUI,
  useMultiSelect,
  useSavesActions,
} from '../store/savesStore';
import type { SaveData, MenuAction } from '../components/OshiCard';
import { apiClient } from '../services/apiClient';
import { OshiCard } from '../components/OshiCard';
import { OshiSkeletonList } from '../components/OshiSkeletonCard';
import { OshiEmptyState } from '../components/OshiEmptyState';
import { CategoryTabs } from '../components/CategoryTabs';
import { SortPicker } from '../components/SortPicker';
import { UndoToast } from '../components/UndoToast';
import type { MainStackParamList } from '../navigation/types';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SCREEN_WIDTH = Dimensions.get('window').width;
const SWIPE_DONE_THRESHOLD = 160;
const SWIPE_DELETE_THRESHOLD = 160;
const SWIPE_REVEAL_THRESHOLD = 80;
const SEARCH_DEBOUNCE_MS = 300;
const LONG_PRESS_MS = 500;
const REASK_DELAY_MS = 2_000;

const PLATFORM_CHIPS: { value: string; label: string }[] = [
  { value: 'youtube', label: 'YouTube' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'web', label: 'Web' },
];
const STATUS_CHIPS: { value: string; label: string }[] = [
  { value: 'unread', label: 'Unread' },
  { value: 'done', label: 'Done' },
  { value: 'skipped', label: 'Skipped' },
];

type NavProp = NativeStackNavigationProp<MainStackParamList & ParamListBase>;

// ─────────────────────────────────────────────────────────────────────────────
// SwipeableCard — wraps OshiCard in list mode with swipe gestures (PRD §3.3.4)
// ─────────────────────────────────────────────────────────────────────────────

interface SwipeableCardProps {
  save: SaveData;
  viewMode: 'grid' | 'list';
  onPress: (save: SaveData) => void;
  onMarkDone: (save: SaveData) => void;
  onRetry: (save: SaveData) => void;
  onMenuAction: (save: SaveData, action: MenuAction) => void;
  onSwipeDone: (save: SaveData) => void;
  onSwipeDelete: (save: SaveData) => void;
  onLongPress: (save: SaveData) => void;
  isSelected: boolean;
  isMultiSelectActive: boolean;
  onToggleSelect: (save: SaveData) => void;
}

function SwipeableCard({
  save,
  viewMode,
  onPress,
  onMarkDone,
  onRetry,
  onMenuAction,
  onSwipeDone,
  onSwipeDelete,
  onLongPress,
  isSelected,
  isMultiSelectActive,
  onToggleSelect,
}: SwipeableCardProps): React.JSX.Element {
  const { colors } = useTheme();
  const translateX = useRef(new RNAnimated.Value(0)).current;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isList = viewMode === 'list';

  // Swipe gestures — list mode only
  const panGesture = Gesture.Pan()
    .enabled(isList && !isMultiSelectActive)
    .activeOffsetX([-20, 20])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      translateX.setValue(e.translationX);
    })
    .onEnd((e) => {
      const tx = e.translationX;

      if (tx > SWIPE_DONE_THRESHOLD) {
        RNAnimated.timing(translateX, {
          toValue: SCREEN_WIDTH,
          duration: 200,
          useNativeDriver: true,
        }).start(() => {
          translateX.setValue(0);
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onSwipeDone(save);
        });
        return;
      }

      if (tx < -SWIPE_DELETE_THRESHOLD) {
        RNAnimated.timing(translateX, {
          toValue: -SCREEN_WIDTH,
          duration: 200,
          useNativeDriver: true,
        }).start(() => {
          translateX.setValue(0);
          onSwipeDelete(save);
        });
        return;
      }

      // Spring back
      RNAnimated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 8,
      }).start();
    });

  // Long press for multi-select
  function handlePressIn(): void {
    longPressTimer.current = setTimeout(() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      onLongPress(save);
    }, LONG_PRESS_MS);
  }

  function handlePressOut(): void {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  const doneRevealOpacity = translateX.interpolate({
    inputRange: [0, SWIPE_REVEAL_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const deleteRevealOpacity = translateX.interpolate({
    inputRange: [-SWIPE_REVEAL_THRESHOLD, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.swipeWrapper}>
      {/* Swipe reveal backgrounds — list only */}
      {isList && (
        <>
          <RNAnimated.View
            style={[
              styles.swipeBg,
              styles.swipeBgLeft,
              { backgroundColor: colors.success, opacity: doneRevealOpacity },
            ]}
          >
            <Text style={styles.swipeIcon}>✓</Text>
            <Text style={styles.swipeLabel}>Done</Text>
          </RNAnimated.View>
          <RNAnimated.View
            style={[
              styles.swipeBg,
              styles.swipeBgRight,
              { backgroundColor: colors.error, opacity: deleteRevealOpacity },
            ]}
          >
            <Text style={styles.swipeLabel}>Delete</Text>
            <Text style={styles.swipeIcon}>🗑</Text>
          </RNAnimated.View>
        </>
      )}

      <GestureDetector gesture={panGesture}>
        <RNAnimated.View
          style={isList ? { transform: [{ translateX }] } : undefined}
          onTouchStart={handlePressIn}
          onTouchEnd={handlePressOut}
          onTouchCancel={handlePressOut}
        >
          <OshiCard
            save={save}
            viewMode={viewMode}
            onPress={onPress}
            onMarkDone={onMarkDone}
            onRetry={onRetry}
            onMenuAction={onMenuAction}
            isSelected={isSelected}
            isMultiSelectActive={isMultiSelectActive}
            onToggleSelect={onToggleSelect}
          />
        </RNAnimated.View>
      </GestureDetector>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MultiSelectBar — action bar shown during multi-select (PRD §3.3.5)
// ─────────────────────────────────────────────────────────────────────────────

interface MultiSelectBarProps {
  selectedCount: number;
  onDone: () => void;
  onSkip: () => void;
  onMoveCategory: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onClose: () => void;
}

function MultiSelectBar({
  selectedCount,
  onDone,
  onSkip,
  onMoveCategory,
  onDelete,
  onSelectAll,
  onClose,
}: MultiSelectBarProps): React.JSX.Element {
  const { colors, theme } = useTheme();
  return (
    <View style={[styles.multiBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <View style={styles.multiBarLeft}>
        <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityLabel="Exit multi-select">
          <Text style={[styles.multiBarIcon, { color: colors.textPrimary }]}>✕</Text>
        </TouchableOpacity>
        <Text style={[styles.multiBarCount, { color: colors.textPrimary }]}>
          {selectedCount} Selected
        </Text>
      </View>

      <View style={styles.multiBarActions}>
        <TouchableOpacity onPress={onSelectAll} style={styles.multiBtn} accessibilityLabel="Select all">
          <Text style={[styles.multiBtnText, { color: colors.accent }]}>All</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDone} style={styles.multiBtn} accessibilityLabel="Mark done">
          <Text style={styles.multiBtnEmoji}>✓</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onSkip} style={styles.multiBtn} accessibilityLabel="Skip">
          <Text style={styles.multiBtnEmoji}>⏭</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onMoveCategory} style={styles.multiBtn} accessibilityLabel="Move to category">
          <Text style={styles.multiBtnEmoji}>📁</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} style={styles.multiBtn} accessibilityLabel="Delete">
          <Text style={[styles.multiBtnEmoji, { color: colors.error }]}>🗑</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CategoryPickerSheet — bottom sheet for "Move to Category" bulk action
// ─────────────────────────────────────────────────────────────────────────────

interface CategoryPickerSheetProps {
  visible: boolean;
  categories: { id: string; name: string }[];
  onSelect: (categoryId: string) => void;
  onClose: () => void;
}

function CategoryPickerSheet({
  visible,
  categories,
  onSelect,
  onClose,
}: CategoryPickerSheetProps): React.JSX.Element {
  const { colors, theme } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={[
            styles.pickerSheet,
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: theme.borderRadius.lg,
              borderTopRightRadius: theme.borderRadius.lg,
            },
          ]}
        >
          <View style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
          </View>
          <Text style={[styles.pickerTitle, { color: colors.textPrimary }]}>Move to Category</Text>
          {categories.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              style={[styles.pickerRow, { paddingVertical: theme.spacing.sm + 4, paddingHorizontal: theme.spacing.md }]}
              onPress={() => {
                onSelect(cat.id);
                onClose();
              }}
              activeOpacity={0.65}
            >
              <Text style={[styles.pickerRowText, { color: colors.textPrimary }]}>{cat.name}</Text>
            </TouchableOpacity>
          ))}
          <View style={{ height: theme.spacing.xl }} />
        </View>
      </Pressable>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NotificationReaskModal — day-3 re-request (PRD §3.4.2)
// ─────────────────────────────────────────────────────────────────────────────

interface NotificationReaskModalProps {
  visible: boolean;
  savesCount: number;
  onEnable: () => void;
  onDismiss: () => void;
}

function NotificationReaskModal({
  visible,
  savesCount,
  onEnable,
  onDismiss,
}: NotificationReaskModalProps): React.JSX.Element {
  const { colors, theme } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <View
          style={[
            styles.reaskCard,
            {
              backgroundColor: colors.surface,
              borderRadius: theme.borderRadius.lg,
              marginHorizontal: theme.spacing.lg,
              padding: theme.spacing.lg,
            },
          ]}
        >
          <Text style={[styles.reaskHeadline, { color: colors.textPrimary }]}>
            You've saved {savesCount} things
          </Text>
          <Text style={[styles.reaskBody, { color: colors.textSecondary }]}>
            Want Oshi to remind you to actually watch them? Enable reminders.
          </Text>
          <TouchableOpacity
            style={[styles.reaskBtn, { backgroundColor: colors.accent, borderRadius: theme.borderRadius.sm }]}
            onPress={onEnable}
            activeOpacity={0.7}
          >
            <Text style={styles.reaskBtnText}>Go to Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDismiss} style={styles.reaskDismiss}>
            <Text style={[styles.reaskDismissText, { color: colors.textMuted }]}>Not now</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HomeScreen
// ─────────────────────────────────────────────────────────────────────────────

export default function HomeScreen(): React.JSX.Element {
  const navigation = useNavigation<NavProp>();
  const { colors, theme } = useTheme();
  const { spacing, borderRadius } = theme;
  const userId = useAuthStore((s) => s.user?.id);

  // Store data
  const saves = useSaves();
  const categories = useCategories();
  const { isLoading, isRefreshing } = useSavesLoading();
  const { activeCategoryId, searchQuery, sortOption, viewMode, platformFilter, statusFilter } = useSavesUI();
  const { isMultiSelectActive, selectedIds, selectedCount } = useMultiSelect();
  const undoEntry = useSavesStore((s) => s.undoEntry);
  const notificationReaskDue = useSavesStore((s) => s.notificationReaskDue);
  const trialExpiryBannerDue = useSavesStore((s) => s.trialExpiryBannerDue);
  const trialBannerDismissed = useSavesStore((s) => s.trialBannerDismissed);

  const {
    fetchCategories,
    fetchSaves,
    setActiveCategory,
    setSearchQuery,
    setPlatformFilter,
    setStatusFilter,
    clearAllFilters,
    setSortOption,
    toggleViewMode,
    markDone,
    markSkipped,
    deleteSave,
    retrySave,
    undoAction,
    clearUndo,
    activateMultiSelect,
    deactivateMultiSelect,
    toggleSelect,
    selectAllInCategory,
    bulkMarkDone,
    bulkSkip,
    bulkDelete,
    bulkMoveCategory,
    updateSave,
    checkUserFlags,
    dismissTrialBanner,
    loadSortPreference,
  } = useSavesActions();

  // Local UI state
  const [sortPickerVisible, setSortPickerVisible] = useState(false);
  const [categoryPickerVisible, setCategoryPickerVisible] = useState(false);
  const [saveForCategoryEdit, setSaveForCategoryEdit] = useState<SaveData | null>(null);
  const [reaskModalVisible, setReaskModalVisible] = useState(false);
  const [localSearch, setLocalSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [localPlatformFilter, setLocalPlatformFilter] = useState<string[]>([]);
  const [localStatusFilter, setLocalStatusFilter] = useState<string[]>([]);
  const [isHeaderRefreshing, setIsHeaderRefreshing] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const refreshSpinRef = useRef<RNAnimated.CompositeAnimation | null>(null);
  const refreshRotate = useRef(new RNAnimated.Value(0)).current;

  // ── Refresh spin animation ───────────────────────────────────────────────

  useEffect(() => {
    if (isHeaderRefreshing) {
      refreshRotate.setValue(0);
      const loop = RNAnimated.loop(
        RNAnimated.timing(refreshRotate, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      );
      refreshSpinRef.current = loop;
      loop.start();
      return () => {
        loop.stop();
        refreshSpinRef.current = null;
      };
    } else {
      refreshSpinRef.current?.stop();
      refreshSpinRef.current = null;
      refreshRotate.setValue(0);
    }
  }, [isHeaderRefreshing, refreshRotate]);

  const refreshSpinStyle = {
    transform: [
      {
        rotate: refreshRotate.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '360deg'],
        }),
      },
    ],
  };

  const handleHeaderRefresh = useCallback(async () => {
    if (isHeaderRefreshing) return;
    setIsHeaderRefreshing(true);
    try {
      await Promise.all([fetchCategories(), fetchSaves({ refresh: true })]);
    } finally {
      setIsHeaderRefreshing(false);
    }
  }, [fetchCategories, fetchSaves, isHeaderRefreshing]);

  // ── AppState handling: refresh on foreground ──────────────────────────────

  useEffect(() => {
    let lastState: AppStateStatus = AppState.currentState;

    const handleAppStateChange = (nextState: AppStateStatus): void => {
      if ((lastState === 'background' || lastState === 'inactive') && nextState === 'active') {
        const state = useSavesStore.getState();
        void state.fetchCategories();
        void state.fetchSaves({ refresh: true });
      }
      lastState = nextState;
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => { sub.remove(); };
  }, []);

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    void (async () => {
      await loadSortPreference();
      await Promise.all([fetchCategories(), fetchSaves(), checkUserFlags()]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-fetch on focus when saves array is empty ─────────────────────────

  useFocusEffect(
    useCallback(() => {
      if (saves.length === 0) {
        void fetchSaves();
      }
    }, [fetchSaves, saves.length]),
  );

  // Day-3 notification re-ask — 2s delay after mount (PRD §3.4.2)
  useEffect(() => {
    if (!notificationReaskDue) return;
    const timer = setTimeout(() => setReaskModalVisible(true), REASK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [notificationReaskDue]);

  // ── Supabase Realtime subscription (API Contract §8) ──────────────────────

  useEffect(() => {
    if (!userId) return;

    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel('saves-updates')
      .on(
        'postgres_changes' as 'system',
        { event: 'UPDATE', schema: 'public', table: 'saves' } as Record<string, string>,
        (payload: { eventType?: string; new: Partial<SaveData> & { id: string; category_id?: string } }) => {
          const state = useSavesStore.getState();
          const newRow = payload.new;
          const existing = state.allSaves.find((s) => s.id === newRow.id);
          const processingComplete = newRow.processing_status === 'complete';
          const newCategoryId = newRow.category?.id ?? newRow.category_id;
          const categoryChanged =
            existing && newCategoryId !== undefined && existing.category?.id !== newCategoryId;

          // Update in-memory — filter auto-re-derives visible saves
          state.updateSave(newRow);

          // Refresh category counts when processing finishes or save moves categories
          if (processingComplete || categoryChanged) {
            void state.fetchCategories();
          }
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [userId]);

  // ── Search — client-side filter, no API call ─────────────────────────────

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchChange(text: string): void {
    setLocalSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearchQuery(text);
    }, SEARCH_DEBOUNCE_MS);
  }

  const hasActiveFilters =
    searchQuery.trim().length > 0 || platformFilter.length > 0 || statusFilter.length > 0;

  const showFilterChips = searchFocused || localSearch.length > 0;

  // Keep local chip selection in sync with store (e.g. after clearAllFilters or initial load)
  useEffect(() => {
    setLocalPlatformFilter(platformFilter);
    setLocalStatusFilter(statusFilter);
  }, [platformFilter, statusFilter]);

  const togglePlatformFilter = (platform: string) => {
    console.log('[filter] togglePlatformFilter called with:', platform);
    console.log('[filter] current localPlatformFilter:', localPlatformFilter);
    const next = localPlatformFilter.includes(platform)
      ? localPlatformFilter.filter((p) => p !== platform)
      : [...localPlatformFilter, platform];
    console.log('[filter] next platformFilter:', next);
    setLocalPlatformFilter(next);
    setPlatformFilter(next);
  };

  const toggleStatusFilter = (status: string) => {
    const next = localStatusFilter.includes(status)
      ? localStatusFilter.filter((s) => s !== status)
      : [...localStatusFilter, status];
    setLocalStatusFilter(next);
    setStatusFilter(next);
  };

  const handleClearAllFilters = useCallback(() => {
    clearAllFilters();
    setLocalSearch('');
    setLocalPlatformFilter([]);
    setLocalStatusFilter([]);
  }, [clearAllFilters]);

  // ── Card handlers ─────────────────────────────────────────────────────────

  const handleCardPress = useCallback(
    (save: SaveData) => {
      navigation.navigate('ContentDetail', { saveId: save.id });
    },
    [navigation],
  );

  const handleMarkDone = useCallback(
    (save: SaveData) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      void markDone(save);
    },
    [markDone],
  );

  const handleRetry = useCallback(
    (save: SaveData) => void retrySave(save),
    [retrySave],
  );

  const handleMenuAction = useCallback(
    (save: SaveData, action: MenuAction) => {
      switch (action) {
        case 'skip':
          void markSkipped(save);
          break;
        case 'unskip':
          void markDone(save); // restore to previous — simplified
          break;
        case 'mark_unread':
          updateSave({ id: save.id, status: 'unread' });
          void apiClient.patch(`/saves/${save.id}`, { status: 'unread' });
          break;
        case 'delete':
          void deleteSave(save);
          break;
        case 'copy_link':
          // Clipboard.setString is deprecated but still works; expo-clipboard is preferred
          try {
            void Linking.openURL(save.url);
          } catch {
            // Fallback
          }
          break;
        case 'share':
          void import('react-native').then(({ Share }) =>
            Share.share({ url: save.url, message: save.title ?? save.url }),
          );
          break;
        case 'edit_category':
          setSaveForCategoryEdit(save);
          setCategoryPickerVisible(true);
          break;
        case 'add_note':
          navigation.navigate('ContentDetail', { saveId: save.id });
          break;
      }
    },
    [markSkipped, markDone, deleteSave, navigation],
  );

  const handleSwipeDone = useCallback(
    (save: SaveData) => void markDone(save),
    [markDone],
  );

  const handleSwipeDelete = useCallback(
    (save: SaveData) => {
      Alert.alert('Delete this save?', undefined, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void deleteSave(save),
        },
      ]);
    },
    [deleteSave],
  );

  const handleLongPress = useCallback(
    (save: SaveData) => activateMultiSelect(save.id),
    [activateMultiSelect],
  );

  const handleToggleSelect = useCallback(
    (save: SaveData) => toggleSelect(save.id),
    [toggleSelect],
  );

  // ── Category picker (single-save Edit Category vs bulk Move) ──────────────

  const handleCategoryPickerSelect = useCallback(
    async (categoryId: string) => {
      const save = saveForCategoryEdit;
      setCategoryPickerVisible(false);
      setSaveForCategoryEdit(null);

      if (save) {
        const cat = categories.find((c) => c.id === categoryId);
        try {
          await apiClient.patch(`/saves/${save.id}`, { category_id: categoryId });
          if (cat) {
            updateSave({ id: save.id, category: { id: cat.id, name: cat.name } });
          }
          void fetchCategories();
        } catch {
          // Leave UI as-is on failure
        }
      } else {
        void bulkMoveCategory(categoryId);
      }
    },
    [saveForCategoryEdit, categories, updateSave, fetchCategories, bulkMoveCategory],
  );

  const handleCategoryPickerClose = useCallback(() => {
    setCategoryPickerVisible(false);
    setSaveForCategoryEdit(null);
  }, []);

  // ── Bulk actions ──────────────────────────────────────────────────────────

  function handleBulkDelete(): void {
    Alert.alert(`Delete ${selectedCount} items?`, 'This cannot be undone via the undo toast.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void bulkDelete() },
    ]);
  }

  // ── Notification re-ask ───────────────────────────────────────────────────

  function handleReaskEnable(): void {
    setReaskModalVisible(false);
    if (Platform.OS === 'ios') {
      void Linking.openURL('app-settings:');
    } else {
      void Linking.openSettings();
    }
  }

  // ── Pull to refresh ───────────────────────────────────────────────────────

  function handleRefresh(): void {
    void fetchSaves({ refresh: true });
    void fetchCategories();
  }

  // ── Active category name (for empty state) ────────────────────────────────

  const activeCategoryName = useMemo(() => {
    if (!activeCategoryId) return null;
    return categories.find((c) => c.id === activeCategoryId)?.name ?? null;
  }, [activeCategoryId, categories]);

  // ── Render item ───────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: SaveData }) => (
      <SwipeableCard
        save={item}
        viewMode={viewMode}
        onPress={handleCardPress}
        onMarkDone={handleMarkDone}
        onRetry={handleRetry}
        onMenuAction={handleMenuAction}
        onSwipeDone={handleSwipeDone}
        onSwipeDelete={handleSwipeDelete}
        onLongPress={handleLongPress}
        isSelected={selectedIds.has(item.id)}
        isMultiSelectActive={isMultiSelectActive}
        onToggleSelect={handleToggleSelect}
      />
    ),
    [
      viewMode,
      handleCardPress,
      handleMarkDone,
      handleRetry,
      handleMenuAction,
      handleSwipeDone,
      handleSwipeDelete,
      handleLongPress,
      selectedIds,
      isMultiSelectActive,
      handleToggleSelect,
    ],
  );

  const keyExtractor = useCallback((item: SaveData) => item.id, []);

  const ListFooter = null;

  // ── Render ────────────────────────────────────────────────────────────────

  const showTrialBanner = trialExpiryBannerDue && !trialBannerDismissed;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      {/* ── Multi-select action bar ─────────────────────────────────────── */}
      {isMultiSelectActive ? (
        <MultiSelectBar
          selectedCount={selectedCount}
          onDone={() => void bulkMarkDone()}
          onSkip={() => void bulkSkip()}
          onMoveCategory={() => {
            setSaveForCategoryEdit(null);
            setCategoryPickerVisible(true);
          }}
          onDelete={handleBulkDelete}
          onSelectAll={selectAllInCategory}
          onClose={deactivateMultiSelect}
        />
      ) : (
        /* ── Header: search full width on row 1; sort / view / refresh / + on row 2 ───────────────────── */
        <View style={[styles.headerContainer, { paddingHorizontal: spacing.md }]}>
          {/* Row 1: Search bar full width */}
          <View
            style={[
              styles.searchBarWrapper,
              {
                backgroundColor: colors.surface,
                borderColor: hasActiveFilters ? colors.accent : colors.border,
                borderRadius: borderRadius.sm,
                borderWidth: hasActiveFilters ? 2 : 1,
                padding: 8,
              },
            ]}
          >
            <View style={[styles.searchBar, { borderRadius: borderRadius.sm, borderWidth: 0 }]}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={[styles.searchInput, { color: colors.textPrimary }]}
                placeholder="Search saves..."
                placeholderTextColor={colors.textMuted}
                value={localSearch}
                onChangeText={handleSearchChange}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                returnKeyType="search"
                accessibilityLabel="Search saves"
              />
              {localSearch.length > 0 && (
                <TouchableOpacity
                  onPress={() => handleSearchChange('')}
                  hitSlop={8}
                  accessibilityLabel="Clear search"
                >
                  <Text style={[styles.clearIcon, { color: colors.textMuted }]}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
            {showFilterChips && (
              <>
                <View style={styles.filterChipsWrap}>
                  {PLATFORM_CHIPS.map(({ value, label }) => (
                    <Pressable
                      key={value}
                      onPress={() => {
                        console.log('[filter] chip pressed:', value);
                        togglePlatformFilter(value);
                      }}
                      style={[
                        styles.filterChip,
                        {
                          backgroundColor: localPlatformFilter.includes(value) ? colors.accent : colors.background,
                          borderColor: colors.border,
                          borderRadius: borderRadius.sm,
                        },
                      ]}
                      accessibilityLabel={`Filter by ${label}`}
                      accessibilityState={{ selected: localPlatformFilter.includes(value) }}
                    >
                      <Text pointerEvents="none" style={[styles.filterChipText, { color: localPlatformFilter.includes(value) ? '#FFF' : colors.textPrimary }]}>
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                  {STATUS_CHIPS.map(({ value, label }) => (
                    <Pressable
                      key={value}
                      onPress={() => toggleStatusFilter(value)}
                      style={[
                        styles.filterChip,
                        {
                          backgroundColor: localStatusFilter.includes(value) ? colors.accent : colors.background,
                          borderColor: colors.border,
                          borderRadius: borderRadius.sm,
                        },
                      ]}
                      accessibilityLabel={`Filter by ${label}`}
                      accessibilityState={{ selected: localStatusFilter.includes(value) }}
                    >
                      <Text pointerEvents="none" style={[styles.filterChipText, { color: localStatusFilter.includes(value) ? '#FFF' : colors.textPrimary }]}>
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {hasActiveFilters && (
                  <TouchableOpacity
                    onPress={handleClearAllFilters}
                    style={[styles.clearFiltersBtn, { marginTop: spacing.xs }]}
                    accessibilityLabel="Clear all filters"
                  >
                    <Text style={[styles.clearFiltersText, { color: colors.accent }]}>Clear</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>

          {/* Row 2: Sort (left), view toggle, refresh, + (right) */}
          <View style={styles.headerActionsRow}>
            <TouchableOpacity
              onPress={() => setSortPickerVisible(true)}
              style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: borderRadius.sm }]}
              accessibilityLabel="Sort options"
            >
              <Text style={styles.iconBtnText}>⇅</Text>
            </TouchableOpacity>
            <View style={styles.headerActionsRight}>
              <TouchableOpacity
                onPress={toggleViewMode}
                style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: borderRadius.sm }]}
                accessibilityLabel={`Switch to ${viewMode === 'grid' ? 'list' : 'grid'} view`}
              >
                <Text style={styles.iconBtnText}>{viewMode === 'grid' ? '☰' : '⊞'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void handleHeaderRefresh()}
                style={[styles.iconBtn, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: borderRadius.sm }]}
                accessibilityLabel="Refresh"
                accessibilityState={{ busy: isHeaderRefreshing }}
                disabled={isHeaderRefreshing}
              >
                <RNAnimated.View style={refreshSpinStyle}>
                  <Text style={styles.iconBtnText}>🔄</Text>
                </RNAnimated.View>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => navigation.navigate('SaveUrl', {})}
                style={[styles.iconBtn, styles.saveUrlBtn, { backgroundColor: colors.accent, borderColor: colors.accent, borderRadius: borderRadius.sm }]}
                accessibilityLabel="Save a URL"
                accessibilityRole="button"
              >
                <Text style={styles.saveUrlBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* ── Trial expiry banner (PRD §3.4.3) ───────────────────────────── */}
      {showTrialBanner && (
        <View style={[styles.trialBanner, { backgroundColor: colors.warning + '18' }]}>
          <Text style={[styles.trialBannerText, { color: colors.textPrimary }]}>
            Your Pro trial ends today — upgrade to keep everything
          </Text>
          <View style={styles.trialBannerActions}>
            <TouchableOpacity
              onPress={() => navigation.navigate('MainTabs', { screen: 'SettingsTab', params: { screen: 'Subscription' } })}
              style={[styles.trialUpgradeBtn, { backgroundColor: colors.accent, borderRadius: borderRadius.sm }]}
              accessibilityLabel="Upgrade now"
            >
              <Text style={styles.trialUpgradeText}>Upgrade Now</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={dismissTrialBanner} hitSlop={8} accessibilityLabel="Dismiss banner">
              <Text style={[styles.trialDismiss, { color: colors.textMuted }]}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Category tabs ──────────────────────────────────────────────── */}
      <CategoryTabs
        categories={categories}
        activeCategoryId={activeCategoryId}
        onSelect={(id) => setActiveCategory(id)}
      />

      {/* ── Content ────────────────────────────────────────────────────── */}
      {isLoading ? (
        <OshiSkeletonList isLoading viewMode={viewMode} containerStyle={styles.listContainer} />
      ) : saves.length === 0 ? (
        <OshiEmptyState
          type={activeCategoryId ? 'category' : 'global'}
          categoryName={activeCategoryName ?? undefined}
        />
      ) : (
        <FlatList<SaveData>
          data={saves}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          key={viewMode}
          numColumns={viewMode === 'grid' ? 2 : 1}
          contentContainerStyle={[
            styles.listContainer,
            { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
          ]}
          columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          ListFooterComponent={ListFooter}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          maxToRenderPerBatch={8}
          windowSize={7}
        />
      )}

      {/* ── Undo toast ─────────────────────────────────────────────────── */}
      {undoEntry && (
        <UndoToast
          label={undoEntry.label}
          entryId={undoEntry.id + String(undoEntry.timestamp)}
          onUndo={() => void undoAction()}
          onDismiss={clearUndo}
        />
      )}

      {/* ── Modals ─────────────────────────────────────────────────────── */}
      <SortPicker
        visible={sortPickerVisible}
        currentSort={sortOption}
        onSelect={(opt) => void setSortOption(opt)}
        onClose={() => setSortPickerVisible(false)}
      />

      <CategoryPickerSheet
        visible={categoryPickerVisible}
        categories={categories}
        onSelect={(catId) => void handleCategoryPickerSelect(catId)}
        onClose={handleCategoryPickerClose}
      />

      <NotificationReaskModal
        visible={reaskModalVisible}
        savesCount={saves.length}
        onEnable={handleReaskEnable}
        onDismiss={() => setReaskModalVisible(false)}
      />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },

  // ── Header / search ───────────────────────────────────────────────────────
  headerContainer: {
    paddingVertical: 8,
  },
  searchBarWrapper: {
    width: '100%',
    marginBottom: 8,
  },
  headerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    height: 40,
    paddingHorizontal: 10,
    gap: 6,
  },
  filterChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 4,
    marginTop: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  clearFiltersBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 0,
  },
  clearFiltersText: {
    fontSize: 14,
    fontWeight: '600',
  },
  searchIcon: { fontSize: 14 },
  searchInput: {
    flex: 1,
    fontSize: 14,
    height: '100%',
    padding: 0,
  },
  clearIcon: { fontSize: 14, fontWeight: '600' },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  iconBtnText: { fontSize: 18 },
  saveUrlBtn: {
    borderWidth: 0,
  },
  saveUrlBtnText: {
    fontSize: 24,
    fontWeight: '400',
    color: '#FFFFFF',
    lineHeight: 28,
  },

  // ── Trial banner ──────────────────────────────────────────────────────────
  trialBanner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  trialBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  trialBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trialUpgradeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  trialUpgradeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  trialDismiss: { fontSize: 16, fontWeight: '600' },

  // ── Content list ──────────────────────────────────────────────────────────
  listContainer: {
    paddingBottom: 100,
    flexGrow: 1,
  },
  gridRow: {
    justifyContent: 'space-between',
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },

  // ── Swipe ─────────────────────────────────────────────────────────────────
  swipeWrapper: {
    position: 'relative',
    overflow: 'hidden',
  },
  swipeBg: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  swipeBgLeft: { justifyContent: 'flex-start' },
  swipeBgRight: { justifyContent: 'flex-end' },
  swipeIcon: { fontSize: 22, color: '#FFFFFF', marginHorizontal: 8 },
  swipeLabel: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },

  // ── Multi-select bar ──────────────────────────────────────────────────────
  multiBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  multiBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  multiBarIcon: { fontSize: 18, fontWeight: '700' },
  multiBarCount: { fontSize: 16, fontWeight: '600' },
  multiBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  multiBtn: {
    minWidth: 36,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  multiBtnText: { fontSize: 14, fontWeight: '700' },
  multiBtnEmoji: { fontSize: 18 },

  // ── Modals / sheets ───────────────────────────────────────────────────────
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
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
  pickerTitle: {
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  pickerRow: {},
  pickerRowText: { fontSize: 16, fontWeight: '500' },

  // ── Notification re-ask modal ─────────────────────────────────────────────
  reaskCard: {
    alignItems: 'center',
  },
  reaskHeadline: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  reaskBody: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  reaskBtn: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  reaskBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  reaskDismiss: {
    paddingVertical: 12,
  },
  reaskDismissText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
