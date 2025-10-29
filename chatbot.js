// chatbot.js
const express = require('express');
const cors = require('cors');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const instanceManager = require('./InstanceManager');

const app = express();
const PORT = 3000;

// Middlewares Globais
app.use(cors());
app.use(express.json());

// Tratamento global de erros para evitar que a aplicação pare
process.on('uncaughtException', (err) => {
  console.error('❌ Erro global não capturado:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('❌ Rejeição de Promise não tratada:', reason);
});

// --- Funções Auxiliares ---
/**
 * Formata um número de telefone para o padrão do WhatsApp.
 * Ex: 11987654321 -> 5511987654321@c.us
 * @param {string} number O número de telefone.
 * @returns {string} O número formatado.
 */
function formatWhatsappNumber(number) {
    const cleaned = number.replace(/\D/g, ''); // Remove todos os não dígitos
    if (cleaned.length === 11 && cleaned.startsWith('55')) {
        return `${cleaned}@c.us`; // Já está quase no formato, só falta o @c.us
    }
    if (cleaned.length > 11 && cleaned.startsWith('55')) {
        return `${cleaned}@c.us`;
    }
    if (cleaned.length === 11) { // Formato comum no Brasil (DDD + 9 + número)
        return `55${cleaned}@c.us`;
    }
    // Adicione mais lógicas se precisar de outros formatos
    throw new Error('Formato de número inválido. Use o formato brasileiro com DDD (ex: 11988887777).');
}


// --- Rotas da API ---

// Rota para criar uma nova instância
app.post(
  '/instances/create',
  [
    body('name').notEmpty().withMessage('O campo "name" é obrigatório.'),
    body('webhookUrl').optional().isURL().withMessage('A "webhookUrl" deve ser uma URL válida.'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { name, webhookUrl } = req.body;
      const instanceId = uuidv4();
      
      // A criação é assíncrona, mas não esperamos aqui para retornar a resposta rapidamente
      instanceManager.createInstance(instanceId, name, webhookUrl)
        .catch(err => console.error(`[${name}] Erro em background na criação da instância:`, err));

      res.status(201).json({
        status: true,
        message: 'Criação da instância iniciada. Monitore o status para obter o QR Code.',
        instanceId: instanceId,
        name: name,
      });
    } catch (error) {
      next(error); // Passa o erro para o middleware de tratamento de erros
    }
  }
);

// Rota para listar todas as instâncias ativas
app.get('/instances', (req, res, next) => {
  try {
    const instances = instanceManager.listAllInstances();
    res.status(200).json({
      status: true,
      data: instances,
    });
  } catch (error) {
    next(error);
  }
});

// Rota para obter o status de uma instância específica (incluindo o QR Code)
app.get('/instances/:instanceId', (req, res, next) => {
    try {
        const { instanceId } = req.params;
        const info = instanceManager.getInstanceInfo(instanceId);

        if (!info) {
            return res.status(404).json({ status: false, message: 'Instância não encontrada.'});
        }

        res.status(200).json({ status: true, data: info });
    } catch (error) {
        next(error);
    }
});

// Rota para enviar uma mensagem
app.post(
  '/instances/:instanceId/message',
  [
    body('number').notEmpty().withMessage('O campo "number" é obrigatório.'),
    body('message').notEmpty().withMessage('O campo "message" é obrigatório.'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { instanceId } = req.params;
      const { number, message } = req.body;

      const instance = instanceManager.getInstance(instanceId);
      if (!instance || instance.status !== 'CONNECTED') {
        return res.status(404).json({ status: false, message: 'Instância não encontrada ou não está conectada.' });
      }

      const formattedNumber = formatWhatsappNumber(number);
      const response = await instance.client.sendMessage(formattedNumber, message);

      res.status(200).json({
        status: true,
        message: 'Mensagem enviada com sucesso!',
        data: response,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Rota para deletar/desconectar uma instância
app.delete('/instances/:instanceId', async (req, res, next) => {
    try {
        const { instanceId } = req.params;
        await instanceManager.removeInstance(instanceId);
        res.status(200).json({ status: true, message: 'Instância desconectada e removida com sucesso.' });
    } catch(error) {
        next(error);
    }
});


// Middleware de tratamento de erros da API
app.use((err, req, res, next) => {
  console.error('❌ Erro na Rota:', err.stack);
  res.status(500).json({
    status: false,
    message: 'Ocorreu um erro interno no servidor.',
    error: err.message,
  });
});

// Iniciar o servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});