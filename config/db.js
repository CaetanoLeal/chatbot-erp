// config/db.js
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "postgres",
  port: Number(process.env.DB_PORT || 5432),
  ssl: false
});

// Teste de conexão
async function testConnection() {
  try {
    const res = await pool.query("SELECT NOW()");
    console.log("✅ Chatbot-ERP conectado ao PostgreSQL:", res.rows[0].now);
  } catch (err) {
    console.error("❌ Erro ao conectar no PostgreSQL:", err.message);
  }
}

testConnection();

module.exports = pool;