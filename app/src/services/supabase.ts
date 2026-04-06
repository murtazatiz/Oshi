import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

// ─────────────────────────────────────────────────────────────────────────────
// SecureStore adapter — satisfies Supabase's SupportedStorage interface.
// PRD §3.5.3: JWT tokens stored in Expo SecureStore ONLY, never AsyncStorage.
// Storage key: 'oshi_session'
// ─────────────────────────────────────────────────────────────────────────────
const SESSION_STORAGE_KEY = 'oshi_session';

const secureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  },
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[Oshi] Missing Supabase env vars. ' +
      'Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to app/.env',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStoreAdapter,
    storageKey: SESSION_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    // Deep links handle the OAuth callback — do not try to parse window.location
    detectSessionInUrl: false,
  },
});
