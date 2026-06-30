import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import socket from "../services/socket";

const TOKEN_KEY = "smartchat_token";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setTokenState] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(true);
  const [onlineUsers, setOnlineUsers] = useState(new Set());

  const setToken = useCallback((value) => {
    if (value) {
      localStorage.setItem(TOKEN_KEY, value);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    setTokenState(value);
  }, []);

  useEffect(() => {
    const fetchMe = async () => {
      const stored = localStorage.getItem(TOKEN_KEY);
      if (!stored) {
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        const { data } = await api.get("/auth/me");
        setUser(data.user);
      } catch {
        setUser(null);
        localStorage.removeItem(TOKEN_KEY);
        setTokenState(null);
      } finally {
        setLoading(false);
      }
    };
    fetchMe();
  }, []);

  useEffect(() => {
    if (!user || !token) {
      if (socket.connected) {
        socket.disconnect();
      }
      return;
    }
    
    const onUserStatusChanged = (data) => {
      setOnlineUsers(prev => {
        const newSet = new Set(prev);
        if (data.isOnline) {
          newSet.add(data.userId);
        } else {
          newSet.delete(data.userId);
        }
        return newSet;
      });
    };

    // Set auth and connect only once
    socket.auth = { token };
    
    const handleConnect = () => {
      // Connection established, listener will handle status updates
    };
    
    const handleDisconnect = () => {
      console.log("[auth] Socket disconnected");
    };

    // Only connect if not already connected
    if (!socket.connected && !socket.connecting) {
      socket.connect();
    }

    socket.on("user-status-changed", onUserStatusChanged);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    return () => {
      socket.off("user-status-changed", onUserStatusChanged);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, [user, token]);

  useEffect(() => {
    const onLogout = () => {
      setUser(null);
      setTokenState(null);
    };
    window.addEventListener("auth:logout", onLogout);
    return () => window.removeEventListener("auth:logout", onLogout);
  }, []);

  const login = useCallback(
    async (email, password) => {
      try {
        const { data } = await api.post("/auth/login", { email, password });
        setToken(data.token);
        setUser(data.user);
        return data;
      } catch (err) {
        console.error("Login API error:", err?.message);
        throw err;
      }
    },
    [setToken]
  );

  const register = useCallback(
    async (username, email, password) => {
      try {
        const { data } = await api.post("/auth/register", { username, email, password });
        setToken(data.token);
        setUser(data.user);
        return data;
      } catch (err) {
        console.error("Register API error:", err?.message);
        throw err;
      }
    },
    [setToken],
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
  }, [setToken]);

  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
    } catch {
      setUser(null);
      localStorage.removeItem(TOKEN_KEY);
      setTokenState(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      login,
      register,
      logout,
      refreshUser,
      onlineUsers,
      isUserOnline: (userId) => onlineUsers.has(userId),
    }),
    [user, token, loading, login, register, logout, refreshUser, onlineUsers],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
