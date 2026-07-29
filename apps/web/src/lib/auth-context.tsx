"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, setAccessToken } from "./apiClient";

export interface Operator {
  id: string;
  name: string;
  email: string;
  role: "admin" | "operator" | "viewer";
  companyId: string;
}

interface AuthContextValue {
  operator: Operator | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [operator, setOperator] = useState<Operator | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const result = await apiRequest<{ accessToken: string; operator: Operator }>(
        "/api/auth/refresh",
        { method: "POST", skipAuth: true },
      );
      if (!cancelled) {
        if (result.success) {
          setAccessToken(result.data.accessToken);
          setOperator(result.data.operator);
        }
        setLoading(false);
      }
    }

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiRequest<{ accessToken: string; operator: Operator }>(
      "/api/auth/login",
      {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({ email, password }),
      },
    );

    if (result.success) {
      setAccessToken(result.data.accessToken);
      setOperator(result.data.operator);
      return { success: true };
    }
    return { success: false, message: result.error.message };
  }, []);

  const logout = useCallback(async () => {
    await apiRequest("/api/auth/logout", { method: "POST" });
    setAccessToken(null);
    setOperator(null);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ operator, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
