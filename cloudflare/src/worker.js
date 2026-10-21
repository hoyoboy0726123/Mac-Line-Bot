// Mac-Line-Bot MIL 雲端版
// Worker：接收 LINE webhook、管理介面 API（需登入）；靜態網頁由 Workers Static Assets 提供
// Durable Object「Main」：就是桌面版的那個常駐程式（App），所有帳號、對話、知識庫都在裡面

import './tz.js';
import { DurableObject } from 'cloudflare:workers';
import store from './shims/store.cjs';
import vectors from './shims/vectors.cjs';
import ai from './shims/ollama.cjs';
import { checkLogin, issueCookie, sessionOK, clearCookie } from './auth.js';
import core from '../../windows/src/core/bot.js';
import api from '../../windows/src/core/api.js';
import appModule from '../../windows/src/core/app.js';
import models from '../../windows/src/core/models.js';

const { App } = core;
const { handleAPI } = api;

// 雲端版不用從外部檢查自己的網址（Worker 打自己的網址會失敗，還會誤發斷線通知）
appModule.App.probe = async () => true;

const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

/// 雲端用不到的設定（連接埠、區網、開資料夾）
const UNSUPPORTED = new Set(['/api/settings/ports', '/api/settings/lan', '/api/settings/login-item', '/api/system/open', '/api/ollama/pull']);
const TICK_MS = 5 * 60 * 1000;

