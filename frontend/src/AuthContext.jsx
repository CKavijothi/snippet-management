import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";

const AuthContext = createContext({
  user: null, token: null,
  login: () => {}, logout: () => {}, isTokenValid: () => false,
});

function decodeJwt(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch { return null; }
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
    } catch { return null; }
  });

  const [token, setToken] = useState(() => {
    const saved = localStorage.getItem("snippet_token");
    return saved && tokenIsValid(saved) ? saved : null;
  });

  // ── NEW: track session expiry warning ──────────────────────────────────
  const [sessionWarning, setSessionWarning] = useState(false);
  const warningTimerRef = useRef(null);
  const expiryTimerRef = useRef(null);

  const logout = useCallback((reason = "") => {
    setUser(null);
    setToken(null);
    setSessionWarning(false);
    clearTimeout(warningTimerRef.current);
    clearTimeout(expiryTimerRef.current);
    localStorage.removeItem("snippet_user");
    localStorage.removeItem("snippet_token");
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
    // ── NEW: store reason so PrivateRoute can show a message ──────────────
    if (reason) sessionStorage.setItem("logout_reason", reason);
  }, []);

  // ── NEW: warn 2 min before expiry, then auto-logout ────────────────────
  useEffect(() => {
    clearTimeout(warningTimerRef.current);
    clearTimeout(expiryTimerRef.current);
    if (!token) return;

    const payload = decodeJwt(token);
    if (!payload?.exp) return;

    const msUntilExpiry = payload.exp * 1000 - Date.now();
    if (msUntilExpiry <= 0) { logout("expired"); return; }

    const WARN_BEFORE = 2 * 60 * 1000; // 2 minutes
    const msUntilWarn = msUntilExpiry - WARN_BEFORE;

    if (msUntilWarn > 0) {
      warningTimerRef.current = setTimeout(() => setSessionWarning(true), msUntilWarn);
    } else {
      setSessionWarning(true); // already within the 2-min window
    }

    expiryTimerRef.current = setTimeout(() => logout("expired"), msUntilExpiry);
    return () => {
      clearTimeout(warningTimerRef.current);
      clearTimeout(expiryTimerRef.current);
    };
  }, [token, logout]);

  // ── NEW: detect stale token when tab regains focus ─────────────────────
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        const stored = localStorage.getItem("snippet_token");
        if (!stored || !tokenIsValid(stored)) logout("expired");
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [logout]);

  // ── NEW: sync logout across tabs ───────────────────────────────────────
  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === "snippet_token" && !e.newValue) logout();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [logout]);

  // On mount: discard stale token
  useEffect(() => {
    const storedToken = localStorage.getItem("snippet_token");
    if (storedToken && !tokenIsValid(storedToken)) logout("expired");
  }, [logout]);

  const login = useCallback((userData, tokenData) => {
    setUser(userData);
    setToken(tokenData);
    setSessionWarning(false);
    sessionStorage.removeItem("logout_reason");
    localStorage.setItem("snippet_user", JSON.stringify(userData));
    localStorage.setItem("snippet_token", tokenData);
  }, []);

  const isTokenValid = useCallback(() => tokenIsValid(token), [token]);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isTokenValid, sessionWarning, setSessionWarning }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);