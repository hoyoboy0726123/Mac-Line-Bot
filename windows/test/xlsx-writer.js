'use strict';
// 測試用：產生最小的 .xlsx（不放真實資料，格式模仿 QTR 測試排程表）

const zlib = require('zlib');

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/// files：[{ name, data, deflate }]
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), data = Buffer.from(f.data);
    const body = f.deflate ? zlib.deflateRawSync(data) : data;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(f.deflate ? 8 : 0, 8);
    h.writeUInt32LE(crc32(data), 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    locals.push(h, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(f.deflate ? 8 : 0, 10);
    c.writeUInt32LE(crc32(data), 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    centrals.push(c, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/// sheets：[{ name, cells: { A1: 'text' | number } }]；文字一半放共用字串、一半放 inlineStr，兩種都測到
function workbook(sheets) {
  const shared = [];
  const sheetXML = sheets.map((sh) => {
    const rows = {};
    for (const [ref, v] of Object.entries(sh.cells)) {
      const r = Number(/\d+/.exec(ref)[0]);
      (rows[r] = rows[r] || []).push([ref, v]);
    }
    const body = Object.keys(rows).map(Number).sort((a, b) => a - b).map((r) => `<row r="${r}">${rows[r].map(([ref, v]) => {
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      if (shared.length % 2 === 0 || shared.includes(v)) {
        let i = shared.indexOf(v);
        if (i < 0) { shared.push(v); i = shared.length - 1; }
        return `<c r="${ref}" t="s"><v>${i}</v></c>`;
      }
      shared.push(null); // 讓下一個字串改用共用字串
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  });
  const sst = shared.map((s) => (s == null ? '<si><t></t></si>' : `<si><r><t>${esc(s.slice(0, 2))}</t></r><r><t xml:space="preserve">${esc(s.slice(2))}</t></r></si>`)).join('');
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types/>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0"?><Relationships>${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${sheets.length - i}.xml"/>`).join('')}</Relationships>` },
    { name: 'xl/sharedStrings.xml', data: `<?xml version="1.0"?><sst>${sst}</sst>`, deflate: true },
    ...sheetXML.map((x, i) => ({ name: `xl/worksheets/sheet${sheets.length - i}.xml`, data: x, deflate: i % 2 === 0 })),
  ]);
}

/// 模仿 QTR 測試排程表：標籤在 D 欄、B 欄是代碼、每個專案 3 欄，往右加
function sampleSchedule() {
  const tests = [
    ['A7', 'Method 500.6-Procedure I'], ['A3', 'Method 500.6-Procedure II'],
    ['A2_3', 'Method 501.7-Procedure II'], ['A2_10', 'Method 501.7-Procedure I'], ['A1_7', 'Method 501.7-Procedure I'],
    ['C1_7', 'Method 502.7- Procedure I'], ['C2_3', 'Method 502.7- Procedure II'],
    ['TS A X', 'Method 503.7- Procedure I-A'], ['TS C X', 'Method 503.7- Procedure I-C'],
    ['Fungus', 'Method 508.8'],
    ['V7', 'Method 514.8- Procedure I\n(Table 514.8C-VII. )'], ['VE1 X', 'Method 514.8- Procedure I\n(Figure 514.8E-1. )'],
    ['S6 (Drop)', 'Method 516.8- Procedure VI'], ['S1', 'Method 516.8- Procedure I'],
    ['528.1 X', 'Method 528.1- Procedure1 (Type 1)'],
  ];
  const first = 20;
  const cells = { D2: '測試類別', D3: '年分', D4: '系列', D5: 'Project', D9: 'QTR', D12: '預計測試排程', [`D${first + tests.length}`]: '測試總數' };
  tests.forEach(([code, label], i) => { cells[`B${first + i}`] = code; cells[`C${first + i}`] = '條件說明（略）'; cells[`D${first + i}`] = label; });
  // 專案：[欄, 名稱, 系列, 類別, 通過的行（index）, 總數, Result 少填的行]
  const projects = [
    ['E', 'ProjectName', '', 'New/Refresh/Cancel', [], 0],
    ['H', 'ZX1001AA', 'ZX', 'New', [0, 1, 2, 3, 5, 7, 8, 9, 10, 11, 12, 13, 14], 13],
    ['K', 'ZX1002AA', 'ZX', 'Refresh', [1, 2, 6, 13], 5, [6]],
    ['N', 'P5405CSA', '', 'Refresh', [0, 1, 2, 3, 5, 7, 8, 10, 11, 12, 13, 14], 12],
    ['Q', 'L1400', '', 'Refresh', [0, 1], 2],
    ['T', 'ZX1001AA', 'ZX', 'New', [0], 1],
    ['W', 'ZX1003AA_備註', 'ZX', 'New', [4], 1],
  ];
  const col = (c, d) => { let n = [...c].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) + d; let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  for (const [c, name, series, status, rows, total, noResult = []] of projects) {
    cells[`${c}2`] = status; cells[`${c}3`] = 2026; cells[`${c}5`] = name; cells[`${c}9`] = '某位同事';
    if (series) cells[`${c}4`] = series;
    cells[`${c}${first - 1}`] = 'CC'; cells[`${col(c, 1)}${first - 1}`] = 'Result (PASS[1]、FAIL[0])'; cells[`${col(c, 2)}${first - 1}`] = 'Appendix';
    for (const i of rows) { cells[`${c}${first + i}`] = 1; if (!noResult.includes(i)) cells[`${col(c, 1)}${first + i}`] = 1; cells[`${col(c, 2)}${first + i}`] = '5/1~5/9'; }
    cells[`${c}${first + tests.length}`] = total;
  }
  const template = { D5: 'Project', E5: 'ProjectName', D20: 'Method 500.6-Procedure I', E20: '　' };
  return workbook([{ name: '範本', cells: template }, { name: 'Commercial', cells }, { name: '說明', cells: { A1: '這是說明頁' } }]);
}

module.exports = { zip, workbook, sampleSchedule, crc32 };

// node test/xlsx-writer.js → 更新 Mac 版也會用到的範例檔
if (require.main === module) {
  const out = require('path').join(__dirname, 'fixtures', 'schedule_sample.xlsx');
  require('fs').writeFileSync(out, sampleSchedule());
  console.log('已寫入', out);
}
