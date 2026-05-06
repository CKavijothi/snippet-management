const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");

const app = express();

app.use(cors());
app.use(express.json());


const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "snippetdb",
  port: "3307"
});

db.connect(err => {
  if (err) {
    console.log("DB Error:", err);
  } else {
    console.log("MySQL Connected");
  }
});

app.get("/api/snippets", (req, res) => {
  const search = req.query.search || "";

  const sql = `
    SELECT * FROM snippets
    WHERE title LIKE ? OR code LIKE ? OR language LIKE ?
    ORDER BY created_at DESC
  `;

  db.query(sql,
    [`%${search}%`, `%${search}%`, `%${search}%`],
    (err, result) => {
      if (err) {
        console.log(err);
        return res.status(500).json([]);
      }
      res.json(result);
    }
  );
});


app.post("/api/snippets", (req, res) => {
  const { title, code, language, is_public } = req.body;

  db.query(
    "INSERT INTO snippets (user_id,title,code,language,is_public) VALUES (1,?,?,?,?)",
    [title, code, language, is_public],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Added" });
    }
  );
});


app.delete("/api/snippets/:id", (req, res) => {
  db.query(
    "DELETE FROM snippets WHERE id=?",
    [req.params.id],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Deleted" });
    }
  );
});


app.listen(5000, () => {
  console.log("Server running http://localhost:5000");
});