import { createContext, useContext, useState, useEffect, useCallback } from "react";

const AuthContext = createContext({
  user: null,
  token: null,
  login: () => {},
  logout: () => {},
  isTokenValid: () => false,
});

function decodeJwt(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

function tokenIsValid(token) {
  if (!token) return false;
  const payload = decodeJwt(token);
  if (!payload?.exp) return false;
  return payload.exp * 1000 > Date.now() + 30_000;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem("snippet_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState(() => {
    const saved = localStorage.getItem("snippet_token");
    return saved && tokenIsValid(saved) ? saved : null;
  });

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("snippet_user");
    localStorage.removeItem("snippet_token");
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
  }, []);

  // Auto-logout precisely when the token expires
  useEffect(() => {
    if (!token) return;
    const payload = decodeJwt(token);
    if (!payload?.exp) return;
    const msUntilExpiry = payload.exp * 1000 - Date.now();
    if (msUntilExpiry <= 0) { logout(); return; }
    const timer = setTimeout(logout, msUntilExpiry);
    return () => clearTimeout(timer);
  }, [token, logout]);

  // On mount: discard any stale token that slipped through
  useEffect(() => {
    const storedToken = localStorage.getItem("snippet_token");
    if (storedToken && !tokenIsValid(storedToken)) {
      logout();
    }
  }, [logout]);

  const login = useCallback((userData, tokenData) => {
    setUser(userData);
    setToken(tokenData);
    localStorage.setItem("snippet_user", JSON.stringify(userData));
    localStorage.setItem("snippet_token", tokenData);
  }, []);

  const isTokenValid = useCallback(() => tokenIsValid(token), [token]);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isTokenValid }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);