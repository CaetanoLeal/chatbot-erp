//InstanceManager.js
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const EventEmitter = require('events');
const path = require('path');
const { Boom } = require('@hapi/boom');
const { sendWebhook } = require('./WebhookService');

/* =======================
   EXTRAÇÃO DE MENSAGEM
======================= */
function extractMessage(msg) {
  if (!msg.message) return { type: 'system', text: null };

  const type = Object.keys(msg.message)[0];

  switch (type) {
    case 'conversation':
      return { type: 'text', text: msg.message.conversation };
    case 'extendedTextMessage':
      return { type: 'text', text: msg.message.extendedTextMessage.text };
    case 'imageMessage':
      return { type: 'image', text: msg.message.imageMessage.caption || '[Imagem]' };
    case 'videoMessage':
      return { type: 'video', text: msg.message.videoMessage.caption || '[Vídeo]' };
    case 'audioMessage':
      return { type: 'audio', text: '[Áudio]' };
    case 'documentMessage':
      return { type: 'document', text: msg.message.documentMessage.fileName || '[Documento]' };
    case 'stickerMessage':
      return { type: 'sticker', text: '[Sticker]' };
    case 'locationMessage':
      return { type: 'location', text: '[Localização]' };
    case 'reactionMessage':
      return { type: 'reaction', text: msg.message.reactionMessage.text };
    default:
      return { type, text: '[Tipo não tratado]' };
  }
}

/* =======================
   INSTANCE MANAGER
======================= */
class InstanceManager extends EventEmitter {
  constructor() {
    super();
    this.instances = new Map();
  }

  /* =======================
     LISTAGEM
  ======================= */
  listAllInstances() {
    return Array.from(this.instances.entries()).map(([id, instance]) => ({
      id,
      name: instance.name,
      status: instance.status
    }));
  }

  /* =======================
     CRIAÇÃO
  ======================= */
  async createInstance(instanceId, name, webhookUrl) {
    for (const inst of this.instances.values()) {
      if (inst.name === name) {
        throw new Error('Já existe uma instância com esse nome');
      }
    }

    const authPath = path.join(__dirname, 'auth', instanceId);
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: require('pino')({ level: 'silent' })
    });

    const instance = {
      id: instanceId,
      name,
      webhook: webhookUrl,
      sock,
      status: 'INITIALIZING',
      qrCode: null,
      userInfo: null,
      _destroying: false,
      _lastAck: null
    };

    this.instances.set(instanceId, instance);
    this.bindEvents(instance, saveCreds);

    return instance;
  }

  /* =======================
     EVENTOS
  ======================= */
  bindEvents(instance, saveCreds) {
    const { sock } = instance;

    sock.ev.on('creds.update', saveCreds);

    /* ===== CONEXÃO ===== */
    sock.ev.on('connection.update', update => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        instance.status = 'SCAN_QR_CODE';
        instance.qrCode = qr;
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        instance.status = 'CONNECTED';
        instance.userInfo = sock.user;
        instance.qrCode = null;

        // 🔍 Teste de sanidade (mensagem para si mesmo)
        sock.sendMessage(sock.user.id, { text: 'ping' }).catch(() => {
          instance.status = 'INVALID';
        });
      }

      if (connection === 'close') {
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        instance.status = 'DISCONNECTED';

        if (reason === DisconnectReason.loggedOut) {
          this.safeRemoveInstance(instance.id);
        } else {
          setTimeout(() => this.reconnect(instance), 5000);
        }
      }
    });

    /* ===== MENSAGENS RECEBIDAS ===== */
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      const msg = messages[0];
      if (!msg || msg.key.fromMe) return;
      if (msg.message?.protocolMessage) return;

      const data = extractMessage(msg);
      if (!data.text || data.text === '[Tipo não tratado]') return;

      const payload = {
        event: 'message.received',
        instance: {
          id: instance.id,
          name: instance.name
        },
        whatsapp: {
          jid: msg.key.remoteJid,
          messageId: msg.key.id,
          pushName: msg.pushName || null,
          timestamp: msg.messageTimestamp
        },
        message: {
          type: data.type,
          text: data.text,
          raw: msg.message
        }
      };

      await sendWebhook(instance.webhook, payload);
    });

    /* ===== ACK DE ENVIO (CRÍTICO) ===== */
    sock.ev.on('messages.update', updates => {
      for (const update of updates) {
        if (!update.key.fromMe) continue;

        const status = update.update?.status;
        instance._lastAck = status;

        /*
          status:
          1 = enviado
          2 = entregue
          3 = lido
        */

        if (status < 2) {
          instance.status = 'DEGRADED';
        } else {
          instance.status = 'CONNECTED';
        }
      }
    });
  }

  /* =======================
     BUSCAS
  ======================= */
  getInstanceByName(name) {
    for (const instance of this.instances.values()) {
      if (instance.name === name) return instance;
    }
    return null;
  }

  getInstanceInfoByName(name) {
    for (const [id, instance] of this.instances.entries()) {
      if (instance.name === name) {
        return { id, name: instance.name, status: instance.status };
      }
    }
    return null;
  }

  /* =======================
     ENVIO SEGURO
  ======================= */
  async sendMessageByName(name, jid, content) {
    const instance = this.getInstanceByName(name);

    if (!instance) throw new Error('Instância não encontrada');
    if (!['CONNECTED', 'DEGRADED'].includes(instance.status)) {
      throw new Error(`Instância indisponível (${instance.status})`);
    }

    if (!instance.sock?.ws || instance.sock.ws.readyState !== 1) {
      instance.status = 'INVALID';
      throw new Error('Socket não pronto para envio');
    }

    const sentMsg = await instance.sock.sendMessage(jid, content);

    const payload = {
      event: 'message.sent',
      instance: {
        id: instance.id,
        name: instance.name
      },
      whatsapp: {
        jid,
        messageId: sentMsg.key.id,
        timestamp: sentMsg.messageTimestamp
      },
      message: {
        type: Object.keys(content)[0],
        text: content.text || null
      }
    };

    await sendWebhook(instance.webhook, payload);
    return sentMsg;
  }

  async sendTextMessageByName(name, number, text) {
  const jid = number.replace(/\D/g, '') + '@s.whatsapp.net'

  return this.sendMessageByName(name, jid, {
    text
  })
}

  /* =======================
     REMOÇÃO
  ======================= */
  async safeRemoveInstanceByName(name) {
    for (const [id, instance] of this.instances.entries()) {
      if (instance.name === name) {
        await this.safeRemoveInstance(id);
        return true;
      }
    }
    return false;
  }

  async safeRemoveInstance(id) {
    const instance = this.instances.get(id);
    if (!instance) return;

    instance._destroying = true;
    try {
      instance.sock.end();
    } catch (_) {}

    this.instances.delete(id);
  }

  async reconnect(instance) {
    if (instance._destroying) return;
    await this.safeRemoveInstance(instance.id);
    await this.createInstance(instance.id, instance.name, instance.webhook);
  }
}

module.exports = new InstanceManager();
