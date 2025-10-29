// InstanceManager.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const EventEmitter = require('events');
const puppeteer = require('puppeteer');

class InstanceManager extends EventEmitter {
  constructor() {
    super();
    this.instances = new Map();
  }

  async createInstance(instanceId, instanceName, webhookUrl) {
    if (this.instances.has(instanceId)) {
      throw new Error('Uma instância com este ID já existe.');
    }

    console.log(`[${instanceName}] 🚀 Iniciando a criação da instância...`);

    const client = new Client({
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-extensions',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
        ],
      },
    });

    const instanceData = {
      id: instanceId,
      name: instanceName,
      webhook: webhookUrl,
      client,
      status: 'INITIALIZING',
      qrCode: null,
      userInfo: null,
    };

    this.instances.set(instanceId, instanceData);
    this.setupEventListeners(instanceData);

    try {
      await client.initialize();
      return instanceData;
    } catch (error) {
      console.error(`[${instanceName}] ❌ Falha ao inicializar o cliente: ${error.message}`);

      // Tentativa segura de destruir o cliente, se ainda existir
      try {
        if (client && client.pupPage) {
          await client.destroy().catch(() => {});
        }
      } catch (err) {
        console.error(`[${instanceName}] Erro ao destruir cliente: ${err.message}`);
      }

      this.instances.delete(instanceId);
      throw new Error(`Falha ao inicializar: ${error.message}`);
    }
  }

  setupEventListeners(instanceData) {
    const { client, name } = instanceData;

    client.on('qr', (qr) => {
      console.log(`[${name}] 📱 QR Code gerado. Exibindo no terminal...`);
      qrcode.generate(qr, { small: true });
      instanceData.qrCode = qr;
      instanceData.status = 'SCAN_QR_CODE';
      this.emit('webhookEvent', instanceData.webhook, {
        event: 'qr_generated',
        instance: this.getInstanceInfo(instanceData.id),
      });
    });

    client.on('authenticated', () => {
      console.log(`[${name}] 🔐 Autenticado com sucesso.`);
      instanceData.status = 'AUTHENTICATED';
      this.emit('webhookEvent', instanceData.webhook, {
        event: 'authenticated',
        instance: this.getInstanceInfo(instanceData.id),
      });
    });

    client.on('ready', () => {
      console.log(`[${name}] ✅ Cliente pronto e conectado!`);
      instanceData.qrCode = null;
      instanceData.status = 'CONNECTED';
      instanceData.userInfo = client.info;
      this.emit('webhookEvent', instanceData.webhook, {
        event: 'connection_ready',
        instance: this.getInstanceInfo(instanceData.id),
      });
    });

    client.on('message_create', async (msg) => {
      const eventType = msg.fromMe ? 'message_sent' : 'message_received';
      console.log(`[${name}] 📨 ${eventType}:`, msg.body);
      this.emit('webhookEvent', instanceData.webhook, {
        event: eventType,
        message: msg,
        instanceName: name,
      });
    });

    client.on('disconnected', (reason) => {
      console.log(`[${name}] 🔌 Cliente desconectado. Motivo: ${reason}`);
      this.emit('webhookEvent', instanceData.webhook, {
        event: 'disconnected',
        reason,
        instanceName: name,
      });
      this.safeRemoveInstance(instanceData.id);
    });

    client.on('auth_failure', (msg) => {
      console.error(`[${name}] ❌ Falha de autenticação: ${msg}`);
      this.emit('webhookEvent', instanceData.webhook, {
        event: 'auth_failure',
        message: msg,
        instanceName: name,
      });
      this.safeRemoveInstance(instanceData.id);
    });
  }

  async safeRemoveInstance(instanceId) {
    const instanceData = this.instances.get(instanceId);
    if (!instanceData) return;

    console.log(`[${instanceData.name}] 🧹 Encerrando e removendo instância...`);

    try {
      if (instanceData.client && instanceData.client.pupPage) {
        await instanceData.client.destroy().catch(() => {});
      }
    } catch (e) {
      console.error(`[${instanceData.name}] Erro ao destruir cliente: ${e.message}`);
    }

    this.instances.delete(instanceId);
  }

  getInstance(instanceId) {
    return this.instances.get(instanceId);
  }

  getInstanceInfo(instanceId) {
    const instanceData = this.instances.get(instanceId);
    if (!instanceData) return null;
    return {
      id: instanceData.id,
      name: instanceData.name,
      status: instanceData.status,
      userInfo: instanceData.userInfo,
      qrCode: instanceData.qrCode,
    };
  }

  listAllInstances() {
    return Array.from(this.instances.keys()).map((id) =>
      this.getInstanceInfo(id)
    );
  }
}

module.exports = new InstanceManager();
