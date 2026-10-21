'use strict';
// 讀 .xlsx 的最小實作（對照 Mac 版 XLSXReader.swift）：只取每個工作表的儲存格文字，不需要額外套件。
// .xlsx 是 zip 壓縮檔，裡面是 XML：sharedStrings.xml（共用字串）＋ worksheets/sheetN.xml（儲存格）。

const zlib = require('zlib');

/// 解開 zip，回傳 { 檔名: Buffer }（只支援「不壓縮」與 deflate，Excel 只會用這兩種）
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是 Excel（.xlsx）檔案');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Excel 檔案損毀');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method === 0) files[name] = Buffer.from(raw);
    else if (method === 8) files[name] = zlib.inflateRawSync(raw);
  }
  return files;
}

const unescape = (s) => s.replace(/&(lt|gt|quot|apos|amp|#x?[0-9a-fA-F]+);/g, (m, e) => {
  if (e === 'lt') return '<';
  if (e === 'gt') return '>';
  if (e === 'quot') return '"';
  if (e === 'apos') return "'";
  if (e === 'amp') return '&';
  return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
});

/// <si> 或 <is> 裡所有 <t> 的文字接起來（含格式化文字 <r><t>…）
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => unescape(m[1])).join('');

/// 回傳 [{ name, cells: { A1: '文字', … } }]，依活頁簿裡的順序
function readXLSX(buf) {
  const files = unzip(Buffer.from(buf));
  const str = (n) => (files[n] ? files[n].toString('utf8') : '');
  const workbook = str('xl/workbook.xml');
  if (!workbook) throw new Error('不是 Excel（.xlsx）檔案');
  const shared = [...str('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const rels = {};
  for (const m of str('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0]), target = /\bTarget="([^"]+)"/.exec(m[0]);
    if (id && target) rels[id[1]] = target[1].replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[0]), rid = /\br:id="([^"]+)"/.exec(m[0]);
    if (!name || !rid || !rels[rid[1]]) continue;
    const xml = str('xl/' + rels[rid[1]]);
    const cells = {};
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(c[1]);
      if (!ref || !c[2]) continue;
      const type = (/\bt="([^"]+)"/.exec(c[1]) || [])[1];
      let value;
      if (type === 'inlineStr') value = textOf(c[2]);
      else {
        const v = /<v>([^<]*)<\/v>/.exec(c[2]);
        if (!v) continue;
        value = type === 's' ? shared[Number(v[1])] : unescape(v[1]);
      }
      if (value != null && value !== '') cells[ref[1]] = value;
    }
    sheets.push({ name: unescape(name[1]), cells });
  }
  return sheets;
}

// MARK: 欄位代號

const colIndex = (col) => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
function colName(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const splitRef = (ref) => { const m = /^([A-Z]+)(\d+)$/.exec(ref); return { col: m[1], row: Number(m[2]) }; };

module.exports = { unzip, readXLSX, colIndex, colName, splitRef };
