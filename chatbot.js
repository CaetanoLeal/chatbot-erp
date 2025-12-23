// chatbot.js
const express = require('express');
const cors = require('cors');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const instanceManager = require('./InstanceManager');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// erros globais
process.on('uncaughtException', err => console.error("❌ Erro não capturado:", err));
process.on('unhandledRejection', err => console.error("❌ Promise rejeitada:", err));

/* Utilitário */
function formatWhatsappNumber(number) {
  const cleaned = number.replace(/\D/g, '');
  if (cleaned.length === 11) return `55${cleaned}@c.us`;
  if (cleaned.length === 13 && cleaned.startsWith('55')) return `${cleaned}@c.us`;
  throw new Error("Número inválido. Use 11999998888");
}

/* ─────────────── ROTAS ─────────────── */

// Criar instância
app.post(
  '/instances/create',
  [body('name').notEmpty(), body('webhookUrl').optional().isURL()],
  async (req, res, next) => {

    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { name, webhookUrl } = req.body;
      const instanceId = uuidv4();

      // CRUCIAL: garantir que só cria UMA VEZ
      const data = await instanceManager.createInstance(instanceId, name, webhookUrl);

      res.status(201).json({
        status: true,
        message: 'Instância iniciada. Consulte o status para pegar o QR code.',
        instanceId,
        name,
      });

    } catch (err) {
      next(err);
    }
  }
);

// Listar instâncias
app.get('/instances', (req, res) => {
  res.json({ status: true, data: instanceManager.listAllInstances() });
});

// Pegar status
app.get('/instances/:instanceId', (req, res) => {
  const info = instanceManager.getInstanceInfo(req.params.instanceId);
  if (!info) return res.status(404).json({ status: false, message: 'Instância não encontrada.' });
  res.json({ status: true, data: info });
});

// Enviar mensagem
app.post(
  '/instances/:instanceId/message',
  [body('number').notEmpty(), body('message').notEmpty()],
  async (req, res, next) => {

    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { instanceId } = req.params;
      const { number, message } = req.body;

      const instance = instanceManager.getInstance(instanceId);

      if (!instance || instance.status !== 'CONNECTED') {
        return res.status(404).json({
          status: false,
          message: 'Instância não encontrada ou não conectada.'
        });
      }

      const formatted = formatWhatsappNumber(number);
      const response = await instance.client.sendMessage(formatted, message);

      res.json({ status: true, message: 'Mensagem enviada!', data: response });

    } catch (err) {
      next(err);
    }
  }
);

// Remover instância
app.delete('/instances/:instanceId', async (req, res) => {
  await instanceManager.safeRemoveInstance(req.params.instanceId);
  res.json({ status: true, message: 'Instância removida com sucesso.' });
});

// fallback
app.use((err, req, res, next) => {
  console.error("❌ Erro:", err.stack);
  res.status(500).json({ status: false, error: err.message });
});

app.listen(PORT, '0.0.0.0', () =>
  console.log(`✅ Servidor rodando na porta ${PORT}`)
);
