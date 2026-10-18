'use strict';
// 不開視窗、直接跑服務（開發測試或放在伺服器上用）：node src/cli.js
// 資料夾預設 ./data，可用 MLB_DATA_DIR 指定。管理介面：http://127.0.0.1:<adminPort>

const path = require('path');
const { createCore } = require('./core');

const dataDir = process.env.MLB_DATA_DIR || path.join(process.cwd(), 'data');
const core = createCore({ dataDir });
core.app.on('change', () => {});
core.start().then(() => {
  const s = core.app.settings;
  console.log(`${require('../edition.json').productName} 服務已啟動`);
  console.log(`  資料：${dataDir}`);
  console.log(`  Webhook：http://127.0.0.1:${s.port}/webhook/<帳號路徑>`);
  console.log(`  管理介面：http://127.0.0.1:${s.adminPort}/`);
});

const quit = () => { core.stop(); process.exit(0); };
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
