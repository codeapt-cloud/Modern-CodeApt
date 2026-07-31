/**
 * AuthProvider — holds the browser session (hydrated from the httpOnly-cookie
 * session via GET /api/me) and exposes login/register/logout/changePassword.
 *
 * Navigation is intentionally NOT done here; route guards react to the state
 * (`status`, `mustChangePassword`). The api-client's interceptor calls back
 * into here on session-expiry and forced-password-change.
 */
import type {
  AuthResponse,
  ChangePasswordInput,
  LoginInput,
  PublicProfile,
  PublicUser,
  RegisterInput,
  RegisterResponse,
} from "@codeapt/shared";
import { AuthErrorCode } from "@codeapt/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api, parseApiError, setAuthEventHandlers } from "../lib/api-client.js";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthState {
  status: AuthStatus;
  user: PublicUser | null;
  profile: PublicProfile | null;
  /** True when the server requires a password change before app access. */
  mustChangePassword: boolean;
}

interface AuthContextValue extends AuthState {
  login: (input: LoginInput) => Promise<AuthResponse>;
  register: (input: RegisterInput) => Promise<RegisterResponse>;
  logout: () => Promise<void>;
  changePassword: (input: ChangePasswordInput) => Promise<AuthResponse>;
  refresh: () => Promise<void>;
}

const GUEST: AuthState = {
  status: "unauthenticated",
  user: null,
  profile: null,
  mustChangePassword: false,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    ...GUEST,
    status: "loading",
  });

  const refresh = useCallback(async () => {
    try {
      const { user, profile } = await api.me.get();
      setState({
        status: "authenticated",
        user,
        profile,
        mustChangePassword: user.forcePasswordChange,
      });
    } catch (err) {
      const parsed = parseApiError(err);
      if (
        parsed.status === 403 &&
        parsed.code === AuthErrorCode.FORCE_PASSWORD_CHANGE
      ) {
        // Authed but /me is gated; keep session, force the change screen.
        setState({
          status: "authenticated",
          user: null,
          profile: null,
          mustChangePassword: true,
        });
      } else {
        setState(GUEST);
      }
    }
  }, []);

  // Register interceptor callbacks + hydrate on mount.
  useEffect(() => {
    setAuthEventHandlers({
      onSessionExpired: () => setState(GUEST),
      onForcePasswordChange: () =>
        setState((s) => ({
          ...s,
          status: "authenticated",
          mustChangePassword: true,
        })),
    });
    void refresh();
    return () => setAuthEventHandlers({});
  }, [refresh]);

  const login = useCallback(async (input: LoginInput) => {
    const res = await api.auth.login(input);
    setState({
      status: "authenticated",
      user: res.user,
      profile: res.profile,
      mustChangePassword: res.user.forcePasswordChange,
    });
    return res;
  }, []);

  const register = useCallback(
    (input: RegisterInput) => api.auth.register(input),
    [],
  );

  const changePassword = useCallback(async (input: ChangePasswordInput) => {
    const res = await api.auth.changePassword(input);
    setState({
      status: "authenticated",
      user: res.user,
      profile: res.profile,
      mustChangePassword: false,
    });
    return res;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      setState(GUEST);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, register, logout, changePassword, refresh }),
    [state, login, register, logout, changePassword, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
