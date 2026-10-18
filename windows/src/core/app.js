'use strict';
// App 狀態（對照 Mac 版 AppState.swift）：帳號、資料、日誌、Tunnel、Ollama、排程

const { EventEmitter } = require('events');
const store = require('./store');
const models = require('./models');
const { uuid, iso, sleep, withTimeout, suffix } = require('./util');
const { OllamaClient } = require('./ollama');
const vectors = require('./vectors');
const retriever = require('./retriever');
const { AgentEngine } = require('./agent');
const { LineAPI, LineMessage } = require('./line');
const { TunnelManager } = require('./tunnel');

const { edition, isMIL, hasCredentials } = models;

/// 只在 MIL 版載入軍規模組
const mil = () => (isMIL ? { catalog: require('./mil/catalog'), index: require('./mil/index') } : null);

const OLLAMA_LABEL = { checking: '檢查中', disabled: '已關閉', ready: '已連線', notRunning: '沒有在執行' };

class App extends EventEmitter {
  constructor() {
    super();
    this.settings = models.normalizeSettings(store.loadSettings());
    this.namedTunnelToken = store.secrets.get('tunnel-token') || '';
    this.accounts = store.loadAccounts();
    this.data = {};
    this.milCatalogs = {};
    for (const a of this.accounts) {
      this.data[a.id] = models.normalizeAccountData(store.loadData(a.id));
      if (isMIL) this.milCatalogs[a.id] = mil().catalog.normalizeCatalog(store.loadMILCatalog(a.id) || mil().catalog.seedCatalog());
    }
    if (!this.settings.selectedAccountId || !this.accounts.some((a) => a.id === this.settings.selectedAccountId)) {
      this.settings.selectedAccountId = this.accounts.length ? this.accounts[0].id : null;
    }
    this.logs = [];
    this.webhookStatus = {};
    this.lastEventAt = null;
    this.serverRunning = false;
    this.serverError = null;
    this.adminRunning = false;
    this.ollamaState = 'checking';
    this.missingModels = [];
    this.pulling = null; // { model, ratio, status }
    this.vectorCount = 0;
    this.tunnel = new TunnelManager();
    this.saveTimers = {};
    this.tickCount = 0;
    this.healthFailures = 0;
    this.disconnectNotified = false;
    this.started = false;
    this.version = 0;
    this.hooks = {}; // Electron 提供：openPath、getLoginItem、setLoginItem
  }

