'use strict';
// 讀 QTR 的「MIL-STD-810H 測試排程表」Excel（對照 Mac 版 MILScheduleImport.swift）
//
// 格式（每個工作表都一樣，專案會一直往右加）：
//   D 欄是標籤：「測試類別」「年分」「系列」「Project」…「Method 500.6-Procedure I」…「測試總數」
//   每個專案佔 3 欄：專案欄（1＝通過）、Result 欄、Appendix 欄
// 用標籤找位置、不寫死行號，排程、人員等其他資訊都略過。

const C = require('./catalog');
const { section } = require('./parser');
const { readXLSX, colIndex, colName, splitRef } = require('./xlsx');

const clean = (s) => String(s == null ? '' : s).replace(/[　 ]/g, ' ').trim();
const isOne = (s) => { const v = clean(s); return v !== '' && Number(v) === 1; };
const PLACEHOLDER = /^projectname$/i;

/// 照測試項目的順序排好通過的程序
function ordered(passed, tests) {
  const out = {};
  for (const t of tests) {
    const procs = t.procedures.map((p) => p.id).filter((id) => (passed[t.id] || []).includes(id));
    if (procs.length) out[t.id] = procs;
  }
  return out;
}

const sameResult = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const procCount = (passed) => Object.values(passed).reduce((n, x) => n + x.length, 0);

/// 一行測試對到哪些測試項目＋程序：用跟 PDF 一樣的規則讀「Method 501.7-Procedure II」，B 欄代碼（A1_3、C2_7…）決定氣候類別
function mapRow(label, code, tests) {
  const cat = (/^(A1|A2|C1|C2)/i.exec(clean(code)) || [])[1];
  const text = clean(label).replace(/\s*\n\s*/g, ' ');
  const found = section(cat ? text.replace(/(Procedure\s*[IVX]+(?:-[ABC])?)/i, `$1 (${cat.toUpperCase()})`) : text, tests);
  if (!Object.keys(found).length) {
    // 沒有寫 Procedure 的（例如「Method 508.8」）：自己新增的同編號測試只有一個程序就勾它
    const method = (/Method\s*(\d{3}\.\d)/i.exec(text) || [])[1];
    const t = method && tests.find((x) => x.code === method && x.procedures.length === 1);
    if (t) found[t.id] = [t.procedures[0].id];
  }
  return found;
}

