// WebhookService.js
const axios = require('axios');

/**
 * Envia um payload para a URL de webhook especificada.
 * @param {string} url A URL do webhook para a qual enviar os dados.
 * @param {object} payload O objeto de dados a ser enviado.
 */
async function sendWebhook(url, payload) {
  if (!url) {
    console.warn(`⚠️ Nenhum webhook configurado. Evento não enviado.`);
    return { success: false, reason: 'Webhook URL ausente' };
  }

  try {
    const response = await axios.post(url, payload, {
      timeout: 15000, // Timeout de 15 segundos
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    console.log(`✅ Webhook enviado com sucesso (${response.status}) → ${url}`);
    return { success: true, status: response.status };
  } catch (error) {
    console.error(`❌ Erro ao enviar webhook para ${url}: ${error.message}`);
    if (error.response) {
      console.error(`🔎 Status: ${error.response.status}, Resposta:`, error.response.data);
    }
    return { success: false, reason: error.message };
  }
}

module.exports = { sendWebhook };
