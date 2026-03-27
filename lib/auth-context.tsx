import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest, setAuthToken } from "@/lib/query-client";

const TOKEN_STORAGE_KEY = "kidspot_auth_token";
const USER_STORAGE_KEY = "kidspot_auth_user";

export type UserRole = "admin" | "colaborador" | "parceiro" | "usuario";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  isLoading: true,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const savedToken = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
        if (!savedToken) return;

        setAuthToken(savedToken);
        const res = await apiRequest("GET", "/api/auth/me");
        if (!res.ok) {
          await Promise.all([
            AsyncStorage.removeItem(TOKEN_STORAGE_KEY),
            AsyncStorage.removeItem(USER_STORAGE_KEY),
          ]);
          setAuthToken(null);
          return;
        }

        const data = await res.json();
        const payload = data.user as { userId: string; name: string; email: string; role: UserRole };
        const validatedUser: AuthUser = {
          id: payload.userId,
          name: payload.name,
          email: payload.email,
          role: payload.role,
        };
        setToken(savedToken);
        setUser(validatedUser);
        await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(validatedUser));
      } catch {
        // ignore storage or network errors — user stays logged out
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const persist = useCallback(async (newToken: string, newUser: AuthUser) => {
    setToken(newToken);
    setUser(newUser);
    setAuthToken(newToken);
    await Promise.all([
      AsyncStorage.setItem(TOKEN_STORAGE_KEY, newToken),
      AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(newUser)),
    ]);
  }, []);

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

  const logout = useCallback(async () => {
    setToken(null);
    setUser(null);
    setAuthToken(null);
    await Promise.all([
      AsyncStorage.removeItem(TOKEN_STORAGE_KEY),
      AsyncStorage.removeItem(USER_STORAGE_KEY),
    ]);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout }}>
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
  usuario: "Usuário",
};

export const ROLE_COLORS: Record<UserRole, string> = {
  admin: "#7C3AED",
  colaborador: "#2563EB",
  parceiro: "#D97706",
  usuario: "#059669",
};
