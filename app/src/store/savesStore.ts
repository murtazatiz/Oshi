/**
 * savesStore — Zustand store for the Library screen.
 *
 * Simple client-side filtering approach:
 *   - On load/refresh, fetch ALL saves (no category filter) and store in allSaves.
 *   - Category tabs and search filter the in-memory allSaves array client-side.
 *   - No TTL, no per-category caching, no cache invalidation complexity.
 *   - GET /saves is called only: on app load, pull-to-refresh, header refresh, new save added.
 *
 * PRD §3.3 — Home Screen (Library)
 * API Contract §3 — Saves Endpoints
 * API Contract §4 — Categories Endpoints
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { apiClient } from '../services/apiClient';
import type { SaveData } from '../components/OshiCard';
import { deleteCachedThumbnail } from '../utils/thumbnailCache';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SortOption = 'ai_recommended' | 'recent' | 'oldest' | 'shortest' | 'manual';

export interface CategoryData {
  id: string;
  name: string;
  slug: string;
  emoji: string | null;
  sort_order: number;
  unread_count: number;
  total_count: number;
}

export interface UndoEntry {
  id: string;
  action: 'done' | 'skipped' | 'deleted';
  label: string;
  save: SaveData;
  previousStatus: SaveData['status'];
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const SORT_STORAGE_KEY = 'oshi_sort_global';

/**
 * Filter allSaves by category, search, platform, and status.
 * Platform and status are independent: only apply when their array is non-empty.
 * - Only platform chips selected → show saves matching that platform (any status).
 * - Only status chips selected → show saves matching that status (any platform).
 * - Both selected → show saves matching both.
 */
