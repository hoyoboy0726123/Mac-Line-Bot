'use strict';
// 讀華碩官方 MIL-STD-810H 測試報告 PDF，找出「Method 5xx.x - Procedure …」自動勾選（對照 Mac 版 MILReportParser.swift）
// 報告排版各版本不同，結果請使用者在畫面上確認後再存。

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const C = require('./catalog');

// MARK: 解析文字

/// 有「Pass」的頁面是結果總表；沒有的是測試說明（只出現在說明裡的程序另外標示）
function parse(pages, tests = C.TESTS) {
  const resultPages = pages.filter((p) => p.includes('Pass'));
  const descPages = pages.filter((p) => !p.includes('Pass'));
  const passed = section(resultPages.join('\n'), tests);
  const described = section(descPages.join('\n'), tests);
  for (const [t, procs] of Object.entries(described)) {
    const rest = procs.filter((p) => !(passed[t] || []).includes(p));
    if (rest.length) described[t] = rest; else delete described[t];
  }
  const all = pages.join('\n');
  return { codeGuess: guessCode(all), passed, describedOnly: described, text: all };
}

function section(raw, tests = C.TESTS) {
  const text = raw.replace(/‐/g, '-').replace(/–/g, '-').replace(/Procedure1/g, 'Procedure 1');
  const passed = {};
  const add = (t, p) => { if (!(passed[t] || []).includes(p)) (passed[t] = passed[t] || []).push(p); };
  // 程序前面 80 個字的說明（例如「Cold Climatic Storage」），用來判斷 A1/A2、C1/C2
  const context = (loc) => text.slice(Math.max(0, loc - 80), loc).toLowerCase().split(/\s+/).filter(Boolean).join(' ');

  const re = /Method\s*(\d{3}\.\d)\s*-?\s*Procedure\s*([IVX]+(?:-[ABC])?|\d)\b\s*(?:\((A1|A2|C1|C2)\))?/g;
  for (const m of text.matchAll(re)) {
    const method = m[1], proc = m[2], explicit = m[3] || '';
    const ctx = context(m.index);
    switch (method) {
      case '500.6': add('altitude', proc); break;
      case '501.7': {
        let cats = explicit ? [explicit] : [];
        if (!cats.length) {
          const dry = ctx.lastIndexOf('hot dry'), basic = ctx.lastIndexOf('basic hot');
          if (dry >= 0 && (basic < 0 || dry > basic)) cats = ['A1']; else if (basic >= 0) cats = ['A2'];
        }
        if (!cats.length) cats = ['A1', 'A2']; // 判斷不出來就兩種都勾，請使用者確認
        for (const c of cats) add('hot', c + (proc === 'II' ? 'op' : 'st'));
        break;
      }
      case '502.7': {
        let cat = explicit;
        if (!cat) {
          // 前文裡最靠近的說明決定類別
          const cold = ctx.lastIndexOf('cold climatic'), basic = ctx.lastIndexOf('basic climatic');
          cat = cold >= 0 && (basic < 0 || cold > basic) ? 'C2' : 'C1';
        }
        add('cold', cat + (proc === 'II' ? 'op' : 'st'));
        break;
      }
      case '503.7': add('tshock', proc.replace(/-/g, '')); break;
      case '505.7': add('solar', 'I'); break;
      case '507.6': add('humidity', 'II'); break;
      case '510.7': add('dust', proc); break;
      case '511.7': add('explosive', 'I'); break;
      case '516.8':
        if (proc === 'IV' || proc === 'VI') add('drop', proc);
        else if (['I', 'II', 'III', 'V'].includes(proc)) add('shock', proc);
        break;
      case '524.1': add('freeze', 'III'); break;
      case '528.1': add('ship', '1'); break;
      default: {
        // 使用者自己新增的測試項目：Method 編號相同就勾選；程序代號對得上就勾那一個，只有一個程序就勾它
        for (const t of tests.filter((x) => x.code === method && !C.test(x.id))) {
          const id = proc.replace(/-/g, '');
          const p = t.procedures.find((x) => x.id === proc || x.id === id) || (t.procedures.length === 1 ? t.procedures[0] : null);
          if (p) add(t.id, p.id);
        }
      }
    }
  }
  // 振動用表號：Table 514.8C-I / C-IV / C-VI / C-VII、Figure 514.8E-1
  for (const m of text.matchAll(/514\.8C-(VII|VI|IV|I)\b/g)) add('vibration', 'C' + m[1]);
  if (text.includes('514.8E-1')) add('vibration', 'E1');

  // 依測試定義的順序排好
  for (const [t, procs] of Object.entries(passed)) {
    const def = tests.find((x) => x.id === t);
    if (def) passed[t] = def.procedures.map((p) => p.id).filter((id) => procs.includes(id));
    else delete passed[t];
    if (passed[t] && !passed[t].length) delete passed[t];
  }
  return passed;
}

/// 型號：「Test Report - B5302C」或報告中的大寫英數型號
function guessCode(text) {
  let m = /Test Report\s*-\s*([A-Z0-9／/]{4,}(?:\s*\/\s*[A-Z0-9]{4,})?)/.exec(text);
  if (m) return m[1].trim();
  m = /\b([A-Z]\d{4}[A-Z]{1,4})\b/.exec(text);
  return m ? m[1] : null;
}

// MARK: 讀 PDF

let pdfjsPromise;
function pdfjs() {
  if (!pdfjsPromise) {
    // 打包後 pdfjs-dist 會放在 app.asar.unpacked，用 require.resolve 找到真正位置
    const file = require.resolve('pdfjs-dist/legacy/build/pdf.mjs').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    pdfjsPromise = import(pathToFileURL(file).href).then((lib) => {
      const worker = file.replace(/pdf\.mjs$/, 'pdf.worker.mjs');
      if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

/// 把一頁的文字片段組回有換行的文字（同一行 y 座標相同；hasEOL 也換行）
function pageText(items) {
  let out = '', lastY = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const y = it.transform ? Math.round(it.transform[5]) : lastY;
    if (lastY != null && y != null && Math.abs(y - lastY) > 2 && out && !out.endsWith('\n')) out += '\n';
    out += it.str;
    if (it.hasEOL) out += '\n';
    if (y != null) lastY = y;
  }
  return out;
}

async function pdfPages(buffer) {
  const lib = await pdfjs();
  const data = new Uint8Array(buffer.buffer ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : buffer);
  const task = lib.getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      pages.push(pageText(tc.items));
    }
  } finally {
    await task.destroy();
  }
  return pages;
}

async function parsePDF(buffer, tests) {
  let pages;
  try {
    pages = await pdfPages(buffer);
  } catch (e) {
    throw new Error('不是可以讀取的 PDF');
  }
  return parse(pages, tests);
}

/// source：本機檔案路徑、http(s) 網址或 Buffer
async function load(source, tests) {
  let data;
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
    data = Buffer.from(source);
  } else if (/^https?:\/\//i.test(source)) {
    let resp;
    try {
      resp = await fetch(source, { signal: AbortSignal.timeout(60000) });
    } catch (e) {
      throw new Error('下載報告失敗');
    }
    if (resp.status !== 200) throw new Error('下載報告失敗');
    data = Buffer.from(await resp.arrayBuffer());
  } else {
    data = fs.readFileSync(source);
  }
  return parsePDF(data, tests);
}

module.exports = { parse, guessCode, pageText, pdfPages, parsePDF, load };
