'use strict';
// 自動回覆流程（對照 Mac 版 BotEngine.swift）：轉人工 → 預約 → FAQ → Agent / AI → 待補

const { App } = require('./app');
const models = require('./models');
const retriever = require('./retriever');
const ai = require('./ai');
const reservation = require('./reservation');
const { splitItems } = require('./agent');
const { LineAPI, LineMessage, parsePostback } = require('./line');
const { iso, prefix, suffix, withTimeout, TimeoutError, sameDay } = require('./util');

const { edition, isMIL, today } = models;

const reply = (text, source, quickReplies = [], latency = null) => ({ text, source, quickReplies, latency });
const lineMsg = (r) => (r.flex ? LineMessage.flex(r.text, r.flex, r.quickReplies) : LineMessage.text(r.text, r.quickReplies));
const P = App.prototype;

// MARK: - Webhook 入口

/// req = { method, path, headers（小寫）, body: Buffer } → { status, body }
P.handleWebhook = function (req) {
  if (req.method === 'GET' && (req.path === '/' || req.path === '/health')) {
    return { status: 200, body: isMIL ? 'ok maclinebot-mil' : 'ok maclinebot' };
  }
  if (!req.path.startsWith('/webhook/')) return { status: 404, body: 'Not Found' };
  if (req.method !== 'POST') return { status: 405, body: 'Method Not Allowed' };
  const slug = req.path.slice('/webhook/'.length).replace(/^\/+|\/+$/g, '');
  const account = this.accounts.find((a) => a.slug === slug);
  if (!account) {
    this.log('warning', `收到未知 webhook 路徑：${req.path}`);
    return { status: 404, body: 'Not Found' };
  }
  if (!LineAPI.verify(req.headers['x-line-signature'], req.body, account.channelSecret)) {
    this.accountLog(account.id, 'warning', 'webhook 簽章驗證失敗，已拒絕');
    return { status: 401, body: 'Unauthorized' };
  }
  let body;
  try { body = JSON.parse(req.body.toString('utf8')); } catch { return { status: 400, body: 'Bad Request' }; }
  if (!Array.isArray(body.events)) return { status: 400, body: 'Bad Request' };
  this.lastEventAt = iso();
  if (!body.events.length) {
    this.accountLog(account.id, 'webhook 測試通過');
    this.webhookStatus[account.id] = { ...(this.webhookStatus[account.id] || {}), synced: true, reachable: true, lastCheck: iso(), message: '外部可連線' };
    this.changed();
  }
  // 先回 200 給 LINE，再慢慢處理
  for (const event of body.events) {
    setImmediate(() => this.process(event, account.id).catch((e) => this.accountLog(account.id, 'error', `處理訊息失敗：${e.message}`)));
  }
  return { status: 200, body: 'OK' };
};

// MARK: - 事件分派

P.process = async function (event, accountId) {
  const account = this.account(accountId);
  if (!account || !account.isEnabled) return;
  if (event.deliveryContext && event.deliveryContext.isRedelivery) { this.accountLog(accountId, '收到重送事件，略過'); return; }
  const source = event.source || {};
  if (source.type !== 'user' || !source.userId) {
    if (event.type === 'message') this.accountLog(accountId, '略過群組訊息');
    return;
  }
  const userId = source.userId;
  const api = new LineAPI(account.channelAccessToken);
  switch (event.type) {
    case 'message': return this.handleMessage(event, userId, account);
    case 'postback': return this.handlePostback(event, userId, account);
    case 'follow': {
      await this.ensureConversation(accountId, userId, api);
      const rules = this.data[accountId].rules;
      if (event.replyToken && rules.greetingMessage) {
        await api.reply(event.replyToken, [LineMessage.text(rules.greetingMessage)]).catch(() => {});
        this.appendMessage(accountId, userId, models.makeMessage('bot', rules.greetingMessage, 'greeting'));
      }
      this.accountLog(accountId, '新好友加入');
      return;
    }
    case 'unfollow': this.accountLog(accountId, '有好友封鎖了帳號'); return;
    default: return;
  }
};

P.ensureConversation = async function (id, userId, api) {
  if (this.data[id] && this.data[id].conversations[userId]) return;
  this.update(id, (d) => { d.conversations[userId] = models.newConversation(userId); });
  const profile = await api.profile(userId).catch(() => null);
  if (profile) {
    this.update(id, (d) => {
      const c = d.conversations[userId];
      if (c) { c.displayName = profile.displayName; c.pictureURL = profile.pictureUrl; }
    });
  }
};

