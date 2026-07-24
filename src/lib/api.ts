/**
 * src/lib/api.ts
 * ==============
 * Axios instance pre-configured for the /api/v1 backend.
 *
 * Features:
 *  - Automatically attaches `Authorization: Bearer <token>` if a token is
 *    stored in localStorage under the key "auth_token".
 *  - On 401 responses, clears the stored credentials and reloads the page
 *    so the login screen appears.
 *  - All requests go to /api/v1 (proxied by Vite in dev, served directly
 *    by Express in production).
 */

import axios from "axios";

// ── Constants ────────────────────────────────────────────────────────────────
export const TOKEN_KEY = "auth_token";
export const USER_KEY  = "auth_user";

// ── Storage helpers ──────────────────────────────────────────────────────────
export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const getStoredUser = (): StoredUser | null => {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as StoredUser) : null;
  } catch {
    return null;
  }
};

export interface StoredUser {
  userId:   string;
  username: string;
  role:     string;
  name:     string;
  phone?:   string | null;
}

export const storeSession = (token: string, user: StoredUser): void => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const clearSession = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

// ── Axios instance ───────────────────────────────────────────────────────────
const api = axios.create({
  baseURL: "/api/v1",
  headers: { "Content-Type": "application/json" },
  withCredentials: false,
});

// Request interceptor — attach Bearer token
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — handle 401 globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      clearSession();
      // Reload so React renders the login screen
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

export default api;