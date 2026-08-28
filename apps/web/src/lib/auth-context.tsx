import React, { createContext, useContext, useState } from "react";
import api from "./api";

export interface LoggedInUser {
  membershipId: string;
  userId: string;
  organizationId: string;
  name: string;
  email: string;
  timezone: string;
  isMentor: boolean;
  organizationName: string;
}

interface AuthContextType {
  user: LoggedInUser | null;
  loading: boolean;
  login: (userId: string, organizationId: string) => Promise<LoggedInUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<LoggedInUser | null>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("auth_user");
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return null;
        }
      }
    }
    return null;
  });
  const [loading, setLoading] = useState(false);

  const login = async (userId: string, organizationId: string) => {
    setLoading(true);
    try {
      const res = await api.post<{ message: string; user: LoggedInUser }>("/auth/login", {
        userId,
        organizationId,
      });
      const loggedUser = res.data.user;
      setUser(loggedUser);
      localStorage.setItem("auth_user", JSON.stringify(loggedUser));
      return loggedUser;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await api.post("/auth/logout");
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      setUser(null);
      localStorage.removeItem("auth_user");
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
