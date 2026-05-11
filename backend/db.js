const mysql = require("mysql2");

const db = mysql.createConnection({
  // If online, use Railway's address. If at home, use localhost.
  host: process.env.MYSQLHOST || "localhost",
  user: process.env.MYSQLUSER || "root",
  password: process.env.MYSQLPASSWORD || "",
  database: process.env.MYSQLDATABASE || "snippetdb",
  // Railway usually uses 3306; your local setup used 3307.
  port: process.env.MYSQLPORT || 3307
});

db.connect(err => {
  if (err) {
    console.error("DB connection failed:", err);
  } else {
    console.log("Connected to MySQL");
  }
});

module.exports = db;
