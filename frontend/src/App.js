import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { dracula } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useAuth } from "./AuthContext";
import PrivateRoute from "./PrivateRoute";
import "./App.css";

// ✅ Block any accidental window.print() calls from libraries (e.g. Pyodide)
window.print = () => {};

let pyodide = null;
let pyodideLoading = false;
const API_URL = "https://snippet-management-production.up.railway.app";

const api = (token) =>
  axios.create({
    baseURL: API_URL,
    headers: { Authorization: `Bearer ${token}` },
  });

// ─── Authenticated app shell ──────────────────────────────────────────────
function AppShell() {
  const { user, token, logout, sessionWarning, setSessionWarning } = useAuth();

  const [snippets, setSnippets] = useState([]);
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("javascript");
  const [isPublic, setIsPublic] = useState(false);
  const [tags, setTags] = useState("");
  const [expiresIn, setExpiresIn] = useState("");
  const [search, setSearch] = useState("");
  const [outputs, setOutputs] = useState({});
  // ✅ Ref stores live output per snippet id — avoids stale closure in window._pyAppendOutput
  const outputRef = useRef({});
  const [filter, setFilter] = useState("all");

  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCode, setEditCode] = useState("");

  const [versionsFor, setVersionsFor] = useState(null);
  const [versions, setVersions] = useState([]);
  const [versionsTitle, setVersionsTitle] = useState("");

  const fetchSnippets = async (searchText = "") => {
    try {
      const res = await api(token).get(`/api/snippets?search=${searchText}`);
      setSnippets(res.data || []);
    } catch (err) {
      console.log(err);
    }
  };

  useEffect(() => {
    if (user) fetchSnippets("");
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const addSnippet = async () => {
    if (!title || !code) return alert("Fill all fields");
    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    await api(token).post("/api/snippets", {
      title,
      code,
      language,
      is_public: isPublic,
      tags: tagList,
      expires_in: expiresIn ? parseInt(expiresIn) : 0,
    });
    setTitle("");
    setCode("");
    setTags("");
    setExpiresIn("");
    fetchSnippets(search);
  };

  const deleteSnippet = async (id) => {
    await api(token).delete(`/api/snippets/${id}`);
    fetchSnippets(search);
  };

  const toggleVisibility = async (snippet) => {
    await api(token).patch(`/api/snippets/${snippet.id}/visibility`, {
      is_public: !snippet.is_public,
    });
    fetchSnippets(search);
  };

  const startEdit = (s) => {
    setEditingId(s.id);
    setEditTitle(s.title);
    setEditCode(s.code);
  };

  const saveEdit = async (id) => {
    await api(token).put(`/api/snippets/${id}`, {
      title: editTitle,
      code: editCode,
    });
    setEditingId(null);
    fetchSnippets(search);
  };

  const openVersions = async (s) => {
    const res = await api(token).get(`/api/snippets/${s.id}/versions`);
    setVersions(res.data);
    setVersionsFor(s.id);
    setVersionsTitle(s.title);
  };

  const restoreVersion = async (snippetId, versionId) => {
    await api(token).post(`/api/snippets/${snippetId}/restore/${versionId}`);
    setVersionsFor(null);
    fetchSnippets(search);
    alert("Version restored!");
  };

  // ── Run Code ───────────────────────────────────────────────────────────────
  const runCode = async (id, codeText, lang) => {

    // ── HTML: render inline via srcDoc iframe ──────────────────────────────
    if (lang === "html") {
      setOutputs((prev) => ({ ...prev, [id]: "__html__" }));
      return;
    }

    // ── JavaScript: sandboxed iframe with streaming console + alert/confirm/prompt ──
    if (lang === "javascript") {
      setOutputs((prev) => ({ ...prev, [id]: "" }));

      // Remove any previous iframe for this snippet
      const existing = document.getElementById(`run-frame-${id}`);
      if (existing) existing.remove();

      const iframe = document.createElement("iframe");
      iframe.id = `run-frame-${id}`;
      // allow-modals enables alert(), confirm(), prompt()
      iframe.sandbox = "allow-scripts allow-modals";
      iframe.style.cssText =
        "display:none;width:0;height:0;border:none;position:absolute;";

      iframe.srcdoc = `
        <script>
          // Stream each console call to parent immediately
          const send = (line) => {
            window.parent.postMessage({ snippetId: ${id}, chunk: line + "\\n" }, "*");
          };

          console.log = (...args) =>
            send(args.map(a =>
              typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)
            ).join(" "));

          console.error = (...args) =>
            send("ERROR: " + args.map(String).join(" "));

          console.warn = (...args) =>
            send("WARN: " + args.map(String).join(" "));

          console.info = (...args) =>
            send("INFO: " + args.map(String).join(" "));

          // Run user code — alert/confirm/prompt work natively via allow-modals
          try {
            ${codeText}
          } catch (e) {
            send("Error: " + e.message);
          }

          // After 15s send done to auto-cleanup iframe
          setTimeout(() => {
            window.parent.postMessage({ snippetId: ${id}, done: true }, "*");
          }, 15000);
        <\/script>
      `;

      document.body.appendChild(iframe);
      return;
    }

    // ── Python: Pyodide WASM runtime with live streaming output ──────────
    if (lang === "python") {
      setOutputs((prev) => ({ ...prev, [id]: "Loading Python runtime..." }));
      try {
        // Load Pyodide script tag if not already loaded
        if (!window.loadPyodide) {
          await new Promise((resolve, reject) => {
            const existing = document.getElementById("pyodide-script");
            if (existing) { resolve(); return; }
            const script = document.createElement("script");
            script.id = "pyodide-script";
            script.src =
              "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js";
            script.onload = resolve;
            script.onerror = () =>
              reject(new Error("Failed to load Pyodide script"));
            document.head.appendChild(script);
          });
        }

        // Initialize Pyodide once (first run takes ~5s)
        if (!pyodide && !pyodideLoading) {
          pyodideLoading = true;
          setOutputs((prev) => ({
            ...prev,
            [id]: "Initializing Python (first run takes ~5s)...",
          }));
          pyodide = await window.loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/",
          });
          pyodideLoading = false;
        }

        // Clear output box before running
        setOutputs((prev) => ({ ...prev, [id]: "" }));

        // ✅ Use a ref to accumulate output — avoids stale closure problem
        // window._pyAppendOutput is called synchronously by Python on each print()
        outputRef.current[id] = "";
        window._pyAppendOutput = (text) => {
          outputRef.current[id] = (outputRef.current[id] || "") + text;
          // Force React to re-render by spreading the ref value into state
          setOutputs((prev) => ({ ...prev, [id]: outputRef.current[id] }));
        };

        // Patch stdout, stderr, input() and time.sleep() before every run
        await pyodide.runPythonAsync(`
import sys, io, builtins, time
from js import window

# Custom stdout that streams each write() call to React state immediately
class _LiveStream:
    def __init__(self):
        self._buf = ""
    def write(self, text):
        self._buf += text
        # Flush line-by-line so output appears as each print() fires
        while "\\n" in self._buf:
            line, self._buf = self._buf.split("\\n", 1)
            window._pyAppendOutput(line + "\\n")
    def flush(self):
        if self._buf:
            window._pyAppendOutput(self._buf)
            self._buf = ""
    def getvalue(self):
        return ""

sys.stdout = _LiveStream()
sys.stderr = _LiveStream()

# Patch input() to use browser prompt() dialog
def _patched_input(prompt=""):
    sys.stdout.flush()
    result = window.prompt(str(prompt))
    if result is None:
        return ""
    # Echo prompt + answer into live output
    sys.stdout.write(str(prompt) + result + "\\n")
    return result

builtins.input = _patched_input

# Patch time.sleep() to no-op with a notice (sleep freezes the browser)
def _patched_sleep(seconds):
    sys.stdout.write(f"[sleep({seconds}s) skipped in browser]\\n")

time.sleep = _patched_sleep
        `);

        // Run the actual user code — output streams live via _LiveStream
        await pyodide.runPythonAsync(codeText);

        // Flush any remaining buffered output
        await pyodide.runPythonAsync("sys.stdout.flush(); sys.stderr.flush()");

        // If nothing was printed, show "No output"
        setOutputs((prev) => ({
          ...prev,
          [id]: outputRef.current[id] || "No output",
        }));

      } catch (err) {
        // Strip long internal Pyodide traceback — show only user-relevant part
        const msg = err.message || String(err);
        const clean = msg.includes('File "<exec>"')
          ? msg.slice(msg.indexOf('File "<exec>"'))
          : msg;
        setOutputs((prev) => ({ ...prev, [id]: (prev[id] || "") + "\nError:\n" + clean }));
      }
      return;
    }

    // ── Server-side SSE streaming fallback (for future languages) ─────────
    setOutputs((prev) => ({ ...prev, [id]: "Running..." }));
    try {
      const response = await fetch(`${API_URL}/api/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: codeText, language: lang }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      setOutputs((prev) => ({ ...prev, [id]: "" }));

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        // SSE events are separated by double newlines
        const events = text.split("\n\n").filter(Boolean);

        for (const event of events) {
          if (!event.startsWith("data: ")) continue;
          let payload;
          try {
            payload = JSON.parse(event.slice(6));
          } catch {
            continue;
          }

          if (payload.chunk !== undefined) {
            setOutputs((prev) => ({
              ...prev,
              [id]:
                (prev[id] === "Running..." ? "" : prev[id] || "") +
                payload.chunk,
            }));
          }
          if (payload.done) break;
        }
      }
    } catch (err) {
      setOutputs((prev) => ({
        ...prev,
        [id]: "Run error: " + err.message,
      }));
    }
  };

  // ── Listen for postMessage from sandboxed JS iframes ──────────────────────
  useEffect(() => {
    const handler = (event) => {
      if (!event.data || event.data.snippetId === undefined) return;
      const { snippetId, chunk, output, done } = event.data;

      if (chunk !== undefined) {
        // Append each streamed chunk as it arrives
        setOutputs((prev) => ({
          ...prev,
          [snippetId]:
            (prev[snippetId] === "" || prev[snippetId] === "Running..."
              ? ""
              : prev[snippetId] || "") + chunk,
        }));
      } else if (output !== undefined) {
        // Legacy single-shot output (fallback)
        setOutputs((prev) => ({ ...prev, [snippetId]: output }));
      }

      if (done) {
        const iframe = document.getElementById(`run-frame-${snippetId}`);
        if (iframe) iframe.remove();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const formatExpiry = (exp) => {
    if (!exp) return null;
    const diff = new Date(exp) - new Date();
    if (diff <= 0) return "Expired";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `Expires in ${h}h ${m}m` : `Expires in ${m}m`;
  };

  const filtered = snippets.filter((s) => {
    if (filter === "mine") return Number(s.user_id) === Number(user.id);
    if (filter === "public") return s.is_public;
    return true;
  });

  return (
    <div className="app">

      {/* ── Session expiry warning banner ───────────────────────────────── */}
      {sessionWarning && (
        <div className="session-warning-banner">
          <span>⚠️ Your session expires in 2 minutes.</span>
          <div className="session-warning-actions">
            <button
              className="session-warn-dismiss"
              onClick={() => setSessionWarning(false)}
            >
              Dismiss
            </button>
            <button
              className="session-warn-logout"
              onClick={() => logout("expired")}
            >
              Logout now
            </button>
          </div>
        </div>
      )}

      {/* Version History Modal */}
      {versionsFor && (
        <div className="modal-overlay" onClick={() => setVersionsFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📜 Version History — {versionsTitle}</h3>
              <button
                className="modal-close"
                onClick={() => setVersionsFor(null)}
              >
                ✕
              </button>
            </div>
            {versions.length === 0 ? (
              <p
                style={{
                  color: "#94a3b8",
                  padding: "40px",
                  textAlign: "center",
                }}
              >
                No versions saved yet.
              </p>
            ) : (
              versions.map((v) => (
                <div className="version-item" key={v.id}>
                  <div className="version-meta">
                    <span className="version-num">v{v.version_number}</span>
                    <span className="version-date">
                      {new Date(v.saved_at).toLocaleString()}
                    </span>
                    <button
                      className="restore-btn"
                      onClick={() => restoreVersion(versionsFor, v.id)}
                    >
                      ↩ Restore
                    </button>
                  </div>
                  <pre className="version-code">
                    {v.code.slice(0, 300)}
                    {v.code.length > 300 ? "..." : ""}
                  </pre>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Navbar ──────────────────────────────────────────────────────── */}
      <div className="navbar">
        <span className="navbar-brand">🚀 Snippet Manager</span>
        <div className="navbar-right">
          <div className="navbar-user">
            <div className="navbar-avatar-circle">
              {user.name?.slice(0, 1).toUpperCase()}
            </div>
            <span className="navbar-username">{user.name}</span>
          </div>
          <button className="navbar-logout" onClick={() => logout()}>
            Logout
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="searchBox">
        <input
          placeholder="🔍 Search snippets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && fetchSnippets(search)}
        />
        <button onClick={() => fetchSnippets(search)}>Search</button>
      </div>

      {/* Filter row */}
      <div className="filter-row">
        {["all", "mine", "public"].map((f) => (
          <button
            key={f}
            className={`filter-btn ${filter === f ? "active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "🌐 All" : f === "mine" ? "👤 Mine" : "🔓 Public"}
          </button>
        ))}
      </div>

      {/* Add snippet form */}
      <div className="form">
        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          placeholder="Tags (comma-separated)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <div className="form-row">
          <select
            className="language-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="javascript">javascript</option>
            <option value="python">python</option>
            <option value="html">html</option>
          </select>
          <select
            value={expiresIn}
            onChange={(e) => setExpiresIn(e.target.value)}
            className="language-select"
          >
            <option value="">⏳ No Expiry</option>
            <option value="1">⏱ Expires in 1 hour</option>
            <option value="6">⏱ Expires in 6 hours</option>
            <option value="24">⏱ Expires in 24 hours</option>
            <option value="72">⏱ Expires in 3 days</option>
            <option value="168">⏱ Expires in 1 week</option>
          </select>
        </div>
        <textarea
          placeholder="Write code..."
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <div className="visibility-row">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            <span>{isPublic ? "🔓 Public" : "🔒 Private"}</span>
          </label>
          <button onClick={addSnippet}>Save Snippet</button>
        </div>
      </div>

      {/* Snippets list */}
      <div className="app-main">
        <div className="card-container">
          {filtered.map((s, index) => (
            <div
              className="card"
              key={s.id}
              style={{ animationDelay: `${index * 0.15}s` }}
            >
              <div className="cardHeader">
                <h3>{s.title}</h3>
                <div className="card-meta">
                  <span className="lang-badge">{s.language}</span>
                  <span
                    className={`vis-badge ${s.is_public ? "public" : "private"}`}
                  >
                    {s.is_public ? "🔓 Public" : "🔒 Private"}
                  </span>
                </div>
              </div>

              <div className="card-sub">
                <span className="author">
                  by {s.author_name}
                  {Number(s.user_id) === Number(user.id) ? " (you)" : ""}
                </span>
                {s.expires_at && (
                  <span className="expiry-badge">
                    ⏳ {formatExpiry(s.expires_at)}
                  </span>
                )}
              </div>

              {editingId === s.id ? (
                <div className="edit-box">
                  <input
                    className="edit-title"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="Edit title..."
                  />
                  <textarea
                    className="edit-code"
                    value={editCode}
                    onChange={(e) => setEditCode(e.target.value)}
                    placeholder="Edit code..."
                  />
                  <div className="edit-actions">
                    <button
                      className="save-edit"
                      onClick={() => saveEdit(s.id)}
                    >
                      💾 Save Changes
                    </button>
                    <button
                      className="cancel-edit"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="code-section">
                  <SyntaxHighlighter language={s.language} style={dracula}>
                    {s.code}
                  </SyntaxHighlighter>
                </div>
              )}

              <div className="controls-section">
                <div className="actions">
                  <button
                    className="run"
                    onClick={() => runCode(s.id, s.code, s.language)}
                  >
                    ▶ Run Code
                  </button>
                  {Number(s.user_id) === Number(user.id) && (
                    <>
                      <button className="edit-btn" onClick={() => startEdit(s)}>
                        ✏ Edit
                      </button>
                      <button
                        className="history-btn"
                        onClick={() => openVersions(s)}
                      >
                        📜 History
                      </button>
                      <button
                        className="toggle-vis"
                        onClick={() => toggleVisibility(s)}
                      >
                        {s.is_public ? "🔒 Make Private" : "🔓 Make Public"}
                      </button>
                      <button
                        className="delete"
                        onClick={() => deleteSnippet(s.id)}
                      >
                        🗑 Delete
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="output-section">
                <div className="outputTitle">Output</div>
                <div className="outputContent">
                  {s.language === "html" ? (
                    // ✅ allow-modals enables alert/confirm/prompt in HTML snippets
                    <iframe
                      srcDoc={s.code}
                      title={`preview-${s.id}`}
                      sandbox="allow-scripts allow-modals"
                    />
                  ) : (
                    <pre>{outputs[s.id] || "Click Run to see output"}</pre>
                  )}
                </div>
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">📝</div>
              <h3>No snippets found</h3>
              <p>Create your first snippet or adjust your filters/search</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Root — wraps AppShell in PrivateRoute ────────────────────────────────
function App() {
  return (
    <PrivateRoute>
      <AppShell />
    </PrivateRoute>
  );
}

export default App;