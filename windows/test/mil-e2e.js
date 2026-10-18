'use strict';
// 軍規機種管理的完整流程測試：新增測試項目 → 新增機種（手動、PDF）→ 產生 → LINE 提問 → 修改 → 全部刪除 → 確認恢復原狀
// 用法：node test/mil-e2e.js（暫存資料夾 + 假 LINE 伺服器，跑完自動刪除）

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = fs.mkdtempSync(path.join(process.env.MLB_TMP || os.tmpdir(), 'mlb-mil-e2e-'));
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ port: 18788, adminPort: 18791, autoStart: false, onboardingCompleted: true }));
process.env.MLB_LINE_API = 'http://127.0.0.1:18900';

const sent = [];
const line = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let j = {}; try { j = JSON.parse(body || '{}'); } catch { /* 略過 */ }
    if (req.url === '/v2/bot/info') return res.end(JSON.stringify({ userId: 'Ubot', basicId: '@test', displayName: '測試' }));
    if (req.url.startsWith('/v2/bot/profile/')) return res.end(JSON.stringify({ displayName: '測試顧客' }));
    if (req.url.endsWith('/reply') || req.url.endsWith('/push')) sent.push(j);
    if (req.url === '/v2/bot/richmenu/list') return res.end('{"richmenus":[]}');
    if (req.url === '/v2/bot/user/all/richmenu') { res.writeHead(404); return res.end('{}'); }
    res.end('{}');
  });
});

