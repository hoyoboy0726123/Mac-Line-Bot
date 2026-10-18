'use strict';
// 軍規 FAQ 的 LINE Flex 卡片（對照 Mac 版 MILFlex.swift，兩邊產生的 JSON 內容相同）
// 只用在「由資料產生」的答案；AI 的回答維持純文字。

const C = require('./catalog');

const GREEN = '#06C755', GRAY = '#8C8C8C', LIGHT = '#C7C7CC', ORANGE = '#FF9500', TEXT = '#333333';
const NOTE = '※ 以華碩官方測試報告為準';
const LEGEND = '✓ 通過（數字＝通過的程序數）　說明＝只在測試說明列出　— 報告中沒有';

const text = (t, o = {}) => ({ type: 'text', text: t, wrap: true, ...o });
const box = (layout, contents, o = {}) => ({ type: 'box', layout, contents, ...o });
const sep = (margin) => (margin ? { type: 'separator', margin } : { type: 'separator' });
const button = (label, msg) => ({ type: 'button', style: 'link', height: 'sm', action: { type: 'message', label, text: msg } });

function header(small, big) {
  return box('vertical', [text(small, { size: 'xs', color: '#FFFFFF' }), text(big, { size: 'lg', weight: 'bold', color: '#FFFFFF' })],
    { backgroundColor: GREEN, paddingAll: '16px' });
}

/// 表格的一格：通過 ✓（部分通過顯示 n/m）、說明另列、或沒有
function cell(m, t) {
  const p = C.passes(m, t), d = C.described(m, t), n = t.procedures.length;
  if (p.length) return { label: n > 1 && p.length < n ? `✓ ${p.length}/${n}` : '✓', color: GREEN };
  if (d.length) return { label: '說明', color: ORANGE };
  return { label: '—', color: LIGHT };
}

const cellText = (c, flex) => text(c.label, { size: 'sm', align: 'center', color: c.color, weight: 'bold', flex });

/// 問這台的總表／某項細節要送出的文字（要剛好對到 FAQ 的問題）
function summaryQuestion(c, m) {
  if (m.aliases.length) return `${m.code} 通過哪些測試`;
  const f = C.familyOf(c, m);
  return f && C.multiFamilies(c).some((x) => x.name === f.name) ? `${f.name} 通過哪些測試` : null;
}

function detailQuestion(c, m, t) {
  if (m.aliases.length) return `${m.code} ${t.short}測試`;
  const f = C.familyOf(c, m);
  return f && C.multiFamilies(c).some((x) => x.name === f.name) ? `${f.name} ${t.short}測試` : null;
}

function footer(buttons) {
  return buttons.length ? box('vertical', buttons, { spacing: 'none' }) : null;
}

function bubble(h, body, f) {
  const b = { type: 'bubble', size: 'mega', header: h, body };
  if (f) b.footer = f;
  return b;
}

// MARK: 兩台比較：表格

function compare(c, a, b) {
  const rows = [
    box('horizontal', [
      text('測試項目', { size: 'xs', color: GRAY, weight: 'bold', flex: 4 }),
      text(a.code, { size: 'xs', color: GRAY, weight: 'bold', flex: 3, align: 'center' }),
      text(b.code, { size: 'xs', color: GRAY, weight: 'bold', flex: 3, align: 'center' }),
    ]),
    sep(),
  ];
  for (const t of C.allTests(c)) {
    rows.push(box('horizontal', [text(t.short, { size: 'sm', color: TEXT, flex: 4 }), cellText(cell(a, t), 3), cellText(cell(b, t), 3)]));
  }
  rows.push(sep('md'), text(LEGEND, { size: 'xxs', color: GRAY, margin: 'md' }), text(NOTE, { size: 'xxs', color: GRAY }));
  const buttons = [];
  for (const m of [a, b]) {
    const q = summaryQuestion(c, m);
    if (q && !buttons.some((x) => x.action.text === q)) buttons.push(button(`${m.code} 全部項目`, q));
  }
  return bubble(header('軍規測試比較', `${a.code} vs ${b.code}`), box('vertical', rows, { spacing: 'sm' }), footer(buttons));
}

