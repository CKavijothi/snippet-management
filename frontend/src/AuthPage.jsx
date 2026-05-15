import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { FiEye, FiEyeOff } from "react-icons/fi";
import { useAuth } from "./AuthContext";
import "./Auth.css";

const API_URL = process.env.REACT_APP_API_URL

/* GOOGLE SIGN IN */

function GoogleSignInButton({ onSuccess, onError }) {
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);

  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    const CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    if (!CLIENT_ID) return;

    function initGoogle() {
      if (!window.google?.accounts?.id) return;

      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: async (response) => {
          try {
            const res = await axios.post(`${API_URL}/api/auth/google`, {
              credential: response.credential,
            });
            onSuccessRef.current(res.data.user, res.data.token);
          } catch (err) {
            onErrorRef.current(
              err.response?.data?.message || "Google sign-in failed"
            );
          }
        },
      });

      window.google.accounts.id.renderButton(
        document.getElementById("google-signin-btn"),
        {
          theme: "filled_black",
          size: "large",
          width: window.innerWidth < 500 ? 320 : 400,
          text: "continue_with",
          shape: "pill",
        }
      );
    }

    // If already loaded
    if (window.google?.accounts?.id) {
      initGoogle();
      return;
    }

    // Avoid duplicate script tags
    if (document.getElementById("google-gis-script")) {
      document.getElementById("google-gis-script")
        .addEventListener("load", initGoogle);
      return;
    }

    const script = document.createElement("script");
    script.id = "google-gis-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = initGoogle;
    document.head.appendChild(script);

  }, []); // ← empty deps: runs ONCE only

  if (!process.env.REACT_APP_GOOGLE_CLIENT_ID) return null;

  return <div id="google-signin-btn" className="google-btn-wrapper" />;
}

/* DIVIDER */

function OrDivider() {
  return (
    <div className="auth-or">
      <span className="auth-or-line"></span>

      <span className="auth-or-text">OR</span>

      <span className="auth-or-line"></span>
    </div>
  );
}

/* MAIN */

export default function AuthPage() {
  const { login } = useAuth();

  const [mode, setMode] = useState("login");

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });

  const [errors, setErrors] = useState({});

  const [serverError, setServerError] = useState("");

  const [loading, setLoading] = useState(false);

  const [showPassword, setShowPassword] = useState(false);

  /* SWITCH MODE */

  const switchMode = (newMode) => {
    setMode(newMode);

    setForm({
      name: "",
      email: "",
      password: "",
    });

    setErrors({});
    setServerError("");
  };

  /* INPUT */

  const handle = (e) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });

    if (errors[e.target.name]) {
      setErrors({
        ...errors,
        [e.target.name]: "",
      });
    }
  };

  /* VALIDATION */

  const validate = () => {
    const errs = {};

    if (
      mode === "register" &&
      !form.name.trim()
    ) {
      errs.name = "Full name is required";
    }

    if (!form.email.trim()) {
      errs.email = "Email is required";
    } else if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)
    ) {
      errs.email = "Enter valid email";
    }

    if (!form.password) {
      errs.password = "Password is required";
    } else if (
      mode === "register" &&
      form.password.length < 6
    ) {
      errs.password =
        "Password must be at least 6 characters";
    }

    return errs;
  };

  /* SUBMIT */

  const submit = async () => {
    setServerError("");

    const errs = validate();

    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setLoading(true);

    try {
      const endpoint =
        mode === "login"
          ? `${API_URL}/api/auth/login`
          : `${API_URL}/api/auth/register`;

      const payload =
        mode === "login"
          ? {
              email: form.email,
              password: form.password,
            }
          : {
              name: form.name,
              email: form.email,
              password: form.password,
            };

      const res = await axios.post(
        endpoint,
        payload
      );

      login(res.data.user, res.data.token);

    } catch (err) {
      setServerError(
        err.response?.data?.message ||
        "Something went wrong"
      );
    } finally {
      setLoading(false);
    }
  };

  /* GOOGLE */

  const handleGoogleSuccess = (user, token) => {
    login(user, token);
  };

  const handleGoogleError = (msg) => {
    setServerError(msg);
  };

  return (
    <div className="auth-bg">
      <div className="auth-card">

        {/* LOGO */}

        <div className="auth-logo">
          <span className="auth-logo-icon">
            ⌨
          </span>

          <span className="auth-logo-text">
            Snippet Manager
          </span>
        </div>

        {/* TABS */}

        <div className="auth-tabs">

          <button
            className={`auth-tab ${
              mode === "login" ? "active" : ""
            }`}
            onClick={() => switchMode("login")}
          >
            Sign In
          </button>

          <button
            className={`auth-tab ${
              mode === "register" ? "active" : ""
            }`}
            onClick={() => switchMode("register")}
          >
            Register
          </button>

        </div>

        {/* GOOGLE */}

        <GoogleSignInButton
          onSuccess={handleGoogleSuccess}
          onError={handleGoogleError}
        />

        {process.env.REACT_APP_GOOGLE_CLIENT_ID && (
          <OrDivider />
        )}

        {/* FORM */}

        <div className="auth-form">

          {/* NAME */}

          {mode === "register" && (
            <div className="auth-field">

              <label>FULL NAME</label>

              <input
                type="text"
                name="name"
                placeholder="John Doe"
                value={form.name}
                onChange={handle}
              />

              {errors.name && (
                <span className="field-error">
                  {errors.name}
                </span>
              )}

            </div>
          )}

          {/* EMAIL */}

          <div className="auth-field">

            <label>EMAIL</label>

            <input
              type="email"
              name="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={handle}
            />

            {errors.email && (
              <span className="field-error">
                {errors.email}
              </span>
            )}

          </div>


{/* PASSWORD */}

<div className="auth-field">

  <label>PASSWORD</label>

  <div className="password-wrapper">

    <input
      id="password"
      name="password"
      type={showPassword ? "text" : "password"}
      autoComplete={
        mode === "login"
          ? "current-password"
          : "new-password"
      }
      placeholder="••••••••"
      value={form.password}
      onChange={handle}
      onKeyDown={(e) =>
        e.key === "Enter" && submit()
      }
    />

    <button
      type="button"
      className="password-toggle"
      onClick={() =>
        setShowPassword(!showPassword)
      }
    >
      {showPassword ? (
        <FiEyeOff />
      ) : (
        <FiEye />
      )}
    </button>

  </div>

  {errors.password && (
    <span className="field-error">
      {errors.password}
    </span>
  )}

</div>

          {/* ERROR */}

          {serverError && (
            <div className="auth-error">
              ⚠ {serverError}
            </div>
          )}

          {/* SUBMIT */}

          <button
            className="auth-submit"
            onClick={submit}
            disabled={loading}
          >
            {loading
              ? "Please wait..."
              : mode === "login"
              ? "Sign In →"
              : "Create Account →"}
          </button>

        </div>

        {/* SWITCH */}

        <p className="auth-switch">

          {mode === "login" ? (
            <>
              Don’t have an account?{" "}
              <span
                onClick={() =>
                  switchMode("register")
                }
              >
                Register free
              </span>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <span
                onClick={() =>
                  switchMode("login")
                }
              >
                Sign In
              </span>
            </>
          )}

        </p>

      </div>
    </div>
  
  );
}