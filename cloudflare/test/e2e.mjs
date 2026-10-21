// 雲端版端對端測試：wrangler dev（本機 Workers + Durable Object）＋ 假 LINE 伺服器
// 用法：先 `npx wrangler dev -c wrangler.test.jsonc --port 8799`，再 `node test/e2e.mjs`
// 不用 Workers AI：只測 FAQ、卡片、比較、轉真人、Excel 匯入、登入保護、資料保存

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8799';
const PASSWORD = process.env.PASSWORD || 'local-test-pass';
const SECRET = 'cloud-test-secret';
const here = path.dirname(new URL(import.meta.url).pathname);

// MARK: 假 LINE 伺服器
const sent = [];
const menus = {};
let defMenu = null;
const line = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let j = {}; try { j = JSON.parse(body || '{}'); } catch { /* 圖片 */ }
    const send = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const u = req.url;
    if (u === '/v2/bot/info') return send({ userId: 'Ubot', basicId: '@cloudtest', displayName: '雲端測試帳號' });
    if (u.startsWith('/v2/bot/profile/')) return send({ displayName: u.endsWith('Uowner') ? '店長' : '測試顧客' });
    if (u === '/v2/bot/message/reply' || u === '/v2/bot/message/push') { sent.push({ url: u, ...j }); return send({}); }
    if (u === '/v2/bot/channel/webhook/test') return send({ success: true, statusCode: 200, reason: 'OK', detail: '200' });
    if (u === '/v2/bot/richmenu/list') return send({ richmenus: Object.values(menus) });
    if (u === '/v2/bot/user/all/richmenu' && req.method === 'GET') return defMenu ? send({ richMenuId: defMenu }) : send({}, 404);
    if (u.startsWith('/v2/bot/user/all/richmenu/')) { defMenu = u.split('/').pop(); return send({}); }
    if (u === '/v2/bot/richmenu' && req.method === 'POST') { const id = `rm${Object.keys(menus).length + 1}`; menus[id] = { ...j, richMenuId: id }; return send({ richMenuId: id }); }
    send({});
  });
});

