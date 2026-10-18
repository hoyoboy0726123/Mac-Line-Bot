'use strict';
// 資料結構與預設值。欄位名稱跟 Mac 版（Swift Codable）完全相同，JSON 檔可以互通。

const { uuid, iso, dayKey } = require('./util');
const edition = require('../../edition.json');

const isMIL = edition.edition === 'mil';

const makeBindCode = () => String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
const makeCode = () => {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
};

// MARK: 帳號

function newAccount(slug, displayName) {
  return {
    id: uuid(), slug, displayName, basicId: '', botUserId: '', pictureURL: null,
    ownerUserIds: [], bindCode: makeBindCode(), isEnabled: true, createdAt: iso(),
    channelSecret: '', channelAccessToken: '',
  };
}

const hasCredentials = (a) => !!(a && a.channelSecret && a.channelAccessToken);

// MARK: 店家 / 規則

const defaultStore = () => ({
  name: '', intro: '', address: '', phone: '', businessHours: '', website: '', payment: '', parking: '', extraNotes: '',
});

function storeAsKnowledge(s) {
  const lines = [];
  const add = (label, v) => { const t = (v || '').trim(); if (t) lines.push(`${label}：${t}`); };
  add('店名', s.name); add('簡介', s.intro); add('地址', s.address); add('電話', s.phone);
  add('營業時間', s.businessHours); add('網站', s.website); add('付款方式', s.payment); add('停車', s.parking); add('其他', s.extraNotes);
  return lines.join('\n');
}

const TONES = {
  friendly: { label: '親切溫暖', instruction: '語氣親切、溫暖、有禮貌。' },
  professional: { label: '專業簡潔', instruction: '語氣專業、簡潔、直接。' },
  lively: { label: '活潑可愛', instruction: '語氣活潑、熱情，可以適度使用表情符號。' },
};

const defaultRules = () => ({
  tone: 'friendly', useEmoji: true, maxReplyLength: 150,
  handoffKeywords: ['真人', '專人', '客服人員', '找老闆', '人工'],
  blockedKeywords: ['退款', '客訴', '投訴', '律師', '報警'],
  handoffMessage: '已為您通知專人，稍後會由專人為您回覆，請稍候。',
  humanModeMinutes: 30,
  fallbackMessage: '這個問題我目前沒有資料，已經幫您轉告店家，會盡快回覆您 🙏',
  greetingMessage: '您好，歡迎加入！有任何問題都可以直接問我喔 😊',
  reservationEnabled: true,
  reservationKeywords: ['預約', '訂位', '預定', '訂桌', 'booking'],
  maxPartySize: 20, askName: true, askPhone: false,
  dailySummaryEnabled: true, dailySummaryHour: 21, dailySummaryMinute: 0,
  pendingReminderEnabled: true, pendingReminderMinutes: 10,
  disconnectNotifyEnabled: true, notifyUnanswered: true,
  /// 有卡片的答案用 LINE Flex 卡片呈現
  useFlex: true,
});

// MARK: 知識庫

const makeFAQ = (question, answer, keywords = []) => ({
  id: uuid(), question, answer, keywords, isEnabled: true, hitCount: 0, updatedAt: iso(),
});
const makeDoc = (title, content) => ({ id: uuid(), title, content, updatedAt: iso() });

const SOURCE_LABEL = {
  faq: 'FAQ', ai: 'AI', handoff: '轉人工', fallback: '待補', reservation: '預約',
  owner: '店家', greeting: '歡迎', blocked: '敏感', system: '系統',
};

const makeMessage = (role, text, source = null, latency = null, card = false) => {
  const m = { id: uuid(), role, text, date: iso() };
  if (card) m.card = true;
  if (source) m.source = source;
  if (latency != null) m.latency = latency;
  return m;
};

const newConversation = (id) => ({
  id, displayName: 'LINE 使用者', pictureURL: null, messages: [], mode: 'ai',
  reminderSent: false, unread: 0, handoffCode: makeCode(),
});

