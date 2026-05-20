require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { spawn } = require("child_process"); // ✅ replaced execSync with spawn
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "snippet_manager_secret_2024";

app.use(cors());
app.options("*", cors());
app.use(express.json());

// ── Database ─────────────────────────────────────────────────────────────────
const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
});

db.getConnection((err, connection) => {
  if (err) {
    console.log("DB Error:", err);
  } else {
    console.log("MySQL Connected");
    connection.release();
    db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE DEFAULT NULL`, () => {});
    db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS picture VARCHAR(512) DEFAULT NULL`, () => {});
  }
});

// ── Auth Middleware ──────────────────────────────────────────────────────────
const authMiddleware = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token provided" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
};

// ── Google Token Verifier ────────────────────────────────────────────────────
function verifyGoogleToken(credential) {
  return new Promise((resolve, reject) => {
    const parts = credential.split(".");
    if (parts.length !== 3) return reject(new Error("Invalid token format"));

    let header, payload;
    try {
      header  = JSON.parse(Buffer.from(parts[0], "base64url").toString());
      payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    } catch {
      return reject(new Error("Failed to decode token"));
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now)  return reject(new Error("Token expired"));
    if (!payload.email)     return reject(new Error("No email in token"));
    if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)) {
      return reject(new Error("Invalid issuer"));
    }

    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    if (CLIENT_ID && payload.aud !== CLIENT_ID) {
      return reject(new Error("Token audience mismatch"));
    }

    https.get("https://www.googleapis.com/oauth2/v3/certs", (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const { keys } = JSON.parse(data);
          const key = keys.find((k) => k.kid === header.kid);
          if (!key) return reject(new Error("Matching public key not found"));

          const pubKey = crypto.createPublicKey({ key, format: "jwk" });
          const pem    = pubKey.export({ type: "spki", format: "pem" });

          jwt.verify(credential, pem, { algorithms: ["RS256"] }, (err) => {
            if (err) return reject(new Error("Signature verification failed: " + err.message));
            resolve(payload);
          });
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

// ── Run Code ─────────────────────────────────────────────────────────────────
app.post("/api/run", authMiddleware, (req, res) => {
  const { code, language } = req.body;
  if (!code) return res.status(400).json({ output: "No code provided" });

  const tmpDir = os.tmpdir();
  const TIMEOUT_MS = 15000; // 15 seconds — handles long-running timers

  // ── Helper: run a process and stream output via SSE ──────────────────────
  const runProcess = (cmd, args, tmpFile) => {
    // Set SSE headers so the client receives chunks in real time
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const child = spawn(cmd, args);
    let timedOut = false;

    // Stream stdout chunks to client as SSE events
    child.stdout.on("data", (data) => {
      const text = data.toString();
      res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
    });

    // Stream stderr chunks — shown as error output
    child.stderr.on("data", (data) => {
      const text = data.toString();
      res.write(`data: ${JSON.stringify({ chunk: text, isError: true })}\n\n`);
    });

    // Process exited naturally
    child.on("close", (exitCode) => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      if (!timedOut) {
        res.write(`data: ${JSON.stringify({ done: true, exitCode })}\n\n`);
        res.end();
      }
    });

    child.on("error", (err) => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      res.write(`data: ${JSON.stringify({ chunk: err.message, isError: true, done: true })}\n\n`);
      res.end();
    });

    // Kill after TIMEOUT_MS to prevent runaway processes
    const killer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      res.write(`data: ${JSON.stringify({ chunk: "\n[Process timed out after 15s]", isError: true, done: true })}\n\n`);
      res.end();
    }, TIMEOUT_MS);

    // Clear the timeout if process exits before limit
    child.on("close", () => clearTimeout(killer));
  };

  // ── JavaScript ────────────────────────────────────────────────────────────
  if (language === "javascript") {
    const tmpFile = path.join(tmpDir, `snippet_${Date.now()}.js`);
    try {
      fs.writeFileSync(tmpFile, code);
    } catch (err) {
      return res.status(500).json({ output: "Failed to write temp file: " + err.message });
    }
    runProcess("node", [tmpFile], tmpFile);
    return;
  }

  // ── Python ────────────────────────────────────────────────────────────────
  if (language === "python") {
    const tmpFile = path.join(tmpDir, `snippet_${Date.now()}.py`);
    try {
      fs.writeFileSync(tmpFile, code);
    } catch (err) {
      return res.status(500).json({ output: "Failed to write temp file: " + err.message });
    }
    // Try python3 first, fall back to python on Windows
    const cmd = process.platform === "win32" ? "python" : "python3";
    runProcess(cmd, [tmpFile], tmpFile);
    return;
  }

  // ── Unsupported language ──────────────────────────────────────────────────
  return res.json({ output: `Running ${language} is not supported yet` });
});