let cookie = '';
async function api(p, body, { raw = false } = {}) {
  const r = await fetch(BASE + p, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-MLB': '1', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return r;
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}：${j.error}`);
  return j;
}

let ok = 0, bad = 0;
const check = (cond, label, extra = '') => { if (cond) { ok++; console.log('  ✅', label); } else { bad++; console.log('  ❌', label, extra); } };

let seq = 0;
async function ask(slug, text, user = 'Utester') {
  const n = sent.length;
  const body = JSON.stringify({ destination: 'Ubot', events: [{ type: 'message', replyToken: `rt${++seq}`, source: { type: 'user', userId: user }, timestamp: Date.now(), message: { type: 'text', id: `m${seq}`, text } }] });
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64');
  const r = await fetch(`${BASE}/webhook/${slug}`, { method: 'POST', headers: { 'x-line-signature': sig, 'Content-Type': 'application/json' }, body });
  if (r.status !== 200) return { status: r.status };
  const t0 = Date.now();
  const token = `rt${seq}`;
  const find = () => sent.slice(n).find((x) => x.replyToken === token);
  while (!find() && Date.now() - t0 < 30000) await new Promise((x) => setTimeout(x, 100));
  return (find() || { messages: [] }).messages[0] || {};
}
const textOf = (m) => m.text || m.altText || '';

(async () => {
  await new Promise((r) => line.listen(18900, '127.0.0.1', r));

  console.log('\n① 登入保護');
  check((await api('/api/state', null, { raw: true })).status === 401, '沒登入讀不到資料（401）');
  const wrong = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong-password' }) });
  check(wrong.status === 401, '密碼錯誤被拒絕');
  const login = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  check(login.status === 200 && cookie.startsWith('mlb_session='), '正確密碼登入，拿到 Cookie');
  const forged = await fetch(BASE + '/api/state', { headers: { Cookie: 'mlb_session=9999999999999.abc' } });
  check(forged.status === 401, '偽造的 Cookie 被拒絕');
  const noHeader = await fetch(BASE + '/api/settings', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
  check(noHeader.status === 403, '沒有 X-MLB 標頭的修改請求被擋（防跨站請求）');

  console.log('\n② 新增 LINE 帳號（自動產生軍規知識庫、套用圖文選單）');
  let st = await api('/api/state');
  check(st.cloud === true && st.edition === 'mil', `雲端版狀態：${st.productName}`);
  const { id } = await api('/api/accounts/add', { secret: SECRET, token: 'cloud-test-token' });
  st = await api('/api/state');
  const acct = st.accounts.find((a) => a.id === id);
  check(acct && acct.basicId === '@cloudtest', `帳號 ${acct && acct.displayName}（${acct && acct.basicId}）`);
  check(acct.webhookURL === `${BASE}/webhook/${acct.slug}`, `Webhook 網址＝Worker 網址：${acct.webhookURL}`);
  let d;
  for (let i = 0; i < 40; i++) { d = await api(`/api/data?account=${id}`); if (d.faqs.length > 20 && defMenu) break; await new Promise((x) => setTimeout(x, 250)); }
  check(d.faqs.length >= 90, `軍規知識庫自動產生：${d.faqs.length} 題 FAQ`);
  check(!!defMenu, '圖文選單已套用');

  console.log('\n③ LINE 提問（FAQ 與卡片，不需要 AI）');
  const slug = acct.slug;
  let m = await ask(slug, 'P5 有通過哪些軍規測試？');
  check(m.type === 'flex' && textOf(m).includes('P5405CSA'), 'P5 通過哪些測試 → 卡片', textOf(m).slice(0, 40));
  m = await ask(slug, '比較型號');
  const firsts = m.quickReply ? m.quickReply.items.map((x) => x.action.text) : [];
  check(firsts.length === 5, `比較型號 → ${firsts.length} 個選項`);
  m = await ask(slug, 'P5 跟 B5 差在哪');
  check(m.type === 'flex' && /P5405CSA/.test(JSON.stringify(m.contents)), 'P5 跟 B5 差在哪 → 比較表卡片');
  const bad1 = await fetch(`${BASE}/webhook/${slug}`, { method: 'POST', headers: { 'x-line-signature': 'wrong', 'Content-Type': 'application/json' }, body: '{"events":[]}' });
  check(bad1.status === 401, '簽章錯誤的 webhook 被拒絕');

  console.log('\n④ 綁定管理者、轉真人、#代碼回覆');
  m = await ask(slug, `綁定 ${acct.bindCode}`, 'Uowner');
  check(textOf(m).includes('綁定成功'), '綁定成功');
  const before = sent.length;
  m = await ask(slug, '我想找專人', 'Ucust');
  await new Promise((x) => setTimeout(x, 800));
  const notice = sent.slice(before).find((x) => x.url.endsWith('/push') && x.to === 'Uowner');
  check(textOf(m).includes('專人') && !!notice, '顧客轉真人，管理者收到推播');
  const code = (/#([A-Z0-9]{4})/.exec(notice ? notice.messages[0].text : '') || [])[1];
  m = await ask(slug, `#${code} 您好，我是業務`, 'Uowner');
  await new Promise((x) => setTimeout(x, 500));
  check(sent.some((x) => x.url.endsWith('/push') && x.to === 'Ucust' && x.messages[0].text === '您好，我是業務'), '#代碼 回覆轉給顧客');
  check(m.type === 'template' && JSON.stringify(m).includes('交還 AI'), '回覆後有「交還 AI」按鈕');

  console.log('\n⑤ Excel 匯入（假資料排程表）');
  const xlsx = path.join(here, '../../windows/test/fixtures/schedule_sample.xlsx');
  const parsed = await api('/api/mil/excel/parse', { account: id, base64: fs.readFileSync(xlsx).toString('base64') });
  check(parsed.projects.length === 6, `識別出 ${parsed.projects.length} 個專案`);
  const pick = parsed.projects.filter((p) => p.include && p.action === 'new');
  const applied = await api('/api/mil/excel/apply', { account: id, items: pick.map((p) => ({ code: p.code, series: p.series, passed: p.passed })) });
  check(applied.added === pick.length, `匯入 ${applied.added} 款新機種`);
  const g = await api('/api/mil/generate', { account: id });
  check(g.faqs > 100, `重新產生知識庫：${g.faqs} 題`);
  m = await ask(slug, 'ZX1001AA 通過哪些測試');
  check(textOf(m).includes('ZX1001AA'), '新機種馬上問得到');

  console.log('\n⑥ 資料保存（Durable Object 重新啟動後還在）');
  d = await api(`/api/data?account=${id}`);
  check(Object.keys(d.conversations || {}).length >= 0 && d.mil.catalog.models.length === 5 + pick.length, `機種 ${d.mil.catalog.models.length} 款都存著`);

  line.close();
  console.log(`\n結果：${ok} 項通過、${bad} 項失敗`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); line.close(); process.exit(1); });
