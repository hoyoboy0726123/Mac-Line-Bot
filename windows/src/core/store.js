'use strict';
// 所有資料都存在這台電腦：Windows 是 %APPDATA%\<產品名稱>\data
// 檔案格式跟 Mac 版相同（settings.json、accounts.json、accounts/<id>.json…）

const fs = require('fs');
const path = require('path');
const { edition } = require('./models');

let base = null;
/// 機密資料加解密（Electron 會換成 Windows DPAPI 的 safeStorage）
let cipher = null;

function setBase(dir) {
  base = dir;
  fs.mkdirSync(base, { recursive: true });
}

function baseDir() {
  if (!base) setBase(process.env.MLB_DATA_DIR || path.join(process.cwd(), 'data'));
  return base;
}

const sub = (name) => { const p = path.join(baseDir(), name); fs.mkdirSync(p, { recursive: true }); return p; };
const accountsDir = () => sub('accounts');
const binDir = () => sub('bin');
const logFile = () => path.join(baseDir(), edition.edition === 'mil' ? 'maclinebot-mil.log' : 'maclinebot.log');

function load(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  try {
    return JSON.parse(text);
  } catch {
    // 解不開就先備份，避免被新格式覆蓋掉
    try { fs.copyFileSync(file, `${file}.bak-${Math.floor(Date.now() / 1000)}`); } catch { /* 略過 */ }
    return null;
  }
}

/// 先寫暫存檔再改名，斷電也不會留下寫一半的檔案
function save(value, file) {
  try {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error('save failed', file, e.message);
  }
}

// MARK: 設定 / 帳號

const settingsFile = () => path.join(baseDir(), 'settings.json');
const loadSettings = () => load(settingsFile());
const saveSettings = (s) => save(s, settingsFile());

const SECRET_FIELDS = ['channelSecret', 'channelAccessToken'];

function loadAccounts() {
  const list = load(path.join(baseDir(), 'accounts.json')) || [];
  for (const a of list) {
    a.channelSecret = secrets.get(`secret-${a.id}`) || '';
    a.channelAccessToken = secrets.get(`token-${a.id}`) || '';
  }
  return list;
}

function saveAccounts(accounts) {
  const plain = accounts.map((a) => {
    const c = { ...a };
    for (const f of SECRET_FIELDS) delete c[f];
    return c;
  });
  save(plain, path.join(baseDir(), 'accounts.json'));
  for (const a of accounts) {
    secrets.set(`secret-${a.id}`, a.channelSecret || '');
    secrets.set(`token-${a.id}`, a.channelAccessToken || '');
  }
}

function deleteAccountFiles(id) {
  try { fs.unlinkSync(path.join(accountsDir(), `${id}.json`)); } catch { /* 沒有就算了 */ }
  try { fs.unlinkSync(path.join(baseDir(), `mil-catalog-${id}.json`)); } catch { /* 沒有就算了 */ }
  secrets.set(`secret-${id}`, '');
  secrets.set(`token-${id}`, '');
}

const loadData = (id) => load(path.join(accountsDir(), `${id}.json`));
const saveData = (d, id) => save(d, path.join(accountsDir(), `${id}.json`));
const loadMILCatalog = (id) => load(path.join(baseDir(), `mil-catalog-${id}.json`));
const saveMILCatalog = (c, id) => save(c, path.join(baseDir(), `mil-catalog-${id}.json`));

function appendLog(line) {
  try { fs.appendFileSync(logFile(), line + '\n'); } catch { /* 略過 */ }
}

// MARK: 機密資料（Channel secret / token / tunnel token / 管理密碼）

const secrets = {
  file: () => path.join(baseDir(), 'secrets.json'),
  setCipher(c) { cipher = c; },
  readAll() {
    const raw = load(this.file()) || {};
    // 加密格式：{ "$enc": "base64" }；Mac 版是明文 { key: value }
    if (raw.$enc && cipher) {
      try { return JSON.parse(cipher.decrypt(Buffer.from(raw.$enc, 'base64'))); } catch { return {}; }
    }
    return raw.$enc ? {} : raw;
  },
  writeAll(dict) {
    const value = cipher ? { $enc: cipher.encrypt(JSON.stringify(dict)).toString('base64') } : dict;
    save(value, this.file());
    try { fs.chmodSync(this.file(), 0o600); } catch { /* Windows 不支援 */ }
  },
  get(key) { return this.readAll()[key]; },
  set(key, value) {
    const d = this.readAll();
    if (value) d[key] = value; else delete d[key];
    this.writeAll(d);
  },
};

module.exports = {
  setBase, baseDir, accountsDir, binDir, logFile, load, save,
  loadSettings, saveSettings, loadAccounts, saveAccounts, deleteAccountFiles,
  loadData, saveData, loadMILCatalog, saveMILCatalog, appendLog, secrets,
};
