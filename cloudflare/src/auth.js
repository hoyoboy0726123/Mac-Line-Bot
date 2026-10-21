// 管理登入：密碼放在 Cloudflare Secret（ADMIN_PASSWORD），程式碼與資料裡都不會有密碼
// 登入後發一個有簽章的 Cookie（7 天），換密碼後舊的 Cookie 會全部失效

const COOKIE = 'mlb_session';
const DAYS = 7;
const enc = new TextEncoder();

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(`mlb-session:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/// 固定時間比較，避免從回應時間猜出密碼
async function sameText(a, b) {
  const [x, y] = await Promise.all([hmac('cmp', a), hmac('cmp', b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0 && x.length === y.length;
}

export async function checkLogin(env, password) {
  const real = env.ADMIN_PASSWORD;
  if (!real || [...real].length < 8) return { error: '尚未設定管理密碼（請執行 wrangler secret put ADMIN_PASSWORD，至少 8 個字）' };
  return { ok: typeof password === 'string' && (await sameText(password, real)) };
}

export async function issueCookie(env) {
  const exp = Date.now() + DAYS * 86400000;
  const value = `${exp}.${await hmac(env.ADMIN_PASSWORD, String(exp))}`;
  return `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${DAYS * 86400}`;
}

export const clearCookie = () => `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

export async function sessionOK(env, request) {
  if (!env.ADMIN_PASSWORD) return false;
  const raw = (request.headers.get('cookie') || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
  if (!raw) return false;
  const [exp, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return sameText(sig, await hmac(env.ADMIN_PASSWORD, exp));
}