P.appendMessage = function (id, userId, message) {
  this.update(id, (d) => {
    if (!d.conversations[userId]) d.conversations[userId] = models.newConversation(userId);
    const c = d.conversations[userId];
    c.messages.push(message);
    if (c.messages.length > 500) c.messages.splice(0, c.messages.length - 500);
  });
};

P.conversation = function (id, userId) { return this.data[id] ? this.data[id].conversations[userId] || null : null; };

const lastCustomerAt = (c) => { for (let i = c.messages.length - 1; i >= 0; i--) if (c.messages[i].role === 'customer') return new Date(c.messages[i].date); return null; };

// MARK: - 訊息

const TYPE_LABEL = { sticker: '[貼圖]', image: '[圖片]', video: '[影片]', audio: '[語音]', location: '[位置]', file: '[檔案]' };

P.handleMessage = async function (event, userId, account) {
  const id = account.id;
  const api = new LineAPI(account.channelAccessToken);
  const message = event.message;
  if (!message) return;
  const text = message.type === 'text' ? message.text || '' : TYPE_LABEL[message.type] || `[${message.type}]`;

  // 綁定店家 LINE：傳「綁定 123456」
  if (message.type === 'text') {
    const bind = this.tryBind(text, userId, account);
    if (bind) { if (event.replyToken) await api.reply(event.replyToken, [LineMessage.text(bind)]).catch(() => {}); return; }
  }
  // 店家的指令（#代碼 回覆、交還、摘要…）
  if (message.type === 'text' && account.ownerUserIds.includes(userId)) {
    const r = await this.handleOwnerCommand(text, account);
    if (r) { if (event.replyToken) await api.reply(event.replyToken, [LineMessage.text(r)]).catch(() => {}); return; }
  }

  await this.ensureConversation(id, userId, api);
  const name = (this.conversation(id, userId) || {}).displayName || '顧客';
  this.appendMessage(id, userId, models.makeMessage('customer', text));
  this.update(id, (d) => {
    today(d).received += 1;
    const c = d.conversations[userId];
    if (c) { c.unread += 1; c.reminderSent = false; }
  });
  this.accountLog(id, `收到 ${name}：${prefix(text, 40)}`);

  if (message.type !== 'text') {
    const conv = this.conversation(id, userId);
    if (message.type !== 'sticker' && conv && conv.mode === 'ai' && this.settings.aiAutoReply && event.replyToken) {
      const r = '收到囉！目前我只看得懂文字訊息，可以用文字描述您的問題，或輸入「真人」請專人協助 🙏';
      await api.reply(event.replyToken, [LineMessage.text(r)]).catch(() => {});
      this.appendMessage(id, userId, models.makeMessage('bot', r, 'system'));
    }
    return;
  }

  const started = Date.now();
  const r = await this.decide(text, userId, account, api);
  if (!r) return;
  r.latency = (Date.now() - started) / 1000;
  if (!event.replyToken) return;
  const record = () => {
    this.appendMessage(id, userId, models.makeMessage('bot', r.text, r.source, r.latency, !!r.flex));
    this.update(id, (d) => { today(d).replied += 1; });
  };
  try {
    try {
      await api.reply(event.replyToken, [lineMsg(r)]);
    } catch (e) {
      // 卡片格式被 LINE 拒絕時改送純文字（replyToken 還沒用掉）
      if (!r.flex || e.status !== 400) throw e;
      this.accountLog(id, 'warning', `Flex 卡片被 LINE 拒絕，改用文字：${e.message}`);
      delete r.flex;
      await api.reply(event.replyToken, [lineMsg(r)]);
    }
    record();
    this.accountLog(id, `${name} reply ${r.latency.toFixed(1)}s 來源=${r.source}`);
  } catch (e) {
    // replyToken 過期就改用 push
    try {
      await api.push(userId, [lineMsg(r)]);
      record();
      this.accountLog(id, 'warning', 'reply 失敗，改用 push 送出');
    } catch {
      this.accountLog(id, 'error', `回覆失敗：${e.message}`);
    }
  }
};