const ADMIN = 'http://127.0.0.1:18791';
const api = async (p, body) => {
  const r = await fetch(ADMIN + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-MLB': '1' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}：${j.error}`);
  return j;
};

let ok = 0, bad = 0;
const check = (cond, label, extra = '') => { if (cond) { ok++; console.log('  ✅', label); } else { bad++; console.log('  ❌', label, extra); } };

async function ask(slug, text) {
  const n = sent.length;
  const body = JSON.stringify({ events: [{ type: 'message', replyToken: 'rt', source: { type: 'user', userId: 'Utester' }, message: { type: 'text', text } }] });
  const sig = crypto.createHmac('sha256', 'sec').update(body).digest('base64');
  await fetch(`http://127.0.0.1:18788/webhook/${slug}`, { method: 'POST', headers: { 'x-line-signature': sig }, body });
  const t0 = Date.now();
  while (sent.length === n && Date.now() - t0 < 90000) await new Promise((x) => setTimeout(x, 100));
  return (sent[n] || { messages: [] }).messages[0] || {};
}

(async () => {
  await new Promise((r) => line.listen(18900, '127.0.0.1', r));
  const { createCore } = require('../src/core');
  const core = createCore({ dataDir });
  await core.start();
  for (let i = 0; i < 60 && core.app.ollamaState !== 'ready'; i++) await new Promise((x) => setTimeout(x, 1000));
  const { id } = await api('/api/accounts/add', { secret: 'sec', token: 'tok' });
  const slug = core.app.account(id).slug;
  const data = () => api(`/api/data?account=${id}`);

  console.log('\n① 起點：內建 5 款機種、13 個測試項目');
  await api('/api/mil/generate', { account: id });
  const base = await data();
  const baseQuestions = base.faqs.map((f) => f.question).sort();
  const snapshot = (x) => JSON.stringify({ faqs: x.faqs.map((f) => [f.question, f.answer, f.keywords, f.flex || '', f.quickReplies || []]).sort(), doc: x.docs.map((y) => [y.title, y.content]) });
  const baseSnapshot = snapshot(base);
  check(base.mil.tests.length === 13 && base.mil.catalog.models.length === 5, `測試項目 ${base.mil.tests.length}、機種 ${base.mil.catalog.models.length}、FAQ ${base.faqs.length}`);

  console.log('\n② 新增測試項目「淋雨 506.6」（2 個程序）');
  await api('/api/mil/test/save', { account: id, test: {
    code: '506.6', short: '淋雨', aliases: ['淋雨', '下雨天', '雨水'],
    procedures: [{ id: 'I', label: '降雨（程序 I）', detail: '降雨率 1.7 mm/min、風速 18 m/s，30 分鐘' }, { id: 'III', label: '滴水（程序 III）', detail: '滴水量 280 L/m²/h，15 分鐘' }],
  } });
  let d = await data();
  const rain = d.mil.tests.find((t) => t.short === '淋雨');
  check(rain && d.mil.tests.length === 14, `測試項目變成 ${d.mil.tests.length} 個，淋雨 id=${rain && rain.id}`);
  check(d.mil.needsRegenerate, '畫面會提示「需要產生知識庫」');

  console.log('\n③ 修改內建測試：低溫加上「冷凍庫」');
  const cold = d.mil.tests.find((t) => t.id === 'cold');
  await api('/api/mil/test/save', { account: id, test: { ...cold, aliases: [...cold.aliases, '冷凍庫'] } });

  console.log('\n④ 手動新增機種「B9400CVA」（通過淋雨 I、低溫 C1、跌落）');
  await api('/api/mil/model/save', { account: id, model: {
    code: 'B9400CVA', display: 'ExpertBook B9（B9400CVA）', aliases: ['B9400CVA', 'B9400', 'ExpertBook B9', 'B9'],
    passed: { [rain.id]: ['I'], cold: ['C1st', 'C1op'], drop: ['VI'] }, reportURL: '',
  } });

  console.log('\n⑤ 從 PDF 新增機種（用 B5302C 的官方報告，改名 B5TEST 當作新機種）');
  const pdf = path.join(__dirname, 'fixtures', 'pdfs', 'B5302C.pdf');
  if (fs.existsSync(pdf)) {
    const r = await api('/api/mil/parse', { account: id, base64: fs.readFileSync(pdf).toString('base64') });
    check(Object.keys(r.passed).length === 11, `PDF 讀到 ${Object.keys(r.passed).length} 個通過項目`);
    await api('/api/mil/model/save', { account: id, model: { code: 'B5TEST', display: 'PDF 匯入測試機（B5TEST）', aliases: ['B5TEST'], passed: r.passed, describedOnly: r.describedOnly } });
  } else console.log('  （沒有 PDF，略過）');

  console.log('\n⑥ 產生知識庫');
  const g = await api('/api/mil/generate', { account: id });
  d = await data();
  check(!d.mil.needsRegenerate, `產生 ${g.faqs} 題 FAQ、背景知識 ${g.paragraphs} 段`);
  check(d.faqs.some((f) => f.question === 'B9400CVA 淋雨測試') && d.faqs.some((f) => f.question === '淋雨測試怎麼做'), '有「B9400CVA 淋雨測試」與「淋雨測試怎麼做」');
  check(d.docs[0].content.includes('Method 506.6 淋雨') && d.docs[0].content.includes('B9400CVA'), '背景知識有淋雨與 B9400CVA');

  console.log('\n⑦ 用 LINE 問');
  let m = await ask(slug, 'B9 下雨天可以用嗎');
  check((m.text || m.altText || '').includes('B9400CVA') && (m.text || m.altText).includes('降雨率 1.7 mm/min'), 'B9 下雨天可以用嗎 → B9400CVA 淋雨測試', (m.text || m.altText || '').slice(0, 60));
  m = await ask(slug, '淋雨測試怎麼做');
  check(m.type === 'flex' && JSON.stringify(m.contents).includes('B9400CVA'), '淋雨測試怎麼做 → 卡片，通過型號有 B9400CVA');
  m = await ask(slug, 'B9 跟 P5 差在哪');
  const rows = m.type === 'flex' ? JSON.stringify(m.contents) : '';
  check(rows.includes('淋雨') && rows.includes('B9400CVA'), 'B9 跟 P5 差在哪 → 比較表卡片有「淋雨」那一列');
  m = await ask(slug, '比較型號');
  check(m.quickReply && m.quickReply.items.length === 13, `比較型號 → 快速選項 ${m.quickReply ? m.quickReply.items.length : 0} 個（7 款機種有 21 組，LINE 最多顯示 13 個）`);
  m = await ask(slug, '放冷凍庫會壞嗎');
  check((m.altText || m.text || '').includes('低溫測試'), '放冷凍庫會壞嗎 → 低溫測試（修改過的內建項目）');
  m = await ask(slug, 'B5TEST 通過哪些測試');
  check((m.altText || m.text || '').includes('B5TEST'), 'B5TEST 通過哪些測試 → PDF 匯入的機種');

  console.log('\n⑧ 手動修改一題自動產生的 FAQ，再重新產生');
  const f = d.faqs.find((x) => x.question === 'B9400CVA 淋雨測試');
  await api('/api/faq/save', { account: id, faq: { ...f, answer: '（手動修改測試）B9 有淋雨測試喔' } });
  const g2 = await api('/api/mil/generate', { account: id });
  d = await data();
  const edited = d.faqs.filter((x) => x.question === 'B9400CVA 淋雨測試');
  check(edited.length === 1 && edited[0].answer.startsWith('（手動修改測試）') && edited[0].keywords.includes('#手動修改'), `重新產生後保留手動修改（保留 ${g2.kept} 題）`);

  console.log('\n⑨ 刪除：機種 ×2、測試項目淋雨、手動修改的 FAQ、低溫改回原本');
  for (const x of d.mil.catalog.models.filter((y) => ['B9400CVA', 'B5TEST'].includes(y.code))) await api('/api/mil/model/delete', { account: id, mid: x.id });
  await api('/api/mil/test/delete', { account: id, tid: rain.id });
  await api('/api/faq/delete', { account: id, id: edited[0].id });
  await api('/api/mil/tests/reset', { account: id });
  await api('/api/mil/generate', { account: id });

  console.log('\n⑩ 確認恢復原狀');
  d = await data();
  const all = JSON.stringify(d);
  check(d.mil.tests.length === 13 && !d.mil.customTests, `測試項目回到內建 ${d.mil.tests.length} 個`);
  check(d.mil.catalog.models.length === 5, `機種回到 ${d.mil.catalog.models.length} 款`);
  check(JSON.stringify(d.faqs.map((x) => x.question).sort()) === JSON.stringify(baseQuestions), `FAQ 回到原本的 ${d.faqs.length} 題（題目完全相同）`);
  check(snapshot(d) === baseSnapshot, '每一題 FAQ 的答案、關鍵字、卡片，以及背景知識，都跟測試前一模一樣');
  check(!/B9400CVA|B5TEST|冷凍庫|手動修改測試|506\.6/.test(JSON.stringify({ faqs: d.faqs, docs: d.docs, mil: d.mil })), '找不到任何測試資料（B9400CVA、B5TEST、506.6、冷凍庫）');
  m = await ask(slug, 'B9 下雨天可以用嗎');
  check(!(m.text || m.altText || '').includes('B9400CVA'), '再問「B9 下雨天可以用嗎」已經查不到 B9400CVA');
  void all;

  core.stop();
  line.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log(`\n結果：${ok} 項通過、${bad} 項失敗；暫存資料夾已刪除（${fs.existsSync(dataDir) ? '還在！' : '確認不存在'}）`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(1); });