  /// 通知畫面重新整理（合併 150ms 內的變更）
  changed() {
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.version++;
      this.emit('change', this.version);
    }, 150);
  }

  // MARK: 設定

  updateSettings(patch) {
    const o = this.settings;
    this.settings = { ...o, ...patch };
    store.saveSettings(this.settings);
    const keys = ['useOllama', 'ollamaURL', 'chatModel', 'embedModel', 'agentMode'];
    if (keys.some((k) => k in patch && patch[k] !== o[k])) {
      this.ollamaState = 'checking';
      this.refreshOllama().catch(() => {});
    }
    this.changed();
  }

  setTunnelToken(token) {
    this.namedTunnelToken = token || '';
    store.secrets.set('tunnel-token', this.namedTunnelToken);
    this.changed();
  }

  // MARK: 帳號

  get selectedAccount() {
    return this.accounts.find((a) => a.id === this.settings.selectedAccountId) || this.accounts[0] || null;
  }

  account(id) { return this.accounts.find((a) => a.id === id) || null; }

  updateAccount(id, body) {
    const a = this.account(id);
    if (!a) return;
    body(a);
    store.saveAccounts(this.accounts);
    this.changed();
  }

  /// 修改某個帳號的資料並延遲存檔
  update(id, body) {
    if (!this.data[id]) this.data[id] = models.defaultAccountData();
    body(this.data[id]);
    this.scheduleSave(id);
    this.changed();
  }

  scheduleSave(id) {
    clearTimeout(this.saveTimers[id]);
    this.saveTimers[id] = setTimeout(() => {
      delete this.saveTimers[id];
      if (this.data[id]) store.saveData(this.data[id], id);
    }, 600);
  }

  flushSaves() {
    for (const [id, d] of Object.entries(this.data)) { clearTimeout(this.saveTimers[id]); store.saveData(d, id); }
    store.saveAccounts(this.accounts);
    store.saveSettings(this.settings);
  }

  addAccount(name, secret, token) {
    let slug = this.accounts.length ? `shop${this.accounts.length + 1}` : 'default';
    while (this.accounts.some((a) => a.slug === slug)) slug += 'x';
    const a = models.newAccount(slug, name || '我的官方帳號');
    a.channelSecret = secret;
    a.channelAccessToken = token;
    this.accounts.push(a);
    const d = models.sampleAccountData();
    d.store.name = a.displayName;
    this.data[a.id] = d;
    if (isMIL) {
      this.milCatalogs[a.id] = mil().catalog.seedCatalog();
      store.saveMILCatalog(this.milCatalogs[a.id], a.id);
    }
    store.saveAccounts(this.accounts);
    store.saveData(d, a.id);
    this.updateSettings({ selectedAccountId: a.id });
    this.log('info', `新增帳號：${a.displayName}`);
    return a;
  }

  deleteAccount(id) {
    this.accounts = this.accounts.filter((a) => a.id !== id);
    delete this.data[id];
    delete this.webhookStatus[id];
    delete this.milCatalogs[id];
    store.deleteAccountFiles(id);
    store.saveAccounts(this.accounts);
    if (this.settings.selectedAccountId === id) this.updateSettings({ selectedAccountId: this.accounts.length ? this.accounts[0].id : null });
    this.changed();
  }

  /// 用 token 讀取官方帳號名稱、basic ID、頭像
  async refreshBotInfo(id) {
    const a = this.account(id);
    if (!a) return;
    const info = await new LineAPI(a.channelAccessToken).botInfo();
    this.updateAccount(id, (x) => {
      x.botUserId = info.userId;
      x.basicId = info.basicId;
      if (info.displayName) x.displayName = info.displayName;
      x.pictureURL = info.pictureUrl;
    });
  }

  // MARK: 日誌

  log(level, message) {
    const entry = { id: uuid(), date: iso(), level, message };
    this.logs.unshift(entry);
    if (this.logs.length > 800) this.logs.length = 800;
    store.appendLog(`${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')} [${level.toUpperCase()}] ${message}`);
    this.changed();
  }

  accountLog(id, level, message) {
    if (message === undefined) { message = level; level = 'info'; }
    const name = (this.account(id) || {}).displayName || '?';
    this.log(level, `[${name}] ${message}`);
  }

  // MARK: Ollama

  client() {
    const s = this.settings;
    return new OllamaClient({ baseURL: s.ollamaURL, chatModel: s.chatModel, embedModel: s.embedModel });
  }

  get usingOllama() { return this.settings.useOllama && this.ollamaState === 'ready'; }
  get agentOn() { return this.usingOllama && this.settings.agentMode; }
  /// Windows 版沒有 Apple 模型：Ollama 可用才算 AI 可用
  get aiReady() { return this.usingOllama; }

  ollamaLabel() {
    if (this.ollamaState === 'missing') return '缺少模型：' + this.missingModels.join('、');
    return OLLAMA_LABEL[this.ollamaState] || this.ollamaState;
  }

  async refreshOllama(warmUp = true) {
    const s = this.settings;
    if (!s.useOllama) { this.ollamaState = 'disabled'; this.changed(); return; }
    const client = this.client();
    const wasReady = this.ollamaState === 'ready';
    try {
      const installed = await client.installedModels();
      this.missingModels = [s.chatModel, s.embedModel].filter((m) => !OllamaClient.has(m, installed));
      this.ollamaState = this.missingModels.length ? 'missing' : 'ready';
    } catch {
      this.ollamaState = 'notRunning';
    }
    this.changed();
    if (this.ollamaState === 'ready' && !wasReady) {
      this.log('info', `Ollama 已連線：${s.chatModel} + ${s.embedModel}`);
      if (warmUp) {
        await client.warmUp();
        await this.buildVectorIndex();
      }
    } else if (wasReady && this.ollamaState !== 'ready') {
      this.log('warning', `Ollama 無法使用（${this.ollamaLabel()}），AI 暫停，只用 FAQ 回答`);
    }
  }

  /// 下載缺少的模型（設定精靈與系統頁的「下載模型」按鈕）
  async pullModels(list) {
    if (this.pulling) return;
    const client = this.client();
    try {
      for (const model of list) {
        this.pulling = { model, ratio: 0, status: '準備下載' };
        this.changed();
        let lastLog = 0;
        await client.pull(model, (ratio, status) => {
          this.pulling = { model, ratio: ratio == null ? this.pulling.ratio : ratio, status };
          if (Date.now() - lastLog > 500) { lastLog = Date.now(); this.changed(); }
        });
        this.log('info', `模型下載完成：${model}`);
      }
    } catch (e) {
      this.log('error', `模型下載失敗：${e.message}`);
      throw e;
    } finally {
      this.pulling = null;
      this.changed();
      await this.refreshOllama();
    }
  }

  /// 把所有帳號的知識庫段落算好向量（只算新增或修改過的）
  async buildVectorIndex(force = false) {
    if (!this.usingOllama) return;
    const client = this.client();
    const texts = this.accounts.flatMap((a) => retriever.pieces(this.data[a.id] || models.defaultAccountData()));
    const started = Date.now();
    try {
      if (force) this.vectorCount = await vectors.shared.rebuild(texts, client);
      else { await vectors.shared.get(texts, client); this.vectorCount = vectors.shared.count; }
      this.log('info', `向量索引完成：${this.vectorCount} 段（${((Date.now() - started) / 1000).toFixed(1)} 秒）`);
    } catch (e) {
      this.log('warning', `向量索引失敗：${e.message}`);
    }
  }

  /// Agent 模式：Qwen 用工具反覆查詢，查齊後才回覆。不能用時回傳 null，改走一般流程
  async runAgent(question, history, d, accountId) {
    if (!this.agentOn) return null;
    const pieces = retriever.pieces(d);
    if (!pieces.length) return null;
    const client = this.client();
    try {
      return await withTimeout(90, async (signal) => {
        const vecs = await vectors.shared.get(pieces, client);
        const agent = new AgentEngine({ client, pieces, vectors: vecs });
        return agent.run({ question, history, store: d.store, rules: d.rules, signal });
      });
    } catch (e) {
      this.accountLog(accountId, 'warning', `Agent 未完成，改用一般回答：${e.message}`);
      return null;
    }
  }

  /// 問題跟每個知識段落的語意相似度；沒有 Ollama 時回傳 null（改用關鍵詞）
  async semanticScores(question, d) {
    if (!this.usingOllama) return null;
    const pieces = retriever.pieces(d);
    if (!pieces.length) return null;
    const client = this.client();
    try {
      return await withTimeout(20, async (signal) => {
        const vecs = await vectors.shared.get(pieces, client);
        const q = (await client.embed([question], { signal }))[0];
        if (!q) return [];
        const qn = vectors.normalized(q);
        return vecs.map((v) => vectors.cosine(qn, v));
      });
    } catch (e) {
      this.log('warning', `語意檢索失敗，改用關鍵詞：${e.message}`);
      return null;
    }
  }

  // MARK: 啟動

  start() {
    if (this.started) return;
    this.started = true;
    this.log('info', `${edition.productName}（Windows 版）啟動`);
    this.tunnel.on('log', (level, msg) => this.log(level, msg));
    this.tunnel.on('change', () => this.changed());
    this.tunnel.on('url', (url) => this.handlePublicURL(url).catch((e) => this.log('error', e.message)));
    this.tunnel.on('disconnect', (reason) => this.notifyDisconnect(reason));
    this.refreshOllama().catch(() => {});
    if (this.settings.autoStart && this.accounts.some(hasCredentials)) this.startTunnel();
    this.timer = setInterval(() => this.tick(), 30000);
    this.upgradeMIL().then(() => this.ensureRichMenus()).catch(() => {});
  }

  startTunnel() {
    const s = this.settings;
    this.tunnel.start({ port: s.port, mode: s.tunnelMode, token: this.namedTunnelToken, hostname: s.namedHostname, customPath: s.cloudflaredPath });
  }

  stopAll() {
    this.tunnel.stop();
    this.log('warning', '已停止 Tunnel，暫停接收 LINE 訊息');
  }

  shutdown() {
    clearInterval(this.timer);
    this.tunnel.stop();
    this.flushSaves();
  }

  // MARK: 公開網址

  webhookURL(account) {
    return this.tunnel.publicURL ? `${this.tunnel.publicURL}/webhook/${account.slug}` : null;
  }

  async handlePublicURL(url) {
    for (const a of this.accounts) this.update(a.id, (d) => { models.today(d).urlChanges += 1; });
    // Quick Tunnel 剛拿到網址時 DNS 還沒生效，等一下再設定 LINE
    let ready = false;
    for (let i = 0; i < 30; i++) {
      if (await App.probe(url + '/health')) { ready = true; break; }
      await sleep(2000);
    }
    if (this.tunnel.publicURL !== url) return;
    if (ready) this.log('info', `DNS 已生效，Tunnel 運作中：${url.replace('https://', '')}`);
    else this.log('warning', '公開網址暫時連不到，仍嘗試更新 LINE webhook');
    if (this.disconnectNotified) {
      this.disconnectNotified = false;
      for (const a of this.accounts.filter(hasCredentials)) {
        await this.notifyOwners(a.id, [LineMessage.text(`✅ ${edition.productName} 已恢復連線，AI 客服重新上線。`)]);
      }
    }
    for (const a of this.accounts.filter(hasCredentials)) await this.syncWebhook(a.id);
  }

  static async probe(url) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
      return r.status === 200;
    } catch { return false; }
  }

  /// 把 LINE 後台的 webhook 網址改成目前的 Tunnel 網址並測試
  async syncWebhook(id) {
    const a = this.account(id);
    const endpoint = a && this.webhookURL(a);
    if (!a || !hasCredentials(a) || !endpoint) return false;
    const api = new LineAPI(a.channelAccessToken);
    const status = { ...(this.webhookStatus[id] || {}), endpoint };
    try {
      await api.setWebhook(endpoint);
      this.accountLog(id, `已更新 LINE webhook 網址：${endpoint}`);
      const test = await api.testWebhook(endpoint);
      status.synced = test.success;
      status.reachable = test.success;
      status.lastCheck = iso();
      status.message = test.success ? '外部可連線' : `${test.statusCode} ${test.reason}`;
      this.accountLog(id, test.success ? 'info' : 'warning', test.success ? 'webhook 測試通過' : `webhook 測試失敗：${test.reason} ${test.detail}`);
    } catch (e) {
      status.synced = false;
      status.message = e.message;
      this.accountLog(id, 'error', `更新 webhook 失敗：${e.message}`);
    }
    this.webhookStatus[id] = status;
    this.changed();
    return status.synced;
  }

  /// 「檢查」按鈕：從外部打一次 /health，再請 LINE 測試 webhook
  async checkWebhook(id) {
    const a = this.account(id);
    const endpoint = a && this.webhookURL(a);
    if (!endpoint) return;
    const status = { ...(this.webhookStatus[id] || {}), endpoint };
    const external = await App.probe((this.tunnel.publicURL || '') + '/health');
    status.reachable = external;
    status.lastCheck = iso();
    let test = null;
    if (hasCredentials(a)) test = await new LineAPI(a.channelAccessToken).testWebhook(endpoint).catch(() => null);
    if (test) {
      status.synced = test.success;
      status.message = test.success ? '外部可連線' : `${test.statusCode} ${test.reason}`;
    } else {
      status.message = external ? '外部可連線' : '外部無法連線';
    }
    this.webhookStatus[id] = status;
    this.accountLog(id, external ? 'info' : 'warning', external ? 'webhook 檢查通過' : 'webhook 從外部無法連線');
    this.changed();
  }

  // MARK: 整體狀態

  health() {
    if (!this.serverRunning) return { level: 'error', title: '本機服務未啟動', detail: this.serverError || 'HTTP 服務沒有在執行' };
    if (!this.accounts.length) return { level: 'warning', title: '還沒設定帳號', detail: '完成設定精靈就能開始自動回覆' };
    const t = this.tunnel.state;
    if (t === 'stopped') return { level: 'warning', title: '已暫停', detail: 'Tunnel 已停止，LINE 訊息暫時收不到' };
    if (t === 'starting') return { level: 'warning', title: '連線中', detail: '正在建立 Cloudflare Tunnel…' };
    if (t === 'failed') return { level: 'error', title: '連線中斷', detail: this.tunnel.error };
    const a = this.selectedAccount;
    if (a && !(this.webhookStatus[a.id] || {}).synced) return { level: 'warning', title: 'Webhook 尚未同步', detail: '按「重啟 Tunnel」或到 LINE 連線頁面檢查' };
    if (!this.settings.aiAutoReply) return { level: 'warning', title: 'AI 自動回覆已關閉', detail: '訊息會留給你手動回覆' };
    if (!this.aiReady) return { level: 'warning', title: '本機模型不可用', detail: `Ollama：${this.ollamaLabel()}。目前只用 FAQ 回答` };
    return { level: 'ok', title: '一切正常', detail: '正在接收 LINE 訊息並由本機模型自動回覆。' };
  }

  // MARK: 排程

  tick() {
    this.tickCount += 1;
    const now = new Date();
    // 每 2 分鐘確認 Ollama 還在
    if (this.tickCount % 4 === 0) this.refreshOllama().catch(() => {});
    for (const a of this.accounts) {
      this.runConversationTimers(a.id, now);
      this.sendDailySummaryIfNeeded(a.id, now);
    }
    // 每 5 分鐘從外部檢查一次公開網址
    if (this.tickCount % 10 === 0 && this.tunnel.state === 'running' && this.tunnel.publicURL) {
      App.probe(this.tunnel.publicURL + '/health').then((ok) => {
        if (ok) { this.healthFailures = 0; return; }
        this.healthFailures += 1;
        this.log('warning', `外部健康檢查失敗（第 ${this.healthFailures} 次）`);
        if (this.healthFailures >= 2) {
          this.healthFailures = 0;
          this.notifyDisconnect('外部連不到 webhook，正在重新建立 Tunnel');
          this.tunnel.restart();
        }
      });
    }
  }

  notifyDisconnect(reason) {
    if (this.disconnectNotified) return;
    this.disconnectNotified = true;
    for (const a of this.accounts) {
      if (!hasCredentials(a) || !((this.data[a.id] || {}).rules || {}).disconnectNotifyEnabled) continue;
      this.notifyOwners(a.id, [LineMessage.text(`⚠️ ${edition.productName} 斷線通知\n${reason}\n${edition.productName} 會自動重新連線，恢復後會再通知你。`)]);
    }
  }

  async notifyOwners(id, messages) {
    const a = this.account(id);
    if (!a || !hasCredentials(a)) return;
    if (!a.ownerUserIds.length) { this.accountLog(id, 'warning', '尚未綁定店家 LINE，無法推播通知'); return; }
    const api = new LineAPI(a.channelAccessToken);
    for (const owner of a.ownerUserIds) {
      try {
        await api.push(owner, messages);
        this.accountLog(id, `已推播通知給 ...${suffix(owner, 6)}`);
      } catch (e) {
        this.accountLog(id, 'error', `推播失敗：${e.message}`);
      }
    }
  }

  /// 這個帳號認識的所有 LINE 使用者（顧客 + 綁定的店家）
  knownUserIds(id) {
    const a = this.account(id);
    return [...new Set([...Object.keys((this.data[id] || {}).conversations || {}), ...((a && a.ownerUserIds) || [])])];
  }

  /// 啟動時：LINE 上的預設選單不是我們的，就自動套用並取代舊選單
  async ensureRichMenus() {
    const richmenu = require('./richmenu');
    const waits = [30, 120, 300, 600, 1200];
    for (const a of this.accounts.filter((x) => hasCredentials(x) && x.isEnabled)) {
      const api = new LineAPI(a.channelAccessToken);
      // LINE 的選單 API 有頻率限制（429），隔一段時間再試
      for (let attempt = 1; attempt <= waits.length + 1; attempt++) {
        try {
          if (richmenu.isDone(await richmenu.status(api))) break;
          const r = await richmenu.apply(api, this.knownUserIds(a.id));
          this.accountLog(a.id, `已自動套用圖文選單${r.deleted.length ? `，取代舊選單：${r.deleted.join('、')}` : ''}`);
          break;
        } catch (e) {
          if (e.status === 429 && attempt <= waits.length) {
            this.accountLog(a.id, `LINE 選單 API 忙碌中（${e.message}），${waits[attempt - 1]} 秒後重試`);
            await sleep(waits[attempt - 1] * 1000);
            continue;
          }
          this.accountLog(a.id, 'warning', `自動套用圖文選單失敗：${e.message}（可到 LINE 連線頁手動套用）`);
          break;
        }
      }
    }
  }

  // MARK: 軍規機種（MIL 版）

  milCatalog(id) {
    if (!isMIL) return null;
    if (!this.milCatalogs[id]) this.milCatalogs[id] = mil().catalog.seedCatalog();
    return this.milCatalogs[id];
  }

  updateMILCatalog(id, body) {
    const c = this.milCatalog(id);
    if (!c) return;
    body(c);
    store.saveMILCatalog(c, id);
    this.changed();
  }

  /// 請 LINE 檢查所有卡片格式（不會送出）；有問題的卡片在日誌列出，回覆時會自動改用文字
  async validateFlex(id) {
    const a = this.account(id);
    if (!a || !hasCredentials(a)) return;
    const api = new LineAPI(a.channelAccessToken);
    const faqs = (this.data[id].faqs || []).filter((f) => f.flex);
    let bad = 0;
    for (let i = 0; i < faqs.length; i += 5) {
      const batch = faqs.slice(i, i + 5);
      const err = await api.validate(batch.map((f) => LineMessage.flex(f.answer, f.flex, f.quickReplies || [])));
      if (!err) continue;
      for (const f of batch) {
        const e = await api.validate([LineMessage.flex(f.answer, f.flex, f.quickReplies || [])]);
        if (e) { bad++; this.accountLog(id, 'warning', `卡片格式有誤（${f.question}）：${e}`); }
      }
    }
    this.accountLog(id, bad ? 'warning' : 'info', bad ? `LINE 卡片檢查：${bad} 張有問題，會改用文字回覆` : `LINE 卡片檢查通過（${faqs.length} 張）`);
  }

  /// 產生器格式升級時自動重新產生一次（只處理已經產生過的帳號）
  async upgradeMIL() {
    if (!isMIL || (this.settings.milGeneratorVersion || 0) >= mil().index.VERSION) return;
    for (const a of this.accounts) {
      const c = this.milCatalogs[a.id];
      if (c && c.lastGenerated && this.milNeedsRegenerate(a.id)) await this.generateMILKnowledge(a.id);
    }
    this.updateSettings({ milGeneratorVersion: mil().index.VERSION });
  }

  milNeedsRegenerate(id) {
    if (!isMIL || !this.milCatalogs[id]) return false;
    return mil().index.needsRegenerate(this.milCatalogs[id], this.data[id] || models.defaultAccountData());
  }

  /// 由機種資料重新產生 FAQ 與背景知識：只替換自動產生的部分，手動新增的 FAQ 不會動
  async generateMILKnowledge(id) {
    if (!isMIL) return null;
    const c = this.milCatalog(id);
    let result;
    this.update(id, (d) => { result = mil().index.applyGenerated(d, c); });
    this.updateMILCatalog(id, (x) => { x.lastGenerated = iso(); });
    this.accountLog(id, `軍規知識庫已重新產生：${result.faqs} 題 FAQ、背景知識 ${result.paragraphs} 段（${c.models.length} 款機種）`);
    store.saveData(this.data[id], id);
    this.validateFlex(id).catch(() => {});
    await this.buildVectorIndex();
    return result;
  }
}

module.exports = { App };