/// 決定要怎麼回：轉人工 → 預約 → FAQ → AI → 待補
P.decide = async function (text, userId, account, api) {
  const id = account.id;
  if (!this.settings.aiAutoReply) return null;
  const conv = this.conversation(id, userId);
  if (!conv || conv.mode !== 'ai') return null;
  const d = this.data[id];
  const rules = d.rules;

  let hit = retriever.containsAny(text, rules.handoffKeywords);
  if (hit) return this.startHandoff(id, userId, `命中轉人工關鍵字「${hit}」`, text, 'handoff');
  hit = retriever.containsAny(text, rules.blockedKeywords);
  if (hit) return this.startHandoff(id, userId, `敏感問題「${hit}」`, text, 'blocked');
  if (rules.reservationEnabled) {
    if (conv.reservationDraft) return this.continueReservation(id, userId, text);
    if (retriever.containsAny(text, rules.reservationKeywords)) return this.beginReservation(id, userId, text);
  }
  // 追問（「有通過的型號」「那低溫呢」）要接上一題的主題
  const earlier = conv.messages.slice(0, -1);
  let previous = null;
  for (let i = earlier.length - 1; i >= 0; i--) if (earlier[i].role === 'customer') { previous = earlier[i].text; break; }
  const followUp = retriever.isFollowUp(text) ? previous : null;
  const searchText = followUp ? `${followUp} ${text}` : text;

  // 同時提到兩個以上型號是比較題：只用「A 和 B 比較」那類 FAQ
  const comparing = retriever.modelTokens(text).length >= 2;
  // 一次問好幾項 → FAQ 只能答一項，交給 Agent 逐項查
  const multiItem = !comparing && splitItems(text).length >= 2;
  const toAgent = this.agentOn && (multiItem || retriever.refersToPrevious(text));
  const candidates = toAgent ? [] : comparing ? d.faqs.filter((f) => f.question.includes('比較')) : d.faqs;
  const faq = retriever.matchFAQ(text, candidates)
    || (followUp && !comparing && !toAgent ? retriever.matchFAQ(searchText, d.faqs) : null);
  if (faq) {
    this.update(id, (x) => {
      today(x).faq += 1;
      const f = x.faqs.find((y) => y.id === faq.id);
      if (f) f.hitCount += 1;
    });
    const r = reply(faq.answer, 'faq', faq.quickReplies || []);
    if (faq.flex && rules.useFlex !== false) r.flex = faq.flex;
    return r;
  }

  if (!this.aiReady) return this.unanswered(id, userId, text);
  const agentOn = this.agentOn;
  api.startLoading(userId, agentOn ? 60 : 20);
  const started = Date.now();
  const history = conv.messages.slice(0, -1);

  // Agent 模式：反覆查詢知識庫，查齊後才回覆
  if (agentOn) {
    const q = searchText === text ? text : `${text}（接續上一題：${followUp || ''}）`;
    const result = await this.runAgent(q, history, d, id);
    if (result) {
      const ms = Date.now() - started;
      this.accountLog(id, `Agent 回答：查了 ${result.searches.length} 次、${result.rounds} 輪（${result.searches.slice(0, 4).join('／')}）`);
      if (!result.answerable) return this.unanswered(id, userId, text);
      this.update(id, (x) => { const s = today(x); s.ai += 1; s.aiMilliseconds += ms; });
      return reply(result.reply, 'ai');
    }
  }

  try {
    const client = this.client();
    const semantic = await this.semanticScores(searchText, d);
    const terms = semantic != null || !d.docs.length ? [] : await withTimeout(10, (signal) => ai.searchTerms(searchText, client, signal)).catch(() => []);
    const knowledge = retriever.context(searchText, d, { terms, semantic, budget: 3000, maxPieces: 5 });
    const answer = await withTimeout(60, (signal) => ai.answer({ question: text, knowledge, history, store: d.store, rules, client, signal }));
    const ms = Date.now() - started;
    if (answer.intent === 'humanAgent') return this.startHandoff(id, userId, 'AI 判斷顧客要找專人', text, 'handoff');
    if (answer.intent === 'complaint') return this.startHandoff(id, userId, 'AI 判斷為客訴，交給你處理', text, 'blocked');
    if (answer.intent === 'reservation' && rules.reservationEnabled) return this.beginReservation(id, userId, text);
    // 沒找到任何相關資料，或 AI 判斷答不出來 → 待補清單
    const answerable = answer.answerable && retriever.hasKnowledge(knowledge);
    if (!answerable && (answer.intent === 'question' || answer.intent === 'other')) return this.unanswered(id, userId, text);
    if (!answer.reply) return this.unanswered(id, userId, text);
    this.update(id, (x) => { const s = today(x); s.ai += 1; s.aiMilliseconds += ms; });
    this.accountLog(id, `AI 回答模型：${answer.model}（檢索：${semantic == null ? '關鍵詞' : '向量'}）`);
    return reply(answer.reply, 'ai');
  } catch (e) {
    if (e instanceof TimeoutError) {
      // 逾時不是知識庫缺資料，改交給真人，不要讓顧客一直等
      this.accountLog(id, 'warning', `${e.message}，轉給真人`);
      return this.startHandoff(id, userId, 'AI 回覆逾時', text, 'handoff');
    }
    this.accountLog(id, 'warning', `AI 生成失敗：${e.message}`);
    return this.unanswered(id, userId, text);
  }
};

