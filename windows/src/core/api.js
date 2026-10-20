'use strict';
// 管理介面的 JSON API。所有修改都走這裡，App 視窗與區網瀏覽器看到的是同一份資料。
// 金鑰（Channel secret / token）不會傳回瀏覽器，只能覆寫。

const models = require('./models');
const retriever = require('./retriever');
const tunnel = require('./tunnel');
const { STATE_LABEL } = tunnel;
const { parseFAQCSV } = require('./csv');
const { LineAPI, LineMessage } = require('./line');
const { iso, dayKey, uuid } = require('./util');

const { edition, isMIL, hasCredentials, SOURCE_LABEL, RESERVATION_STATUS } = models;
const mil = () => require('./mil/index');

const ok = (body = { ok: true }) => ({ status: 200, body });
const fail = (error, status = 400) => ({ status, body: { error } });

function publicAccount(app, a) {
  const d = app.data[a.id] || models.defaultAccountData();
  return {
    id: a.id, slug: a.slug, displayName: a.displayName, basicId: a.basicId, pictureURL: a.pictureURL,
    ownerUserIds: a.ownerUserIds, bindCode: a.bindCode, isEnabled: a.isEnabled, hasCredentials: hasCredentials(a),
    webhookURL: app.webhookURL(a), webhookStatus: app.webhookStatus[a.id] || null,
    counts: {
      faqs: d.faqs.length, docs: d.docs.length, conversations: Object.keys(d.conversations).length,
      today: (d.stats[dayKey()] || {}).received || 0,
      waiting: Object.values(d.conversations).filter((c) => c.mode === 'human').length,
      pendingReservations: d.reservations.filter((r) => r.status === 'pending').length,
      pending: d.pending.length,
    },
  };
}

function state(app, ctx) {
  const s = app.settings;
  const servers = require('./servers');
  return {
    edition: edition.edition, productName: edition.productName, platform: process.platform, local: ctx.local,
    settings: s,
    hasTunnelToken: !!app.namedTunnelToken,
    hasAdminPassword: !!app.adminPasswordHash(),
    lanAddresses: servers.lanAddresses(),
    health: app.health(),
    serverRunning: app.serverRunning, serverError: app.serverError,
    adminRunning: app.adminRunning, adminError: app.adminError, adminHost: app.adminHost,
    tunnel: {
      state: app.tunnel.state, label: STATE_LABEL[app.tunnel.state], error: app.tunnel.error,
      publicURL: app.tunnel.publicURL, pid: app.tunnel.pid, binary: tunnel.locate(s.cloudflaredPath),
    },
    installing: !!app.installingCloudflared,
    ollama: { state: app.ollamaState, label: app.ollamaLabel(), missing: app.missingModels, pulling: app.pulling, ready: app.usingOllama },
    vectorCount: app.vectorCount,
    accounts: app.accounts.map((a) => publicAccount(app, a)),
    selectedAccountId: (app.selectedAccount || {}).id || null,
    lastEventAt: app.lastEventAt,
    logs: app.logs.slice(0, 150),
    loginItem: app.hooks.getLoginItem ? app.hooks.getLoginItem() : null,
    dataDir: require('./store').baseDir(),
    sourceLabels: SOURCE_LABEL,
    reservationLabels: RESERVATION_STATUS,
    tones: Object.fromEntries(Object.entries(models.TONES).map(([k, v]) => [k, v.label])),
    version: app.version,
  };
}

function lastDays(d, n = 14) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    const k = dayKey(day);
    out.push(d.stats[k] || models.emptyStats(k));
  }
  return out;
}

function conversationSummary(c) {
  const last = c.messages[c.messages.length - 1] || null;
  return {
    id: c.id, displayName: c.displayName, pictureURL: c.pictureURL, mode: c.mode, unread: c.unread, handoffCode: c.handoffCode,
    reserving: !!c.reservationDraft, lastMessage: last,
  };
}

