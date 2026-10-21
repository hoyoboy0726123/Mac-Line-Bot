'use strict';
// 雲端版沒有本機 HTTP 伺服器（Worker 直接處理請求），只保留 api.js 會用到的函式。
const lanAddresses = () => [];
module.exports = { lanAddresses, WebhookServer: class {}, AdminServer: class {}, hashPassword: () => '', checkPassword: () => false };
