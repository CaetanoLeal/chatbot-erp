// chatbot.js
const express = require('express')
const cors = require('cors')
const { body, validationResult } = require('express-validator')
const { v4: uuidv4 } = require('uuid')
const instanceManager = require('./InstanceManager')

const app = express()
const PORT = 3000

app.use(cors())
app.use(express.json())

function formatNumber(number) {
  return number.replace(/\D/g, '') + '@s.whatsapp.net'
}

app.post('/instances/create', async (req, res) => {
  const { name, webhookUrl, id_funil } = req.body
  const instanceId = uuidv4()

  await instanceManager.createInstance(
    instanceId,
    name,
    webhookUrl,
    id_funil
  )

  res.json({
    status: true,
    instanceId,
    message: 'QR Code gerado, scaneie para conectar a instância'
  })
})

app.get('/instances', (req, res) => {
  res.json(instanceManager.listAllInstances())
})

app.get('/instances/:name/qrcode', (req, res) => {
  const data = instanceManager.getQrCodeByName(req.params.name)

  if (!data) {
    return res.status(404).json({ error: 'Instância não encontrada' })
  }

  return res.json({
    status: data.status,
    qrCode: data.qrCode
  })
})

app.get('/instances/:name', (req, res) => {
  const data = instanceManager.getInstanceInfoByName(req.params.name)
  if (!data) return res.status(404).json({ error: 'Não encontrada' })
  res.json(data)
})

app.post('/instances/:name/message', async (req, res) => {
  try {
    const instance = instanceManager.getInstanceByName(req.params.name)

    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' })
    }

    if (instance.status !== 'CONNECTED') {
      return res.status(400).json({ error: 'Instância offline' })
    }

    if (!instance.sock?.user) {
      return res.status(400).json({ error: 'Socket ainda não pronto' })
    }

    const jid = formatNumber(req.body.number)

    const sent = await instance.sock.sendMessage(jid, {
      text: req.body.message
    })

    return res.json({
      status: true,
      messageId: sent.key.id
    })
  } catch (err) {
    console.error('❌ Erro ao enviar mensagem:', err)
    return res.status(500).json({ error: err.message })
  }
})

app.post('/instances/:name/message', async (req, res) => {
  try {
    const { number, message } = req.body
    const { name } = req.params

    if (!number || !message) {
      return res.status(400).json({
        error: 'number e message são obrigatórios'
      })
    }

    const sent = await instanceManager.sendTextMessageByName(
      name,
      number,
      message
    )

    return res.json({
      status: true,
      messageId: sent.key.id
    })
  } catch (err) {
    console.error('❌ Erro ao enviar mensagem:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

app.delete('/instances/:name', async (req, res) => {
  await instanceManager.safeRemoveInstanceByName(req.params.name)
  res.json({ status: true })
})

const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.set("io", io);
instanceManager.setIO(io);

server.listen(PORT, () =>
  console.log(`🚀 Chatbot ERP rodando na porta ${PORT}`)
);