function accountData(app, id) {
  const d = app.data[id];
  if (!d) return null;
  const out = {
    store: d.store, rules: d.rules, faqs: d.faqs, docs: d.docs, pending: d.pending, reservations: d.reservations,
    days: lastDays(d), today: d.stats[dayKey()] || models.emptyStats(dayKey()),
    recent: Object.values(d.conversations).filter((c) => c.messages.length)
      .sort((a, b) => (b.messages[b.messages.length - 1].date || '').localeCompare(a.messages[a.messages.length - 1].date || ''))
      .slice(0, 6).map(conversationSummary),
  };
  if (isMIL) {
    out.mil = { catalog: app.milCatalog(id), needsRegenerate: app.milNeedsRegenerate(id), tests: mil().catalog.allTests(app.milCatalog(id)), customTests: Array.isArray(app.milCatalog(id).tests) };
  }
  return out;
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
const SETTINGS_KEYS = ['aiAutoReply', 'tunnelMode', 'namedHostname', 'cloudflaredPath', 'autoStart', 'useOllama', 'ollamaURL', 'chatModel', 'embedModel', 'agentMode', 'onboardingCompleted'];

async function handleAPI(app, method, path, q, body, ctx) {
  const acct = () => body.account || q.get('account') || (app.selectedAccount || {}).id;
  const data = () => app.data[acct()];

  if (method === 'GET') {
    switch (path) {
      case '/api/state': return ok(state(app, ctx));
      case '/api/data': {
        const d = accountData(app, acct());
        return d ? ok(d) : fail('找不到帳號', 404);
      }
      case '/api/conversations': {
        const d = data();
        if (!d) return ok([]);
        const text = (q.get('q') || '').toLowerCase();
        const waiting = q.get('filter') === 'human';
        const list = Object.values(d.conversations)
          .filter((c) => !waiting || c.mode === 'human')
          .filter((c) => !text || c.displayName.toLowerCase().includes(text) || c.messages.some((m) => m.text.toLowerCase().includes(text)))
          .sort((a, b) => ((b.messages[b.messages.length - 1] || {}).date || '').localeCompare((a.messages[a.messages.length - 1] || {}).date || ''));
        return ok(list.map(conversationSummary));
      }
      case '/api/conversation': {
        const c = data() && data().conversations[q.get('uid')];
        return c ? ok(c) : fail('找不到對話', 404);
      }
      case '/api/quota': {
        const a = app.account(acct());
        if (!a || !hasCredentials(a)) return fail('尚未設定 LINE 帳號');
        const api = new LineAPI(a.channelAccessToken);
        try { return ok({ quota: await api.quota(), consumption: await api.consumption() }); } catch (e) { return fail(e.message); }
      }
      case '/api/richmenu': {
        const a = app.account(acct());
        if (!a || !hasCredentials(a)) return fail('尚未設定 LINE 帳號');
        try { return ok(await require('./richmenu').status(new LineAPI(a.channelAccessToken))); } catch (e) { return fail(e.message); }
      }
      default: return fail('Not Found', 404);
    }
  }

  const id = acct();
  switch (path) {
    // MARK: 設定
    case '/api/settings': {
      const patch = pick(body, SETTINGS_KEYS);
      app.updateSettings(patch);
      return ok();
    }
    case '/api/settings/tunnel-token': app.setTunnelToken(body.token || ''); return ok();
    case '/api/settings/ports': {
      const port = parseInt(body.port, 10), adminPort = parseInt(body.adminPort, 10);
      if (!(port > 1024 && port < 65536) || !(adminPort > 1024 && adminPort < 65536) || port === adminPort) return fail('連接埠要在 1025～65535 之間，而且兩個不能相同');
      const adminChanged = adminPort !== app.settings.adminPort;
      app.updateSettings({ port, adminPort });
      await app.restartWebhookServer();
      if (app.tunnel.state !== 'stopped') app.startTunnel();
      if (adminChanged) setTimeout(() => app.restartAdminServer(), 300);
      return ok({ adminChanged });
    }
    case '/api/settings/lan': {
      if (!ctx.local) return fail('只能在主機上修改區網設定', 403);
      if (body.password) {
        if ([...body.password].length < 6) return fail('密碼至少 6 個字');
        app.setAdminPassword(body.password);
      }
      if ('lanAccess' in body) {
        if (body.lanAccess && !app.adminPasswordHash()) return fail('請先設定密碼');
        app.updateSettings({ lanAccess: !!body.lanAccess });
      }
      setTimeout(() => app.restartAdminServer(), 300);
      return ok();
    }
    case '/api/settings/login-item': {
      if (!app.hooks.setLoginItem) return fail('這個環境不支援');
      app.hooks.setLoginItem(!!body.enabled);
      app.changed();
      return ok();
    }
    case '/api/system/open': {
      if (!ctx.local || !app.hooks.openPath) return fail('只能在主機上開啟');
      app.hooks.openPath(body.what === 'log' ? require('./store').logFile() : require('./store').baseDir());
      return ok();
    }
    case '/api/select-account': if (app.account(body.id)) app.updateSettings({ selectedAccountId: body.id }); return ok();

    // MARK: 帳號
    case '/api/accounts/add': {
      const secret = (body.secret || '').trim(), token = (body.token || '').trim();
      if (!secret || !token) return fail('請填入 Channel secret 與 Channel access token');
      let info;
      try { info = await new LineAPI(token).botInfo(); } catch (e) { return fail(`驗證失敗：${e.message}`); }
      const a = app.addAccount(info.displayName, secret, token);
      await app.refreshBotInfo(a.id).catch(() => {});
      if (app.tunnel.publicURL) app.syncWebhook(a.id);
      app.accountConnected(a.id).catch(() => {});
      return ok({ id: a.id });
    }
    case '/api/accounts/credentials': {
      const a = app.account(body.id);
      if (!a) return fail('找不到帳號', 404);
      const secret = (body.secret || '').trim(), token = (body.token || '').trim();
      const old = { s: a.channelSecret, t: a.channelAccessToken };
      app.updateAccount(a.id, (x) => { if (secret) x.channelSecret = secret; if (token) x.channelAccessToken = token; });
      try {
        await app.refreshBotInfo(a.id);
      } catch (e) {
        app.updateAccount(a.id, (x) => { x.channelSecret = old.s; x.channelAccessToken = old.t; });
        return fail(`驗證失敗：${e.message}`);
      }
      if (app.tunnel.publicURL) await app.syncWebhook(a.id);
      app.accountConnected(a.id).catch(() => {});
      return ok();
    }
    case '/api/accounts/update': {
      app.updateAccount(body.id, (a) => {
        if ('isEnabled' in body) a.isEnabled = !!body.isEnabled;
        if (body.displayName) a.displayName = body.displayName;
      });
      return ok();
    }
    case '/api/accounts/delete': app.deleteAccount(body.id); return ok();
    case '/api/accounts/bindcode': app.updateAccount(body.id, (a) => { a.bindCode = models.makeBindCode(); }); return ok();
    case '/api/accounts/unbind': app.updateAccount(body.id, (a) => { a.ownerUserIds = a.ownerUserIds.filter((u) => u !== body.uid); }); return ok();
    case '/api/accounts/test-push':
      await app.notifyOwners(body.id, [LineMessage.text(`👋 這是 ${edition.productName} 的測試通知，收到代表綁定成功！`)]);
      return ok();

    case '/api/richmenu/apply': {
      const a = app.account(body.id || id);
      if (!a || !hasCredentials(a)) return fail('尚未設定 LINE 帳號');
      try {
        const r = await require('./richmenu').apply(new LineAPI(a.channelAccessToken), app.knownUserIds(a.id));
        app.accountLog(a.id, `已套用圖文選單${r.deleted.length ? `，取代舊選單：${r.deleted.join('、')}` : ''}`);
        return ok(r);
      } catch (e) {
        app.accountLog(a.id, 'error', `套用圖文選單失敗：${e.message}`);
        return fail(`套用失敗：${e.message}`);
      }
    }

    // MARK: Tunnel / Webhook
    case '/api/tunnel/start': app.startTunnel(); return ok();
    case '/api/tunnel/stop': app.stopAll(); return ok();
    case '/api/tunnel/install': {
      if (app.installingCloudflared) return ok();
      app.installingCloudflared = true;
      app.changed();
      try {
        const p = await tunnel.install();
        app.log('info', `cloudflared 已安裝：${p}`);
        app.startTunnel();
        return ok();
      } catch (e) {
        app.log('error', `安裝 cloudflared 失敗：${e.message}`);
        return fail(`安裝 cloudflared 失敗：${e.message}`);
      } finally {
        app.installingCloudflared = false;
        app.changed();
      }
    }
    case '/api/webhook/sync': return ok({ synced: await app.syncWebhook(body.id || id) });
    case '/api/webhook/check': await app.checkWebhook(body.id || id); return ok();

    // MARK: Ollama
    case '/api/ollama/refresh': await app.refreshOllama(); return ok();
    case '/api/ollama/pull': {
      const list = (body.models && body.models.length ? body.models : app.missingModels).filter(Boolean);
      app.pullModels(list).catch(() => {});
      return ok();
    }
    case '/api/vectors/rebuild': await app.buildVectorIndex(true); return ok({ count: app.vectorCount });
    case '/api/ai/try': {
      if (!app.aiReady) return fail('本機模型還沒準備好');
      try { return ok({ text: await app.client().chat(body.prompt || '用一句話介紹你自己') }); } catch (e) { return fail(e.message); }
    }

    // MARK: 店家資訊 / 規則
    case '/api/store': app.update(id, (d) => { d.store = { ...d.store, ...pick(body.store || {}, Object.keys(models.defaultStore())) }; }); return ok();
    case '/api/rules': app.update(id, (d) => { d.rules = { ...d.rules, ...pick(body.rules || {}, Object.keys(models.defaultRules())) }; }); return ok();

    // MARK: 知識庫
    case '/api/faq/save': {
      const f = body.faq || {};
      if (!f.question || !f.answer) return fail('問題和答案都要填');
      app.update(id, (d) => {
        const item = { ...models.makeFAQ(f.question, f.answer, f.keywords || []), ...(f.id ? { id: f.id } : {}), isEnabled: f.isEnabled !== false, updatedAt: iso() };
        const i = d.faqs.findIndex((x) => x.id === item.id);
        // 改了自動產生的題目 → 標成「手動修改」，重新產生時保留你的版本（卡片不再適用，拿掉）
        if (i >= 0 && isMIL && (d.faqs[i].keywords || []).includes('#MIL自動產生') && (d.faqs[i].answer !== item.answer || d.faqs[i].question !== item.question)) {
          item.keywords = item.keywords.filter((k) => k !== '#MIL自動產生' && k !== '#手動修改').concat('#手動修改');
          delete item.flex;
        } else if (i >= 0) {
          if (d.faqs[i].flex) item.flex = d.faqs[i].flex;
          if (d.faqs[i].quickReplies) item.quickReplies = d.faqs[i].quickReplies;
        }
        if (i >= 0) d.faqs[i] = { ...item, hitCount: d.faqs[i].hitCount }; else d.faqs.unshift(item);
        // 從待補清單補成 FAQ 的，順手移除
        d.pending = d.pending.filter((p) => retriever.core(p.question) !== retriever.core(item.question));
      });
      return ok();
    }
    case '/api/faq/delete': app.update(id, (d) => { d.faqs = d.faqs.filter((f) => f.id !== body.id); }); return ok();
    case '/api/doc/save': {
      const doc = body.doc || {};
      if (!doc.content) return fail('內容不能是空的');
      app.update(id, (d) => {
        const item = { ...models.makeDoc(doc.title || '', doc.content), ...(doc.id ? { id: doc.id } : {}) };
        const i = d.docs.findIndex((x) => x.id === item.id);
        if (i >= 0) d.docs[i] = item; else d.docs.unshift(item);
      });
      return ok();
    }
    case '/api/doc/delete': app.update(id, (d) => { d.docs = d.docs.filter((x) => x.id !== body.id); }); return ok();
    case '/api/import': {
      // files: [{ name, text }]：CSV 匯入成常見問題；其他文字檔當作文件
      let faqCount = 0, docCount = 0;
      for (const f of body.files || []) {
        if (/\.csv$/i.test(f.name)) {
          const faqs = parseFAQCSV(f.text);
          app.update(id, (d) => {
            for (const x of faqs) {
              const old = d.faqs.find((y) => y.question === x.question);
              if (old) { old.answer = x.answer; old.keywords = x.keywords; old.updatedAt = iso(); } else d.faqs.push(x);
            }
          });
          faqCount += faqs.length;
          app.log('info', `匯入 ${faqs.length} 筆 FAQ`);
        } else {
          const title = f.name.replace(/\.[^.]+$/, '');
          app.update(id, (d) => { d.docs.unshift(models.makeDoc(title, f.text)); });
          docCount++;
          app.log('info', `匯入文件：${title}`);
        }
      }
      if (app.usingOllama) app.buildVectorIndex().catch(() => {});
      return ok({ faqs: faqCount, docs: docCount });
    }
    case '/api/pending/delete': app.update(id, (d) => { d.pending = d.pending.filter((p) => p.id !== body.id); }); return ok();
    case '/api/preview': return ok(await app.preview(body.text || '', id));

    // MARK: 對話
    case '/api/conversation/send': return (await app.sendOwnerMessage(id, body.uid, body.text)) ? ok() : fail('傳送失敗，請看系統日誌');
    case '/api/conversation/resume': app.resumeAI(id, body.uid, '店家在 App 交還'); return ok();
    case '/api/conversation/takeover': app.takeOver(id, body.uid); return ok();
    case '/api/conversation/read': app.update(id, (d) => { const c = d.conversations[body.uid]; if (c) c.unread = 0; }); return ok();

    // MARK: 預約
    case '/api/reservation/decide': return ok({ message: await app.decideReservation(id, body.rid, !!body.accept) });
    case '/api/reservation/cancel': app.update(id, (d) => { const r = d.reservations.find((x) => x.id === body.rid); if (r) r.status = 'cancelled'; }); return ok();
    case '/api/reservation/delete': app.update(id, (d) => { d.reservations = d.reservations.filter((x) => x.id !== body.rid); }); return ok();

    // MARK: 軍規機種
    case '/api/mil/model/save': {
      if (!isMIL) return fail('這個版本沒有軍規機種');
      const m = body.model || {};
      if (!m.code) return fail('請填型號');
      app.updateMILCatalog(id, (c) => {
        const item = { ...mil().catalog.newModel(), ...m, id: m.id || uuid() };
        const i = c.models.findIndex((x) => x.id === item.id);
        if (i >= 0) c.models[i] = item; else c.models.push(item);
        if (item.family && !c.families.some((f) => f.name === item.family)) c.families.push(mil().catalog.newFamily(item.family, [item.family]));
      });
      return ok();
    }
    case '/api/mil/model/delete': app.updateMILCatalog(id, (c) => { c.models = c.models.filter((m) => m.id !== body.mid); }); return ok();
    case '/api/mil/family/save': {
      const f = body.family || {};
      app.updateMILCatalog(id, (c) => {
        const i = c.families.findIndex((x) => x.id === f.id);
        const old = i >= 0 ? c.families[i].name : null;
        const item = { ...mil().catalog.newFamily(f.name || '', f.aliases || []), id: f.id || uuid() };
        if (i >= 0) c.families[i] = item; else c.families.push(item);
        // 系列改名：成員跟著改
        if (old && old !== item.name) for (const m of c.models) if (m.family === old) m.family = item.name;
      });
      return ok();
    }
    case '/api/mil/family/delete': app.updateMILCatalog(id, (c) => {
      const f = c.families.find((x) => x.id === body.fid);
      c.families = c.families.filter((x) => x.id !== body.fid);
      if (f) for (const m of c.models) if (m.family === f.name) m.family = '';
    }); return ok();
    case '/api/mil/test/save': {
      const C = mil().catalog;
      const t = C.normalizeTest(body.test || {});
      if (!t.short || !t.code) return fail('請填測試名稱與 Method 編號');
      if (!t.procedures.length) return fail('至少要有一個測試程序');
      if (new Set(t.procedures.map((p) => p.id)).size !== t.procedures.length) return fail('程序代號不能重複');
      app.updateMILCatalog(id, (c) => {
        // 第一次修改時，把內建的 13 項複製一份到這份資料裡
        if (!Array.isArray(c.tests)) c.tests = JSON.parse(JSON.stringify(C.TESTS));
        const i = c.tests.findIndex((x) => x.id === t.id);
        if (i >= 0) c.tests[i] = t; else c.tests.push(t);
        C.pruneModels(c);
      });
      return ok();
    }
    case '/api/mil/test/delete': {
      const C = mil().catalog;
      app.updateMILCatalog(id, (c) => {
        if (!Array.isArray(c.tests)) c.tests = JSON.parse(JSON.stringify(C.TESTS));
        c.tests = c.tests.filter((x) => x.id !== body.tid);
        C.pruneModels(c);
      });
      return ok();
    }
    case '/api/mil/test/move': {
      const C = mil().catalog;
      app.updateMILCatalog(id, (c) => {
        if (!Array.isArray(c.tests)) c.tests = JSON.parse(JSON.stringify(C.TESTS));
        const i = c.tests.findIndex((x) => x.id === body.tid), j = i + (body.dir < 0 ? -1 : 1);
        if (i >= 0 && j >= 0 && j < c.tests.length) [c.tests[i], c.tests[j]] = [c.tests[j], c.tests[i]];
      });
      return ok();
    }
    case '/api/mil/tests/reset': {
      const C = mil().catalog;
      app.updateMILCatalog(id, (c) => { delete c.tests; C.pruneModels(c); });
      return ok();
    }
    case '/api/mil/generate': return ok(await app.generateMILKnowledge(id));
    case '/api/mil/parse': {
      try {
        const parser = mil().parser;
        const tests = mil().catalog.allTests(app.milCatalog(id));
        const r = body.url ? await parser.load(body.url, tests) : await parser.parsePDF(Buffer.from(body.base64 || '', 'base64'), tests);
        delete r.text;
        return ok(r);
      } catch (e) {
        return fail(e.message || '讀取報告失敗');
      }
    }
    default: return fail('Not Found', 404);
  }
}

module.exports = { handleAPI, state, accountData };
