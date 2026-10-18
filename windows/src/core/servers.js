'use strict';
// 兩個 HTTP 服務：
// 1. Webhook（只綁 127.0.0.1，Cloudflare Tunnel 把 LINE 的請求轉進來）
// 2. 管理介面（App 視窗與區網瀏覽器共用；開啟「區網連入」時才綁 0.0.0.0，並要求密碼）

const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { handleAPI } = require('./api');

function readBody(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (e) => { server.off('listening', onListening); reject(e); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

const portError = (e, port) => (e.code === 'EADDRINUSE' ? `連接埠 ${port} 已被其他程式使用` : e.message);

// MARK: - Webhook

class WebhookServer {
  constructor(app) { this.app = app; this.server = null; }

  async start(port) {
    this.stop();
    const app = this.app;
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const body = req.method === 'POST' ? await readBody(req, 2 * 1024 * 1024) : Buffer.alloc(0);
        const r = app.handleWebhook({ method: req.method, path: url.pathname, headers: req.headers, body });
        res.writeHead(r.status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(r.body);
      } catch {
        res.writeHead(500); res.end('error');
      }
    });
    try {
      await listen(server, port, '127.0.0.1');
      this.server = server;
      app.serverRunning = true;
      app.serverError = null;
      app.log('info', `HTTP 服務啟動 127.0.0.1:${port}`);
      app.log('info', `服務已啟動（${app.accounts.length} 個帳號）`);
    } catch (e) {
      app.serverRunning = false;
      app.serverError = portError(e, port);
      app.log('error', `HTTP 服務無法啟動：${app.serverError}`);
    }
    app.changed();
  }

  stop() {
    if (this.server) { this.server.close(); this.server = null; }
    this.app.serverRunning = false;
  }
}

// MARK: - 管理介面

const SESSION_COOKIE = 'mlb_session';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  if (!stored || !password) return false;
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hashPassword(password, salt).split(':')[1], 'hex');
  const b = Buffer.from(hash || '', 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/// 這台電腦的區網 IP（顯示給使用者用）
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  }
  return out;
}

const isLoopback = (addr) => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

class AdminServer {
  constructor(app, { webRoot, vendor }) {
    this.app = app;
    this.webRoot = webRoot;
    this.vendor = vendor; // { '/vendor/vue.js': 檔案路徑, '/icons/': 資料夾 }
    this.server = null;
    this.sessions = new Map();
    this.sse = new Set();
    this.failures = new Map();
    app.on('change', (v) => { for (const res of this.sse) res.write(`data: ${v}\n\n`); });
  }

  get passwordHash() { return this.app.adminPasswordHash(); }

  async start() {
    this.stop();
    const app = this.app;
    const { adminPort, lanAccess } = app.settings;
    const host = lanAccess && this.passwordHash ? '0.0.0.0' : '127.0.0.1';
    const server = http.createServer((req, res) => this.handle(req, res).catch((e) => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }));
    try {
      await listen(server, adminPort, host);
      this.server = server;
      app.adminRunning = true;
      app.adminError = null;
      app.adminHost = host;
      app.log('info', `管理介面啟動 ${host === '0.0.0.0' ? '區網' : '本機'} :${adminPort}`);
    } catch (e) {
      app.adminRunning = false;
      app.adminError = portError(e, adminPort);
      app.log('error', `管理介面無法啟動：${app.adminError}`);
    }
    app.changed();
  }

  stop() {
    for (const res of this.sse) res.end();
    this.sse.clear();
    if (this.server) { this.server.close(); this.server.closeAllConnections && this.server.closeAllConnections(); this.server = null; }
    this.app.adminRunning = false;
  }

  /// 本機（App 視窗）免密碼；區網要登入
  authorized(req) {
    if (isLoopback(req.socket.remoteAddress) && !req.headers['cf-connecting-ip']) return true;
    const cookie = String(req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(SESSION_COOKIE + '='));
    const sid = cookie && cookie.slice(SESSION_COOKIE.length + 1);
    const s = sid && this.sessions.get(sid);
    if (!s) return false;
    if (Date.now() - s.at > 7 * 24 * 3600 * 1000) { this.sessions.delete(sid); return false; }
    return true;
  }

  send(res, status, obj, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(obj));
  }

  sendFile(res, file, type) {
    const fs = require('fs');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }

  async handle(req, res) {
    const path = require('path');
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const remote = req.socket.remoteAddress;

    // 登入（區網）
    if (p === '/api/login' && req.method === 'POST') {
      const key = remote;
      const f = this.failures.get(key) || { n: 0, until: 0 };
      if (Date.now() < f.until) return this.send(res, 429, { error: '嘗試太多次，請 1 分鐘後再試' });
      let body = {};
      try { body = JSON.parse((await readBody(req, 10000)).toString('utf8')); } catch { /* 空的 */ }
      if (!checkPassword(body.password, this.passwordHash)) {
        f.n += 1;
        if (f.n >= 5) { f.n = 0; f.until = Date.now() + 60000; }
        this.failures.set(key, f);
        this.app.log('warning', `區網登入失敗（${remote}）`);
        return this.send(res, 401, { error: '密碼不正確' });
      }
      this.failures.delete(key);
      const sid = crypto.randomBytes(24).toString('hex');
      this.sessions.set(sid, { at: Date.now(), remote });
      this.app.log('info', `區網登入：${remote}`);
      return this.send(res, 200, { ok: true }, { 'Set-Cookie': `${SESSION_COOKIE}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800` });
    }

    // 靜態檔案
    if (req.method === 'GET' && !p.startsWith('/api/')) {
      if (p === '/' || p === '/index.html') return this.sendFile(res, path.join(this.webRoot, 'index.html'), 'text/html; charset=utf-8');
      if (p === '/vendor/vue.js') return this.sendFile(res, this.vendor.vue, 'text/javascript; charset=utf-8');
      if (p.startsWith('/icons/') && /^[a-z0-9-]+\.svg$/.test(p.slice(7))) return this.sendFile(res, path.join(this.vendor.icons, p.slice(7)), 'image/svg+xml');
      const name = p.slice(1);
      const types = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
      if (/^[a-z0-9-]+\.(js|css|png|svg)$/.test(name)) return this.sendFile(res, path.join(this.webRoot, name), types[path.extname(name)]);
      res.writeHead(404); return res.end('Not Found');
    }

    if (!this.authorized(req)) return this.send(res, 401, { error: '請先登入', login: true });

    // 即時更新
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`data: ${this.app.version}\n\n`);
      this.sse.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); this.sse.delete(res); });
      return;
    }

    // 修改資料的請求要帶自訂標頭，擋掉其他網站的跨站請求
    if (req.method !== 'GET') {
      if (req.headers['x-mlb'] !== '1') return this.send(res, 403, { error: 'forbidden' });
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return this.send(res, 403, { error: 'forbidden' });
    }
    let body = {};
    if (req.method === 'POST') {
      try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch { return this.send(res, 400, { error: '格式錯誤' }); }
    }
    const local = isLoopback(remote) && !req.headers['cf-connecting-ip'];
    const result = await handleAPI(this.app, req.method, p, url.searchParams, body, { local, admin: this });
    return this.send(res, result.status, result.body);
  }
}

module.exports = { WebhookServer, AdminServer, hashPassword, checkPassword, lanAddresses };