// MARK: - 答不出來 → 待補清單

P.unanswered = function (id, userId, question) {
  const rules = this.data[id].rules;
  const conv = this.conversation(id, userId) || {};
  const name = conv.displayName || '';
  const key = retriever.core(question);
  let isNew = false;
  this.update(id, (d) => {
    today(d).unanswered += 1;
    const p = d.pending.find((x) => retriever.core(x.question) === key);
    if (p) { p.count += 1; p.lastAskedAt = iso(); }
    else {
      d.pending.unshift({ id: models.makeCode() + Date.now(), question, askedBy: name, count: 1, firstAskedAt: iso(), lastAskedAt: iso() });
      isNew = true;
    }
  });
  this.accountLog(id, `知識庫沒有答案，已加入待補清單：${prefix(question, 30)}`);
  if (rules.notifyUnanswered && isNew) {
    this.notifyOwners(id, [LineMessage.text(`❓ ${name} 問了知識庫沒有的問題：\n「${prefix(question, 200)}」\n\n已加入待補清單。要直接回覆請傳：\n#${conv.handoffCode || ''} 你的回覆`)]);
  }
  return reply(rules.fallbackMessage, 'fallback');
};

// MARK: - 轉人工

P.startHandoff = async function (id, userId, reason, lastText, source) {
  const rules = this.data[id].rules;
  this.update(id, (d) => {
    today(d).handoff += 1;
    const c = d.conversations[userId];
    if (c) { c.mode = 'human'; c.humanSince = iso(); delete c.lastOwnerReplyAt; delete c.reservationDraft; c.reminderSent = false; }
  });
  this.appendMessage(id, userId, models.makeMessage('system', `已轉真人：${reason}`, 'system'));
  const conv = this.conversation(id, userId) || {};
  const name = conv.displayName || '顧客';
  const code = conv.handoffCode || '';
  this.accountLog(id, `handoff：${reason}`);
  await this.notifyOwners(id, [
    LineMessage.text(`🙋 ${name} 需要專人協助\n原因：${reason}\n最新訊息：「${prefix(lastText, 200)}」\n\n直接傳「#${code} 你的回覆」就會轉給顧客，你回覆後 AI 會自動閃開。`),
    LineMessage.buttons(`處理完畢後可以把 ${name} 交還給 AI`, [['交還 AI', `action=resume&uid=${userId}`]], `${name} 需要專人協助`),
  ]);
  return reply(rules.handoffMessage, source);
};

P.resumeAI = function (id, userId, reason) {
  const c = this.conversation(id, userId);
  if (!c || c.mode !== 'human') return;
  this.update(id, (d) => {
    const x = d.conversations[userId];
    x.mode = 'ai'; delete x.humanSince; x.reminderSent = false;
  });
  this.appendMessage(id, userId, models.makeMessage('system', `AI 已接手：${reason}`, 'system'));
  this.accountLog(id, `${c.displayName} 交還 AI（${reason}）`);
};

P.takeOver = function (id, userId) {
  this.update(id, (d) => {
    const c = d.conversations[userId];
    if (c) { c.mode = 'human'; c.humanSince = iso(); c.lastOwnerReplyAt = iso(); }
  });
};

/// 店家從 App 或 LINE 回覆顧客
P.sendOwnerMessage = async function (id, userId, text) {
  const a = this.account(id);
  if (!a || !models.hasCredentials(a)) return false;
  const trimmed = (text || '').trim();
  if (!trimmed) return false;
  try {
    await new LineAPI(a.channelAccessToken).push(userId, [LineMessage.text(trimmed)]);
  } catch (e) {
    this.accountLog(id, 'error', `傳送失敗：${e.message}`);
    return false;
  }
  this.update(id, (d) => {
    const c = d.conversations[userId];
    if (!c) return;
    c.mode = 'human';
    if (!c.humanSince) c.humanSince = iso();
    c.lastOwnerReplyAt = iso();
    c.unread = 0;
    c.reminderSent = false;
  });
  this.appendMessage(id, userId, models.makeMessage('owner', trimmed, 'owner'));
  return true;
};

// MARK: - 綁定 / 店家指令

P.tryBind = function (text, userId, account) {
  const t = text.trim();
  if (!t.startsWith('綁定')) return null;
  const code = t.slice(2).trim();
  if (code !== account.bindCode) return `綁定碼不正確，請到 ${edition.productName} 的「LINE 連線」頁面查看最新綁定碼。`;
  this.updateAccount(account.id, (a) => {
    if (!a.ownerUserIds.includes(userId)) a.ownerUserIds.push(userId);
    a.bindCode = models.makeBindCode();
  });
  this.accountLog(account.id, `店家 LINE 綁定成功 ...${suffix(userId, 6)}`);
  return '✅ 綁定成功！之後轉人工、預約、每日摘要、斷線通知都會推播到這裡。\n\n傳「指令」可以看所有可用指令。';
};

