'use strict';
// 測試排程表 Excel 匯入（用假資料產生的 .xlsx，格式跟 QTR 的排程表相同）

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../src/core/mil/catalog');
const E = require('../src/core/mil/excel');
const X = require('../src/core/mil/xlsx');
const { sampleSchedule } = require('./xlsx-writer');

const fixture = path.join(__dirname, 'fixtures', 'schedule_sample.xlsx');
const seed = () => C.normalizeCatalog(C.seedCatalog());

test('xlsx：共用字串、inlineStr、壓縮與不壓縮都讀得到，工作表照活頁簿順序', () => {
  const sheets = X.readXLSX(sampleSchedule());
  assert.deepStrictEqual(sheets.map((s) => s.name), ['範本', 'Commercial', '說明']);
  const c = sheets[1].cells;
  assert.strictEqual(c.D5, 'Project');
  assert.strictEqual(c.H5, 'ZX1001AA');
  assert.strictEqual(c.D30, 'Method 514.8- Procedure I\n(Table 514.8C-VII. )');
  assert.strictEqual(c.H20, '1');
  assert.strictEqual(sheets[2].cells.A1, '這是說明頁');
  assert.throws(() => X.readXLSX(Buffer.from('not a zip at all, definitely not')), /不是 Excel/);
});

test('排程表：用標籤找位置，專案欄 1＝通過，對到測試項目與程序', () => {
  const r = E.parseSchedule(sampleSchedule(), seed());
  assert.deepStrictEqual(r.sheets.map((s) => [s.name, s.projects]), [['範本', 0], ['Commercial', 6], ['說明', 0]]);
  assert.match(r.sheets[0].note, /範本/);
  assert.match(r.sheets[2].note, /略過/);
  const by = Object.fromEntries(r.projects.map((p) => [p.code + '@' + p.column, p]));

  const a = by['ZX1001AA@H'];
  assert.deepStrictEqual(a.passed, {
    altitude: ['I', 'II'], hot: ['A2op', 'A2st'], cold: ['C1st'], tshock: ['IA', 'IC'],
    vibration: ['CVII', 'E1'], drop: ['VI'], shock: ['I'], ship: ['1'],
  });
  assert.strictEqual(a.ones, 13);
  assert.strictEqual(a.total, 13);
  assert.deepStrictEqual(a.unmapped, ['Method 508.8']);
  assert.strictEqual(a.series, 'ZX');
  assert.strictEqual(a.status, 'New');
  assert.strictEqual(a.year, '2026');
  assert.strictEqual(a.action, 'new');
  assert.strictEqual(a.include, true);
  assert.deepStrictEqual(a.warnings, []);

  const b = by['ZX1002AA@K'];
  assert.deepStrictEqual(b.passed, { altitude: ['II'], hot: ['A2op'], cold: ['C2op'], shock: ['I'] });
  assert.strictEqual(b.warnings.length, 2);
  assert.match(b.warnings[0], /第 26 行「C2_3」.*Result/);
  assert.match(b.warnings[1], /4 項.*測試總數」寫 5/);

  assert.strictEqual(by['P5405CSA@N'].action, 'update');
  assert.strictEqual(by['L1400@Q'].action, 'update');
  assert.deepStrictEqual(by['L1400@Q'].passed, { altitude: ['I', 'II'] });
  const dup = by['ZX1001AA@T'];
  assert.strictEqual(dup.duplicate, true);
  assert.strictEqual(dup.include, false);
  assert.match(dup.warnings.join(), /重複/);
  assert.match(by['ZX1003AA_備註@W'].warnings.join(), /備註/);
  assert.deepStrictEqual(by['ZX1003AA_備註@W'].passed, { hot: ['A1st'] });
  assert.ok(!r.projects.some((p) => p.code === 'ProjectName'));
  assert.deepStrictEqual(r.unmapped.map((u) => [u.label, u.code, u.projects]), [['Method 508.8', 'Fungus', 1]]);
});

test('排程表：確認匯入後新增／更新型號，再上傳一次就是「已是最新」', () => {
  const c = seed();
  const before = c.models.find((m) => m.code === 'P5405CSA');
  const keep = { display: before.display, aliases: [...before.aliases], reportURL: before.reportURL, describedOnly: before.describedOnly };
  const r = E.parseSchedule(sampleSchedule(), c);
  const res = E.applySchedule(c, r.projects.filter((p) => p.include));
  assert.deepStrictEqual(res, { added: 3, updated: 2 });
  assert.strictEqual(c.models.length, 8);
  const p5 = c.models.find((m) => m.code === 'P5405CSA');
  assert.deepStrictEqual(p5.passed, r.projects.find((p) => p.code === 'P5405CSA').passed);
  assert.deepStrictEqual({ display: p5.display, aliases: p5.aliases, reportURL: p5.reportURL, describedOnly: p5.describedOnly }, keep);
  const zx = c.models.find((m) => m.code === 'ZX1001AA');
  assert.strictEqual(zx.display, 'ZX1001AA（ZX 系列）');
  assert.deepStrictEqual(zx.aliases, ['ZX1001AA']);
  assert.strictEqual(zx.standard, 'MIL-STD-810H');

  const again = E.parseSchedule(sampleSchedule(), c);
  assert.deepStrictEqual(again.projects.filter((p) => !p.duplicate).map((p) => p.action), ['same', 'same', 'same', 'same', 'same']);
  assert.ok(again.projects.every((p) => !p.include));
});

test('排程表：自己新增同編號的測試項目後，原本未對應的那一行就會匯入', () => {
  const c = seed();
  c.tests = [...C.allTests(c), C.normalizeTest({ code: '508.8', short: '黴菌', procedures: [{ id: 'I', label: '五種黴菌 28 天', detail: '' }] })];
  const r = E.parseSchedule(sampleSchedule(), c);
  assert.deepStrictEqual(r.unmapped, []);
  const id = c.tests[c.tests.length - 1].id;
  assert.deepStrictEqual(r.projects.find((p) => p.column === 'H').passed[id], ['I']);
});

test('排程表：範例檔跟產生器一致（Mac 版用同一個檔案比對）', () => {
  assert.ok(fs.readFileSync(fixture).equals(sampleSchedule()), '請執行 node test/xlsx-writer.js 更新 fixtures/schedule_sample.xlsx');
});
