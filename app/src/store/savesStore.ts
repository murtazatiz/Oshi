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
  /** true for the 11 seeded defaults; only custom categories count toward the free limit */
  is_system_default?: boolean;
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
/** When the free-plan upsell banner was last dismissed (ms epoch); it returns after UPSELL_SNOOZE_MS */
const UPSELL_DISMISSED_KEY = 'oshi_upsell_dismissed_at';
const UPSELL_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

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

/** The filter inputs that applyFilter derives the visible list from. */
interface FilterState {
  activeCategoryId: string | null;
  searchQuery: string;
  platformFilter: string[];
  statusFilter: string[];
}

/**
 * Derive the { allSaves, saves } slice from a new master list, using the
 * store's current filters unless explicitly overridden.
 *
 * Every mutation that touches allSaves goes through this helper so the
 * visible `saves` list can never drift out of sync with the master list —
 * previously each of ~20 call sites repeated the applyFilter(...) spread
 * by hand.
 */
function withDerivedSaves(
  current: FilterState,
  allSaves: SaveData[],
  overrides: Partial<FilterState> = {},
): { allSaves: SaveData[]; saves: SaveData[] } {
  const f = { ...current, ...overrides };
  return {
    allSaves,
    saves: applyFilter(allSaves, f.activeCategoryId, f.searchQuery, f.platformFilter, f.statusFilter),
  };
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
  /** PRD §8.3 day-5 soft upsell for free users (server flag, minus a 7-day snooze) */
  upsellBannerDue: boolean;
}

interface SavesActions {
  fetchCategories: () => Promise<void>;
  /**
   * Category management (Settings). Each throws on API failure so the caller
   * can show its own message (and detect the free-tier limit on create).
   */
  createCategory: (name: string, emoji: string) => Promise<CategoryData>;
  updateCategory: (id: string, changes: { name: string; emoji: string }) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  /** Swap a category with its neighbour; optimistic, rolled back on failure. */
  moveCategory: (index: number, direction: 'up' | 'down') => Promise<void>;
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
  dismissUpsellBanner: () => void;

  // Helpers
  loadSortPreference: () => Promise<void>;
}