P.handleOwnerCommand = async function (raw, account) {
  const id = account.id;
  const text = raw.trim();
  const d = this.data[id];
  const convs = Object.values(d.conversations);

  // #ABCD 回覆內容
  if (text.startsWith('#') || text.startsWith('＃')) {
    const body = [...text].slice(1).join('');
    const code = [...body].slice(0, 4).join('').toUpperCase();
    const content = [...body].slice(4).join('').trim();
    const conv = convs.find((c) => c.handoffCode === code);
    if (!conv) return `找不到代碼 #${code} 的顧客。`;
    if (!content) return `請在代碼後面加上要回覆的內容，例如：#${code} 您好，我是店長`;
    const ok = await this.sendOwnerMessage(id, conv.id, content);
    return ok ? `已傳送給 ${conv.displayName} ✅\nAI 會先暫停，${d.rules.humanModeMinutes} 分鐘沒有新回覆就自動交還 AI。` : '傳送失敗，請稍後再試。';
  }
  for (const p of ['交還', '恢復']) {
    if (!text.startsWith(p)) continue;
    const code = text.slice(p.length).trim().replace(/#/g, '').toUpperCase();
    const conv = convs.find((c) => c.handoffCode === code);
    if (!conv) return `找不到代碼 ${code} 的顧客。`;
    this.resumeAI(id, conv.id, '店家交還');
    return `已把 ${conv.displayName} 交還給 AI 🤖`;
  }
  switch (text) {
    case '摘要': case '今日摘要': return this.dailySummary(id);
    case '待補': case '待補清單': {
      const list = d.pending.slice(0, 10).map((p, i) => `${i + 1}. ${p.question}（${p.count} 次）`);
      return list.length ? '📝 待補清單（到 App 的知識庫可一鍵補成 FAQ）\n' + list.join('\n') : '目前沒有待補問題 🎉';
    }
    case '預約': case '待確認': {
      const list = d.reservations.filter((r) => r.status === 'pending').slice(0, 10).map((r) => `・${r.customerName} ${r.date} ${r.time} ${r.people} 位`);
      return list.length ? '📅 待確認預約\n' + list.join('\n') : '目前沒有待確認的預約。';
    }
    case '待回覆': {
      const list = convs.filter((c) => c.mode === 'human').map((c) => `・#${c.handoffCode} ${c.displayName}`);
      return list.length ? '🙋 等待真人回覆\n' + list.join('\n') : '目前沒有等待真人回覆的顧客。';
    }
    case '指令': case '說明': case 'help':
      return `🛠 ${edition.productName} 指令\n#代碼 內容 → 回覆顧客\n交還 代碼 → 交還給 AI\n待回覆 → 等待真人的顧客\n預約 → 待確認預約\n待補 → 待補問題\n摘要 → 今日數據`;
    default: return null;
  }
};

// MARK: - Postback（預約接受 / 婉拒、交還 AI）

P.handlePostback = async function (event, userId, account) {
  const id = account.id;
  const api = new LineAPI(account.channelAccessToken);
  const raw = event.postback && event.postback.data;
  if (!raw) return;
  const p = parsePostback(raw);
  let r = null;
  if (p.action === 'rsv') {
    if (!account.ownerUserIds.includes(userId)) r = '只有店家可以處理預約。';
    else if (p.id) r = await this.decideReservation(id, p.id, p.op === 'accept');
  } else if (p.action === 'resume') {
    if (account.ownerUserIds.includes(userId) && p.uid) { this.resumeAI(id, p.uid, '店家交還'); r = '已交還給 AI 🤖'; }
  }
  if (r && event.replyToken) await api.reply(event.replyToken, [LineMessage.text(r)]).catch(() => {});
};

/// 接受或婉拒預約（LINE 按鈕與 App 共用），回傳給店家的文字
P.decideReservation = async function (id, reservationId, accept) {
  const a = this.account(id);
  const r = a && this.data[id].reservations.find((x) => x.id === reservationId);
  if (!r) return '找不到這筆預約。';
  if (r.status !== 'pending') return `這筆預約已經是「${models.RESERVATION_STATUS[r.status]}」了。`;
  const status = accept ? 'accepted' : 'declined';
  this.update(id, (d) => {
    const x = d.reservations.find((y) => y.id === reservationId);
    if (x) { x.status = status; x.decidedAt = iso(); }
  });
  const storeName = this.data[id].store.name || '';
  const text = accept
    ? `✅ 您的預約已確認！\n${models.reservationSummary(r)}\n\n期待您的光臨！${storeName ? `— ${storeName}` : ''}`
    : `很抱歉 🙇 ${r.date} ${r.time} 的時段已經客滿，無法接受這次預約。\n歡迎改約其他時間，直接傳「預約」就可以重新登記喔！`;
  try {
    await new LineAPI(a.channelAccessToken).push(r.userId, [LineMessage.text(text)]);
    this.appendMessage(id, r.userId, models.makeMessage('bot', text, 'reservation'));
  } catch (e) {
    this.accountLog(id, 'error', `通知顧客預約結果失敗：${e.message}`);
  }
  this.accountLog(id, `預約 ${r.customerName} ${r.date} ${r.time} → ${models.RESERVATION_STATUS[status]}`);
  return accept ? `已接受 ${r.customerName} 的預約，顧客已收到確認 ✅` : `已婉拒 ${r.customerName} 的預約，已通知顧客。`;
};

// MARK: - 預約收單

P.beginReservation = async function (id, userId, text) {
  const draft = { awaitingConfirm: false, startedAt: iso() };
  await this.fillDraft(draft, text, false);
  this.update(id, (d) => { d.conversations[userId].reservationDraft = draft; });
  this.accountLog(id, '開始預約收單');
  return this.nextReservationStep(id, userId);
};

P.continueReservation = async function (id, userId, text) {
  let draft = (this.conversation(id, userId) || {}).reservationDraft;
  if (!draft) return this.beginReservation(id, userId, text);
  draft = { ...draft };
  const t = text.trim();
  const clear = () => this.update(id, (d) => { delete d.conversations[userId].reservationDraft; });
  if (t.includes('取消') || t === '不用了' || t === '算了') {
    clear();
    return reply('好的，已取消這次的預約登記，有需要隨時再跟我說 😊', 'reservation');
  }
  // 預約流程拖太久（超過 2 小時）就重來
  if (Date.now() - new Date(draft.startedAt).getTime() > 7200 * 1000) {
    clear();
    return this.beginReservation(id, userId, text);
  }
  if (draft.awaitingConfirm) {
    const yes = ['確認', '確認送出', '對', '好', '好的', '是', '是的', '沒問題', 'ok', 'OK', '正確', '可以', '送出'];
    if (yes.includes(t) || t.startsWith('確認') || t.startsWith('沒問題')) return this.submitReservation(id, userId);
    if (t.includes('重新') || t.includes('重填')) {
      this.update(id, (d) => { d.conversations[userId].reservationDraft = { awaitingConfirm: false, startedAt: iso() }; });
      return this.nextReservationStep(id, userId);
    }
    draft.awaitingConfirm = false;
  }
  const rules = this.data[id].rules;
  // 單純回數字時，依目前問到的欄位判斷
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    if (draft.date && draft.time && draft.people == null) draft.people = n;
    else if (draft.date && !draft.time && n >= 0 && n <= 23) draft.time = `${String(n < 11 ? n + 12 : n).padStart(2, '0')}:00`;
  }
  const askingName = !!(draft.date && draft.time && draft.people != null && !draft.name && rules.askName);
  await this.fillDraft(draft, t, askingName);
  this.update(id, (d) => { d.conversations[userId].reservationDraft = draft; });
  return this.nextReservationStep(id, userId);
};

