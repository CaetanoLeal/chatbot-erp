const express = require("express");
const qrcode = require("qrcode-terminal");
const cors = require("cors");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { body, validationResult } = require("express-validator");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const sessions = {}; // token -> client
const qrCodes = {}; // token -> qr
const instanceInfo = {}; // token -> { nome }
const messages = [];

// === CAPTURA GLOBAL DE ERROS PARA EVITAR QUE O NODE PARE ===
process.on("uncaughtException", (err) => {
  console.error("❌ Erro não tratado:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Promessa rejeitada sem tratamento:", reason);
});

// Função para enviar dados ao WebHook
async function sendWebhook(url, payload) {
  try {
    await axios.post(url, payload);
  } catch (err) {
    console.error("Erro ao enviar para WebHook:", err.message);
  }
}

// Criar nova instância
app.post(
  "/nova-instancia",
  [
    body("Nome").notEmpty().withMessage("Nome é obrigatório"),
    body("WebHook").notEmpty().withMessage("WebHook é obrigatório")
  ],
  async (req, res) => {
    try {
      // Validação do corpo da requisição
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({ status: false, message: errors.mapped() });
      }

      // Verificar se o nome da instância já existe
      const nomeSolicitado = req.body.Nome.trim().toLowerCase();
      const instanciaExistente = Object.values(instanceInfo).find(
        (info) => info.nome.trim().toLowerCase() === nomeSolicitado
      );
      if (instanciaExistente) {
        return res.status(400).json({ status: false, message: "Já existe uma instância com esse nome." });
      }

      // Declaração de variáveis
      const token = uuidv4();
      let qrCodeTimeout;

      // Configuração do cliente WhatsApp
      const client = new Client({
        authStrategy: new LocalAuth({ clientId: token }),
        puppeteer: {
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        },
      });

      // Armazenar sessão e informações da instância
      sessions[token] = client;
      instanceInfo[token] = { nome: req.body.Nome, numero: null, webhook: req.body.WebHook };

      // Gerar QR Code e lidar com eventos
      client.on("qr", (qr) => {
        try {
          if (qrCodes[token]) return;
          qrCodes[token] = qr;

          console.log(`[${instanceInfo[token].nome}] 🔐 QR Code gerado`);
          qrcode.generate(qr, { small: true });

          sendWebhook(instanceInfo[token].webhook, {
            evento: "qr_code_gerado",
            nome: instanceInfo[token].nome,
            token: token,
            qr_raw: qr
          });

          qrCodeTimeout = setTimeout(() => {
            if (!client.info) {
              console.log(`[${instanceInfo[token].nome}] ❌ QR expirado. Encerrando sessão.`);
              client.destroy();
              delete sessions[token];
              delete qrCodes[token];
              delete instanceInfo[token];

              sendWebhook(instanceInfo[token].webhook, {
                evento: "qr_code_expirado",
                nome: instanceInfo[token]?.nome,
                token: token
              });
            }
          }, 60 * 1000);
        } catch (err) {
          console.error("Erro no evento QR:", err);
        }
      });

      // Conexão efetuada
      client.on("ready", () => {
        try {
          instanceInfo[token].numero = client.info.wid.user;
          console.log(`[${instanceInfo[token].nome}] ✅ Cliente conectado! Token: ${token} Número: ${instanceInfo[token].numero}`);
          clearTimeout(qrCodeTimeout);
          delete qrCodes[token];
          sendWebhook(instanceInfo[token].webhook, {
            evento: "conexao_estabelecida",
            nome: instanceInfo[token].nome,
          });
        } catch (err) {
          console.error("Erro no evento ready:", err);
        }
      });

      // Autenticação efetuada
      client.on("authenticated", () => {
        console.log(`[${instanceInfo[token].nome}] 🔐 Autenticado`);
      });

      // Desconexão ou erro
      client.on("disconnected", (reason) => {
        try {
          console.log(`[${instanceInfo[token].nome}] 🔌 Desconectado: ${reason}`);
          delete sessions[token];
          delete qrCodes[token];
          delete instanceInfo[token];
          sendWebhook(instanceInfo[token].webhook, {
            evento: "desconectado",
            nome: instanceInfo[token]?.nome
          });
        } catch (err) {
          console.error("Erro no evento disconnected:", err);
        }
      });

      const mensagensMonitoradas = new Set();

      // Mensagens enviadas
      client.on("message_create", async (msg) => {
        mensagensMonitoradas.add(msg.id._serialized);
        let v_no_remetente;
        let v_no_destinatario;
        let v_ds_mensagem;
        let v_dh_mensagem;
        let v_sg_tipo; // E - Enviada, R - Recebida
        let v_is_respondida = msg.hasQuotedMsg ? "t" : "f";
        let v_is_encaminhada = msg.isForwarded ? "t" : "f";
        let v_mensagem_respondida = null;

        if (msg.hasQuotedMsg) {
        try {
            const quotedMsg = await msg.getQuotedMessage();
            v_mensagem_respondida = quotedMsg.body;
        } catch (e) {
            v_mensagem_respondida = null;
        }
    }

        try {
            if (msg.fromMe) {
                v_sg_tipo = "E";
                v_no_remetente = instanceInfo[token].numero;
                v_no_destinatario = msg.to;
            } else {
                v_sg_tipo = "R";
                v_no_remetente = msg.from;
                v_no_destinatario = instanceInfo[token].numero;
            }
            v_ds_mensagem = msg.body;
            v_dh_mensagem = new Date().toISOString();

            messages.push({
                token,
                remetente: v_no_remetente,
                destinatario: v_no_destinatario,
                mensagem: v_ds_mensagem,
                dataHora: v_dh_mensagem,
                respondida: v_is_respondida,
                encaminhada: v_is_encaminhada,
                mensagem_respondida: v_mensagem_respondida,
            });

            let logMsg = `[${v_no_remetente}] Mensagem enviada para ${v_no_destinatario}: ${v_ds_mensagem}`;
            if (v_is_respondida === "t" && v_mensagem_respondida) {
                logMsg += ` (responde à mensagem: "${v_mensagem_respondida}")`;
            }
            if (v_is_encaminhada === "t") {
                logMsg += " [Mensagem encaminhada]";
            }
            console.log(logMsg);

            sendWebhook(instanceInfo[token].webhook, {
                evento: (v_sg_tipo === "E") ? "Envio de Mensagem" : "Recebimento de Mensagem",
                nome: instanceInfo[token].nome,
                messages: {
                    tipo: v_sg_tipo,
                    remetente: v_no_remetente,
                    destinatario: v_no_destinatario,
                    mensagem: v_ds_mensagem,
                    dataHora: v_dh_mensagem,
                    respondida: v_is_respondida,
                    encaminhada: v_is_encaminhada,
                    mensagem_respondida: v_mensagem_respondida,
                },
            });

            // Se for mídia, baixar e salvar
            if (msg.hasMedia) {
                const media = await msg.downloadMedia();
                let v_no_tipo = media.mimetype.split("/")[0];
                let v_no_extensao = media.mimetype.split("/")[1];
                v_no_extensao = v_no_extensao.includes(";") ? v_no_extensao.split(";")[0] : v_no_extensao;
                const v_no_arquivo = v_no_tipo + '_' + Date.now() + '.' + v_no_extensao;

                const acao = v_sg_tipo === "E" ? "enviada" : "recebida";
                console.log(`[${instanceInfo[token].nome}] 📎 Mensagem de mídia ${acao}: ${v_no_arquivo}`);

                const pastaDestino = path.join(__dirname, v_sg_tipo, v_no_tipo);
                if (!fs.existsSync(pastaDestino)) {
                    fs.mkdirSync(pastaDestino, { recursive: true });
                }

                const v_no_path_arquivo = path.join(pastaDestino, v_no_arquivo);

                if (media.mimetype.startsWith("image") || media.mimetype.startsWith("audio") || media.mimetype.startsWith("video")) {
                    fs.writeFileSync(v_no_path_arquivo, media.data, "base64");
                } else {
                    fs.writeFileSync(v_no_path_arquivo, Buffer.from(media.data, "base64"));
                }

                sendWebhook(instanceInfo[token].webhook, {
                    evento: "Mensagem de Mídia",
                    nome: instanceInfo[token].nome,
                    messages: {
                        remetente: v_no_remetente,
                        destinatario: v_no_destinatario,
                        mensagem: "Conteúdo de mídia",
                        dataHora: v_dh_mensagem,
                        tipo: v_no_tipo,
                        mídia: v_no_path_arquivo
                    },
                });
                return;
            }
        } catch (err) {
            console.error("Erro no evento message_create:", err);
        }
    });

    // Captura reações somente em mensagens criadas nesta sessão
    client.on("message_reaction", async (reaction) => {
        try {
            if (!mensagensMonitoradas.has(reaction.msgId._serialized)) {
                return; // Ignora reações a mensagens antigas
            }

            const remetente = reaction.senderId;
            const emoji = reaction.emoji;
            let v_conteudo_mensagem = null;

            try {
                const mensagemReagida = await client.getMessageById(reaction.msgId._serialized);
                v_conteudo_mensagem = mensagemReagida?.body || "[Mídia ou mensagem sem texto]";
            } catch (e) {
                v_conteudo_mensagem = "[Não foi possível obter o conteúdo]";
            }

            console.log(
                `[${instanceInfo[token]?.nome || "Instância"}] Reação recebida: ${emoji} de ${remetente} na mensagem: "${v_conteudo_mensagem}"`
            );

            sendWebhook(instanceInfo[token]?.webhook, {
                evento: "Reacao em Mensagem",
                nome: instanceInfo[token]?.nome,
                reacao: {
                    remetente,
                    emoji,
                    conteudo_mensagem_reagida: v_conteudo_mensagem,
                },
            });
        } catch (err) {
            console.error("Erro ao processar reação:", err);
        }
    });

      client.on("message_reaction", async (reaction) => {
        try {
          const remetente = reaction.senderId;
          const emoji = reaction.emoji;
          // Buscar o conteúdo da mensagem reagida
          let v_conteudo_mensagem = null;
          try {
            const mensagemReagida = await client.getMessageById(reaction.msgId._serialized || reaction.msgId.id || reaction.msgId);
            v_conteudo_mensagem = mensagemReagida?.body || "[Mídia ou mensagem sem texto]";
          } catch (e) {
            v_conteudo_mensagem = "[Não foi possível obter o conteúdo]";
          }

          console.log(
            `[${instanceInfo[token]?.nome || "Instância"}] Reação recebida: ${emoji} de ${remetente} na mensagem: "${v_conteudo_mensagem}"`
          );

          sendWebhook(instanceInfo[token]?.webhook, {
            evento: "Reacao em Mensagem",
            nome: instanceInfo[token]?.nome,
            reacao: {
              remetente,
              emoji,
              conteudo_mensagem_reagida: v_conteudo_mensagem,
            },
          });
        } catch (err) {
          console.error("Erro ao processar reação:", err);
        }
      });

      // Iniciar cliente
      try {
        await client.initialize();
      } catch (err) {
        console.error(`[${req.body.Nome}] ❌ Erro ao iniciar cliente:`, err.message);
        delete sessions[token];
        delete instanceInfo[token];
        return res.status(500).json({ status: false, message: "Falha ao iniciar instância" });
      }

      res.json({
        status: true,
        token,
        nome: instanceInfo[token].nome,
        webhook: instanceInfo[token].webhook,
        message: "Sessão iniciada. QR gerado.",
      });
    } catch (err) {
      console.error("Erro na rota /nova-instancia:", err);
      res.status(500).json({ status: false, message: "Erro interno ao criar instância" });
    }
  }
);

