import { useState } from "react";
import axios from "axios";
import { useAuth } from "./AuthContext";
import "./Auth.css";

export default function AuthPage() {
  const { login } = useAuth();
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      const API_URL = "https://snippet-backend-production.up.railway.app";

const endpoint =
  mode === "login"
    ? `${API_URL}/api/auth/login`
    : `${API_URL}/api/auth/register`;

      const payload =
        mode === "login"
          ? { email: form.email, password: form.password }
          : { name: form.name, email: form.email, password: form.password };

      const res = await axios.post(endpoint, payload);
      login(res.data.user, res.data.token);
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-bg">
      <div className="auth-glow" />
      <div className="auth-card">
        <div className="auth-logo">
          <span className="auth-logo-icon">⌨</span>
          <span className="auth-logo-text">Snippet Manager</span>
        </div>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => { setMode("login"); setError(""); }}
          >
            Sign In
          </button>
          <button
            className={`auth-tab ${mode === "register" ? "active" : ""}`}
            onClick={() => { setMode("register"); setError(""); }}
          >
            Register
          </button>
          <div className={`auth-tab-slider ${mode === "register" ? "right" : ""}`} />
        </div>

        <div className="auth-form">
          {mode === "register" && (
            <div className="auth-field">
              <label>Full Name</label>
              <input
                name="name"
                placeholder="John Doe"
                value={form.name}
                onChange={handle}
              />
            </div>
          )}

          <div className="auth-field">
            <label>Email</label>
            <input
              name="email"
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={handle}
            />
          </div>

          <div className="auth-field">
            <label>Password</label>
            <input
              name="password"
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={handle}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>

          {error && <div className="auth-error">⚠ {error}</div>}

          <button className="auth-submit" onClick={submit} disabled={loading}>
            {loading ? (
              <span className="auth-spinner" />
            ) : mode === "login" ? (
              "Sign In →"
            ) : (
              "Create Account →"
            )}
          </button>
        </div>

        <p className="auth-switch">
          {mode === "login" ? (
            <>Don't have an account?{" "}
              <span onClick={() => { setMode("register"); setError(""); }}>
                Register free
              </span>
            </>
          ) : (
            <>Already have an account?{" "}
              <span onClick={() => { setMode("login"); setError(""); }}>
                Sign in
              </span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
