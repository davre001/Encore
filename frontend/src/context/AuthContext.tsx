"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthSession, User } from "@/types";

const STORAGE_KEY = "encore.user";
const TOKEN_KEY = "encore.accessToken";

type AuthContextValue = {
  user: User | null;
  ready: boolean;
  signIn: (session: AuthSession, remember?: boolean) => void;
  updateUser: (partial: Partial<User>) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function clearStoredSession() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

function readStoredSession(): User | null {
  const persistentUser = localStorage.getItem(STORAGE_KEY);
  const persistentToken = localStorage.getItem(TOKEN_KEY);
  if (persistentUser && persistentToken) {
    return JSON.parse(persistentUser) as User;
  }

  const sessionUser = sessionStorage.getItem(STORAGE_KEY);
  const sessionToken = sessionStorage.getItem(TOKEN_KEY);
  if (sessionUser && sessionToken) {
    return JSON.parse(sessionUser) as User;
  }

  clearStoredSession();
  return null;
}

function activeStorage() {
  return localStorage.getItem(TOKEN_KEY) ? localStorage : sessionStorage;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setUser(readStoredSession());
    } catch {
      clearStoredSession();
    }
    setReady(true);
  }, []);

  const signIn = useCallback((session: AuthSession, remember = true) => {
    clearStoredSession();
    const storage = remember ? localStorage : sessionStorage;
    setUser(session.user);
    storage.setItem(STORAGE_KEY, JSON.stringify(session.user));
    storage.setItem(TOKEN_KEY, session.accessToken);
  }, []);

  const updateUser = useCallback((partial: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...partial };
      activeStorage().setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    clearStoredSession();
  }, []);

  const value = useMemo(
    () => ({ user, ready, signIn, updateUser, signOut }),
    [user, ready, signIn, updateUser, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