/// 解析整份 Excel，回傳識別結果總覽（還沒存）
function parseSchedule(buffer, catalog) {
  const tests = C.allTests(catalog);
  const sheets = readXLSX(buffer);
  const out = { sheets: [], projects: [], unmapped: [] };
  const unmapped = new Map();
  const seen = new Map();

  for (const sh of sheets) {
    // 依列整理：rows[行][欄] = 文字
    const rows = new Map();
    for (const [ref, v] of Object.entries(sh.cells)) {
      const { col, row } = splitRef(ref);
      if (!rows.has(row)) rows.set(row, {});
      rows.get(row)[col] = v;
    }
    // 找標籤欄：有「Project」的那一格
    let labelCol = null, projectRow = null;
    for (const [r, cols] of [...rows].sort((a, b) => a[0] - b[0])) {
      const hit = Object.entries(cols).find(([, v]) => clean(v) === 'Project');
      if (hit) { labelCol = hit[0]; projectRow = r; break; }
    }
    if (!labelCol) { out.sheets.push({ name: sh.name, projects: 0, note: '不是排程表格式，略過' }); continue; }
    const lc = colIndex(labelCol);
    const labelRow = (text) => [...rows].filter(([, c]) => clean(c[labelCol]) === text).map(([r]) => r)[0];
    const testRows = [...rows].filter(([, c]) => /^Method\s*\d{3}\.\d/i.test(clean(c[labelCol]))).map(([r]) => r).sort((a, b) => a - b);
    const totalRow = labelRow('測試總數');
    const headerRow = testRows.length ? testRows[0] - 1 : null;
    const info = { status: labelRow('測試類別'), year: labelRow('年分'), series: labelRow('系列') };
    const cell = (r, col) => (r != null && rows.has(r) ? clean(rows.get(r)[col]) : '');

    // 每一行測試對到的項目（同一行所有專案共用）
    const rowMap = new Map();
    for (const r of testRows) {
      const label = clean(rows.get(r)[labelCol]);
      const code = cell(r, colName(lc - 2));
      const mapped = mapRow(rows.get(r)[labelCol], code, tests);
      rowMap.set(r, { label: label.split('\n')[0], code, mapped });
    }

    // 專案欄：Project 那一行、標籤欄右邊有寫專案名稱的
    const projectCols = Object.entries(rows.get(projectRow))
      .filter(([col, v]) => colIndex(col) > lc && clean(v) && !PLACEHOLDER.test(clean(v)))
      .sort((a, b) => colIndex(a[0]) - colIndex(b[0]));
    out.sheets.push({ name: sh.name, projects: projectCols.length, tests: testRows.length, note: projectCols.length ? '' : '還沒有專案（都是範本）' });

    for (const [col, rawName] of projectCols) {
      const code = clean(rawName);
      const resultCol = colName(colIndex(col) + 1);
      const hasResult = /^Result/i.test(cell(headerRow, resultCol));
      const passed = {};
      const warnings = [];
      const notMapped = [];
      let ones = 0;
      for (const r of testRows) {
        if (!isOne(cell(r, col))) continue;
        ones++;
        const row = rowMap.get(r);
        if (hasResult && !isOne(cell(r, resultCol))) warnings.push(`第 ${r} 行「${row.code || row.label}」專案欄是 1，但 Result 欄沒有 1`);
        if (!Object.keys(row.mapped).length) {
          notMapped.push(row.label);
          const k = row.label;
          if (!unmapped.has(k)) unmapped.set(k, { label: k, code: row.code, rows: [], projects: 0 });
          const u = unmapped.get(k);
          if (!u.rows.includes(r)) u.rows.push(r);
          u.projects++;
          continue;
        }
        for (const [t, procs] of Object.entries(row.mapped)) {
          passed[t] = [...new Set([...(passed[t] || []), ...procs])];
        }
      }
      const totalText = cell(totalRow, col);
      const total = totalText === '' || isNaN(Number(totalText)) ? null : Number(totalText);
      if (total != null && total !== ones) warnings.push(`標示 1 的有 ${ones} 項，但「測試總數」寫 ${total}`);
      if (/[^A-Za-z0-9\-／/]/.test(code)) warnings.push('專案名稱含有備註文字，會照原樣當作型號');
      const key = code.toUpperCase();
      let duplicate = false;
      if (seen.has(key)) { warnings.push(`跟 ${seen.get(key)} 的專案名稱重複，預設不匯入`); duplicate = true; } else seen.set(key, `${sh.name} ${col} 欄`);

      const result = ordered(passed, tests);
      const existing = catalog.models.find((m) => m.code.toUpperCase() === key || (m.aliases || []).some((a) => a.toUpperCase() === key));
      let action = 'new';
      if (existing) action = sameResult(ordered(existing.passed || {}, tests), result) ? 'same' : 'update';
      out.projects.push({
        sheet: sh.name, column: col, code,
        series: cell(info.series, col), year: cell(info.year, col), status: cell(info.status, col),
        passed: result, passedTests: Object.keys(result).length, procedures: procCount(result),
        ones, total, unmapped: notMapped, warnings, duplicate,
        action, existingId: existing ? existing.id : null, existingDisplay: existing ? existing.display : null,
        include: !duplicate && action !== 'same' && procCount(result) > 0,
      });
    }
  }
  out.unmapped = [...unmapped.values()];
  return out;
}

/// 匯入選好的專案：已有的型號更新通過項目（其他資料不動），沒有的新增
function applySchedule(catalog, items) {
  const tests = C.allTests(catalog);
  let added = 0, updated = 0;
  for (const it of items) {
    const code = clean(it.code);
    if (!code) continue;
    const passed = ordered(it.passed || {}, tests);
    const key = code.toUpperCase();
    const m = catalog.models.find((x) => x.code.toUpperCase() === key || (x.aliases || []).some((a) => a.toUpperCase() === key));
    if (m) {
      m.passed = passed;
      updated++;
    } else {
      const series = clean(it.series);
      catalog.models.push(C.newModel({ code, display: series ? `${code}（${series} 系列）` : code, aliases: [code], passed }));
      added++;
    }
  }
  return { added, updated };
}

module.exports = { parseSchedule, applySchedule, mapRow };
