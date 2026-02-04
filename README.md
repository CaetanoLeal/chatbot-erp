# 💬 Container chatbot-erp – WhatsApp Instance Manager

Este container é o **gerenciador de instâncias do WhatsApp**. Ele conecta números via Baileys, mantém sessões ativas, escuta eventos do WhatsApp e **encaminha tudo para a API principal (`api_mensagem`) via webhook**.

> ⚠️ Importante: **não existe lógica de negócio aqui**. Este serviço **não decide fluxo**, **não valida respostas** e **não mantém estado conversacional**. Ele apenas conecta, envia e repassa eventos.

---

## 🎯 Objetivo

- Criar e gerenciar múltiplas instâncias WhatsApp
- Gerar QR Code para autenticação
- Manter sessões persistentes (auth state)
- Enviar mensagens sob comando externo
- Encaminhar mensagens recebidas e ACKs para a API principal

---

## 📦 Papel na Arquitetura

```
[ WhatsApp App ]
        ↓
[ chatbot-erp ]        ← Instance Manager
        ↓ (webhook)
[ api_mensagem ]       ← Regras de negócio
```

Este container é **stateful em conexão**, mas **stateless em negócio**.

---

## 🧱 Stack Utilizada

- Node.js
- Express
- @whiskeysockets/baileys
- Axios
- EventEmitter
- Multi-file Auth State (Baileys)

---

## 📂 Arquivos Principais

### `chatbot.js`

Responsável por:

- Subir o servidor HTTP
- Expor endpoints REST
- Delegar ações ao `InstanceManager`

---

### `InstanceManager.js`

Coração do container.

Responsável por:

- Criar instâncias WhatsApp
- Manter mapa de instâncias em memória
- Lidar com eventos do Baileys
- Enviar mensagens com segurança
- Detectar degradação de conexão
- Reencaminhar eventos para webhook

---

### `WebhookService.js`

Responsável por:

- Enviar eventos HTTP POST para a API principal
- Padronizar headers
- Controlar timeout e logs

---

## 🧩 Conceito de Instância

Uma **instância** representa **um número de WhatsApp conectado**.

Campos principais:

- `id` → UUID interno
- `name` → nome lógico (ex: empresa_x)
- `status` → estado atual da conexão
- `sock` → socket Baileys
- `webhook` → URL da API principal

---

## 🔌 Ciclo de Vida da Instância

### 1️⃣ Criação

**Endpoint**

```
POST /instances/create
```

**Body**

```json
{
  "name": "empresa_x",
  "webhookUrl": "http://api_mensagem/webhook/whatsapp"
}
```

Comportamento:

- Cria diretório de autenticação
- Inicializa socket Baileys
- Instância entra em estado `INITIALIZING`

---

### 2️⃣ QR Code

- Ao receber QR:
  - Status → `SCAN_QR_CODE`
  - QR armazenado em memória
  - QR impresso no terminal

---

### 3️⃣ Conectado

Quando a conexão abre:

- Status → `CONNECTED`
- Informações do usuário carregadas
- QR Code limpo
- Mensagem de sanidade enviada para si mesmo (`ping`)

---

### 4️⃣ Desconexão

- Status → `DISCONNECTED`
- Se logout → instância removida
- Se erro transitório → reconexão automática

---

## 📊 Estados da Instância

| Status       | Significado              |
| ------------ | ------------------------ |
| INITIALIZING | Criando socket           |
| SCAN_QR_CODE | Aguardando leitura do QR |
| CONNECTED    | Conectado e operacional  |
| DEGRADED     | ACK parcial (instável)   |
| DISCONNECTED | Conexão encerrada        |
| INVALID      | Socket inválido          |

---

## 📩 Mensagens Recebidas

Evento Baileys:

```
messages.upsert (notify)
```

Processo:

- Ignora mensagens próprias
- Ignora mensagens de sistema
- Extrai tipo e texto
- Monta payload padronizado
- Envia webhook para a API principal

**Payload enviado**

```json
{
  "event": "message.received",
  "instance": { "id": "...", "name": "empresa_x" },
  "whatsapp": {
    "jid": "...",
    "jidAlt": "...",
    "messageId": "...",
    "pushName": "..."
  },
  "message": {
    "type": "text",
    "text": "Olá",
    "raw": {}
  }
}
```

⚠️ `jid` e `jidAlt` podem variar — a API principal decide qual usar.

---

## 📤 Envio de Mensagens

**Endpoint**

```
POST /instances/:name/message
```

**Body**

```json
{
  "number": "559199999999",
  "message": "Olá!"
}
```

Regras:

- Instância deve estar `CONNECTED` ou `DEGRADED`
- Socket precisa estar pronto
- Número é normalizado para `@s.whatsapp.net`

Após envio:

- Evento `message.sent` é enviado via webhook

---

## ✅ ACK de Mensagens (Crítico)

Evento Baileys:

```
messages.update
```

Mapeamento:

- `1` → enviada
- `2` → entregue
- `3` → lida

Comportamento:

- Status < 2 → `DEGRADED`
- Status ≥ 2 → `CONNECTED`

---

## 🔎 Consulta de Instâncias

- `GET /instances` → lista resumida
- `GET /instances/:name` → status da instância

---

## 🗑️ Remoção Segura

- `DELETE /instances/:name`
- Finaliza socket
- Remove instância da memória
- Impede reconexão automática

---

## 🚫 O Que Este Container NÃO Faz

- ❌ Não controla funil
- ❌ Não interpreta respostas
- ❌ Não acessa banco de dados
- ❌ Não mantém estado de conversa

Tudo isso pertence à **API principal (`api_mensagem`)**.

---

## ✅ Status do Documento

✔ README oficial do WhatsApp Instance Manager
✔ Define contrato claro com a API principal
✔ Base para desenvolvimento do frontend

---

📌 Próximo passo recomendado:

- README do **Banco de Dados**
- Mapeamento final de eventos WhatsApp → API
- Início do frontend (dashboard de instâncias)
