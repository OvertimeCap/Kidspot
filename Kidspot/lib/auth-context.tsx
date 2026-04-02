import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest, setAuthToken } from "@/lib/query-client";

const TOKEN_STORAGE_KEY = "kidspot_auth_token";
const USER_STORAGE_KEY = "kidspot_auth_user";
const LAST_ACTIVE_KEY = "kidspot_last_active";
const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export type UserRole = "admin" | "colaborador" | "parceiro" | "estabelecimento" | "usuario";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  linked_place_id?: string | null;
  linked_place_name?: string | null;
  linked_place_address?: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  loginWithGoogle: (accessToken: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  isLoading: true,
  login: async () => {},
  register: async () => {},
  loginWithGoogle: async () => {},
  logout: async () => {},
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const sessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSession = useCallback(async () => {
    if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current);
    setToken(null);
    setUser(null);
    setAuthToken(null);
    await Promise.all([
      AsyncStorage.removeItem(TOKEN_STORAGE_KEY),
      AsyncStorage.removeItem(USER_STORAGE_KEY),
      AsyncStorage.removeItem(LAST_ACTIVE_KEY),
    ]);
  }, []);

  const resetSessionTimer = useCallback(() => {
    if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current);
    AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())).catch(() => {});
    sessionTimerRef.current = setTimeout(() => {
      clearSession();
    }, SESSION_TIMEOUT_MS);
  }, [clearSession]);

  const fetchAndSetUser = useCallback(async () => {
    const res = await apiRequest("GET", "/api/auth/me");
    if (!res.ok) return null;
    const data = await res.json();
    const payload = data.user as {
      userId: string;
      name: string;
      email: string;
      role: UserRole;
      linked_place_id?: string | null;
      linked_place_name?: string | null;
      linked_place_address?: string | null;
    };
    const validatedUser: AuthUser = {
      id: payload.userId,
      name: payload.name,
      email: payload.email,
      role: payload.role,
      linked_place_id: payload.linked_place_id,
      linked_place_name: payload.linked_place_name,
      linked_place_address: payload.linked_place_address,
    };
    setUser(validatedUser);
    await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(validatedUser));
    return validatedUser;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const savedToken = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
        if (!savedToken) return;

        const lastActiveStr = await AsyncStorage.getItem(LAST_ACTIVE_KEY);
        if (lastActiveStr) {
          const lastActive = parseInt(lastActiveStr, 10);
          if (Date.now() - lastActive > SESSION_TIMEOUT_MS) {
            await Promise.all([
              AsyncStorage.removeItem(TOKEN_STORAGE_KEY),
              AsyncStorage.removeItem(USER_STORAGE_KEY),
              AsyncStorage.removeItem(LAST_ACTIVE_KEY),
            ]);
            return;
          }
        }

        setAuthToken(savedToken);
        const validatedUser = await fetchAndSetUser();
        if (!validatedUser) {
          await Promise.all([
            AsyncStorage.removeItem(TOKEN_STORAGE_KEY),
            AsyncStorage.removeItem(USER_STORAGE_KEY),
            AsyncStorage.removeItem(LAST_ACTIVE_KEY),
          ]);
          setAuthToken(null);
          return;
        }
        setToken(savedToken);
        resetSessionTimer();
      } catch {
        // ignore storage or network errors — user stays logged out
      } finally {
        setIsLoading(false);
      }
    })();
  }, [fetchAndSetUser, resetSessionTimer]);

  const persist = useCallback(async (newToken: string, newUser: AuthUser) => {
    setToken(newToken);
    setUser(newUser);
    setAuthToken(newToken);
    await Promise.all([
      AsyncStorage.setItem(TOKEN_STORAGE_KEY, newToken),
      AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(newUser)),
    ]);
    resetSessionTimer();
  }, [resetSessionTimer]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/login", { email, password });
    const data = await res.json();
    await persist(data.token, data.user);
  }, [persist]);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/register", { name, email, password });
    const data = await res.json();
    await persist(data.token, data.user);
  }, [persist]);

  const loginWithGoogle = useCallback(async (accessToken: string) => {
    const res = await apiRequest("POST", "/api/auth/google", { accessToken });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    const data = await res.json();
    await persist(data.token, data.user);
  }, [persist]);

  const logout = useCallback(async () => {
    await clearSession();
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    try {
      await fetchAndSetUser();
    } catch {
      // silent
    }
  }, [fetchAndSetUser]);

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active" && token) {
        resetSessionTimer();
      }
    };
    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => sub.remove();
  }, [token, resetSessionTimer]);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, loginWithGoogle, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrador",
  colaborador: "Colaborador",
  parceiro: "Parceiro",
  estabelecimento: "Estabelecimento",
  usuario: "Usuário",
};

export const ROLE_COLORS: Record<UserRole, string> = {
  admin: "#7C3AED",
  colaborador: "#2563EB",
  parceiro: "#D97706",
  estabelecimento: "#0891B2",
  usuario: "#059669",
};
