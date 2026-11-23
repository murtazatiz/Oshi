import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { supabase } from './supabase';
import { LIMIT_TRIGGERS, openPaywall, type LimitErrorCode } from './paywall';

declare module 'axios' {
  interface AxiosRequestConfig {
    /**
     * Don't open the paywall when this request hits a free-tier limit.
     * For background work the user didn't just initiate (offline-queue
     * flushes), which would otherwise pop the paywall on every foreground.
     */
    skipPaywall?: boolean;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Error envelope — API contract §1: { error: { code, message, statusCode } }
// ─────────────────────────────────────────────────────────────────────────────
export interface ApiError {
  code: string;
  message: string;
  statusCode: number;
}

/** The backend's error envelope from a failed request, or null for network/other errors. */
export function getApiError(err: unknown): ApiError | null {
  if (!axios.isAxiosError(err)) return null;
  const body: unknown = err.response?.data;
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const envelope = (body as { error: unknown }).error;
  if (typeof envelope !== 'object' || envelope === null) return null;
  const { code, message, statusCode } = envelope as Record<string, unknown>;
  if (typeof code !== 'string') return null;
  return {
    code,
    message: typeof message === 'string' ? message : 'Something went wrong.',
    statusCode: typeof statusCode === 'number' ? statusCode : err.response?.status ?? 0,
  };
}

export function isLimitError(err: unknown): boolean {
  const code = getApiError(err)?.code;
  return code !== undefined && code in LIMIT_TRIGGERS;
}

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

    // PRD §8.3 — free-tier limits open the paywall from here, so no call
    // site can forget to. The error still rejects so callers can stop work
    // (e.g. halt a batch import) and show their own message.
    const limitCode = getApiError(error)?.code;
    if (
      limitCode !== undefined &&
      limitCode in LIMIT_TRIGGERS &&
      originalRequest?.skipPaywall !== true
    ) {
      openPaywall(LIMIT_TRIGGERS[limitCode as LimitErrorCode]);
      return Promise.reject(error);
    }

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