// GET para obter QR Code
app.get("/qrcode/:token", (req, res) => {
  try {
    const token = req.params.token;
    if (qrCodes[token]) {
      res.json({ status: true, qr: qrCodes[token] });
    } else {
      res.status(404).json({ status: false, message: "QR Code não disponível ou expirado." });
    }
  } catch (err) {
    console.error("Erro ao obter QR Code:", err);
    res.status(500).json({ status: false, message: "Erro interno" });
  }
});

// POST para enviar mensagem
app.post(
  "/send-message",
  [
    body("token").notEmpty().withMessage("Token é obrigatório"),
    body("number").notEmpty().withMessage("Número é obrigatório"),
    body("message").notEmpty().withMessage("Mensagem é obrigatória"),
  ],
  async (req, res) => {
    try {
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

      const response = await client.sendMessage(numberZDG, message);
      res.status(200).json({ status: true, message: "Mensagem enviada com sucesso", response });
      sendWebhook(instanceInfo[token].webhook, {
        evento: "mensagem_enviada_com_sucesso",
        nome: instanceInfo[token].nome,
      });
    } catch (err) {
      console.error("Erro ao enviar mensagem:", err);
      res.status(500).json({ status: false, message: "Erro ao enviar mensagem", response: err.message });
    }
  }
);

// GET para listar mensagens recebidas
app.get("/received-messages", (req, res) => {
  try {
    res.json({
      status: true,
      total: messages.length,
      mensagens: messages,
    });
  } catch (err) {
    console.error("Erro ao listar mensagens:", err);
    res.status(500).json({ status: false, message: "Erro interno" });
  }
});

// GET para listar instâncias conectadas
app.get("/instancias", (req, res) => {
  try {
    const conectadas = Object.keys(sessions).map((token) => ({
      token,
      nome: instanceInfo[token]?.nome || "Desconhecido",
      numero: instanceInfo[token]?.numero || "Desconhecido",
      webhook: instanceInfo[token]?.webhook || "Não definido",
    }));

    res.json({ status: true, total: conectadas.length, instancias: conectadas });
  } catch (err) {
    console.error("Erro ao listar instâncias:", err);
    res.status(500).json({ status: false, message: "Erro interno" });
  }
});

// Middleware global para tratamento de erros
app.use((err, req, res, next) => {
  console.error("❌ Erro não capturado em rota:", err.stack);
  res.status(500).json({ status: false, message: "Erro interno do servidor" });
});

// Iniciar servidor
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