P.fillDraft = async function (draft, text, askingName) {
  const beforeName = draft.name;
  reservation.fill(draft, text);
  const stillMissing = !draft.date || !draft.time || draft.people == null;
  if ((stillMissing || askingName) && this.aiReady) {
    const slots = await ai.extractSlots(text, reservation.display(new Date()), this.client());
    if (slots) {
      if (!draft.date && slots.date) draft.date = reservation.date(slots.date) || slots.date;
      if (!draft.time && slots.time) draft.time = reservation.time(slots.time) || slots.time;
      if (draft.people == null && slots.people > 0) draft.people = slots.people;
      if (!draft.name && slots.name) draft.name = slots.name;
      if (!draft.phone && slots.phone) draft.phone = slots.phone;
    }
  }
  if (askingName && !draft.name && reservation.looksLikeName(text) && !beforeName) draft.name = text.trim();
};

P.nextReservationStep = async function (id, userId) {
  const draft = (this.conversation(id, userId) || {}).reservationDraft;
  if (!draft) return reply('請問想預約哪一天呢？', 'reservation');
  const rules = this.data[id].rules;
  if (!draft.date) return reply('好的，幫您登記預約 📅 請問想預約哪一天呢？（例如：10/12 或 明天）', 'reservation', ['今天', '明天', '後天', '取消預約']);
  if (!draft.time) return reply(`${draft.date} 沒問題！請問大約幾點呢？（例如：晚上 7 點）`, 'reservation', ['中午 12 點', '晚上 6 點', '晚上 7 點', '取消預約']);
  if (draft.people == null) return reply('請問幾位呢？', 'reservation', ['1 位', '2 位', '3 位', '4 位', '5 位', '6 位']);
  if (draft.people > rules.maxPartySize) {
    return this.startHandoff(id, userId, `預約人數 ${draft.people} 位超過上限`, `預約 ${draft.date} ${draft.time} ${draft.people} 位`, 'handoff');
  }
  if (rules.askName && !draft.name) return reply('請問訂位大名是？', 'reservation');
  if (rules.askPhone && !draft.phone) return reply('請留一支聯絡電話 📞', 'reservation');
  this.update(id, (d) => { d.conversations[userId].reservationDraft.awaitingConfirm = true; });
  let s = `幫您確認預約內容：\n📅 ${draft.date} ${draft.time}\n👥 ${draft.people} 位`;
  if (draft.name) s += `\n🙋 ${draft.name}`;
  if (draft.phone) s += `\n📞 ${draft.phone}`;
  s += '\n\n請問確認送出嗎？';
  return reply(s, 'reservation', ['確認送出', '重新填寫', '取消預約']);
};

