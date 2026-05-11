const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const JWT_SECRET = "snippet_manager_secret_2024";

app.use(cors());
app.use(express.json());
const db = mysql.createConnection({
  host: process.env.MYSQLHOST || "localhost", 
  user: process.env.MYSQLUSER || "root",
  password: process.env.MYSQLPASSWORD || "",
  database: process.env.MYSQLDATABASE || "snippetdb",
  port: process.env.MYSQLPORT || 3307 
});

db.connect((err) => {
  if (err) {
    console.log("DB Error:", err);
  } else {
    console.log("MySQL Connected");
  }
});

const authMiddleware = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({
      message: "All fields are required"
    });
  }

  db.query(
    "SELECT id FROM users WHERE email=?",
    [email],
    async (err, rows) => {
      if (err) {
        console.log("REGISTER ERROR:", err);
        return res.status(500).json({ message: "Database error" });
      }

      if (rows.length > 0) {
        return res.status(400).json({
          message: "Email already registered"
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
                message: "Database error"
              });
            }

            const token = jwt.sign(
              {
                id: result.insertId,
                name,
                email
              },
              JWT_SECRET,
              { expiresIn: "7d" }
            );

            res.json({
              token,
              user: {
                id: result.insertId,
                name,
                email
              }
            });
          }
        );
      } catch (hashErr) {
        console.log(hashErr);
        res.status(500).json({ message: "Server error" });
      }
    }
  );
});


app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      message: "All fields are required"
    });
  }

  db.query(
    "SELECT * FROM users WHERE email=?",
    [email],
    async (err, rows) => {
      if (err) {
        console.log("LOGIN ERROR:", err);
        return res.status(500).json({
          message: "Database error"
        });
      }

      if (rows.length === 0) {
        return res.status(401).json({
          message: "Invalid credentials"
        });
      }

      const user = rows[0];

      const match = await bcrypt.compare(password, user.password);

      if (!match) {
        return res.status(401).json({
          message: "Invalid credentials"
        });
      }

      const token = jwt.sign(
        {
          id: user.id,
          name: user.name,
          email: user.email
        },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      res.json({
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email
        }
      });
    }
  );
});
app.get("/api/snippets", authMiddleware, (req, res) => {
  const search = req.query.search || "";
  const userId = req.user.id;

  // Delete expired snippets
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
      `%${search}%`
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

app.post("/api/snippets", authMiddleware, (req, res) => {
  const {
    title,
    code,
    language,
    is_public,
    tags,
    expires_in
  } = req.body;

  const userId = req.user.id;

  let expiresAt = null;

  if (expires_in && Number(expires_in) > 0) {
    const d = new Date();

    d.setHours(d.getHours() + Number(expires_in));

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");

    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");

    expiresAt = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
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
      expiresAt
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
            (e, tagResult) => {
              if (e) {
                console.log(e);
                return;
              }

              if (tagResult.insertId) {
                db.query(
                  `
                  INSERT INTO snippet_tags
                  (snippet_id, tag_id)
                  VALUES (?,?)
                  `,
                  [result.insertId, tagResult.insertId]
                );
              } else {
                db.query(
                  "SELECT id FROM tags WHERE name=?",
                  [tag],
                  (e2, rows) => {
                    if (rows && rows[0]) {
                      db.query(
                        `
                        INSERT INTO snippet_tags
                        (snippet_id, tag_id)
                        VALUES (?,?)
                        `,
                        [result.insertId, rows[0].id]
                      );
                    }
                  }
                );
              }
            }
          );
        });
      }

      res.json({
        message: "Snippet added successfully",
        id: result.insertId
      });
    }
  );
});
app.delete("/api/snippets/:id", authMiddleware, (req, res) => {
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
          message: "Not allowed"
        });
      }

      res.json({
        message: "Deleted successfully"
      });
    }
  );
});

app.patch("/api/snippets/:id/visibility", authMiddleware, (req, res) => {
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
      userId
    ],
    (err) => {
      if (err) {
        return res.status(500).json(err);
      }

      res.json({
        message: "Visibility updated"
      });
    }
  );
});

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
                message: "Snippet updated"
              });
            }
          );
        }
      );
    }
  );
});

app.get("/api/snippets/:id/versions", authMiddleware, (req, res) => {
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
});

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
            message: "Version not found"
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
              message: "Version restored"
            });
          }
        );
      }
    );
  }
);

app.listen(5000, () => {
  console.log("Server running at http://localhost:5000");
});