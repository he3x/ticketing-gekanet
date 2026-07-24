/**
 * src/context/AuthContext.tsx
 * ===========================
 * Provides authentication state and helpers throughout the React app.
 *
 * Usage:
 *   // Wrap your root component
 *   <AuthProvider><App /></AuthProvider>
 *
 *   // Inside any component
 *   const { user, login, logout, isLoading } = useAuth();
 *
 * Login flow:
 *   1. POST /api/v1/auth/login  →  { data: {...}, token }
 *   2. Token + user stored in localStorage via src/lib/api.ts helpers
 *   3. Axios instance auto-attaches Bearer token on every subsequent request
 *
 * Logout:
 *   Clears localStorage and resets state (no server round-trip needed for
 *   stateless JWT).
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import api, {
  clearSession,
  getStoredUser,
  getToken,
  StoredUser,
  storeSession,
} from "../lib/api";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser extends StoredUser {}

interface LoginCredentials {
  username: string;
  password: string;
}

interface LoginResult {
  success: boolean;
  message?: string;
}

interface AuthContextValue {
  /** Currently authenticated user, or null if not logged in. */
  user: AuthUser | null;
  /** True while the initial session-restore check is running. */
  isLoading: boolean;
  /** Attempt login. Returns { success, message }. */
  login: (credentials: LoginCredentials) => Promise<LoginResult>;
  /** Clear the session and log out. */
  logout: () => void;
  /** Whether the user is currently authenticated. */
  isAuthenticated: boolean;
}

// ── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]         = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ── Restore session on mount ─────────────────────────────────────────────
  useEffect(() => {
    const token = getToken();
    const stored = getStoredUser();

    if (token && stored) {
      // Optionally validate against /me to ensure the token is still valid
      api
        .get<{ status: string; data: AuthUser }>("/auth/me")
        .then((res) => {
          setUser(res.data.data);
        })
        .catch(() => {
          // Token expired or invalid — clear and show login
          clearSession();
          setUser(null);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  // ── Login ────────────────────────────────────────────────────────────────
  const login = useCallback(
    async ({ username, password }: LoginCredentials): Promise<LoginResult> => {
      try {
        const res = await api.post<{
          status: string;
          data: AuthUser;
          token: string;
          expiresIn: string;
        }>("/auth/login", { username, password });

        const { data, token } = res.data;
        storeSession(token, data);
        setUser(data);
        return { success: true };
      } catch (err: unknown) {
        let message = "Terjadi kesalahan koneksi";
        if (
          err &&
          typeof err === "object" &&
          "response" in err &&
          (err as { response?: { data?: { message?: string } } }).response?.data
            ?.message
        ) {
          message =
            (err as { response: { data: { message: string } } }).response.data
              .message;
        }
        return { success: false, message };
      }
    },
    []
  );

  // ── Logout ───────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const value: AuthContextValue = {
    user,
    isLoading,
    login,
    logout,
    isAuthenticated: user !== null,
  };

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}

export default AuthContext;