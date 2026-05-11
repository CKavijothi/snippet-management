const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();

const PORT = process.env.PORT || 5000;
const JWT_SECRET =
  process.env.JWT_SECRET || "snippet_manager_secret_2024";

app.use(
  cors({
   origin: [
    "http://localhost:3000",
    "https://snippet-management.vercel.app",
    "https://snippet-management-fxsqg4n26-ckavijothis-projects.vercel.app" // ← add pannu
  ],
    credentials: true,
  })
);

app.use(express.json());

/* =========================
   DATABASE CONNECTION
========================= */

const db = mysql.createConnection({
  host: process.env.MYSQLHOST || "localhost",
  user: process.env.MYSQLUSER || "root",
  password: process.env.MYSQLPASSWORD || "",
  database: process.env.MYSQLDATABASE || "snippetdb",
  port: process.env.MYSQLPORT || 3307,
});

db.connect((err) => {
  if (err) {
    console.log("DB Error:", err);
  } else {
    console.log("MySQL Connected");
  }
});

/* =========================
   AUTH MIDDLEWARE
========================= */

const authMiddleware = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      message: "No token provided",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      message: "Invalid token",
    });
  }
};

/* =========================
   REGISTER
========================= */

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({
      message: "All fields are required",
    });
  }

  db.query(
    "SELECT id FROM users WHERE email=?",
    [email],
    async (err, rows) => {
      if (err) {
        console.log("REGISTER ERROR:", err);
        return res.status(500).json({
          message: "Database error",
        });
      }

      if (rows.length > 0) {
        return res.status(400).json({
          message: "Email already registered",
        });
      }

      try {
        const hashedPassword = await bcrypt.hash(password, 10);

        db.query(
          "INSERT INTO users (name, email, password) VALUES (?,?,?)",
          [name, email, hashedPassword],
          (err2, result) => {
            if (err2) {
              console.log("INSERT USER ERROR:", err2);
              return res.status(500).json({
                message: "Database error",
              });
            }

            const token = jwt.sign(
              {
                id: result.insertId,
                name,
                email,
              },
              JWT_SECRET,
              { expiresIn: "7d" }
            );

            res.json({
              token,
              user: {
                id: result.insertId,
                name,
                email,
              },
            });
          }
        );
      } catch (hashErr) {
        console.log(hashErr);

        res.status(500).json({
          message: "Server error",
        });
      }
    }
  );
});

/* =========================
   LOGIN
========================= */

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      message: "All fields are required",
    });
  }

  db.query(
    "SELECT * FROM users WHERE email=?",
    [email],
    async (err, rows) => {
      if (err) {
        console.log("LOGIN ERROR:", err);

        return res.status(500).json({
          message: "Database error",
        });
      }

      if (rows.length === 0) {
        return res.status(401).json({
          message: "Invalid credentials",
        });
      }

      const user = rows[0];

      const match = await bcrypt.compare(
        password,
        user.password
      );

      if (!match) {
        return res.status(401).json({
          message: "Invalid credentials",
        });
      }

      const token = jwt.sign(
        {
          id: user.id,
          name: user.name,
          email: user.email,
        },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      res.json({
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      });
    }
  );
});

/* =========================
   GET SNIPPETS
========================= */

app.get("/api/snippets", authMiddleware, (req, res) => {
  const search = req.query.search || "";
  const userId = req.user.id;

  db.query(
    "DELETE FROM snippets WHERE expires_at IS NOT NULL AND expires_at <= NOW()",
    (err) => {
      if (err) {
        console.log("Expiry Delete Error:", err);
      }
    }
  );

  const sql = `
    SELECT s.*, u.name AS author_name
    FROM snippets s
    JOIN users u ON s.user_id = u.id
    WHERE (s.user_id = ? OR s.is_public = 1)
    AND (
      s.title LIKE ?
      OR s.code LIKE ?
      OR s.language LIKE ?
    )
    AND (
      s.expires_at IS NULL
      OR s.expires_at > NOW()
    )
    ORDER BY s.created_at DESC
  `;

  db.query(
    sql,
    [
      userId,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
    ],
    (err, result) => {
      if (err) {
        console.log("FETCH ERROR:", err);
        return res.status(500).json([]);
      }

      res.json(result);
    }
  );
});

/* =========================
   ADD SNIPPET
========================= */