// ── Register ─────────────────────────────────────────────────────────────────
app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ message: "All fields are required" });

  db.query("SELECT id FROM users WHERE email=?", [email], async (err, rows) => {
    if (err) return res.status(500).json({ message: "Database error" });
    if (rows.length > 0) return res.status(400).json({ message: "Email already registered" });

    const hashed = await bcrypt.hash(password, 10);
    db.query(
      "INSERT INTO users (name, email, password) VALUES (?,?,?)",
      [name, email, hashed],
      (err2, result) => {
        if (err2) return res.status(500).json({ message: "Database error" });
        const token = jwt.sign({ id: result.insertId, name, email }, JWT_SECRET, { expiresIn: "7d" });
        res.json({ token, user: { id: result.insertId, name, email } });
      }
    );
  });
});

// ── Login ─────────────────────────────────────────────────────────────────────
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: "All fields are required" });

  db.query("SELECT * FROM users WHERE email=?", [email], async (err, rows) => {
    if (err) return res.status(500).json({ message: "Database error" });
    if (rows.length === 0) return res.status(401).json({ message: "Invalid credentials" });

    const user = rows[0];

    if (!user.password) {
      return res.status(401).json({
        message: "This account uses Google sign-in. Please use the Google button.",
      });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, picture: user.picture || null } });
  });
});

// ── Google Sign-In ────────────────────────────────────────────────────────────
app.post("/api/auth/google", async (req, res) => {
  const { credential } = req.body;
  if (!credential)
    return res.status(400).json({ message: "Google credential is required" });

  let payload;
  try {
    payload = await verifyGoogleToken(credential);
  } catch (err) {
    console.error("Google token error:", err.message);
    return res.status(401).json({ message: "Google sign-in failed: " + err.message });
  }

  const { sub: googleId, email, name, picture } = payload;

  db.query(
    "SELECT * FROM users WHERE google_id = ? OR email = ? LIMIT 1",
    [googleId, email],
    (err, rows) => {
      if (err) return res.status(500).json({ message: "Database error" });

      if (rows.length > 0) {
        const user = rows[0];
        db.query(
          "UPDATE users SET google_id = ?, picture = ? WHERE id = ?",
          [googleId, picture || user.picture, user.id],
          () => {}
        );
        const token = jwt.sign(
          { id: user.id, name: user.name, email: user.email },
          JWT_SECRET,
          { expiresIn: "7d" }
        );
        return res.json({
          token,
          user: { id: user.id, name: user.name, email: user.email, picture: picture || user.picture || null },
        });
      }

      db.query(
        "INSERT INTO users (name, email, google_id, picture) VALUES (?,?,?,?)",
        [name, email, googleId, picture || null],
        (err2, result) => {
          if (err2) return res.status(500).json({ message: "Database error" });
          const token = jwt.sign({ id: result.insertId, name, email }, JWT_SECRET, { expiresIn: "7d" });
          return res.json({
            token,
            user: { id: result.insertId, name, email, picture: picture || null },
          });
        }
      );
    }
  );
});

// ── Snippets ──────────────────────────────────────────────────────────────────
app.get("/api/snippets", authMiddleware, (req, res) => {
  const search = req.query.search || "";
  const userId = req.user.id;

  db.query("DELETE FROM snippets WHERE expires_at IS NOT NULL AND expires_at <= NOW()", (err) => {
    if (err) console.log("Expiry Delete Error:", err);
  });

  const sql = `
    SELECT s.*, u.name AS author_name
    FROM snippets s
    JOIN users u ON s.user_id = u.id
    WHERE (s.user_id = ? OR s.is_public = 1)
    AND (s.title LIKE ? OR s.code LIKE ? OR s.language LIKE ?)
    AND (s.expires_at IS NULL OR s.expires_at > NOW())
    ORDER BY s.created_at DESC
  `;
  db.query(sql, [userId, `%${search}%`, `%${search}%`, `%${search}%`], (err, result) => {
    if (err) return res.status(500).json([]);
    res.json(result);
  });
});