type SavesStore = SavesState & SavesActions;

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useSavesStore = create<SavesStore>((set, get) => {
  /**
   * Shared optimistic status mutation behind markDone/markSkipped:
   * set status locally + arm undo → PATCH + engagement signal → roll back
   * to the previous status if the API call fails.
   */
  async function mutateStatus(
    save: SaveData,
    status: 'done' | 'skipped',
    label: string,
  ): Promise<void> {
    const prev = save.status;
    set((s) => ({
      ...withDerivedSaves(
        s,
        s.allSaves.map((sv) => (sv.id === save.id ? { ...sv, status } : sv)),
      ),
      undoEntry: {
        id: save.id,
        action: status,
        label,
        save,
        previousStatus: prev,
        timestamp: Date.now(),
      },
    }));
    try {
      await apiClient.patch(`/saves/${save.id}`, { status });
      await apiClient.post('/engagement/signal', { save_id: save.id, action: status });
      if (status === 'done') void deleteCachedThumbnail(save.id);
      void get().fetchCategories();
    } catch {
      set((s) =>
        withDerivedSaves(
          s,
          s.allSaves.map((sv) => (sv.id === save.id ? { ...sv, status: prev } : sv)),
        ),
      );
    }
  }

  return {
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
  upsellBannerDue: false,

  // ── Categories ────────────────────────────────────────────────────────────

  async fetchCategories(): Promise<void> {
    try {
      const res = await apiClient.get<{ categories: CategoryData[] }>('/categories');
      set({ categories: res.data.categories });
    } catch {
      // Silently fail — categories will remain as-is
    }
  },

  async createCategory(name, emoji): Promise<CategoryData> {
    const res = await apiClient.post<CategoryData>('/categories', { name, emoji });
    set((s) => ({ categories: [...s.categories, res.data] }));
    return res.data;
  },

  async updateCategory(id, { name, emoji }): Promise<void> {
    await apiClient.patch(`/categories/${id}`, { name, emoji });
    // Cards show the category name, so rename it on the saves too
    set((s) => ({
      categories: s.categories.map((c) => (c.id === id ? { ...c, name, emoji } : c)),
      ...withDerivedSaves(
        s,
        s.allSaves.map((sv) => (sv.category?.id === id ? { ...sv, category: { id, name } } : sv)),
      ),
    }));
  },

  async deleteCategory(id): Promise<void> {
    await apiClient.delete(`/categories/${id}`);
    set((s) => ({
      categories: s.categories.filter((c) => c.id !== id),
      ...(s.activeCategoryId === id ? withDerivedSaves(s, s.allSaves, { activeCategoryId: null }) : {}),
      ...(s.activeCategoryId === id ? { activeCategoryId: null } : {}),
    }));
    // The server moved this category's saves to "Other" — reload both lists
    // so cards and tab counts reflect the move.
    await Promise.all([get().fetchSaves({ refresh: true }), get().fetchCategories()]);
  },

  async moveCategory(index, direction): Promise<void> {
    const before = get().categories;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const moved = before[index];
    const neighbour = before[targetIndex];
    if (!moved || !neighbour) return;

    // Swap the two rows' existing sort_order values (rather than writing list
    // indexes) so every other category keeps its stored position.
    const reordered = [...before];
    reordered[index] = { ...neighbour, sort_order: moved.sort_order };
    reordered[targetIndex] = { ...moved, sort_order: neighbour.sort_order };
    set({ categories: reordered });

    try {
      await Promise.all([
        apiClient.patch(`/categories/${moved.id}`, { sort_order: neighbour.sort_order }),
        apiClient.patch(`/categories/${neighbour.id}`, { sort_order: moved.sort_order }),
      ]);
    } catch {
      set({ categories: before });
      void get().fetchCategories();
    }
  },

  // ── Saves ─────────────────────────────────────────────────────────────────
  // Fetches ALL saves without a category filter. Category tabs filter client-side.

  async fetchSaves(opts): Promise<void> {
    const { sortOption } = get();
    const refresh = opts?.refresh ?? false;

    set({ isLoading: !refresh, isRefreshing: refresh });

    try {
      const res = await apiClient.get<{
        saves: SaveData[];
        next_cursor: string | null;
        total_count: number;
        has_more: boolean;
      }>('/saves', {
        params: { sort: sortOption, limit: '500' },
      });

      // Derive with the filters as they are NOW (post-await) — the user may
      // have switched category/search while the request was in flight.
      set(withDerivedSaves(get(), res.data.saves));
    } catch {
      // Network error — keep existing data
    } finally {
      set({ isLoading: false, isRefreshing: false });
    }
  },

  // ── Category switching ────────────────────────────────────────────────────
  // Only updates activeCategoryId — no API call. Visible saves re-derived immediately.

  setActiveCategory(categoryId): void {
    const s = get();
    set({
      activeCategoryId: categoryId,
      ...withDerivedSaves(s, s.allSaves, { activeCategoryId: categoryId }),
    });
  },

  // ── Search ────────────────────────────────────────────────────────────────
  // Client-side filter — no API call.

  setSearchQuery(query): void {
    const s = get();
    set({
      searchQuery: query,
      ...withDerivedSaves(s, s.allSaves, { searchQuery: query }),
    });
  },

  setPlatformFilter(platforms): void {
    const s = get();
    set({
      platformFilter: platforms,
      ...withDerivedSaves(s, s.allSaves, { platformFilter: platforms }),
    });
  },

  setStatusFilter(statuses): void {
    const s = get();
    set({
      statusFilter: statuses,
      ...withDerivedSaves(s, s.allSaves, { statusFilter: statuses }),
    });
  },

  clearAllFilters(): void {
    const s = get();
    const cleared = { searchQuery: '', platformFilter: [], statusFilter: [] };
    set({
      ...cleared,
      ...withDerivedSaves(s, s.allSaves, cleared),
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
    await mutateStatus(save, 'done', 'Marked as Done');
  },

  async markSkipped(save): Promise<void> {
    await mutateStatus(save, 'skipped', 'Skipped');
  },

  async deleteSave(save): Promise<void> {
    set((s) => ({
      ...withDerivedSaves(s, s.allSaves.filter((sv) => sv.id !== save.id)),
      undoEntry: {
        id: save.id,
        action: 'deleted',
        label: 'Deleted',
        save,
        previousStatus: save.status,
        timestamp: Date.now(),
      },
    }));
    try {
      await apiClient.delete(`/saves/${save.id}`);
      void deleteCachedThumbnail(save.id);
      void get().fetchCategories();
    } catch {
      set((s) => withDerivedSaves(s, [...s.allSaves, save]));
    }
  },

  async retrySave(save): Promise<void> {
    set((s) =>
      withDerivedSaves(
        s,
        s.allSaves.map((sv) =>
          sv.id === save.id ? { ...sv, processing_status: 'processing' as const } : sv,
        ),
      ),
    );
    try {
      await apiClient.post(`/saves/${save.id}/retry`);
    } catch {
      set((s) =>
        withDerivedSaves(
          s,
          s.allSaves.map((sv) =>
            sv.id === save.id ? { ...sv, processing_status: 'failed' as const } : sv,
          ),
        ),
      );
    }
  },

  async undoAction(): Promise<void> {
    const { undoEntry } = get();
    if (!undoEntry) return;

    if (undoEntry.action === 'deleted') {
      set((s) => ({
        ...withDerivedSaves(s, [undoEntry.save, ...s.allSaves]),
        undoEntry: null,
      }));
      try {
        // PATCH can't touch soft-deleted rows (routes filter deletedAt: null) —
        // the dedicated restore endpoint clears the delete flag instead.
        await apiClient.post(`/saves/${undoEntry.id}/restore`);
      } catch {
        set((s) => withDerivedSaves(s, s.allSaves.filter((sv) => sv.id !== undoEntry.id)));
      }
    } else {
      set((s) => ({
        ...withDerivedSaves(
          s,
          s.allSaves.map((sv) =>
            sv.id === undoEntry.id ? { ...sv, status: undoEntry.previousStatus } : sv,
          ),
        ),
        undoEntry: null,
      }));
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
    set((s) => ({
      ...withDerivedSaves(
        s,
        s.allSaves.map((sv) => (selectedIds.has(sv.id) ? { ...sv, status: 'done' as const } : sv)),
      ),
      isMultiSelectActive: false,
      selectedIds: new Set<string>(),
    }));
    await Promise.allSettled(ids.map((id) => apiClient.patch(`/saves/${id}`, { status: 'done' })));
    ids.forEach((id) => void deleteCachedThumbnail(id));
    void get().fetchCategories();
  },

  async bulkSkip(): Promise<void> {
    const { selectedIds } = get();
    const ids = [...selectedIds];
    set((s) => ({
      ...withDerivedSaves(
        s,
        s.allSaves.map((sv) =>
          selectedIds.has(sv.id) ? { ...sv, status: 'skipped' as const } : sv,
        ),
      ),
      isMultiSelectActive: false,
      selectedIds: new Set<string>(),
    }));
    await Promise.allSettled(
      ids.map((id) => apiClient.patch(`/saves/${id}`, { status: 'skipped' })),
    );
    void get().fetchCategories();
  },

  async bulkDelete(): Promise<void> {
    const { selectedIds } = get();
    const ids = [...selectedIds];
    set((s) => ({
      ...withDerivedSaves(s, s.allSaves.filter((sv) => !selectedIds.has(sv.id))),
      isMultiSelectActive: false,
      selectedIds: new Set<string>(),
    }));
    await Promise.allSettled(ids.map((id) => apiClient.delete(`/saves/${id}`)));
    ids.forEach((id) => void deleteCachedThumbnail(id));
    void get().fetchCategories();
  },

  async bulkMoveCategory(categoryId): Promise<void> {
    const { selectedIds } = get();
    const ids = [...selectedIds];
    const targetCat = get().categories.find((c) => c.id === categoryId);
    if (!targetCat) return;
    set((s) => ({
      ...withDerivedSaves(
        s,
        s.allSaves.map((sv) =>
          selectedIds.has(sv.id)
            ? { ...sv, category: { id: targetCat.id, name: targetCat.name } }
            : sv,
        ),
      ),
      isMultiSelectActive: false,
      selectedIds: new Set<string>(),
    }));
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

    set((s) =>
      withDerivedSaves(
        s,
        s.allSaves.map((sv) => (sv.id === update.id ? { ...sv, ...update } : sv)),
      ),
    );
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

      return { ...withDerivedSaves(s, allSaves), categories };
    });
  },

  // ── User flags (notification re-ask, trial banner) ────────────────────────

  async checkUserFlags(): Promise<void> {
    try {
      const res = await apiClient.get<{
        notification_reask_due?: boolean;
        trial_expiry_banner_due?: boolean;
        upsell_banner_due?: boolean;
      }>('/users/me');

      let isUpsellSnoozed = false;
      try {
        const dismissedAt = Number(await AsyncStorage.getItem(UPSELL_DISMISSED_KEY));
        isUpsellSnoozed = dismissedAt > 0 && Date.now() - dismissedAt < UPSELL_SNOOZE_MS;
      } catch {
        // Storage unavailable — show the banner
      }

      set({
        notificationReaskDue: res.data.notification_reask_due ?? false,
        trialExpiryBannerDue: res.data.trial_expiry_banner_due ?? false,
        upsellBannerDue: (res.data.upsell_banner_due ?? false) && !isUpsellSnoozed,
      });
    } catch {
      // Ignore
    }
  },

  dismissTrialBanner(): void {
    set({ trialBannerDismissed: true });
  },

  dismissUpsellBanner(): void {
    set({ upsellBannerDue: false });
    void AsyncStorage.setItem(UPSELL_DISMISSED_KEY, String(Date.now())).catch(() => {
      // Not persisted — the banner returns on the next flag check
    });
  },
  };
});

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
      createCategory: s.createCategory,
      updateCategory: s.updateCategory,
      deleteCategory: s.deleteCategory,
      moveCategory: s.moveCategory,
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
      dismissUpsellBanner: s.dismissUpsellBanner,
      loadSortPreference: s.loadSortPreference,
    })),
  );
}
