const express = require("express");
const qrcode = require("qrcode-terminal");
const cors = require("cors");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { body, validationResult } = require("express-validator");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json()); // Necessário para receber JSON em POST

let qrCodeString = null;
const receivedMessages = []; // Armazena mensagens recebidas em memória

// Inicializa o cliente do WhatsApp
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// Exibe o QR Code no terminal
client.on("qr", (qr) => {
  qrCodeString = qr;
  console.log("🔐 QR Code string:", qr);
  qrcode.generate(qr, { small: true });
});

// Conexão bem-sucedida
client.on("ready", () => {
  console.log("✅ WhatsApp está conectado!");
});

// Escuta mensagens recebidas
client.on("message", async (msg) => {
  const remetente = msg.from;
  const conteudo = msg.body;
  const timestamp = new Date().toISOString();
  const numeroLimpo = remetente.replace("@c.us", "");

  console.log("📩 Nova mensagem recebida:");
  console.log("Número:", numeroLimpo);
  console.log("Mensagem:", conteudo);

  receivedMessages.push({
    numero: numeroLimpo,
    mensagem: conteudo,
    dataHora: timestamp,
  });

  // (Opcional) Responder automaticamente
  // await msg.reply("Mensagem recebida!");
});

// Inicia o cliente
client.initialize();

// Rota para obter o QR code
app.get("/qrcode", (req, res) => {
  if (qrCodeString) {
    res.json({ qr: qrCodeString });
  } else {
    res.status(404).json({ error: "QR Code ainda não gerado ou já expirou" });
  }
});

// Rota para enviar mensagem
app.post(
  "/send-message",
  [
    body("number").notEmpty().withMessage("Número é obrigatório"),
    body("message").notEmpty().withMessage("Mensagem é obrigatória"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        status: false,
        message: errors.mapped(),
      });
    }

    const { number, message } = req.body;

    const numberDDD = number.substr(2, 2);
    const numberUser = number.slice(-8);
    let numberZDG = "";

    if (parseInt(numberDDD) <= 30) {
      numberZDG = `55${numberDDD}9${numberUser}@c.us`;
    } else {
      numberZDG = `55${numberDDD}${numberUser}@c.us`;
    }

    try {
      const response = await client.sendMessage(numberZDG, message);
      res.status(200).json({
        status: true,
        message: "BOT-ZDG Mensagem enviada",
        response,
      });
    } catch (err) {
      res.status(500).json({
        status: false,
        message: "BOT-ZDG Mensagem não enviada",
        response: err.message,
      });
    }
  }
);

// Rota para listar mensagens recebidas
app.get("/received-messages", (req, res) => {
  res.json({
    status: true,
    total: receivedMessages.length,
    mensagens: receivedMessages,
  });
});

// Inicia o servidor
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
