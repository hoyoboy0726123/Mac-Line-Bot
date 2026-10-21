'use strict';
// 型號比較：顧客問的時候才即時產生（對照 Mac 版 MILCompare.swift）
// 以前每兩台預先存一題 FAQ，型號一多就爆量（41 款 = 820 題）；現在只存型號資料，問到才算。
//
// 圖文選單「比較型號」的兩步選：
//   13 款以內：先選第一台 → 再選另一台（跟以前一樣）
//   超過 13 款（LINE 快速選項最多 13 個）：先選系列 → 選第一台 → 同系列的直接列、其他系列再點進去選 → 比較表
//   清單太長會分頁，最後一個按鈕是「第 N 頁」

const { normalize } = require('../retriever');
const C = require('./catalog');
const F = require('./flex');
const G = require('./generator');

const MAX = 13; // LINE 快速選項上限
const PAGE = 12; // 分頁時每頁 12 個 + 「下一頁」
const START_WORDS = ['比較型號', '型號比較', '比較機種', '機種比較', '比一比'];

/// 系列：型號開頭的英文字＋第一個數字（P5405CSA → P5、BM3406CHA → BM3、B1400／B1500 → B1）
const groupOf = (m) => ((/^[A-Za-z]+\d/.exec(m.code) || [m.code])[0]).toUpperCase();

function groups(c) {
  const out = [];
  for (const m of c.models) {
    const name = groupOf(m);
    let g = out.find((x) => x.name === name);
    if (!g) { g = { name, models: [] }; out.push(g); }
    g.models.push(m);
  }
  return out;
}

/// 顧客怎麼稱呼這台：型號別名；沒有別名就用系列的叫法
function terms(c, m) {
  if (m.aliases.length) return m.aliases;
  const f = C.familyOf(c, m);
  return f ? f.aliases : [m.code];
}

/// 問題裡提到哪些型號（依出現順序）。長的叫法優先，「B1400CBA」不會被當成「B1400」
function resolve(c, text) {
  const t = normalize(text);
  const hits = [];
  c.models.forEach((m, i) => {
    for (const term of terms(c, m)) {
      const n = normalize(term);
      if ([...n].length < 2) continue;
      for (let at = t.indexOf(n); at >= 0; at = t.indexOf(n, at + 1)) hits.push({ start: at, end: at + n.length, model: i });
    }
  });
  hits.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start || a.model - b.model);
  const taken = [];
  for (const h of hits) if (!taken.some((x) => h.start < x.end && x.start < h.end)) taken.push(h);
  taken.sort((a, b) => a.start - b.start);
  const out = [];
  for (const h of taken) if (!out.includes(h.model)) out.push(h.model);
  return { models: out.map((i) => c.models[i]), covered: taken.reduce((n, h) => n + (h.end - h.start), 0), length: t.length };
}

/// 清單超過 13 個就分頁：每頁 12 個，最後一個按鈕到下一頁
function paged(items, page, more) {
  if (items.length <= MAX) return items;
  const start = (page - 1) * PAGE;
  const list = items.slice(start, start + PAGE);
  if (start + PAGE < items.length) list.push(more(page + 1));
  return list;
}

const label = F.pairLabel;
const pickFirst = (c, m) => `比較 ${label(c, m)}`;
const pair = (c, a, b) => `${label(c, a)} vs ${label(c, b)}`;

/// 第一步：選第一台（太多就先選系列）
function startList(c) {
  if (c.models.length <= MAX) return c.models.map((m) => pickFirst(c, m));
  return groups(c).map((g) => (g.models.length === 1 ? pickFirst(c, g.models[0]) : `比較 ${g.name} 系列`));
}

/// 第二步：選要比的另一台（太多就同系列先列、其他系列點進去選）
function withList(c, m) {
  if (c.models.length <= MAX) return c.models.filter((x) => x !== m).map((x) => pair(c, m, x));
  const mine = groupOf(m);
  const out = groups(c).find((g) => g.name === mine).models.filter((x) => x !== m).map((x) => pair(c, m, x));
  for (const g of groups(c)) {
    if (g.name === mine) continue;
    out.push(g.models.length === 1 ? pair(c, m, g.models[0]) : `${label(c, m)} 比 ${g.name} 系列`);
  }
  return out;
}

