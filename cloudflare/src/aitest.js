// 雲端 AI 實測用（只部署到測試 Worker mac-line-bot-mil-aitest，正式版不會用到）
// 假 LINE 伺服器直接做在 Worker 裡：MLB_LINE_API 指到 https://fake-line.test，送出的回覆記在記憶體，用 /aitest/sent 讀
import worker, { Main as Base } from './worker.js';
import { sessionOK } from './auth.js';

const sent = [];
const menus = {};
let defMenu = null;
const realFetch = globalThis.fetch;
const reply = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

async function fakeLine(u, init = {}) {
  const p = u.pathname;
  const method = (init.method || 'GET').toUpperCase();
  let j = {};
  try { j = typeof init.body === 'string' ? JSON.parse(init.body) : {}; } catch { /* 圖片 */ }
  if (p === '/v2/bot/info') return reply({ userId: 'Ubot', basicId: '@aitest', displayName: 'AI 測試帳號' });
  if (p.startsWith('/v2/bot/profile/')) return reply({ displayName: '測試顧客' });
  if (p === '/v2/bot/message/reply' || p === '/v2/bot/message/push') { sent.push({ url: p, at: Date.now(), ...j }); return reply({}); }
  if (p === '/v2/bot/channel/webhook/test') return reply({ success: true, statusCode: 200, reason: 'OK', detail: '200' });
  if (p === '/v2/bot/richmenu/list') return reply({ richmenus: Object.values(menus) });
  if (p === '/v2/bot/user/all/richmenu' && method === 'GET') return defMenu ? reply({ richMenuId: defMenu }) : reply({}, 404);
  if (p.startsWith('/v2/bot/user/all/richmenu/')) { defMenu = p.split('/').pop(); return reply({}); }
  if (p === '/v2/bot/richmenu' && method === 'POST') { const id = `rm${Object.keys(menus).length + 1}`; menus[id] = { ...j, richMenuId: id }; return reply({ richMenuId: id }); }
  return reply({});
}

globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.host === 'fake-line.test') return fakeLine(url, init);
  return realFetch(input, init);
};

export class Main extends Base {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/aitest/sent') {
      const since = Number(url.searchParams.get('since') || 0);
      return reply({ total: sent.length, items: sent.slice(since) });
    }
    return super.fetch(request);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/aitest/')) {
      if (!(await sessionOK(env, request))) return reply({ error: '請先登入' }, 401);
      return env.MAIN.get(env.MAIN.idFromName('main')).fetch(request);
    }
    return worker.fetch(request, env, ctx);
  },
};
