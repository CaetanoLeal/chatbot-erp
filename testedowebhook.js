const express = require("express");
const app = express();
const PORT = 3001; // Porta diferente da do app principal

// Middleware para receber JSON
app.use(express.json());

// Endpoint que recebe os webhooks
app.post("/webhook", (req, res) => {
  console.log("📬 Webhook recebido!");

  console.log("✅ Evento:", req.body.evento);
  console.log("📦 Dados recebidos:", JSON.stringify(req.body, null, 2));

  // Retorna uma resposta simples para quem enviou
  res.status(200).send("✅ Webhook recebido com sucesso!");
});

// Inicia o servidor
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🎧 Receptor de webhook escutando em http://localhost:${PORT}/webhook`);
});
