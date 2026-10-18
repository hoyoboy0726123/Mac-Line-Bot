'use strict';
// 端對端測試（需要本機 Ollama）：假 LINE 伺服器 + 簽章 webhook → 檢查回覆
// 用法：node test/e2e.js   （會用暫存資料夾與 18xxx 連接埠，不會碰到真的 LINE）

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LINE_PORT = 18900;
const dataDir = fs.mkdtempSync(path.join(process.env.MLB_TMP || os.tmpdir(), 'mlb-e2e-'));
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ port: 18788, adminPort: 18791, autoStart: false, onboardingCompleted: true }));
process.env.MLB_LINE_API = `http://127.0.0.1:${LINE_PORT}`;

const sent = [];
let menus = [{ richMenuId: 'rm-old', name: '舊專案選單', chatBarText: '功能選單', areas: [{ action: { type: 'message', label: '選擇專家' } }] }];
let defaultMenu = 'rm-old', uploaded = 0, validated = 0;
const lineServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let j = {}; try { j = body ? JSON.parse(body) : {}; } catch { /* 圖片 */ }
    if (req.url === '/v2/bot/info') return res.end(JSON.stringify({ userId: 'Ubot', basicId: '@test', displayName: '測試商店' }));
    if (req.url.startsWith('/v2/bot/profile/')) return res.end(JSON.stringify({ displayName: '小明' }));
    if (req.url === '/v2/bot/message/reply' || req.url === '/v2/bot/message/push') sent.push({ kind: req.url.split('/').pop(), ...j });
    // 圖文選單：一開始有一個別的專案留下的選單
    if (req.url === '/v2/bot/richmenu/list') return res.end(JSON.stringify({ richmenus: menus }));
    if (req.url === '/v2/bot/user/all/richmenu' && req.method === 'GET') return defaultMenu ? res.end(JSON.stringify({ richMenuId: defaultMenu })) : (res.writeHead(404), res.end('{}'));
    if (req.url === '/v2/bot/richmenu' && req.method === 'POST') { const id = 'rm-new-' + menus.length; menus.push({ richMenuId: id, ...j }); return res.end(JSON.stringify({ richMenuId: id })); }
    if (req.url.startsWith('/v2/bot/user/all/richmenu/')) { defaultMenu = req.url.split('/').pop(); return res.end('{}'); }
    if (req.url.endsWith('/content')) { uploaded = body.length; return res.end('{}'); }
    if (req.method === 'DELETE') { menus = menus.filter((m) => m.richMenuId !== req.url.split('/').pop()); return res.end('{}'); }
    if (req.url === '/v2/bot/message/validate/push') validated += j.messages.length;
    res.end('{}');
  });
});

const SECRET = 'testsecret';
const ADMIN = 'http://127.0.0.1:18791';
const api = (p, body) => fetch(ADMIN + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-MLB': '1' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

async function say(slug, userId, text) {
  const n = sent.length;
  const body = JSON.stringify({ events: [{ type: 'message', replyToken: 'rt' + Date.now(), source: { type: 'user', userId }, message: { type: 'text', text } }] });
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64');
  const r = await fetch(`http://127.0.0.1:18788/webhook/${slug}`, { method: 'POST', headers: { 'x-line-signature': sig, 'Content-Type': 'application/json' }, body });
  if (r.status !== 200) throw new Error('webhook ' + r.status);
  const t0 = Date.now();
  while (sent.length === n && Date.now() - t0 < 120000) await new Promise((x) => setTimeout(x, 200));
  const m = sent[n];
  return { text: m ? m.messages.map((x) => (x.type === 'flex' ? `[卡片 ${x.contents.header.contents[1].text}] ` : '') + (x.text || x.altText) + (x.quickReply ? ` [快速選項 ${x.quickReply.items.length}]` : '')).join(' | ') : '(沒有回覆)', secs: (Date.now() - t0) / 1000 };
}

(async () => {
  await new Promise((r) => lineServer.listen(LINE_PORT, '127.0.0.1', r));
  const { createCore } = require('../src/core');
  const core = createCore({ dataDir });
  await core.start();
  // 等 Ollama 就緒
  for (let i = 0; i < 60 && core.app.ollamaState !== 'ready'; i++) await new Promise((x) => setTimeout(x, 1000));
  console.log('Ollama：', core.app.ollamaLabel());

  const add = await api('/api/accounts/add', { secret: SECRET, token: 'tok' });
  const id = add.id;
  const slug = core.app.account(id).slug;
  if (core.app.data[id] && core.app.milCatalog) {
    const g = await api('/api/mil/generate', { account: id });
    console.log('產生知識庫：', JSON.stringify(g));
  }
  // 綁定店家
  const bind = core.app.account(id).bindCode;
  await say(slug, 'Uowner', `綁定 ${bind}`);
  console.log('綁定：', core.app.account(id).ownerUserIds);

  const menu = await api('/api/richmenu/apply', { id });
  console.log('圖文選單：', JSON.stringify(menu), '預設=', defaultMenu, '剩下', menus.map((m) => m.name), '圖片', uploaded, 'bytes');
  await new Promise((x) => setTimeout(x, 1500));
  console.log('卡片檢查：', validated, '則');

  const cases = [
    '比較型號',
    'P5405CSA vs B1400',
    '沙塵測試怎麼做',
    'P5 可以耐多低溫',
    'B5 跟 L1400 差在哪',
    '沙塵、凍融和艦載振動這三項的條件',
    '跌落測試的高度是多少',
    '你們有賣手機嗎',
    '我要找真人',
  ];
  for (const q of cases) {
    const r = await say(slug, 'Ucust' + cases.indexOf(q), q);
    console.log(`\n▶ ${q}（${r.secs.toFixed(1)}s）\n${r.text}`);
  }
  // 預約流程
  const steps = ['我想預約', '明天', '晚上7點', '4位', '王小明', '確認送出'];
  for (const s of steps) { const r = await say(slug, 'Ursv', s); console.log(`\n▶ ${s}\n${r.text}`); }
  const st = await api(`/api/data?account=${id}`);
  console.log('\n預約筆數：', st.reservations.length, '今日：', JSON.stringify(st.today));
  core.stop();
  lineServer.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