P.submitReservation = async function (id, userId) {
  const conv = this.conversation(id, userId);
  const draft = conv && conv.reservationDraft;
  if (!draft || !draft.date || !draft.time || draft.people == null) return this.nextReservationStep(id, userId);
  const r = {
    id: require('./util').uuid(), code: models.makeCode(), userId, customerName: conv.displayName,
    date: draft.date, time: draft.time, people: draft.people, contactName: draft.name || '', phone: draft.phone || '', note: draft.note || '',
    status: 'pending', createdAt: iso(),
  };
  this.update(id, (d) => {
    d.reservations.unshift(r);
    today(d).reservations += 1;
    delete d.conversations[userId].reservationDraft;
  });
  this.accountLog(id, `收到預約：${conv.displayName} ${r.date} ${r.time} ${r.people} 位`);
  await this.notifyOwners(id, [
    LineMessage.buttons(
      `📅 新預約 #${r.code}\n${conv.displayName}\n${r.date} ${r.time}｜${r.people} 位${r.contactName ? `｜${r.contactName}` : ''}${r.phone ? `\n📞 ${r.phone}` : ''}`,
      [['接受', `action=rsv&op=accept&id=${r.id}`], ['婉拒', `action=rsv&op=decline&id=${r.id}`]],
      `新預約：${conv.displayName} ${r.date} ${r.time} ${r.people} 位`,
    ),
  ]);
  return reply(`已收到您的預約申請 🙏 店家確認後會馬上通知您！\n\n${models.reservationSummary(r)}`, 'reservation');
};

// MARK: - 試答（不送出、不記錄）

P.preview = async function (text, accountId) {
  const d = this.data[accountId];
  if (!d) return reply('找不到帳號', 'system');
  const rules = d.rules;
  let hit = retriever.containsAny(text, rules.handoffKeywords);
  if (hit) return reply(`${rules.handoffMessage}\n\n（命中轉人工關鍵字「${hit}」）`, 'handoff');
  hit = retriever.containsAny(text, rules.blockedKeywords);
  if (hit) return reply(`${rules.handoffMessage}\n\n（敏感問題「${hit}」）`, 'blocked');
  if (rules.reservationEnabled && retriever.containsAny(text, rules.reservationKeywords)) return reply('（會開始預約收單流程）', 'reservation');
  const comparing = retriever.modelTokens(text).length >= 2;
  const multiItem = !comparing && splitItems(text).length >= 2;
  const toAgent = this.agentOn && (multiItem || retriever.refersToPrevious(text));
  const faq = toAgent ? null : retriever.matchFAQ(text, comparing ? d.faqs.filter((f) => f.question.includes('比較')) : d.faqs);
  if (faq) { const r = reply(faq.answer, 'faq', faq.quickReplies || []); if (faq.flex && rules.useFlex !== false) r.flex = faq.flex; return r; }
  if (!this.aiReady) return reply(rules.fallbackMessage, 'fallback');
  const started = Date.now();
  const done = (r) => { r.latency = (Date.now() - started) / 1000; return r; };
  if (this.agentOn) {
    const result = await this.runAgent(text, [], d, accountId);
    if (result) {
      if (!result.answerable) return done(reply(`${rules.fallbackMessage}\n\n（知識庫沒有答案，會加入待補清單）`, 'fallback'));
      return done(reply(`${result.reply}\n\n（Agent 查了 ${result.searches.length} 次）`, 'ai'));
    }
  }
  try {
    const client = this.client();
    const semantic = await this.semanticScores(text, d);
    const terms = semantic != null || !d.docs.length ? [] : await withTimeout(10, (s) => ai.searchTerms(text, client, s)).catch(() => []);
    const knowledge = retriever.context(text, d, { terms, semantic, budget: 3000, maxPieces: 5 });
    const a = await withTimeout(60, (signal) => ai.answer({ question: text, knowledge, history: [], store: d.store, rules, client, signal }));
    if ((a.intent === 'question' || a.intent === 'other') && (!a.answerable || !retriever.hasKnowledge(knowledge))) {
      return done(reply(`${rules.fallbackMessage}\n\n（知識庫沒有答案，會加入待補清單）`, 'fallback'));
    }
    return done(reply(a.reply, 'ai'));
  } catch (e) {
    return reply(`AI 生成失敗：${e.message}`, 'system');
  }
};