export class Main extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.streams = new Set();
    this.failures = { n: 0, until: 0 };
    this.ready = ctx.blockConcurrencyWhile(() => this.boot());
  }

  async boot() {
    ai.setAI(this.env.AI);
    await store.init(this.ctx.storage);
    // 第一次啟動：模型改成 Workers AI
    const s = models.normalizeSettings(store.loadSettings());
    if (!String(s.chatModel).startsWith('@')) s.chatModel = ai.DEFAULT_CHAT;
    if (!String(s.embedModel).startsWith('@')) s.embedModel = ai.DEFAULT_EMBED;
    s.useOllama = true;
    s.autoStart = true;
    store.saveSettings(s);
    await vectors.shared.init(this.ctx.storage, s.embedModel);

    const app = new App();
    this.app = app;
    app.serverRunning = true;
    app.adminRunning = true;
    app.adminHost = 'cloud';
    app.adminPasswordHash = () => '';
    app.setAdminPassword = () => {};
    app.restartWebhookServer = async () => {};
    app.restartAdminServer = async () => {};
    app.tunnel.publicURL = s.cloudPublicURL || null;
    // Webhook 狀態、上次收到訊息的時間：重新啟動後還要在
    const status = store.load('status') || {};
    app.webhookStatus = status.webhookStatus || {};
    app.lastEventAt = status.lastEventAt || null;
    let statusJSON = JSON.stringify(status);
    // 狀態說明改成雲端版的用語
    const health = app.health.bind(app);
    app.health = () => {
      const h = health();
      if (h.title === 'Webhook 尚未同步') h.detail = '到「LINE 連線」頁按「重新設定到 LINE」';
      return h;
    };
    // 日誌：留最近 150 筆，重新啟動後還看得到
    app.logs = store.load('logs') || [];
    let logTimer = null;
    app.on('change', (v) => {
      for (const w of this.streams) w.write(`data: ${v}\n\n`).catch(() => this.streams.delete(w));
      if (!logTimer) {
        logTimer = setTimeout(() => {
          logTimer = null;
          store.save(app.logs.slice(0, 150), 'logs');
          const now = JSON.stringify({ webhookStatus: app.webhookStatus, lastEventAt: app.lastEventAt });
          if (now !== statusJSON) { statusJSON = now; store.save(JSON.parse(now), 'status'); }
        }, 1500);
      }
    });
    // 處理 LINE 訊息時，讓 Durable Object 等處理完才休眠
    const process = app.process.bind(app);
    app.process = (...args) => {
      const p = process(...args);
      this.ctx.waitUntil(p.catch(() => {}));
      return p;
    };
    // Durable Object 閒置後會重新啟動，每次都記「Ollama 已連線」會洗版
    const log = app.log.bind(app);
    app.log = (level, msg, ...rest) => (String(msg).startsWith('Ollama 已連線') ? undefined : log(level, msg, ...rest));
    if (!app.logs.length) app.log('info', '雲端版啟動（Cloudflare Workers + Workers AI）');
    app.started = true;
    await app.refreshOllama(false);
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    this.ctx.waitUntil(app.upgradeMIL().catch(() => {}));
  }

  /// 每 5 分鐘：自動交還 AI、待回覆提醒、每日摘要
  async alarm() {
    await this.ready;
    try { this.app.tick(); } finally { await this.ctx.storage.setAlarm(Date.now() + TICK_MS); }
  }

  /// 記住公開網址（Webhook 要設定到這裡）
  rememberOrigin(origin) {
    if (!origin || this.app.tunnel.publicURL === origin) return;
    this.app.tunnel.publicURL = origin;
    this.app.updateSettings({ cloudPublicURL: origin });
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    const p = url.pathname;
    const app = this.app;
    this.rememberOrigin(request.headers.get('x-public-origin'));

    if (p.startsWith('/webhook/')) {
      const body = Buffer.from(await request.arrayBuffer());
      const headers = Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v]));
      const r = app.handleWebhook({ method: request.method, path: p, headers, body });
      return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    if (p === '/api/login') return this.login(request);

    if (p === '/api/events') {
      const { readable, writable } = new TransformStream();
      const w = writable.getWriter();
      const enc = new TextEncoder();
      const writer = { write: (s) => w.write(enc.encode(s)) };
      this.streams.add(writer);
      writer.write(`data: ${app.version}\n\n`);
      // 25 秒一次心跳；瀏覽器關掉後寫入失敗就移除
      const ping = setInterval(() => writer.write(': ping\n\n').catch(() => { clearInterval(ping); this.streams.delete(writer); }), 25000);
      request.signal && request.signal.addEventListener('abort', () => { clearInterval(ping); this.streams.delete(writer); w.close().catch(() => {}); });
      return new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
    }

    if (UNSUPPORTED.has(p)) return json({ error: '雲端版不需要這項設定' }, 400);
    if (p === '/api/mil/parse') return json({ error: '雲端版暫時不支援 PDF 匯入，請用「從測試排程表 Excel 匯入」或「手動新增」' }, 400);

    let body = {};
    if (request.method === 'POST') {
      try { body = JSON.parse((await request.text()) || '{}'); } catch { return json({ error: '格式錯誤' }, 400); }
    }
    const result = await handleAPI(app, request.method, p, url.searchParams, body, { local: true, admin: { sessions: new Map() } });
    if (p === '/api/state' && result.status === 200) {
      result.body.cloud = true;
      result.body.productName = `${result.body.productName} 雲端版`;
      result.body.platform = 'cloud';
      result.body.dataDir = 'Cloudflare Durable Object（帳號 Line-bot-Media）';
      result.body.aiUsage = ai.usage;
    }
    return json(result.body, result.status);
  }

  /// 登入：失敗 5 次鎖 1 分鐘（計數放在 Durable Object，全世界只有一份）
  async login(request) {
    if (Date.now() < this.failures.until) return json({ error: '嘗試太多次，請 1 分鐘後再試' }, 429);
    let body = {};
    try { body = await request.json(); } catch { /* 空的 */ }
    const r = await checkLogin(this.env, body.password);
    if (r.error) return json({ error: r.error }, 500);
    if (!r.ok) {
      this.failures.n += 1;
      if (this.failures.n >= 5) { this.failures = { n: 0, until: Date.now() + 60000 }; }
      this.app.log('warning', `管理登入失敗（${request.headers.get('cf-connecting-ip') || '?'}）`);
      return json({ error: '密碼不正確' }, 401);
    }
    this.failures = { n: 0, until: 0 };
    this.app.log('info', `管理登入：${request.headers.get('cf-connecting-ip') || '?'}`);
    return json({ ok: true }, 200, { 'Set-Cookie': await issueCookie(this.env) });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    const stub = env.MAIN.get(env.MAIN.idFromName('main'));
    const forward = (req) => {
      const h = new Headers(req.headers);
      h.set('x-public-origin', url.origin);
      return stub.fetch(new Request(req, { headers: h }));
    };

    if (p === '/health' || p === '/') {
      if (p === '/health') return new Response('ok maclinebot-mil-cloud', { headers: { 'Content-Type': 'text/plain' } });
    }
    if (p.startsWith('/webhook/')) return forward(request);
    if (p === '/api/login' && request.method === 'POST') return forward(request);
    if (p === '/api/logout') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
    if (p.startsWith('/api/')) {
      if (!(await sessionOK(env, request))) return json({ error: '請先登入', login: true }, 401);
      // 修改資料的請求要帶自訂標頭，擋掉其他網站的跨站請求
      if (request.method !== 'GET') {
        if (request.headers.get('x-mlb') !== '1') return json({ error: 'forbidden' }, 403);
        const origin = request.headers.get('origin');
        if (origin && new URL(origin).host !== url.host) return json({ error: 'forbidden' }, 403);
      }
      return forward(request);
    }
    return env.ASSETS.fetch(request);
  },
};
