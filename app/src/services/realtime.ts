/**
 * Supabase Realtime — live save updates (API Contract §8).
 *
 * This module owns the postgres_changes subscription on the `saves` table:
 * the BullMQ worker on the backend updates a row when AI processing finishes,
 * Supabase fires the change event, and this module merges the new row into
 * savesStore (which re-derives the visible list). Category counts are
 * refreshed when processing completes or a save moves category.
 *
 * One subscription app-wide (the channel name 'saves-updates' is global), so
 * the channel lives here as a module singleton rather than in a screen ref.
 * Screens call subscribe/unsubscribe from their mount effects.
 */
import { supabase } from './supabase';
import { useSavesStore } from '../store/savesStore';
import type { SaveData } from '../components/OshiCard';

/** Row shape delivered by Realtime — snake_case, may carry category_id instead of a nested category. */
export type SaveRealtimeRow = Partial<SaveData> & { id: string; category_id?: string };

let channel: ReturnType<typeof supabase.channel> | null = null;

/**
 * Subscribe to UPDATE events on the saves table and route them into
 * savesStore. Idempotent — an existing subscription is replaced.
 */
export function subscribeToSaveUpdates(): void {
  unsubscribeFromSaveUpdates();

  channel = supabase
    .channel('saves-updates')
    .on(
      'postgres_changes' as 'system',
      { event: 'UPDATE', schema: 'public', table: 'saves' } as Record<string, string>,
      (payload: { eventType?: string; new: SaveRealtimeRow }) => {
        const state = useSavesStore.getState();
        const newRow = payload.new;
        const existing = state.allSaves.find((s) => s.id === newRow.id);
        const processingComplete = newRow.processing_status === 'complete';
        const newCategoryId = newRow.category?.id ?? newRow.category_id;
        const categoryChanged =
          existing !== undefined &&
          newCategoryId !== undefined &&
          existing.category?.id !== newCategoryId;

        // Update in-memory — filter auto-re-derives visible saves
        state.updateSave(newRow);

        // Refresh category counts when processing finishes or save moves categories
        if (processingComplete || categoryChanged) {
          void state.fetchCategories();
        }
      },
    )
    .subscribe();
}

/** Tear down the subscription (call on sign-out / screen unmount). */
export function unsubscribeFromSaveUpdates(): void {
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }
}