// MARK: - 排程工作

P.runConversationTimers = function (id, now) {
  const d = this.data[id];
  if (!d) return;
  const rules = d.rules;
  for (const conv of Object.values(d.conversations)) {
    if (conv.mode !== 'human') continue;
    const lastCustomer = lastCustomerAt(conv);
    // 店家回覆後一段時間沒動靜 → 自動交還 AI
    if (conv.lastOwnerReplyAt) {
      const last = new Date(conv.lastOwnerReplyAt);
      const activity = lastCustomer && lastCustomer > last ? lastCustomer : last;
      if (now - activity > rules.humanModeMinutes * 60000) {
        this.resumeAI(id, conv.id, `${rules.humanModeMinutes} 分鐘無人回覆，自動交還`);
        continue;
      }
    } else if (conv.humanSince && now - new Date(conv.humanSince) > 12 * 3600000) {
      this.resumeAI(id, conv.id, '超過 12 小時未處理，自動交還');
      continue;
    }
    // 待回覆提醒
    const ownerAt = conv.lastOwnerReplyAt ? new Date(conv.lastOwnerReplyAt) : new Date(0);
    if (!rules.pendingReminderEnabled || conv.reminderSent || !lastCustomer || !(lastCustomer > ownerAt)
      || !(now - lastCustomer > rules.pendingReminderMinutes * 60000)) continue;
    this.update(id, (x) => { x.conversations[conv.id].reminderSent = true; });
    const minutes = Math.floor((now - lastCustomer) / 60000);
    const last = [...conv.messages].reverse().find((m) => m.role === 'customer');
    this.notifyOwners(id, [LineMessage.text(`⏰ 待回覆提醒\n${conv.displayName} 已經等了 ${minutes} 分鐘\n最新訊息：「${prefix(last ? last.text : '', 100)}」\n\n回覆請傳：#${conv.handoffCode} 你的回覆`)]);
  }
};

P.sendDailySummaryIfNeeded = function (id, now) {
  const d = this.data[id];
  if (!d || !d.rules.dailySummaryEnabled) return;
  const key = require('./util').dayKey(now);
  if (d.lastSummarySent === key) return;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (nowMinutes < d.rules.dailySummaryHour * 60 + d.rules.dailySummaryMinute) return;
  this.update(id, (x) => { x.lastSummarySent = key; });
  this.notifyOwners(id, [LineMessage.text(this.dailySummary(id))]);
  this.accountLog(id, '已送出每日摘要');
};

P.dailySummary = function (id) {
  const d = this.data[id];
  const s = today(d);
  const pendingRsv = d.reservations.filter((r) => r.status === 'pending').length;
  const waiting = Object.values(d.conversations).filter((c) => c.mode === 'human').length;
  let text = `📊 ${d.store.name || '今日'} 每日摘要（${reservation.display(new Date())}）
收到訊息 ${s.received} 則｜已回覆 ${s.replied} 則
FAQ 直接回答 ${s.faq}｜AI 生成 ${s.ai}
轉人工 ${s.handoff}｜新預約 ${s.reservations}
待確認預約 ${pendingRsv} 筆｜等待真人 ${waiting} 位`;
  const todays = d.pending.filter((p) => sameDay(new Date(p.lastAskedAt), new Date())).slice(0, 5);
  if (todays.length) {
    text += '\n\n📝 今天答不出來的問題：\n' + todays.map((p) => `・${prefix(p.question, 40)}`).join('\n');
    text += '\n到 App 知識庫可一鍵補成 FAQ，越用越準！';
  }
  return text;
};

module.exports = { App };
