// 雲端 Workers AI 實測：對測試 Worker（mac-line-bot-mil-aitest，假 LINE）發問，記錄回答與花費時間
// 用法：PASSWORD_FILE=<密碼檔> node test/aitest.mjs
// 只用內建的軍規知識庫和假帳號，不碰正式資料

import crypto from 'node:crypto';
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://mac-line-bot-mil-aitest.line-bot-media.workers.dev';
const PASSWORD = (process.env.PASSWORD || fs.readFileSync(process.env.PASSWORD_FILE, 'utf8')).trim();
const SECRET = 'aitest-secret';

const QUESTIONS = process.env.QS ? process.env.QS.split("|") : [
  // 本機評估用的 10 題
  '溫度衝擊測試怎麼做', '摔到地上會壞嗎', 'B1400 有做沙塵測試嗎', 'P5 可以耐多低溫', '筆電可以淋雨嗎',
  '坐飛機帶著沒問題吧', 'L1400 有沒有做溫度衝擊', '摔壞了保固有賠嗎', '放在車上曬太陽會怎樣', '開車載著一直震動可以嗎',
  // 軍規流程測試的題目
  'B9 下雨天可以用嗎', '淋雨測試怎麼做', '放冷凍庫會壞嗎', 'B5 可以在零下幾度使用？',
  // 其他意圖
  '你好', '謝謝你', '你們的筆電多少錢', '我要退貨', '請問門市在哪裡',
  // 要 AI 回答的：FAQ 答不到、追問、一次問多項
  'P5 跟 B1400 哪台比較耐摔', '我常去沙漠出差，帶哪台比較好', '我在高山上工作，哪一台適合', 'P5 有做沙塵測試嗎', '那 L1400 呢',
  'B5 能淋雨嗎？可以摔嗎？', '冬天在雪地裡用 L1400 會怎樣', '軍規是什麼意思',
  // 模糊、問機器人、要找人（應該反問、自我介紹、轉人工）
  '你是誰', '我要查', '查一下測試結果', '查通過機種', '我想跟業務聊聊',
  // 一次問好幾題
  'P5 耐低溫嗎，可以帶上飛機嗎？', 'L1400 可以摔嗎？價格多少？', 'P5 最高可以幾度',
];

let cookie = '';
async function api(p, body) {
  const r = await fetch(BASE + p, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-MLB': '1', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}：${j.error}`);
  return j;
}

let seq = 0;
const RUN = Date.now().toString(36);
async function ask(slug, text, user = `U${RUN}`) {
  const { total } = await api('/aitest/sent');
  const token = `rt${Date.now()}-${++seq}`;
  const body = JSON.stringify({ destination: 'Ubot', events: [{ type: 'message', replyToken: token, source: { type: 'user', userId: user }, timestamp: Date.now(), message: { type: 'text', id: `m${RUN}-${seq}`, text } }] });
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64');
  const t0 = Date.now();
  const r = await fetch(`${BASE}/webhook/${slug}`, { method: 'POST', headers: { 'x-line-signature': sig, 'Content-Type': 'application/json' }, body });
  if (r.status !== 200) return { ms: Date.now() - t0, text: `（webhook ${r.status}）` };
  while (Date.now() - t0 < 60000) {
    const { items } = await api(`/aitest/sent?since=${total}`);
    const hit = items.find((x) => x.replyToken === token);
    if (hit) {
      const m = hit.messages[0] || {};
      return { ms: Date.now() - t0, type: m.type, text: m.text || m.altText || JSON.stringify(m).slice(0, 200) };
    }
    await new Promise((x) => setTimeout(x, 500));
  }
  return { ms: Date.now() - t0, text: '（60 秒內沒有回覆）' };
}

const login = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
cookie = (login.headers.get('set-cookie') || '').split(';')[0];
if (login.status !== 200) throw new Error(`登入失敗 ${login.status}`);

let st = await api('/api/state');
console.log(`${st.productName}｜AI：${st.settings?.chatModel || ''}｜狀態：${st.ollama?.label || ''}`);
let acct = st.accounts.find((a) => a.basicId === '@aitest');
// FRESH=1：刪掉舊的測試帳號重建（測新增帳號的預設資料）
if (acct && process.env.FRESH) { await api('/api/accounts/delete', { id: acct.id }); acct = null; }
if (!acct) {
  const { id } = await api('/api/accounts/add', { secret: SECRET, token: 'aitest-token' });
  st = await api('/api/state');
  acct = st.accounts.find((a) => a.id === id);
}
// 等知識庫與向量索引建好
for (let i = 0; i < 120; i++) {
  const d = await api(`/api/data?account=${acct.id}`);
  st = await api('/api/state');
  if (d.faqs.length > 20 && st.vectorCount > 0) break;
  await new Promise((x) => setTimeout(x, 1000));
}
console.log(`帳號 ${acct.displayName}，向量 ${st.vectorCount} 筆\n`);

const rows = [];
for (const q of QUESTIONS) {
  const a = await ask(acct.slug, q);
  rows.push({ q, ...a });
  console.log(`【${q}】 ${(a.ms / 1000).toFixed(1)} 秒 ${a.type || ''}\n  → ${a.text}\n`);
}
st = await api('/api/state');
console.log('AI 用量：', JSON.stringify(st.aiUsage));
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ rows, usage: st.aiUsage }, null, 1));
