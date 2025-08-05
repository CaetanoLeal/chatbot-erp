const express = require("express");
const qrcode = require("qrcode-terminal");
const cors = require("cors");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { body, validationResult } = require("express-validator");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const sessions = {}; // token -> client
const qrCodes = {}; // token -> qr
const instanceInfo = {}; // token -> { nome }
const receivedMessages = [];

// Criar nova instância
app.post(
  "/nova-instancia",
  [body("Nome").notEmpty().withMessage("Nome é obrigatório")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ status: false, message: errors.mapped() });
    }

    const nomeDaInstancia = req.body.Nome;
    const token = uuidv4();

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: token }),
      puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
    });

    sessions[token] = client;
    instanceInfo[token] = { nome: nomeDaInstancia };

    let qrCodeTimeout;

    client.on("qr", (qr) => {
      if (qrCodes[token]) return;
      qrCodes[token] = qr;
      console.log(`[${nomeDaInstancia}] 🔐 QR Code gerado`);
      qrcode.generate(qr, { small: true });

      qrCodeTimeout = setTimeout(() => {
        if (!client.info) {
          console.log(`[${nomeDaInstancia}] ❌ QR expirado. Encerrando sessão.`);
          client.destroy();
          delete sessions[token];
          delete qrCodes[token];
          delete instanceInfo[token];
        }
      }, 60 * 1000);
    });

    client.on("ready", () => {
      console.log(`[${nomeDaInstancia}] ✅ Cliente conectado! Token: ${token}`);
      clearTimeout(qrCodeTimeout);
      delete qrCodes[token];
    });

    client.on("authenticated", () => {
      console.log(`[${nomeDaInstancia}] 🔐 Autenticado`);
    });

    client.on("disconnected", (reason) => {
      console.log(`[${nomeDaInstancia}] 🔌 Desconectado: ${reason}`);
      delete sessions[token];
      delete qrCodes[token];
      delete instanceInfo[token];
    });

    client.on("message", async (msg) => {
      const remetente = msg.from;
      const conteudo = msg.body;
      const timestamp = new Date().toISOString();
      const numeroLimpo = remetente.replace("@c.us", "");

      console.log(`[${nomeDaInstancia}] 📩 Mensagem de ${numeroLimpo}: ${conteudo}`);

      receivedMessages.push({
        token,
        numero: numeroLimpo,
        mensagem: conteudo,
        dataHora: timestamp,
      });
    });

    await client.initialize();

    res.json({
      status: true,
      token,
      nome: nomeDaInstancia,
      message: "Sessão iniciada. QR gerado.",
    });
  }
);

// Rota para obter o QR code
app.get("/qrcode/:token", (req, res) => {
  const token = req.params.token;
  if (qrCodes[token]) {
    res.json({ status: true, qr: qrCodes[token] });
  } else {
    res.status(404).json({ status: false, message: "QR Code não disponível ou expirado." });
  }
});

// Rota para enviar mensagem
app.post(
  "/send-message",
  [
    body("token").notEmpty().withMessage("Token é obrigatório"),
    body("number").notEmpty().withMessage("Número é obrigatório"),
    body("message").notEmpty().withMessage("Mensagem é obrigatória"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ status: false, message: errors.mapped() });
    }

    const { token, number, message } = req.body;
    const client = sessions[token];

    if (!client) {
      return res.status(400).json({ status: false, message: "Sessão não encontrada ou inativa." });
    }

    const numberDDD = number.substr(2, 2);
    const numberUser = number.slice(-8);
    const numberZDG =
      parseInt(numberDDD) <= 30
        ? `55${numberDDD}9${numberUser}@c.us`
        : `55${numberDDD}${numberUser}@c.us`;

    try {
      const response = await client.sendMessage(numberZDG, message);
      res.status(200).json({ status: true, message: "Mensagem enviada com sucesso", response });
    } catch (err) {
      res
        .status(500)
        .json({ status: false, message: "Erro ao enviar mensagem", response: err.message });
    }
  }
);

// Listar mensagens recebidas
app.get("/received-messages", (req, res) => {
  res.json({
    status: true,
    total: receivedMessages.length,
    mensagens: receivedMessages,
  });
});

// Rota para listar instâncias conectadas
app.get("/instancias", (req, res) => {
  const conectadas = Object.keys(sessions).map((token) => ({
    token,
    nome: instanceInfo[token]?.nome || "Desconhecido",
  }));

  res.json({ status: true, total: conectadas.length, instancias: conectadas });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
