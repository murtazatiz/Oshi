import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { supabase } from './supabase';

// ─────────────────────────────────────────────────────────────────────────────
// Base URLs per environment — set via EAS build profiles in eas.json
// PRD §5.2 — three environments: development, staging, production
// ─────────────────────────────────────────────────────────────────────────────
const BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

// ─────────────────────────────────────────────────────────────────────────────
// Axios instance
// ─────────────────────────────────────────────────────────────────────────────
export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Request interceptor — attach current JWT to every request
// ─────────────────────────────────────────────────────────────────────────────
apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }

  return config;
});

// ─────────────────────────────────────────────────────────────────────────────
// Response interceptor — 401 silent refresh
// PRD §3.5.3: On 401 attempt one silent token refresh.
// If refresh fails: clear SecureStore and redirect to Login.
// ─────────────────────────────────────────────────────────────────────────────
let isRefreshing = false;
let pendingQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

function drainQueue(token: string | null, error: unknown): void {
  pendingQueue.forEach(({ resolve, reject }) => {
    if (token) resolve(token);
    else reject(error);
  });
  pendingQueue = [];
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retried?: boolean;
    };

    if (error.response?.status !== 401 || originalRequest._retried) {
      return Promise.reject(error);
    }

    originalRequest._retried = true;

    if (isRefreshing) {
      // Queue requests that arrive while a refresh is already in-flight
      return new Promise((resolve, reject) => {
        pendingQueue.push({
          resolve: (token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(apiClient(originalRequest));
          },
          reject,
        });
      });
    }

    isRefreshing = true;

    try {
      const { data, error: refreshError } = await supabase.auth.refreshSession();

      if (refreshError || !data.session) {
        drainQueue(null, refreshError);
        // Session is unrecoverable — authStore listens to onAuthStateChange
        // and will redirect to Login automatically when the session is cleared
        await supabase.auth.signOut();
        return Promise.reject(refreshError ?? new Error('Session expired'));
      }

      const newToken = data.session.access_token;
      drainQueue(newToken, null);

      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      return apiClient(originalRequest);
    } finally {
      isRefreshing = false;
    }
  },
);
