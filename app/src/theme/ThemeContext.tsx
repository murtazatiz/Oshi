import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { theme, ColorTokens } from './index';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export type ThemeMode = 'light' | 'dark' | 'system';

/** AsyncStorage key — PRD Section 7.4 */
const THEME_STORAGE_KEY = 'oshi_theme';

export interface ThemeContextValue {
  /** The resolved colour tokens for the current active mode */
  colors: ColorTokens;
  /** The current selected mode ('light' | 'dark' | 'system') */
  mode: ThemeMode;
  /** Whether dark colours are currently active */
  isDark: boolean;
  /** Full theme object (spacing, typography, etc.) */
  theme: typeof theme;
  /**
   * Set the theme mode explicitly.
   * Persists the selection to AsyncStorage under 'oshi_theme'.
   */
  setMode: (mode: ThemeMode) => Promise<void>;
}

// ─────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// ─────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────
interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps): React.JSX.Element {
  const systemColorScheme = useColorScheme();

  /** Default is 'system' per PRD Section 7.4 */
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [isLoaded, setIsLoaded] = useState(false);

  // Restore persisted preference on mount
  useEffect(() => {
    async function loadPersistedMode(): Promise<void> {
      try {
        const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setModeState(saved);
        }
      } catch {
        // Storage read failed — fall back to 'system' silently
      } finally {
        setIsLoaded(true);
      }
    }

    loadPersistedMode();
  }, []);

  const setMode = useCallback(async (newMode: ThemeMode): Promise<void> => {
    setModeState(newMode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, newMode);
    } catch {
      // Storage write failed — in-memory state is still updated
    }
  }, []);

  const isDark = useMemo((): boolean => {
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return systemColorScheme === 'dark';
  }, [mode, systemColorScheme]);

  const colors = useMemo(
    (): ColorTokens => (isDark ? theme.darkColors : theme.colors),
    [isDark],
  );

  const value = useMemo(
    (): ThemeContextValue => ({
      colors,
      mode,
      isDark,
      theme,
      setMode,
    }),
    [colors, mode, isDark, setMode],
  );

  // Render nothing until the persisted preference is loaded to avoid
  // a flash of the wrong theme on startup
  if (!isLoaded) return <></>;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

/**
 * Access the active Oshi theme from any component.
 *
 * @example
 * const { colors, isDark, setMode } = useTheme();
 * <View style={{ backgroundColor: colors.background }} />
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

export default ThemeContext;
