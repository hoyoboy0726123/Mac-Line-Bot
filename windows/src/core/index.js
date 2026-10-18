'use strict';
// 把 App、自動回覆流程與兩個 HTTP 服務組起來。Electron 與命令列（測試用）共用。

const path = require('path');
const store = require('./store');

/// dataDir：資料資料夾；cipher：機密資料加解密（可省略）
function createCore({ dataDir, cipher } = {}) {
  if (dataDir) store.setBase(dataDir);
  if (cipher) store.secrets.setCipher(cipher);
  const { App } = require('./bot'); // bot.js 會把自動回覆流程掛到 App 上
  const { WebhookServer, AdminServer, hashPassword } = require('./servers');
  const app = new App();

  const webRoot = path.join(__dirname, '..', 'web');
  const vendor = {
    vue: require.resolve('vue/dist/vue.global.prod.js'),
    icons: path.join(path.dirname(require.resolve('lucide-static/package.json')), 'icons'),
  };
  const webhook = new WebhookServer(app);
  const admin = new AdminServer(app, { webRoot, vendor });

  app.adminPasswordHash = () => store.secrets.get('admin-password') || '';
  app.setAdminPassword = (pw) => { store.secrets.set('admin-password', hashPassword(pw)); admin.sessions.clear(); app.changed(); };
  app.restartWebhookServer = () => webhook.start(app.settings.port);
  app.restartAdminServer = () => admin.start();

  async function start() {
    await webhook.start(app.settings.port);
    await admin.start();
    app.start();
  }

  function stop() {
    app.shutdown();
    webhook.stop();
    admin.stop();
  }

  return { app, start, stop, admin, webhook };
}

module.exports = { createCore };