const RESERVATION_STATUS = { pending: '待確認', accepted: '已接受', declined: '已婉拒', cancelled: '已取消' };

function reservationSummary(r) {
  let s = `📅 ${r.date} ${r.time}\n👥 ${r.people} 位`;
  if (r.contactName) s += `\n🙋 ${r.contactName}`;
  if (r.phone) s += `\n📞 ${r.phone}`;
  if (r.note) s += `\n📝 ${r.note}`;
  return s;
}

const emptyStats = (key) => ({
  dateKey: key, received: 0, replied: 0, faq: 0, ai: 0, handoff: 0, urlChanges: 0, reservations: 0, unanswered: 0, aiMilliseconds: 0,
});

/// 取得今天的統計（沒有就建立）
function today(d) {
  const k = dayKey();
  if (!d.stats[k]) d.stats[k] = emptyStats(k);
  return d.stats[k];
}

const defaultAccountData = () => ({
  store: defaultStore(), faqs: [], docs: [], pending: [], rules: defaultRules(),
  conversations: {}, reservations: [], stats: {},
});

function sampleAccountData() {
  const d = defaultAccountData();
  d.store = {
    ...defaultStore(), name: '我的小店', intro: '歡迎光臨！',
    businessHours: '週二至週五：上午 9:00 至晚上 8:00\n週六、週日：上午 8:30 至晚上 9:00\n每週一公休',
  };
  d.faqs = [
    makeFAQ('營業時間', '・週二至週五：上午 9:00 至晚上 8:00\n・週六、週日：上午 8:30 至晚上 9:00\n每週一公休', ['幾點', '開門', '營業', '公休']),
    makeFAQ('可以刷卡嗎', '可以喔！我們接受信用卡、LINE Pay 與現金。', ['刷卡', '付款', 'Line Pay']),
  ];
  return d;
}

/// 讀進來的資料補上缺的欄位（舊版檔案、Mac 版檔案都能讀）
function normalizeAccountData(raw) {
  const d = { ...defaultAccountData(), ...(raw || {}) };
  d.store = { ...defaultStore(), ...(d.store || {}) };
  d.rules = { ...defaultRules(), ...(d.rules || {}) };
  d.faqs = (d.faqs || []).map((f) => ({ isEnabled: true, hitCount: 0, keywords: [], ...f }));
  d.docs = d.docs || [];
  d.pending = d.pending || [];
  d.conversations = d.conversations || {};
  for (const c of Object.values(d.conversations)) {
    c.messages = c.messages || [];
    if (!c.mode) c.mode = 'ai';
    if (!c.handoffCode) c.handoffCode = makeCode();
    if (c.unread == null) c.unread = 0;
  }
  d.reservations = d.reservations || [];
  d.stats = d.stats || {};
  return d;
}

// MARK: 全域設定

const defaultSettings = () => ({
  port: edition.port,
  adminPort: edition.adminPort,
  /// 區網內的其他電腦可以用瀏覽器連進管理介面（需要密碼）
  lanAccess: false,
  aiAutoReply: true,
  tunnelMode: 'quick',
  namedHostname: '',
  cloudflaredPath: '',
  selectedAccountId: null,
  onboardingCompleted: false,
  autoStart: true,
  useOllama: true,
  ollamaURL: 'http://127.0.0.1:11434',
  chatModel: 'qwen3.5:9b',
  embedModel: 'bge-m3',
  agentMode: isMIL,
});

const normalizeSettings = (raw) => ({ ...defaultSettings(), ...(raw || {}) });

module.exports = {
  edition, isMIL, makeBindCode, makeCode, newAccount, hasCredentials,
  defaultStore, storeAsKnowledge, TONES, defaultRules, makeFAQ, makeDoc, SOURCE_LABEL, makeMessage,
  newConversation, RESERVATION_STATUS, reservationSummary, emptyStats, today,
  defaultAccountData, sampleAccountData, normalizeAccountData, defaultSettings, normalizeSettings,
};
