import React, { useEffect, useState } from "react";
import axios from "axios";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { dracula } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useAuth } from "./AuthContext";
import AuthPage from "./AuthPage";
import "./App.css";

let pyodide = null;
const API_URL = "https://snippet-management-production.up.railway.app";

const api = (token) =>
  axios.create({
    baseURL: API_URL,
    headers: { Authorization: `Bearer ${token}` }
  });

function App() {
  const { user, token, logout } = useAuth();

  const [snippets, setSnippets] = useState([]);
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
const [language] = useState("javascript");
  const [isPublic, setIsPublic] = useState(false);
  const [tags, setTags] = useState("");
  const [expiresIn, setExpiresIn] = useState("");
  const [search, setSearch] = useState("");
  const [outputs, setOutputs] = useState({});
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
    } catch (err) { console.log(err); }
  };

useEffect(() => { if (user) fetchSnippets(""); }, [user]);

  if (!user) return <AuthPage />;

  const addSnippet = async () => {
    if (!title || !code) return alert("Fill all fields");
    const tagList = tags.split(",").map(t => t.trim()).filter(Boolean);
    await api(token).post("/api/snippets", {
      title, code, language, is_public: isPublic,
      tags: tagList,
      expires_in: expiresIn ? parseInt(expiresIn) : 0
    });
    setTitle(""); setCode(""); setTags(""); setExpiresIn("");
    fetchSnippets(search);
  };

  const deleteSnippet = async (id) => {
    await api(token).delete(`/api/snippets/${id}`);
    fetchSnippets(search);
  };

  const toggleVisibility = async (snippet) => {
    await api(token).patch(`/api/snippets/${snippet.id}/visibility`, {
      is_public: !snippet.is_public
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
      title: editTitle, code: editCode
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

  const runCode = async (id, codeText, lang) => {
    let output = "";
    if (lang === "javascript") {
      try {
        const logs = [];
        const oldLog = console.log;
        console.log = (v) => logs.push(String(v));
        eval(codeText);
        console.log = oldLog;
        output = logs.join("\n") || "No output";
      } catch (err) { output = err.message; }
    }
    if (lang === "python") {
      setOutputs(prev => ({ ...prev, [id]: "Loading Python..." }));
      if (!pyodide) pyodide = await window.loadPyodide();
      await pyodide.runPythonAsync(`import sys, io\nsys.stdout = io.StringIO()`);
      await pyodide.runPythonAsync(codeText);
      output = await pyodide.runPythonAsync("sys.stdout.getvalue()");
    }
    setOutputs(prev => ({ ...prev, [id]: output }));
  };

  const formatExpiry = (exp) => {
    if (!exp) return null;
    const diff = new Date(exp) - new Date();
    if (diff <= 0) return "Expired";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `Expires in ${h}h ${m}m` : `Expires in ${m}m`;
  };

  const filtered = snippets.filter(s => {
    if (filter === "mine") return Number(s.user_id) === Number(user.id);
    if (filter === "public") return s.is_public;
    return true;
  });

  return (
    <div className="app">
     
      {versionsFor && (
        <div className="modal-overlay" onClick={() => setVersionsFor(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📜 Version History — {versionsTitle}</h3>
              <button className="modal-close" onClick={() => setVersionsFor(null)}>✕</button>
            </div>
            {versions.length === 0 ? (
              <p style={{color:"#94a3b8",padding:"40px", textAlign:"center"}}>No versions saved yet.</p>
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
                  <pre className="version-code">{v.code.slice(0, 300)}{v.code.length > 300 ? "..." : ""}</pre>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="navbar">
        <span>🚀 Snippet Manager</span>
        <div className="navbar-right">
          <span className="navbar-user">👤 {user.name}</span>
          <button className="navbar-logout" onClick={logout}>Logout</button>
        </div>
      </div>

      <div className="searchBox">
        <input
          placeholder="🔍 Search snippets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button onClick={() => fetchSnippets(search)}>Search</button>
      </div>

      <div className="filter-row">
        {["all", "mine", "public"].map(f => (
          <button
            key={f}
            className={`filter-btn ${filter === f ? "active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "🌐 All" : f === "mine" ? "👤 Mine" : "🔓 Public"}
          </button>
        ))}
      </div>

      <div className="form">
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input placeholder="Tags (comma-separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
        <div className="form-row">
          <select class="language-select">
  <option>javascript</option>
  <option selected>python</option>
  <option>html</option>
</select>
          <select value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)} className="language-select">
            <option value="">⏳ No Expiry</option>
            <option value="1">⏱ Expires in 1 hour</option>
            <option value="6">⏱ Expires in 6 hours</option>
            <option value="24">⏱ Expires in 24 hours</option>
            <option value="72">⏱ Expires in 3 days</option>
            <option value="168">⏱ Expires in 1 week</option>
          </select>
        </div>
        <textarea placeholder="Write code..." value={code} onChange={(e) => setCode(e.target.value)} />
        <div className="visibility-row">
          <label className="toggle-label">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            <span>{isPublic ? "🔓 Public" : "🔒 Private"}</span>
          </label>
          <button onClick={addSnippet}>Save Snippet</button>
        </div>
      </div>

      {/* NEW SINGLE COLUMN LAYOUT - NO GRID */}
      <div className="app-main">
        <div className="card-container">
          {filtered.map((s, index) => (
            <div 
              className="card" 
              key={s.id} 
              style={{animationDelay: `${index * 0.15}s`}}
            >
              {/* Header */}
              <div className="cardHeader">
                <h3>{s.title}</h3>
                <div className="card-meta">
                  <span className="lang-badge">{s.language}</span>
                  <span className={`vis-badge ${s.is_public ? "public" : "private"}`}>
                    {s.is_public ? "🔓 Public" : "🔒 Private"}
                  </span>
                </div>
              </div>

              {/* Snippet Info */}
              <div className="card-sub">
                <span className="author">
                  by {s.author_name}{Number(s.user_id) === Number(user.id) ? " (you)" : ""}
                </span>
                {s.expires_at && (
                  <span className="expiry-badge">
                    ⏳ {formatExpiry(s.expires_at)}
                  </span>
                )}
              </div>

              {/* Edit Mode or Code Display */}
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
                    <button className="save-edit" onClick={() => saveEdit(s.id)}>
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

              {/* Controls */}
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
                      <button className="history-btn" onClick={() => openVersions(s)}>
                        📜 History
                      </button>
                      <button className="toggle-vis" onClick={() => toggleVisibility(s)}>
                        {s.is_public ? "🔒 Make Private" : "🔓 Make Public"}
                      </button>
                      <button className="delete" onClick={() => deleteSnippet(s.id)}>
                        🗑 Delete
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Integrated Output Section */}
              <div className="output-section">
                <div className="outputTitle">Output</div>
                <div className="outputContent">
                  {s.language === "html" ? (
                    <iframe srcDoc={s.code} title={`preview-${s.id}`} />
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

export default App;