import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

const STORAGE_KEY = 'oshi_onboarding_complete';

interface OnboardingState {
  /** True once the user finishes (or skips) the last onboarding step */
  isComplete: boolean;
  /** True after AsyncStorage has been read — prevents a flash of the wrong stack */
  isLoaded: boolean;
}

interface OnboardingActions {
  /** Called once on app open to hydrate from AsyncStorage */
  load: () => Promise<void>;
  /** Called when the user finishes step 9 (or explicitly skips) */
  markComplete: () => Promise<void>;
  /** Internal — for testing or account deletion flows */
  reset: () => Promise<void>;
}

type OnboardingStore = OnboardingState & OnboardingActions;

export const useOnboardingStore = create<OnboardingStore>((set) => ({
  isComplete: false,
  isLoaded: false,

  async load(): Promise<void> {
    try {
      const val = await AsyncStorage.getItem(STORAGE_KEY);
      set({ isComplete: val === 'true', isLoaded: true });
    } catch {
      // If storage fails, default to showing onboarding (safe fallback)
      set({ isComplete: false, isLoaded: true });
    }
  },

  async markComplete(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // In-memory state still updates even if persistence fails
    }
    set({ isComplete: true });
  },

  async reset(): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
    set({ isComplete: false });
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Typed selector hooks
// ─────────────────────────────────────────────────────────────────────────────

export function useOnboardingReady(): { isComplete: boolean; isLoaded: boolean } {
  return useOnboardingStore(
    useShallow((s) => ({ isComplete: s.isComplete, isLoaded: s.isLoaded })),
  );
}

export function useOnboardingActions(): {
  load: () => Promise<void>;
  markComplete: () => Promise<void>;
  reset: () => Promise<void>;
} {
  return useOnboardingStore(
    useShallow((s) => ({ load: s.load, markComplete: s.markComplete, reset: s.reset })),
  );
}