const findGroup = (c, name) => groups(c).find((g) => g.name === normalize(name).toUpperCase()) || null;

/// 只有一台、而且整句就只是那台的叫法（「比較 P5」的「P5」）
function onlyModel(c, text) {
  const r = resolve(c, text);
  return r.models.length === 1 && r.covered === r.length ? r.models[0] : null;
}

/// 兩台比較：照型號清單的順序排（跟以前預先產生的題目一樣）
function compareOf(c, a, b) {
  const [x, y] = c.models.indexOf(a) <= c.models.indexOf(b) ? [a, b] : [b, a];
  return { question: `${x.code} 和 ${y.code} 比較`, answer: G.compare(c, x, y), flex: F.json(F.compare(c, x, y)), quickReplies: [] };
}

/// 處理比較相關的訊息；不是比較題回 null
/// 回傳 { question, answer, flex, quickReplies }
function handle(c, text) {
  if (!c || c.models.length < 2) return null;
  let body = (text || '').trim();
  let page = 1;
  const pm = /\s*第\s*(\d+)\s*頁$/.exec(body);
  if (pm) { page = Math.max(1, Number(pm[1])); body = body.slice(0, pm.index).trim(); }

  // 「比較 B3 系列」：列出這個系列的型號
  let m = /^比較\s*(.+?)\s*系列$/.exec(body);
  if (m) {
    const g = findGroup(c, m[1]);
    if (g) {
      return {
        question: `比較 ${g.name} 系列`, answer: `${g.name} 系列有 ${g.models.length} 款，要先選哪一台呢？👇`, flex: null,
        quickReplies: paged(g.models.map((x) => pickFirst(c, x)), page, (n) => `比較 ${g.name} 系列 第${n}頁`),
      };
    }
  }
  // 「P5405CSA 比 B3 系列」：選另一個系列裡的型號
  m = /^(.+?)\s*比\s*(.+?)\s*系列$/.exec(body);
  if (m) {
    const a = onlyModel(c, m[1]), g = findGroup(c, m[2]);
    if (a && g) {
      return {
        question: `${label(c, a)} 比 ${g.name} 系列`, answer: `要拿 ${a.display} 跟 ${g.name} 系列的哪一台比較呢？👇`, flex: null,
        quickReplies: paged(g.models.filter((x) => x !== a).map((x) => pair(c, a, x)), page, (n) => `${label(c, a)} 比 ${g.name} 系列 第${n}頁`),
      };
    }
  }
  const r = resolve(c, body);
  // 兩台以上：直接給比較表
  if (r.models.length >= 2) return compareOf(c, r.models[0], r.models[1]);
  // 「比較 P5405CSA」：選要比的另一台
  m = /^比較\s*(.+)$/.exec(body);
  if (m) {
    const a = onlyModel(c, m[1]);
    if (a) {
      return {
        question: pickFirst(c, a), answer: `要拿 ${a.display} 跟哪一台比較呢？👇`, flex: null,
        quickReplies: paged(withList(c, a), page, (n) => `${pickFirst(c, a)} 第${n}頁`),
      };
    }
  }
  // 「比較型號」：第一步
  const nb = normalize(body);
  if (!r.models.length && START_WORDS.some((w) => nb.includes(normalize(w)))) {
    const grouped = c.models.length > MAX;
    return {
      question: '比較型號',
      answer: grouped
        ? `目前有 ${c.models.length} 款，想比較哪兩台呢？先選第一台的系列 👇\n也可以直接輸入例如「P5 跟 B5 差在哪」🙂`
        : '想比較哪兩台呢？先選第一台 👇\n也可以直接輸入例如「P5 跟 B5 差在哪」🙂',
      flex: null,
      quickReplies: paged(startList(c), page, (n) => `比較型號 第${n}頁`),
    };
  }
  return null;
}

module.exports = { handle, resolve, groups, groupOf, startList, withList, MAX, PAGE };
