'use strict';
// 標準 CSV（欄位可用雙引號包住，裡面可以有逗號與換行）：問題,答案[,關鍵字1;關鍵字2]

const { makeFAQ } = require('./models');

function parseRows(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  let s = (text || '').replace(/\r\n/g, '\n');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseFAQCSV(text) {
  return parseRows(text).map((cols) => {
    if (cols.length < 2) return null;
    const q = cols[0].trim(), a = cols[1].trim();
    if (!q || !a || q === '問題') return null;
    const k = cols.length > 2 ? cols[2].split(/[;；]/).map((x) => x.trim()).filter(Boolean) : [];
    return makeFAQ(q, a, k);
  }).filter(Boolean);
}

module.exports = { parseRows, parseFAQCSV };