// MARK: 單一測試：條件 + 通過型號

function test(c, t) {
  const rows = [text('測試條件', { size: 'sm', weight: 'bold', color: TEXT })];
  for (const p of t.procedures) {
    rows.push(box('vertical', [text(p.label, { size: 'sm', color: TEXT }), text(p.detail, { size: 'xs', color: GRAY })], { margin: 'sm' }));
  }
  rows.push(sep('lg'), text('通過型號', { size: 'sm', weight: 'bold', color: TEXT, margin: 'lg' }));
  const passed = c.models.filter((m) => C.passes(m, t).length);
  for (const m of passed) {
    const labels = C.passes(m, t).map((p) => C.procedure(t, p)).filter(Boolean).map((p) => p.label).join('、');
    rows.push(box('horizontal', [text(m.code, { size: 'sm', weight: 'bold', color: GREEN, flex: 3 }), text(labels, { size: 'xs', color: GRAY, flex: 5 })], { margin: 'sm' }));
  }
  if (!passed.length) {
    const desc = c.models.filter((m) => C.described(m, t).length).map((m) => m.code);
    rows.push(text('結果總表中沒有型號列出此項' + (desc.length ? `（${desc.join('、')} 的測試說明有列出）` : ''), { size: 'xs', color: GRAY, margin: 'sm' }));
  }
  rows.push(text(NOTE, { size: 'xxs', color: GRAY, margin: 'lg' }));
  const buttons = [];
  for (const m of passed) {
    const q = detailQuestion(c, m, t);
    if (!q || buttons.length >= 4 || buttons.some((x) => x.action.text === q)) continue;
    const who = m.aliases.length ? m.code : C.familyOf(c, m).name;
    buttons.push(button(`${who} 細節`, q));
  }
  return bubble(header(`MIL-STD-810H Method ${t.code}`, `${t.short}測試`), box('vertical', rows, { spacing: 'xs' }), footer(buttons));
}

// MARK: 單一型號：每項測試的結果

function model(c, m) {
  const rows = [];
  for (const t of C.allTests(c)) {
    rows.push(box('horizontal', [
      text(t.short, { size: 'sm', color: TEXT, flex: 4 }),
      text(t.code, { size: 'xs', color: GRAY, flex: 2, align: 'center' }),
      cellText(cell(m, t), 2),
    ]));
  }
  rows.push(sep('md'), text(LEGEND, { size: 'xxs', color: GRAY, margin: 'md' }), text(NOTE, { size: 'xxs', color: GRAY }));
  return bubble(header(`${m.standard} 軍規測試`, m.display), box('vertical', rows, { spacing: 'sm' }), footer([button('和其他型號比較', '比較型號')]));
}

/// 比較型號的快速選項：「P5405CSA vs B5302C」
function pairLabel(c, m) {
  if (m.aliases.includes(m.code)) return m.code;
  if (m.aliases.length) return m.aliases[0];
  const f = C.familyOf(c, m);
  return f && f.aliases.length ? f.aliases[0] : m.code;
}

/// 比較型號第一步：選第一台（送出「比較 P5405CSA」）
const compareStart = (c) => c.models.slice(0, 13).map((m) => `比較 ${pairLabel(c, m)}`);

/// 比較型號第二步：選要比的另一台（送出「P5405CSA vs B5302C」）
const compareWith = (c, m) => c.models.filter((x) => x !== m).slice(0, 13).map((x) => `${pairLabel(c, m)} vs ${pairLabel(c, x)}`);

/// 物件的 key 排序後轉 JSON（Mac 版用 sortedKeys，兩邊字串一樣）
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  return v;
}
const json = (v) => JSON.stringify(stable(v));

module.exports = { compare, test, model, compareStart, compareWith, pairLabel, json, summaryQuestion, detailQuestion };