app.post("/api/snippets", authMiddleware, (req, res) => {
  const {
    title,
    code,
    language,
    is_public,
    tags,
    expires_in,
  } = req.body;

  const userId = req.user.id;

  let expiresAt = null;

  if (expires_in && Number(expires_in) > 0) {
    const d = new Date();

    d.setHours(d.getHours() + Number(expires_in));

    expiresAt = d
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
  }

  db.query(
    `
    INSERT INTO snippets
    (user_id, title, code, language, is_public, expires_at)
    VALUES (?,?,?,?,?,?)
    `,
    [
      userId,
      title,
      code,
      language,
      is_public ? 1 : 0,
      expiresAt,
    ],
    (err, result) => {
      if (err) {
        console.log("INSERT ERROR:", err);
        return res.status(500).json(err);
      }

      db.query(
        `
        INSERT INTO snippet_versions
        (snippet_id, code, title, version_number)
        VALUES (?,?,?,1)
        `,
        [result.insertId, code, title]
      );

      if (tags && tags.length > 0) {
        tags.forEach((tag) => {
          db.query(
            "INSERT IGNORE INTO tags (name) VALUES (?)",
            [tag],
            (e) => {
              if (e) {
                console.log(e);
              }
            }
          );
        });
      }

      res.json({
        message: "Snippet added successfully",
        id: result.insertId,
      });
    }
  );
});

/* =========================
   DELETE SNIPPET
========================= */

app.delete(
  "/api/snippets/:id",
  authMiddleware,
  (req, res) => {
    const userId = req.user.id;

    db.query(
      "DELETE FROM snippets WHERE id=? AND user_id=?",
      [req.params.id, userId],
      (err, result) => {
        if (err) {
          return res.status(500).json(err);
        }

        if (result.affectedRows === 0) {
          return res.status(403).json({
            message: "Not allowed",
          });
        }

        res.json({
          message: "Deleted successfully",
        });
      }
    );
  }
);

/* =========================
   UPDATE VISIBILITY
========================= */

app.patch(
  "/api/snippets/:id/visibility",
  authMiddleware,
  (req, res) => {
    const { is_public } = req.body;
    const userId = req.user.id;

    db.query(
      `
      UPDATE snippets
      SET is_public=?
      WHERE id=? AND user_id=?
      `,
      [
        is_public ? 1 : 0,
        req.params.id,
        userId,
      ],
      (err) => {
        if (err) {
          return res.status(500).json(err);
        }

        res.json({
          message: "Visibility updated",
        });
      }
    );
  }
);

/* =========================
   UPDATE SNIPPET
========================= */

app.put("/api/snippets/:id", authMiddleware, (req, res) => {
  const { title, code } = req.body;

  const userId = req.user.id;
  const snippetId = req.params.id;

  db.query(
    "SELECT COUNT(*) AS cnt FROM snippet_versions WHERE snippet_id=?",
    [snippetId],
    (err, rows) => {
      if (err) {
        return res.status(500).json(err);
      }

      const nextVersion = rows[0].cnt + 1;

      db.query(
        `
        INSERT INTO snippet_versions
        (snippet_id, code, title, version_number)
        VALUES (?,?,?,?)
        `,
        [snippetId, code, title, nextVersion],
        (err2) => {
          if (err2) {
            return res.status(500).json(err2);
          }

          db.query(
            `
            UPDATE snippets
            SET title=?, code=?
            WHERE id=? AND user_id=?
            `,
            [title, code, snippetId, userId],
            (err3) => {
              if (err3) {
                return res.status(500).json(err3);
              }

              res.json({
                message: "Snippet updated",
              });
            }
          );
        }
      );
    }
  );
});

/* =========================
   GET VERSIONS
========================= */

app.get(
  "/api/snippets/:id/versions",
  authMiddleware,
  (req, res) => {
    db.query(
      `
      SELECT *
      FROM snippet_versions
      WHERE snippet_id=?
      ORDER BY version_number DESC
      `,
      [req.params.id],
      (err, rows) => {
        if (err) {
          return res.status(500).json(err);
        }

        res.json(rows);
      }
    );
  }
);

/* =========================
   RESTORE VERSION
========================= */

app.post(
  "/api/snippets/:id/restore/:versionId",
  authMiddleware,
  (req, res) => {
    const userId = req.user.id;
    const { id, versionId } = req.params;

    db.query(
      "SELECT * FROM snippet_versions WHERE id=?",
      [versionId],
      (err, rows) => {
        if (err || !rows[0]) {
          return res.status(404).json({
            message: "Version not found",
          });
        }

        const version = rows[0];

        db.query(
          `
          UPDATE snippets
          SET title=?, code=?
          WHERE id=? AND user_id=?
          `,
          [version.title, version.code, id, userId],
          (err2) => {
            if (err2) {
              return res.status(500).json(err2);
            }

            res.json({
              message: "Version restored",
            });
          }
        );
      }
    );
  }
);

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});