app.post("/api/snippets", authMiddleware, (req, res) => {
  const { title, code, language, is_public, tags, expires_in } = req.body;
  const userId = req.user.id;

  let expiresAt = null;
  if (expires_in && Number(expires_in) > 0) {
    const d = new Date();
    d.setHours(d.getHours() + Number(expires_in));
    expiresAt = d.toISOString().slice(0, 19).replace("T", " ");
  }

  db.query(
    "INSERT INTO snippets (user_id, title, code, language, is_public, expires_at) VALUES (?,?,?,?,?,?)",
    [userId, title, code, language, is_public ? 1 : 0, expiresAt],
    (err, result) => {
      if (err) return res.status(500).json(err);
      db.query(
        "INSERT INTO snippet_versions (snippet_id, code, title, version_number) VALUES (?,?,?,1)",
        [result.insertId, code, title]
      );
      if (tags && tags.length > 0) {
        tags.forEach((tag) => db.query("INSERT IGNORE INTO tags (name) VALUES (?)", [tag]));
      }
      res.json({ message: "Snippet added successfully", id: result.insertId });
    }
  );
});

app.delete("/api/snippets/:id", authMiddleware, (req, res) => {
  db.query(
    "DELETE FROM snippets WHERE id=? AND user_id=?",
    [req.params.id, req.user.id],
    (err, result) => {
      if (err) return res.status(500).json(err);
      if (result.affectedRows === 0) return res.status(403).json({ message: "Not allowed" });
      res.json({ message: "Deleted successfully" });
    }
  );
});

app.patch("/api/snippets/:id/visibility", authMiddleware, (req, res) => {
  const { is_public } = req.body;
  db.query(
    "UPDATE snippets SET is_public=? WHERE id=? AND user_id=?",
    [is_public ? 1 : 0, req.params.id, req.user.id],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Visibility updated" });
    }
  );
});

app.put("/api/snippets/:id", authMiddleware, (req, res) => {
  const { title, code } = req.body;
  const snippetId = req.params.id;

  db.query("SELECT COUNT(*) AS cnt FROM snippet_versions WHERE snippet_id=?", [snippetId], (err, rows) => {
    if (err) return res.status(500).json(err);
    const nextVersion = rows[0].cnt + 1;
    db.query(
      "INSERT INTO snippet_versions (snippet_id, code, title, version_number) VALUES (?,?,?,?)",
      [snippetId, code, title, nextVersion],
      (err2) => {
        if (err2) return res.status(500).json(err2);
        db.query(
          "UPDATE snippets SET title=?, code=? WHERE id=? AND user_id=?",
          [title, code, snippetId, req.user.id],
          (err3) => {
            if (err3) return res.status(500).json(err3);
            res.json({ message: "Snippet updated" });
          }
        );
      }
    );
  });
});

app.get("/api/snippets/:id/versions", authMiddleware, (req, res) => {
  db.query(
    "SELECT * FROM snippet_versions WHERE snippet_id=? ORDER BY version_number DESC",
    [req.params.id],
    (err, rows) => {
      if (err) return res.status(500).json(err);
      res.json(rows);
    }
  );
});

app.post("/api/snippets/:id/restore/:versionId", authMiddleware, (req, res) => {
  const { id, versionId } = req.params;
  db.query("SELECT * FROM snippet_versions WHERE id=?", [versionId], (err, rows) => {
    if (err || !rows[0]) return res.status(404).json({ message: "Version not found" });
    const version = rows[0];
    db.query(
      "UPDATE snippets SET title=?, code=? WHERE id=? AND user_id=?",
      [version.title, version.code, id, req.user.id],
      (err2) => {
        if (err2) return res.status(500).json(err2);
        res.json({ message: "Version restored" });
      }
    );
  });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));