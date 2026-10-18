'use strict';
// 共用小工具：字數一律用「字元」計算（跟 Mac 版 Swift 的 String.count 一致）

const crypto = require('crypto');

const chars = (s) => Array.from(s || '');
const count = (s) => chars(s).length;
const prefix = (s, n) => {
  const a = chars(s);
  return a.length <= n ? (s || '') : a.slice(0, n).join('');
};
const suffix = (s, n) => {
  const a = chars(s);
  return a.length <= n ? (s || '') : a.slice(a.length - n).join('');
};

/// 跟 Swift UUID().uuidString 一樣用大寫，資料檔可以跟 Mac 版互通
const uuid = () => crypto.randomUUID().toUpperCase();

/// ISO 8601 不帶毫秒（Swift 的 .iso8601 解不開毫秒）
const iso = (d = new Date()) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
const toDate = (v) => (v ? new Date(v) : null);

const pad2 = (n) => String(n).padStart(2, '0');

/// 本地日期 yyyy-MM-dd（每日統計的 key）
const dayKey = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
};

const sameDay = (a, b) => dayKey(a) === dayKey(b);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class TimeoutError extends Error {
  constructor(seconds) {
    super(`AI 超過 ${Math.round(seconds)} 秒沒有回應`);
    this.name = 'TimeoutError';
    this.seconds = seconds;
  }
}

/// 幫非同步工作加上時間上限；逾時會呼叫 AbortController 讓 fetch 停下來
function withTimeout(seconds, work) {
  const ctrl = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new TimeoutError(seconds));
    }, seconds * 1000);
  });
  return Promise.race([Promise.resolve().then(() => work(ctrl.signal)), timeout]).finally(() => clearTimeout(timer));
}

/// 短時間顯示：今天只顯示時間，其他顯示月/日
function shortDisplay(d) {
  if (!d) return '';
  const x = new Date(d);
  const t = `${pad2(x.getHours())}:${pad2(x.getMinutes())}`;
  return sameDay(x, new Date()) ? t : `${x.getMonth() + 1}/${x.getDate()} ${t}`;
}

module.exports = { chars, count, prefix, suffix, uuid, iso, toDate, pad2, dayKey, sameDay, sleep, TimeoutError, withTimeout, shortDisplay };
