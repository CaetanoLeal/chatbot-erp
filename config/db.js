// config/db.js
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT),
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