function applyFilter(
  allSaves: SaveData[],
  activeCategoryId: string | null,
  searchQuery: string,
  platformFilter: string[],
  statusFilter: string[],
): SaveData[] {
  let result = allSaves;

  if (activeCategoryId) {
    result = result.filter((sv) => sv.category?.id === activeCategoryId);
  }

  const q = searchQuery.trim().toLowerCase();
  if (q) {
    result = result.filter((sv) => {
      const title = sv.title?.toLowerCase() ?? '';
      const creator = sv.creator_name?.toLowerCase() ?? '';
      const summary = sv.summary?.toLowerCase() ?? '';
      const tags = Array.isArray(sv.tags) ? sv.tags : [];
      const tagMatch = tags.some((t) => typeof t === 'string' && t.toLowerCase().includes(q));
      return title.includes(q) || creator.includes(q) || summary.includes(q) || tagMatch || sv.url?.toLowerCase().includes(q);
    });
  }

  // Apply platform filter only when at least one platform chip is selected (independent of status)
  if (platformFilter.length > 0) {
    const platformSet = new Set(platformFilter.map((p) => p.toLowerCase()));
    result = result.filter((sv) => sv.platform != null && platformSet.has(String(sv.platform).toLowerCase()));
  }

  // Apply status filter only when at least one status chip is selected (independent of platform)
  if (statusFilter.length > 0) {
    const statusSet = new Set(statusFilter.map((s) => s.toLowerCase()));
    result = result.filter((sv) => sv.status != null && statusSet.has(String(sv.status).toLowerCase()));
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// State & actions
// ─────────────────────────────────────────────────────────────────────────────

interface SavesState {
  // Master list — all saves for the user, unfiltered by category
  allSaves: SaveData[];
  // Visible saves — allSaves filtered by activeCategoryId + searchQuery
  saves: SaveData[];
  categories: CategoryData[];

  // UI
  isLoading: boolean;
  isRefreshing: boolean;
  activeCategoryId: string | null; // null = "All"
  searchQuery: string;
  sortOption: SortOption;
  viewMode: 'grid' | 'list';
  platformFilter: string[];
  statusFilter: string[];

  // Multi-select
  isMultiSelectActive: boolean;
  selectedIds: Set<string>;

  // Undo
  undoEntry: UndoEntry | null;

  // Notification / trial banners
  notificationReaskDue: boolean;
  trialExpiryBannerDue: boolean;
  trialBannerDismissed: boolean;
}

interface SavesActions {
  fetchCategories: () => Promise<void>;
  /** Fetch ALL saves (no category filter). Only call on load, refresh, or after adding a save. */
  fetchSaves: (opts?: { refresh?: boolean }) => Promise<void>;
  /** Updates activeCategoryId and immediately re-derives the visible saves client-side — no API call. */
  setActiveCategory: (categoryId: string | null) => void;
  setSearchQuery: (query: string) => void;
  setPlatformFilter: (platforms: string[]) => void;
  setStatusFilter: (statuses: string[]) => void;
  clearAllFilters: () => void;
  setSortOption: (option: SortOption) => Promise<void>;
  toggleViewMode: () => void;

  // Single-item actions
  markDone: (save: SaveData) => Promise<void>;
  markSkipped: (save: SaveData) => Promise<void>;
  deleteSave: (save: SaveData) => Promise<void>;
  retrySave: (save: SaveData) => Promise<void>;
  undoAction: () => Promise<void>;
  clearUndo: () => void;

  // Multi-select
  activateMultiSelect: (initialSaveId: string) => void;
  deactivateMultiSelect: () => void;
  toggleSelect: (saveId: string) => void;
  selectAllInCategory: () => void;
  bulkMarkDone: () => Promise<void>;
  bulkSkip: () => Promise<void>;
  bulkDelete: () => Promise<void>;
  bulkMoveCategory: (categoryId: string) => Promise<void>;

  // Realtime — updates save in allSaves and re-derives saves
  updateSave: (updatedSave: Partial<SaveData> & { id: string }) => void;

  // Local helpers
  addSaveToTop: (save: SaveData) => void;

  // Banners
  checkUserFlags: () => Promise<void>;
  dismissTrialBanner: () => void;

  // Helpers
  loadSortPreference: () => Promise<void>;
}

type SavesStore = SavesState & SavesActions;

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useSavesStore = create<SavesStore>((set, get) => ({
  // ── Initial state ─────────────────────────────────────────────────────────
  allSaves: [],
  saves: [],
  categories: [],
  isLoading: false,
  isRefreshing: false,
  activeCategoryId: null,
  searchQuery: '',
  platformFilter: [],
  statusFilter: [],
  sortOption: 'ai_recommended',
  viewMode: 'grid',
  isMultiSelectActive: false,
  selectedIds: new Set<string>(),
  undoEntry: null,
  notificationReaskDue: false,
  trialExpiryBannerDue: false,
  trialBannerDismissed: false,

  // ── Categories ────────────────────────────────────────────────────────────

  async fetchCategories(): Promise<void> {
    try {
      const res = await apiClient.get<{ categories: CategoryData[] }>('/categories');
      set({ categories: res.data.categories });
    } catch {
      // Silently fail — categories will remain as-is
    }
  },

  // ── Saves ─────────────────────────────────────────────────────────────────
  // Fetches ALL saves without a category filter. Category tabs filter client-side.

  async fetchSaves(opts): Promise<void> {
    const { sortOption, activeCategoryId, searchQuery } = get();
    const refresh = opts?.refresh ?? false;

    set({ isLoading: !refresh, isRefreshing: refresh });

    try {
      const sort = sortOption;
      const limit = '500';
      console.log('[fetchSaves] Calling API with params:', { sort, limit });
      const res = await apiClient.get<{
        saves: SaveData[];
        next_cursor: string | null;
        total_count: number;
        has_more: boolean;
      }>('/saves', {
        params: { sort, limit },
      });

      const allSaves = res.data.saves;
      const { platformFilter, statusFilter } = get();
      set({
        allSaves,
        saves: applyFilter(allSaves, activeCategoryId, searchQuery, platformFilter, statusFilter),
      });
    } catch {
      // Network error — keep existing data
    } finally {
      set({ isLoading: false, isRefreshing: false });
    }
  },

  // ── Category switching ────────────────────────────────────────────────────
  // Only updates activeCategoryId — no API call. Visible saves re-derived immediately.

  setActiveCategory(categoryId): void {
    const { allSaves, searchQuery, platformFilter, statusFilter } = get();
    set({
      activeCategoryId: categoryId,
      saves: applyFilter(allSaves, categoryId, searchQuery, platformFilter, statusFilter),
    });
  },

  // ── Search ────────────────────────────────────────────────────────────────
  // Client-side filter — no API call.

  setSearchQuery(query): void {
    const { allSaves, activeCategoryId, platformFilter, statusFilter } = get();
    set({
      searchQuery: query,
      saves: applyFilter(allSaves, activeCategoryId, query, platformFilter, statusFilter),
    });
  },

  setPlatformFilter(platforms): void {
    console.log('[store] setPlatformFilter called with:', platforms, 'allSaves count:', get().allSaves.length);
    const { allSaves, activeCategoryId, searchQuery, statusFilter } = get();
    const nextSaves = applyFilter(allSaves, activeCategoryId, searchQuery, platforms, statusFilter);
    console.log('[savesStore] setPlatformFilter applied', { platforms, statusFilter, allSavesCount: allSaves.length, filteredCount: nextSaves.length });
    set({
      platformFilter: platforms,
      saves: nextSaves,
    });
  },

  setStatusFilter(statuses): void {
    const { allSaves, activeCategoryId, searchQuery, platformFilter } = get();
    const nextSaves = applyFilter(allSaves, activeCategoryId, searchQuery, platformFilter, statuses);
    console.log('[savesStore] setStatusFilter applied', { statuses, platformFilter, allSavesCount: allSaves.length, filteredCount: nextSaves.length });
    set({
      statusFilter: statuses,
      saves: nextSaves,
    });
  },

  clearAllFilters(): void {
    const { allSaves, activeCategoryId } = get();
    const emptyPlatform: string[] = [];
    const emptyStatus: string[] = [];
    set({
      searchQuery: '',
      platformFilter: emptyPlatform,
      statusFilter: emptyStatus,
      saves: applyFilter(allSaves, activeCategoryId, '', emptyPlatform, emptyStatus),
    });
  },

  // ── Sort ──────────────────────────────────────────────────────────────────

  async setSortOption(option): Promise<void> {
    set({ sortOption: option });
    try {
      await AsyncStorage.setItem(SORT_STORAGE_KEY, option);
    } catch {
      // Ignore storage failures
    }
    await get().fetchSaves();
  },

  async loadSortPreference(): Promise<void> {
    try {
      const saved = await AsyncStorage.getItem(SORT_STORAGE_KEY);
      if (saved && ['ai_recommended', 'recent', 'oldest', 'shortest', 'manual'].includes(saved)) {
        set({ sortOption: saved as SortOption });
      } else {
        set({ sortOption: 'ai_recommended' });
      }
    } catch {
      set({ sortOption: 'ai_recommended' });
    }
  },

  // ── View mode ─────────────────────────────────────────────────────────────

  toggleViewMode(): void {
    set((s) => ({ viewMode: s.viewMode === 'grid' ? 'list' : 'grid' }));
  },

  // ── Single-item actions ───────────────────────────────────────────────────

  async markDone(save): Promise<void> {
    const prev = save.status;
    set((s) => {
      const allSaves = s.allSaves.map((sv) =>
        sv.id === save.id ? { ...sv, status: 'done' as const } : sv,
      );
      return {
        allSaves,
        saves: applyFilter(allSaves, s.activeCategoryId, s.searchQuery, s.platformFilter, s.statusFilter),
        undoEntry: {
          id: save.id,
          action: 'done',
          label: 'Marked as Done',
          save,
          previousStatus: prev,
          timestamp: Date.now(),
        },
      };
    });
    try {
      await apiClient.patch(`/saves/${save.id}`, { status: 'done' });
      await apiClient.post('/engagement/signal', { save_id: save.id, action: 'done' });
      void deleteCachedThumbnail(save.id);
      void get().fetchCategories();
    } catch {
      set((s) => {
        const allSaves = s.allSaves.map((sv) => (sv.id === save.id ? { ...sv, status: prev } : sv));
        return { allSaves, saves: applyFilter(allSaves, s.activeCategoryId, s.searchQuery, s.platformFilter, s.statusFilter) };
      });
    }
  },

  async markSkipped(save): Promise<void> {
    const prev = save.status;
    set((s) => {
      const allSaves = s.allSaves.map((sv) =>
        sv.id === save.id ? { ...sv, status: 'skipped' as const } : sv,
      );
      return {
        allSaves,
        saves: applyFilter(allSaves, s.activeCategoryId, s.searchQuery, s.platformFilter, s.statusFilter),
        undoEntry: {
          id: save.id,
          action: 'skipped',
          label: 'Skipped',
          save,
          previousStatus: prev,
          timestamp: Date.now(),
        },
      };
    });
    try {
      await apiClient.patch(`/saves/${save.id}`, { status: 'skipped' });
      await apiClient.post('/engagement/signal', { save_id: save.id, action: 'skipped' });
      void get().fetchCategories();
    } catch {
      set((s) => {
        const allSaves = s.allSaves.map((sv) => (sv.id === save.id ? { ...sv, status: prev } : sv));
        return { allSaves, saves: applyFilter(allSaves, s.activeCategoryId, s.searchQuery, s.platformFilter, s.statusFilter) };
      });
    }
  },

  async deleteSave(save): Promise<void> {
    set((s) => {
      const allSaves = s.allSaves.filter((sv) => sv.id !== save.id);
      return {
        allSaves,
        saves: applyFilter(allSaves, s.activeCategoryId, s.searchQuery, s.platformFilter, s.statusFilter),
        undoEntry: {
          id: save.id,
          action: 'deleted',
          label: 'Deleted',
          save,
          previousStatus: save.status,
          timestamp: Date.now(),
        },
      };
    });
    try {
      await apiClient.delete(`/saves/${save.id}`);
      void deleteCachedThumbnail(save.id);
      void get().fetchCategories();
    } catch {
      set((s) => {
        const allSaves = [...s.allSaves, save];
        return { allSaves, saves: applyFilter(allSaves, s.activeCategoryId, s.searchQuery, s.platformFilter, s.statusFilter) };
      });
    }
  },

  async retrySave(save): Promise<void> {
    set((s) => {
      const allSaves = s.allSaves.map((sv) =>
        sv.id === save.id ? { ...sv, processing_status: 'processing' as const } : sv,
      );
      return { allSaves, saves: applyFilter(allSaves, s.activeCategoryId, s.searchQuery, s.platformFilter, s.statusFilter) };
    });
    try {
      await apiClient.post(`/saves/${save.id}/retry`);
    } catch {
      set((s) => {
        const allSaves = s.allSaves.map((sv) =>
          sv.id === save.id ? { ...sv, processing_status: 'failed' as const } : sv,
        );
        return { allSaves, saves: applyFilter(allSaves, s.activeCategoryId, s.searchQuery, s.platformFilter, s.statusFilter) };
      });
    }
  },

  async undoAction(): Promise<void> {
    const { undoEntry } = get();
    if (!undoEntry) return;

    if (undoEntry.action === 'deleted') {
      set((s) => {
        const allSaves = [undoEntry.save, ...s.allSaves];
        return {
          allSaves,
          saves: applyFilter(allSaves, s.activeCategoryId, s.searchQuery, s.platformFilter, s.statusFilter),
          undoEntry: null,
        };
      });
      try {
        await apiClient.patch(`/saves/${undoEntry.id}`, { status: undoEntry.previousStatus });
      } catch {
        set((s) => {
          const allSaves = s.allSaves.filter((sv) => sv.id !== undoEntry.id);
          return { allSaves, saves: applyFilter(allSaves, s.activeCategoryId, s.searchQuery, s.platformFilter, s.statusFilter) };
        });
      }
    } else {
      set((s) => {
        const allSaves = s.allSaves.map((sv) =>
          sv.id === undoEntry.id ? { ...sv, status: undoEntry.previousStatus } : sv,
        );
        return {
          allSaves,
          saves: applyFilter(allSaves, s.activeCategoryId, s.searchQuery, s.platformFilter, s.statusFilter),
          undoEntry: null,
        };
      });
      try {
        await apiClient.patch(`/saves/${undoEntry.id}`, { status: undoEntry.previousStatus });
      } catch {
        // Revert failed — leave as-is
      }
    }
  },

  clearUndo(): void {
    set({ undoEntry: null });
  },

  // ── Multi-select ──────────────────────────────────────────────────────────

  activateMultiSelect(initialSaveId): void {
    set({ isMultiSelectActive: true, selectedIds: new Set([initialSaveId]) });
  },

  deactivateMultiSelect(): void {
    set({ isMultiSelectActive: false, selectedIds: new Set() });
  },

  toggleSelect(saveId): void {
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(saveId)) next.delete(saveId);
      else next.add(saveId);
      return { selectedIds: next };
    });
  },

  selectAllInCategory(): void {
    set((s) => ({ selectedIds: new Set(s.saves.map((sv) => sv.id)) }));
  },

  async bulkMarkDone(): Promise<void> {
    const { selectedIds } = get();
    const ids = [...selectedIds];
    set((s) => {
      const allSaves = s.allSaves.map((sv) =>
        selectedIds.has(sv.id) ? { ...sv, status: 'done' as const } : sv,
      );
      return {
        allSaves,
        saves: applyFilter(allSaves, s.activeCategoryId, s.searchQuery, s.platformFilter, s.statusFilter),
        isMultiSelectActive: false,
        selectedIds: new Set(),
      };
    });
    await Promise.allSettled(ids.map((id) => apiClient.patch(`/saves/${id}`, { status: 'done' })));
    ids.forEach((id) => void deleteCachedThumbnail(id));
    void get().fetchCategories();
  },

  async bulkSkip(): Promise<void> {
    const { selectedIds } = get();
    const ids = [...selectedIds];
    set((s) => {
      const allSaves = s.allSaves.map((sv) =>
        selectedIds.has(sv.id) ? { ...sv, status: 'skipped' as const } : sv,
      );
      return {
        allSaves,
        saves: applyFilter(allSaves, s.activeCategoryId, s.searchQuery, s.platformFilter, s.statusFilter),
        isMultiSelectActive: false,
        selectedIds: new Set(),
      };
    });
    await Promise.allSettled(
      ids.map((id) => apiClient.patch(`/saves/${id}`, { status: 'skipped' })),
    );
    void get().fetchCategories();
  },

  async bulkDelete(): Promise<void> {
    const { selectedIds } = get();
    const ids = [...selectedIds];
    set((s) => {
      const allSaves = s.allSaves.filter((sv) => !selectedIds.has(sv.id));
      return {
        allSaves,
        saves: applyFilter(allSaves, s.activeCategoryId, s.searchQuery, s.platformFilter, s.statusFilter),
        isMultiSelectActive: false,
        selectedIds: new Set(),
      };
    });
    await Promise.allSettled(ids.map((id) => apiClient.delete(`/saves/${id}`)));
    ids.forEach((id) => void deleteCachedThumbnail(id));
    void get().fetchCategories();
  },

  async bulkMoveCategory(categoryId): Promise<void> {
    const { selectedIds } = get();
    const ids = [...selectedIds];
    const targetCat = get().categories.find((c) => c.id === categoryId);
    if (!targetCat) return;
    set((s) => {
      const allSaves = s.allSaves.map((sv) =>
        selectedIds.has(sv.id)
          ? { ...sv, category: { id: targetCat.id, name: targetCat.name } }
          : sv,
      );
      return {
        allSaves,
        saves: applyFilter(allSaves, s.activeCategoryId, s.searchQuery, s.platformFilter, s.statusFilter),
        isMultiSelectActive: false,
        selectedIds: new Set(),
      };
    });
    await Promise.allSettled(
      ids.map((id) => apiClient.patch(`/saves/${id}`, { category_id: categoryId })),
    );
    void get().fetchCategories();
  },

  // ── Realtime (Supabase) ───────────────────────────────────────────────────
  // Merges the updated row into allSaves and re-derives the visible list.
  // Handles the case where the backend sends category_id instead of a nested category object.

  updateSave(updatedSave): void {
    const { categories } = get();

    const update: Partial<SaveData> & { id: string } = { ...updatedSave };
    const rawCatId = (updatedSave as { category_id?: string }).category_id;
    if (rawCatId && !updatedSave.category) {
      const cat = categories.find((c) => c.id === rawCatId);
      if (cat) {
        update.category = { id: cat.id, name: cat.name };
      }
    }

    set((s) => {
      const allSaves = s.allSaves.map((sv) =>
        sv.id === update.id ? { ...sv, ...update } : sv,
      );
      return { allSaves, saves: applyFilter(allSaves, s.activeCategoryId, s.searchQuery, s.platformFilter, s.statusFilter) };
    });
  },

  // Adds a newly created save to the top of allSaves and re-derives visible list.
  addSaveToTop(save): void {
    set((s) => {
      const existing = s.allSaves.find((sv) => sv.id === save.id);
      const allSaves = existing
        ? s.allSaves.map((sv) => (sv.id === save.id ? save : sv))
        : [save, ...s.allSaves];

      // Optimistically bump category counts so the tab badge updates immediately
      const categories = s.categories.map((cat) =>
        cat.id === save.category?.id
          ? { ...cat, unread_count: cat.unread_count + 1, total_count: cat.total_count + 1 }
          : cat,
      );

      return {
        allSaves,
        saves: applyFilter(allSaves, s.activeCategoryId, s.searchQuery, s.platformFilter, s.statusFilter),
        categories,
      };
    });
  },

  // ── User flags (notification re-ask, trial banner) ────────────────────────

  async checkUserFlags(): Promise<void> {
    try {
      const res = await apiClient.get<{
        notification_reask_due?: boolean;
        trial_expiry_banner_due?: boolean;
      }>('/users/me');
      set({
        notificationReaskDue: res.data.notification_reask_due ?? false,
        trialExpiryBannerDue: res.data.trial_expiry_banner_due ?? false,
      });
    } catch {
      // Ignore
    }
  },

  dismissTrialBanner(): void {
    set({ trialBannerDismissed: true });
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Typed selector hooks
// ─────────────────────────────────────────────────────────────────────────────

export function useSaves(): SaveData[] {
  return useSavesStore((s) => s.saves);
}

export function useCategories(): CategoryData[] {
  return useSavesStore((s) => s.categories);
}

export function useSavesLoading(): { isLoading: boolean; isRefreshing: boolean } {
  return useSavesStore(
    useShallow((s) => ({
      isLoading: s.isLoading,
      isRefreshing: s.isRefreshing,
    })),
  );
}

export function useSavesUI() {
  return useSavesStore(
    useShallow((s) => ({
      activeCategoryId: s.activeCategoryId,
      searchQuery: s.searchQuery,
      sortOption: s.sortOption,
      viewMode: s.viewMode,
      platformFilter: s.platformFilter,
      statusFilter: s.statusFilter,
    })),
  );
}

export function useMultiSelect() {
  return useSavesStore(
    useShallow((s) => ({
      isMultiSelectActive: s.isMultiSelectActive,
      selectedIds: s.selectedIds,
      selectedCount: s.selectedIds.size,
    })),
  );
}

export function useSavesActions() {
  return useSavesStore(
    useShallow((s) => ({
      fetchCategories: s.fetchCategories,
      fetchSaves: s.fetchSaves,
      setActiveCategory: s.setActiveCategory,
      setSearchQuery: s.setSearchQuery,
      setPlatformFilter: s.setPlatformFilter,
      setStatusFilter: s.setStatusFilter,
      clearAllFilters: s.clearAllFilters,
      setSortOption: s.setSortOption,
      toggleViewMode: s.toggleViewMode,
      markDone: s.markDone,
      markSkipped: s.markSkipped,
      deleteSave: s.deleteSave,
      retrySave: s.retrySave,
      undoAction: s.undoAction,
      clearUndo: s.clearUndo,
      activateMultiSelect: s.activateMultiSelect,
      deactivateMultiSelect: s.deactivateMultiSelect,
      toggleSelect: s.toggleSelect,
      selectAllInCategory: s.selectAllInCategory,
      bulkMarkDone: s.bulkMarkDone,
      bulkSkip: s.bulkSkip,
      bulkDelete: s.bulkDelete,
      bulkMoveCategory: s.bulkMoveCategory,
      updateSave: s.updateSave,
      addSaveToTop: s.addSaveToTop,
      checkUserFlags: s.checkUserFlags,
      dismissTrialBanner: s.dismissTrialBanner,
      loadSortPreference: s.loadSortPreference,
    })),
  );
}
