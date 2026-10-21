'use strict';
// 雲端版的存檔：取代 windows/src/core/store.js（介面相同）
// Durable Object 啟動時把所有資料一次讀進記憶體（cache），之後讀取都是同步的；
// 寫入時更新 cache，並非同步寫回 Durable Object 的儲存空間。

/// 單一值太大時切成好幾段存（Durable Object 單一值有大小上限）
const CHUNK = 400000;

let cache = new Map();
let storage = null; // DurableObjectStorage

/// Durable Object 啟動時呼叫：讀出全部資料
async function init(st) {
  storage = st;
  cache = new Map();
  const all = await st.list({ prefix: 'json:' });
  const parts = new Map();
  for (const [k, v] of all) {
    const m = /^json:(.+?)#(\d+)$/.exec(k);
    if (!m) continue;
    if (!parts.has(m[1])) parts.set(m[1], []);
    parts.get(m[1])[Number(m[2])] = v;
  }
  for (const [name, list] of parts) {
    const meta = list[0];
    if (!meta || typeof meta !== 'object') continue;
    const text = list.slice(1, meta.n + 1).join('');
    try { cache.set(name, JSON.parse(text)); } catch { /* 壞掉的略過 */ }
  }
}

function load(name) {
  const v = cache.get(name);
  return v === undefined ? null : v;
}

/// 寫入：先改記憶體，再寫回儲存空間（切段）
function save(value, name) {
  cache.set(name, value);
  if (!storage) return;
  const text = JSON.stringify(value);
  const n = Math.max(1, Math.ceil(text.length / CHUNK));
  const entries = { [`json:${name}#0`]: { n, at: Date.now() } };
  for (let i = 0; i < n; i++) entries[`json:${name}#${i + 1}`] = text.slice(i * CHUNK, (i + 1) * CHUNK);
  storage.put(entries).catch((e) => console.error('save failed', name, e.message));
  // 之前比較長、這次變短：刪掉多出來的段落
  storage.list({ prefix: `json:${name}#` }).then((old) => {
    const extra = [...old.keys()].filter((k) => Number(k.split('#')[1]) > n);
    if (extra.length) storage.delete(extra);
  }).catch(() => {});
}

function remove(name) {
  cache.delete(name);
  if (!storage) return;
  storage.list({ prefix: `json:${name}#` }).then((old) => storage.delete([...old.keys()])).catch(() => {});
}

const baseDir = () => 'Cloudflare Durable Object';
const setBase = () => {};
const accountsDir = baseDir;
const binDir = baseDir;
const logFile = () => '';

// MARK: 設定 / 帳號（跟桌面版一樣：金鑰分開存）

const loadSettings = () => load('settings');
const saveSettings = (s) => save(s, 'settings');
const SECRET_FIELDS = ['channelSecret', 'channelAccessToken'];

function loadAccounts() {
  const list = load('accounts') || [];
  for (const a of list) {
    a.channelSecret = secrets.get(`secret-${a.id}`) || '';
    a.channelAccessToken = secrets.get(`token-${a.id}`) || '';
  }
  return list;
}

function saveAccounts(accounts) {
  save(accounts.map((a) => {
    const c = { ...a };
    for (const f of SECRET_FIELDS) delete c[f];
    return c;
  }), 'accounts');
  const d = secrets.readAll();
  for (const a of accounts) {
    for (const [k, v] of [[`secret-${a.id}`, a.channelSecret], [`token-${a.id}`, a.channelAccessToken]]) {
      if (v) d[k] = v; else delete d[k];
    }
  }
  secrets.writeAll(d);
}

function deleteAccountFiles(id) {
  remove(`data-${id}`);
  remove(`mil-catalog-${id}`);
  secrets.set(`secret-${id}`, '');
  secrets.set(`token-${id}`, '');
}

const loadData = (id) => load(`data-${id}`);
const saveData = (d, id) => save(d, `data-${id}`);
const loadMILCatalog = (id) => load(`mil-catalog-${id}`);
const saveMILCatalog = (c, id) => save(c, `mil-catalog-${id}`);

/// 雲端沒有日誌檔：最近的日誌在 App.logs（Durable Object 記憶體）
function appendLog() {}

// 機密資料：存在 Durable Object 儲存空間（Cloudflare 會加密存放），不會傳回瀏覽器
const secrets = {
  setCipher() {},
  readAll() { return { ...(load('secrets') || {}) }; },
  writeAll(dict) { save(dict, 'secrets'); },
  get(key) { return this.readAll()[key]; },
  set(key, value) {
    const d = this.readAll();
    if (value) d[key] = value; else delete d[key];
    this.writeAll(d);
  },
};

module.exports = {
  init, setBase, baseDir, accountsDir, binDir, logFile, load, save, remove,
  loadSettings, saveSettings, loadAccounts, saveAccounts, deleteAccountFiles,
  loadData, saveData, loadMILCatalog, saveMILCatalog, appendLog, secrets,
};
