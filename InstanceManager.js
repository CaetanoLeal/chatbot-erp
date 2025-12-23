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

  /* ===============================
   * Criar instância
   * =============================== */
  async createInstance(instanceId, name, webhookUrl) {
    // 🔒 LOCK forte
    if (this.instances.has(instanceId)) {
      const inst = this.instances.get(instanceId);
      console.log(`[${name}] ⚠ Instância já existe (${inst.status})`);
      return inst;
    }

    console.log(`[${name}] 🚀 Criando instância...`);

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: instanceId }),
      puppeteer: {
        headless: true,
        executablePath:
          process.env.PUPPETEER_EXECUTABLE_PATH ||
          puppeteer.executablePath(),
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
      name,
      webhook: webhookUrl,
      client,
      status: 'INITIALIZING',
      qrCode: null,
      userInfo: null,
      _eventsBound: false,
      _destroying: false,
    };

    this.instances.set(instanceId, instanceData);
    this.setupEvents(instanceData);

    try {
      await client.initialize();
      return instanceData;
    } catch (err) {
      console.error(`[${name}] ❌ Erro ao inicializar:`, err);
      await this.safeRemoveInstance(instanceId);
      throw err;
    }
  }

  /* ===============================
   * Bind de eventos (1x apenas)
   * =============================== */
  setupEvents(instance) {
    if (instance._eventsBound) return;
    instance._eventsBound = true;

    const { client, name } = instance;

    /* 📱 QR CODE */
    client.on('qr', qr => {
      if (
        instance.status === 'AUTHENTICATED' ||
        instance.status === 'CONNECTED'
      ) {
        console.log(`[${name}] ⚠ QR ignorado (já autenticado)`);
        return;
      }

      console.log(`[${name}] 📱 QR Code gerado.`);
      instance.status = 'SCAN_QR_CODE';
      instance.qrCode = qr;

      qrcode.generate(qr, { small: true });
    });

    /* 🔐 AUTHENTICATED */
    client.on('authenticated', () => {
      if (
        instance.status !== 'INITIALIZING' &&
        instance.status !== 'SCAN_QR_CODE'
      ) {
        return;
      }

      console.log(`[${name}] 🔐 Autenticado.`);
      instance.status = 'AUTHENTICATED';
    });

    /* ✅ READY */
    client.on('ready', () => {
      if (instance.status === 'CONNECTED') return;

      console.log(`[${name}] ✅ Conectado!`);
      instance.status = 'CONNECTED';
      instance.qrCode = null;
      instance.userInfo = client.info;
    });

    /* 📨 MENSAGENS (apenas log) */
    client.on('message_create', msg => {
      const type = msg.fromMe
        ? 'message_sent'
        : 'message_received';

      console.log(
        `[${name}] 📨 ${type}: ${msg.body || '[mídia]'}`
      );
    });

    /* ❌ AUTH FAILURE */
    client.on('auth_failure', msg => {
      console.log(`[${name}] ❌ Falha de autenticação:`, msg);
      this.safeRemoveInstance(instance.id);
    });

    /* 🔌 DISCONNECTED */
    client.on('disconnected', async reason => {
      if (
        instance._destroying ||
        instance.status === 'DISCONNECTED'
      ) {
        return;
      }

      console.log(`[${name}] 🔌 Desconectado:`, reason);
      instance.status = 'DISCONNECTED';

      // Se logout/unpaired → precisa de novo QR
      if (reason === 'LOGOUT' || reason === 'UNPAIRED') {
        console.log(
          `[${name}] ⚠ Sessão invalidada. Novo QR será necessário.`
        );
      }

      // Delay para evitar race condition
      setTimeout(() => {
        this.safeRemoveInstance(instance.id);
      }, 15000);
    });
  }

  /* ===============================
   * Remoção segura
   * =============================== */
  async safeRemoveInstance(instanceId) {
    const instance = this.instances.get(instanceId);
    if (!instance || instance._destroying) return;

    instance._destroying = true;

    console.log(`[${instance.name}] 🧹 Encerrando instância...`);

    try {
      await instance.client.destroy();
    } catch (_) {}

    this.instances.delete(instanceId);
  }

  /* ===============================
   * Utils
   * =============================== */
  getInstance(id) {
    return this.instances.get(id);
  }

  getInstanceInfo(id) {
    const i = this.instances.get(id);
    if (!i) return null;

    return {
      id: i.id,
      name: i.name,
      status: i.status,
      userInfo: i.userInfo,
      qrCode: i.qrCode,
    };
  }

  listAllInstances() {
    return [...this.instances.values()].map(i =>
      this.getInstanceInfo(i.id)
    );
  }
}

module.exports = new InstanceManager();
