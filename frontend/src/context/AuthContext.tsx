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
import type { User } from "@/types";

const STORAGE_KEY = "encore.user";

type AuthContextValue = {
  user: User | null;
  ready: boolean;
  signIn: (user: User) => void;
  updateUser: (partial: Partial<User>) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as User;
        const next =
          !stored.name || stored.name === "Creator"
            ? {
                ...stored,
                name: "Mira Chen",
                email: stored.email === "you@encore.app" ? "mira@encore.app" : stored.email,
                handle: stored.handle || "@mira.studies",
                niche: stored.niche || "Study vlogs",
              }
            : stored;
        setUser(next);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    setReady(true);
  }, []);

  const signIn = useCallback((next: User) => {
    setUser(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const updateUser = useCallback((partial: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...partial };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
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
