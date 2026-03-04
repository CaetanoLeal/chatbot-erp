// InstanceBootService.js
/*const pool = require('./config/db');
const instanceManager = require('./InstanceManager');
const fs = require('fs');
const path = require('path');

async function waitForDatabase(retries = 10) {
  while (retries > 0) {
    try {
      await pool.query('SELECT 1');
      console.log('✅ Banco pronto');
      return;
    } catch (err) {
      console.log('⏳ Aguardando banco iniciar...');
      retries--;
      await new Promise(res => setTimeout(res, 3000));
    }
  }

  throw new Error('Banco não respondeu após várias tentativas');
}

async function syncAuthFolders(validInstanceIds) {
  const authBasePath = path.join(__dirname, 'auth');

  if (!fs.existsSync(authBasePath)) return;

  const folders = fs.readdirSync(authBasePath);

  for (const folder of folders) {
    const fullPath = path.join(authBasePath, folder);

    if (!validInstanceIds.has(folder)) {
      console.log(`🗑 Removendo pasta auth órfã: ${folder}`);
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }
}

async function bootInstances() {
  console.log("🚀 Iniciando boot das instâncias...");

  try {
    await waitForDatabase();

    const { rows } = await pool.query(`
      SELECT 
        id_instancia,
        no_instancia,
        ds_webhook,
        id_funil
      FROM tbl_instancia
      WHERE cd_status = 1
        AND cd_provider = 1
    `);

    const dbIds = new Set(rows.map(r => r.id_instancia));

    // Sincroniza pasta auth
    await syncAuthFolders(dbIds);

    // Cria instâncias válidas
    for (const row of rows) {
      if (!instanceManager.instances.has(row.id_instancia)) {
        console.log(`🔄 Bootando instância ${row.no_instancia}`);

        await instanceManager.createInstance(
          row.id_instancia,
          row.no_instancia,
          row.ds_webhook,
          row.id_funil
        );
      }
    }

    console.log("✅ Boot finalizado.");
  } catch (err) {
    console.error("❌ Erro no boot das instâncias:", err.message);
  }
}

module.exports = { bootInstances };