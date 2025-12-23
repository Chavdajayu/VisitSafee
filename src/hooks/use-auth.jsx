import { createContext, useContext, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { storage } from "../lib/storage";
import { useQueryClient } from "@tanstack/react-query";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // ✅ RESTORE SESSION ON PAGE REFRESH
  useEffect(() => {
    let mounted = true;

    const restoreSession = async () => {
      try {
        const currentUser = await storage.getCurrentUser();
        if (mounted) {
          setUser(currentUser);
          queryClient.setQueryData(["/api/user"], currentUser);
        }
      } catch (err) {
        console.error("Session restore failed:", err);
        if (mounted) setUser(null);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    restoreSession();

    return () => {
      mounted = false;
    };
  }, []);

  // ✅ LOGIN
  const login = async (credentials, options = {}) => {
    setIsLoggingIn(true);
    try {
      const loggedInUser = await storage.login(credentials);

      setUser(loggedInUser);
      queryClient.setQueryData(["/api/user"], loggedInUser);

      const societyPath = loggedInUser.residencyName
        ? `/${encodeURIComponent(loggedInUser.residencyName)}`
        : "/unknown-society";

      if (loggedInUser.role === "admin") {
        setLocation(`${societyPath}/admin`);
      } else if (loggedInUser.role === "guard") {
        setLocation(`${societyPath}/guard`);
      } else {
        const flatPath = loggedInUser.flatNumber
          ? `/${loggedInUser.flatNumber}`
          : "";
        setLocation(`${societyPath}/resident${flatPath}`);
      }

      options.onSuccess?.(loggedInUser);
    } catch (error) {
      options.onError?.(error);
      throw error;
    } finally {
      setIsLoggingIn(false);
    }
  };

  // ✅ LOGOUT
  const logout = async () => {
    await storage.logout();
    setUser(null);
    queryClient.setQueryData(["/api/user"], null);
    setLocation("/login");
  };

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isLoggingIn, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
