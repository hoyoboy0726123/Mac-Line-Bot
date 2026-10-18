'use strict';
// 規則式抽取日期 / 時間 / 人數 / 電話（對照 Mac 版 ReservationParser.swift）

const { pad2 } = require('./util');

const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
const chineseDigits = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function chineseNumber(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const a = [...s];
  if (s === '十') return 10;
  if (a[0] === '十' && a.length > 1 && chineseDigits[a[a.length - 1]] != null) return 10 + chineseDigits[a[a.length - 1]];
  if (a.length === 2 && a[1] === '十' && chineseDigits[a[0]] != null) return chineseDigits[a[0]] * 10;
  if (a.length === 3 && a[1] === '十' && chineseDigits[a[0]] != null && chineseDigits[a[2]] != null) return chineseDigits[a[0]] * 10 + chineseDigits[a[2]];
  if (a.length === 1 && chineseDigits[a[0]] != null) return chineseDigits[a[0]];
  return null;
}

const match = (re, text) => { const m = re.exec(text); return m ? m.map((x) => x || '') : null; };

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const display = (d) => `${d.getMonth() + 1}/${d.getDate()}（週${weekdayNames[d.getDay()]}）`;

function date(text, now = new Date()) {
  const today = startOfDay(now);
  let m = match(/(\d{1,2})\s*[/／月]\s*(\d{1,2})/, text);
  if (m) {
    const month = parseInt(m[1], 10), day = parseInt(m[2], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let d = new Date(now.getFullYear(), month - 1, day);
      if (d < today) d = new Date(now.getFullYear() + 1, month - 1, day);
      return display(d);
    }
  }
  const relative = [['大後天', 3], ['後天', 2], ['明天', 1], ['明日', 1], ['今天', 0], ['今晚', 0], ['今日', 0]];
  for (const [word, offset] of relative) if (text.includes(word)) return display(addDays(today, offset));
  m = match(/(下下|下個?|這個?|本)?\s*(週|周|星期|禮拜)\s*([一二三四五六日天])/, text);
  if (m) {
    const p = m[1];
    const target = m[3] === '天' ? 0 : Math.max(0, weekdayNames.indexOf(m[3]));
    const current = today.getDay();
    let diff = (target - current + 7) % 7;
    if (p.startsWith('下下')) diff += 14;
    else if (p.startsWith('下')) diff += 7;
    return display(addDays(today, diff));
  }
  return null;
}

function time(text) {
  const re = /(凌晨|早上|上午|中午|下午|傍晚|晚上|晚間)?\s*(\d{1,2}|[一二兩三四五六七八九十]{1,3})\s*(?:[:：]\s*(\d{2})|點\s*(半|\d{1,2}\s*分|\d{2}(?![位人名]))?)/;
  const m = match(re, text);
  if (!m) return null;
  let hour = chineseNumber(m[2]);
  if (hour == null) return null;
  let minute = 0;
  if (m[3]) minute = parseInt(m[3], 10) || 0;
  else if (m[4] === '半') minute = 30;
  else if (m[4]) minute = parseInt(m[4].replace('分', '').trim(), 10) || 0;
  if (['下午', '傍晚', '晚上', '晚間'].includes(m[1])) { if (hour < 12) hour += 12; else if (hour === 24) hour = 0; }
  else if (m[1] === '中午') { if (hour < 6) hour += 12; }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${pad2(hour)}:${pad2(minute)}`;
}

function people(text) {
  const m = match(/(\d{1,3}|[一二兩三四五六七八九十]{1,3})\s*(?:位|個人|人|大人|名)/, text);
  return m ? chineseNumber(m[1]) : null;
}

function phone(text) {
  const m = match(/(09\d{2})[- ]?(\d{3})[- ]?(\d{3})/, text);
  return m ? m[1] + m[2] + m[3] : null;
}

/// 顧客回的是不是單純名字（沒有數字、夠短）
function looksLikeName(text) {
  const t = (text || '').trim();
  const n = [...t].length;
  return n >= 1 && n <= 12 && !/\d/.test(t);
}

function fill(draft, text) {
  const d = date(text); if (d) draft.date = d;
  const t = time(text); if (t) draft.time = t;
  const p = people(text); if (p != null) draft.people = p;
  const ph = phone(text); if (ph) draft.phone = ph;
}

module.exports = { chineseNumber, display, date, time, people, phone, looksLikeName, fill };
