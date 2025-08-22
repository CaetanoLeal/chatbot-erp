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
// Função para enviar dados ao WebHook - AJUSTADA para a API PHP
// Função para enviar dados ao WebHook - Versão com campos específicos
// Função para enviar dados ao WebHook - CORRIGIDA para a API PHP
async function sendWebhook(url, payload) {
  try {
    // Extrai a mensagem textual do payload
    let mensagemTexto = '';
    
    // Tenta encontrar a mensagem em diferentes estruturas
    if (payload.mensagem_completa && payload.mensagem_completa.body) {
      mensagemTexto = payload.mensagem_completa.body;
    } else if (payload.body) {
      mensagemTexto = payload.body;
    } else if (payload.mensagem) {
      mensagemTexto = payload.mensagem;
    } else if (payload.messages && payload.messages.mensagem) {
      mensagemTexto = payload.messages.mensagem;
    }
    
    // Converte o payload completo para string JSON
    const jsonCompleto = JSON.stringify(payload);
    
    // Estrutura o payload no formato EXATO que a API PHP espera
    const apiPayload = {
      body: mensagemTexto,          // Campo 'body' (obrigatório) → vai para gn_msg
      gn_json: jsonCompleto         // Campo adicional → vai para gn_json
    };

    await axios.post(url, apiPayload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    
    console.log(`✅ Webhook enviado com sucesso para: ${url}`);
  } catch (err) {
    console.error("Erro ao enviar para WebHook:", err.message);
  }
}

// Função para extrair TODAS as informações de uma mensagem
function extractAllMessageData(msg) {
  try {
    const messageData = {
      // Informações básicas
      id: msg.id ? msg.id._serialized : null,
      from: msg.from,
      to: msg.to,
      fromMe: msg.fromMe,
      timestamp: msg.timestamp,
      hasMedia: msg.hasMedia,
      hasQuotedMsg: msg.hasQuotedMsg,
      isForwarded: msg.isForwarded,
      isStatus: msg.isStatus,
      isEphemeral: msg.isEphemeral,
      
      // Conteúdo da mensagem
      body: msg.body,
      type: msg.type,
      mimetype: msg.mimetype || null,
      mediaKey: msg.mediaKey || null,
      filename: msg.filename || null,
      clientUrl: msg.clientUrl || null,
      deprecatedMms3Url: msg.deprecatedMms3Url || null,
      
      // Informações de localização
      location: msg.location ? {
        latitude: msg.location.latitude,
        longitude: msg.location.longitude,
        description: msg.location.description
      } : null,
      
      // Informações de contato
      vCards: msg.vCards || [],
      mentionedIds: msg.mentionedIds || [],
      
      // Informações de reação
      hasReaction: msg.hasReaction,
      reactions: msg.reactions || [],
      
      // Informações de encaminhamento
      forwardingScore: msg.forwardingScore || 0,
      isForwarded: msg.isForwarded,
      
      // Informações de citação
      quotedMsg: null,
      quotedMsgId: msg.quotedMsgId ? msg.quotedMsgId._serialized : null,
      
      // Informações de status de entrega
      ack: msg.ack,
      broadcast: msg.broadcast || false,
      
      // Informações de dispositivo
      deviceType: msg.deviceType || 'unknown',
      
      // Informações de temporização
      duration: msg.duration || null,
      seconds: msg.seconds || null,
      
      // Metadados adicionais
      author: msg.author || null,
      notifyName: msg.notifyName || null,
      caption: msg.caption || null,
      
      // Informações de chat/grupo
      isGroupMsg: msg.isGroupMsg,
      isMedia: msg.isMedia,
      isNotification: msg.isNotification,
      isPSA: msg.isPSA,
      
      // Raw data (se disponível)
      rawData: msg.rawData ? JSON.parse(JSON.stringify(msg.rawData)) : null

    };

    return messageData;
  } catch (error) {
    console.error("Erro ao extrair dados da mensagem:", error);
    return { error: "Falha ao extrair dados da mensagem", originalError: error.message };
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
      let connectionTimestamp = null; // Armazena o momento da conexão

      client.on("ready", () => {
        try {
          instanceInfo[token].numero = client.info.wid.user;
          connectionTimestamp = Date.now(); // Marca o momento da conexão
          console.log(`[${instanceInfo[token].nome}] ✅ Cliente conectado! Token: ${token} Número: ${instanceInfo[token].numero}`);
          clearTimeout(qrCodeTimeout);
          delete qrCodes[token];
          sendWebhook(instanceInfo[token].webhook, {
            evento: "conexao_estabelecida",
            nome: instanceInfo[token].nome,
            numero: instanceInfo[token].numero,
            token: token
          });
        } catch (err) {
          console.error("Erro no evento ready:", err);
        }
      });

      // Autenticação efetuada
      client.on("authenticated", () => {
        console.log(`[${instanceInfo[token].nome}] 🔐 Autenticado`);
        sendWebhook(instanceInfo[token].webhook, {
          evento: "autenticado",
          nome: instanceInfo[token].nome,
          token: token
        });
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
            nome: instanceInfo[token]?.nome,
            motivo: reason,
            token: token
          });
        } catch (err) {
          console.error("Erro no evento disconnected:", err);
        }
      });

      const mensagensMonitoradas = new Set();

      // Mensagens enviadas
      client.on("message_create", async (msg) => {
        try {
          mensagensMonitoradas.add(msg.id._serialized);
          
          // Extrair TODOS os dados da mensagem
          const messageData = extractAllMessageData(msg);
          
          // Adicionar informações adicionais
          messageData.instanceInfo = {
            nome: instanceInfo[token].nome,
            token: token,
            numero: instanceInfo[token].numero
          };
          console.log(msg)
          
          messageData.eventType = msg.fromMe ? "mensagem_enviada" : "mensagem_recebida";
          messageData.timestampISO = new Date().toISOString();
          
          // Processar mensagem citada se existir
          if (msg.hasQuotedMsg) {
            try {
              const quotedMsg = await msg.getQuotedMessage();
              messageData.quotedMsg = extractAllMessageData(quotedMsg);
            } catch (e) {
              messageData.quotedMsg = { error: "Não foi possível obter a mensagem citada" };
            }
          }
          
          // Baixar mídia se existir
          if (msg.hasMedia) {
            try {
              const media = await msg.downloadMedia();
              messageData.media = {
                mimetype: media.mimetype,
                data: media.data,
                filesize: media.data.length,
                filename: msg.filename || `media_${Date.now()}.${media.mimetype.split('/')[1]}`
              };
              
              // Salvar arquivo de mídia
              const mediaType = media.mimetype.split('/')[0];
              const extension = media.mimetype.split('/')[1].split(';')[0];
              const filename = `${mediaType}_${Date.now()}.${extension}`;
              const folderPath = path.join(__dirname, messageData.eventType === "mensagem_enviada" ? "enviadas" : "recebidas", mediaType);
              
              if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath, { recursive: true });
              }
              
              const filePath = path.join(folderPath, filename);
              fs.writeFileSync(filePath, media.data, 'base64');
              
              messageData.media.filePath = filePath;
              messageData.media.saved = true;
              
            } catch (mediaError) {
              messageData.media = { error: "Falha ao processar mídia", details: mediaError.message };
            }
          }
          
          // Adicionar ao histórico de mensagens
          messages.push(messageData);
          
          // Log no console
          console.log(`[${instanceInfo[token].nome}] 📨 ${messageData.eventType === "mensagem_enviada" ? "Enviada" : "Recebida"} de ${msg.fromMe ? instanceInfo[token].numero : msg.from} para ${msg.fromMe ? msg.to : instanceInfo[token].numero}: ${msg.body || "[Mídia]"}`);
          
          // Enviar TODOS os dados para o webhook
          sendWebhook(instanceInfo[token].webhook, {
            evento: messageData.eventType,
            timestamp: new Date().toISOString(),
            mensagem_completa: messageData
          });
          
        } catch (err) {
          console.error("Erro no evento message_create:", err);
          // Mesmo em caso de erro, tentar enviar o máximo de informações possível
          try {
            sendWebhook(instanceInfo[token].webhook, {
              evento: "erro_no_processamento_da_mensagem",
              timestamp: new Date().toISOString(),
              erro: err.message,
              mensagem_basica: {
                id: msg.id ? msg.id._serialized : "unknown",
                from: msg.from,
                to: msg.to,
                body: msg.body,
                hasMedia: msg.hasMedia
              }
            });
          } catch (webhookError) {
            console.error("Erro ao enviar webhook de erro:", webhookError);
          }
        }
      });

      // Status da mensagem (enviada, entregue, lida)
      client.on("message_ack", (msg, ack) => {
        try {
          let status;
          switch (ack) {
            case 0: status = "pendente"; break;   // Ainda não enviada
            case 1: status = "enviada"; break;    // ✔️ enviada ao servidor
            case 2: status = "entregue"; break;   // ✔️✔️ entregue ao contato
            case 3: status = "lida"; break;       // Azul = lida
            case 4: status = "reproduzida"; break; // Para áudios/vídeos
            default: status = "desconhecido";
          }

          console.log(
            `[${instanceInfo[token]?.nome}] 📡 Mensagem ${msg.id._serialized} mudou status para: ${status}`
          );

          // Extrair dados completos da mensagem para o status
          const messageData = extractAllMessageData(msg);
          
          sendWebhook(instanceInfo[token]?.webhook, {
            evento: "status_mensagem",
            timestamp: new Date().toISOString(),
            status: status,
            mensagem_completa: messageData,
            informacoes_adicionais: {
              nome: instanceInfo[token]?.nome,
              token: token,
              numero: instanceInfo[token]?.numero
            }
          });
        } catch (err) {
          console.error("Erro ao processar status da mensagem:", err);
        }
      });

    // Captura reações somente em mensagens criadas após a conexão
    client.on("message_reaction", async (reaction) => {
        try {
            // Busca a mensagem reagida para pegar o timestamp dela
            let mensagemReagida;
            try {
              mensagemReagida = await client.getMessageById(reaction.msgId._serialized);
            } catch (e) {
              mensagemReagida = null;
            }

            // Se não conseguir buscar a mensagem, ou se ela for anterior à conexão, ignora
            if (
              !mensagemReagida ||
              !mensagemReagida.timestamp ||
              (connectionTimestamp && mensagemReagida.timestamp * 1000 < connectionTimestamp)
            ) {
              return;
            }

            // Extrair dados completos da mensagem reagida
            const messageData = extractAllMessageData(mensagemReagida);
            
            const reactionData = {
              remetente: reaction.senderId,
              emoji: reaction.emoji,
              id_mensagem: reaction.msgId._serialized,
              timestamp: new Date().toISOString(),
              mensagem_reagida: messageData
            };

            console.log(
              `[${instanceInfo[token]?.nome || "Instância"}] Reação recebida: ${reaction.emoji} de ${reaction.senderId}`
            );

            sendWebhook(instanceInfo[token]?.webhook, {
              evento: "reacao_mensagem",
              timestamp: new Date().toISOString(),
              reacao_completa: reactionData,
              informacoes_adicionais: {
                nome: instanceInfo[token]?.nome,
                token: token,
                numero: instanceInfo[token]?.numero
              }
            });
          } catch (err) {
            console.error("Erro ao processar reação:", err);
          }
    });

      // Captura edições de mensagens
      client.on("message_edit", async (msg) => {
          try {
              // Extrair dados completos da mensagem editada
              const messageData = extractAllMessageData(msg);
              
              const editData = {
                id_mensagem: msg.id._serialized,
                novo_conteudo: msg.body,
                remetente: msg.from,
                destinatario: msg.to || instanceInfo[token]?.numero,
                timestamp: new Date().toISOString(),
                mensagem_completa: messageData
              };

              console.log(
                  `[${instanceInfo[token]?.nome || "Instância"}] Mensagem editada [${msg.id._serialized}] por ${msg.from}`
              );

              sendWebhook(instanceInfo[token]?.webhook, {
                  evento: "edicao_mensagem",
                  timestamp: new Date().toISOString(),
                  edicao_completa: editData,
                  informacoes_adicionais: {
                    nome: instanceInfo[token]?.nome,
                    token: token,
                    numero: instanceInfo[token]?.numero
                  }
              });
          } catch (err) {
              console.error("Erro ao processar edição de mensagem:", err);
          }
      });

      // Evento de mudança no estado de conexão
      client.on("change_state", (state) => {
        sendWebhook(instanceInfo[token]?.webhook, {
          evento: "mudanca_estado_conexao",
          timestamp: new Date().toISOString(),
          estado: state,
          informacoes_adicionais: {
            nome: instanceInfo[token]?.nome,
            token: token,
            numero: instanceInfo[token]?.numero
          }
        });
      });

      // Evento de mudança na bateria
      client.on("change_battery", (batteryInfo) => {
        sendWebhook(instanceInfo[token]?.webhook, {
          evento: "mudanca_bateria",
          timestamp: new Date().toISOString(),
          bateria: batteryInfo,
          informacoes_adicionais: {
            nome: instanceInfo[token]?.nome,
            token: token,
            numero: instanceInfo[token]?.numero
          }
        });
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
      
      // Extrair dados completos da mensagem enviada
      const messageData = extractAllMessageData(response);
      messageData.instanceInfo = {
        nome: instanceInfo[token].nome,
        token: token,
        numero: instanceInfo[token].numero
      };
      
      res.status(200).json({ 
        status: true, 
        message: "Mensagem enviada com sucesso", 
        response: messageData 
      });
      
      sendWebhook(instanceInfo[token].webhook, {
        evento: "mensagem_enviada_api",
        timestamp: new Date().toISOString(),
        mensagem_completa: messageData
      });
      
    } catch (err) {
      console.error("Erro ao enviar mensagem:", err);
      res.status(500).json({ status: false, message: "Erro ao enviar mensagem", error: err.message });
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
      status: "conectada"
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