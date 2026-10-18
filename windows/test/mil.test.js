'use strict';
// 軍規模組測試：產生器輸出要跟 Mac 版一模一樣、FAQ 比對 75 題、PDF 解析 5 份報告

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const C = require('../src/core/mil/catalog');
const G = require('../src/core/mil/generator');
const MIL = require('../src/core/mil');
const P = require('../src/core/mil/parser');
const R = require('../src/core/retriever');
const { defaultAccountData, makeFAQ, makeDoc } = require('../src/core/models');

const fixtures = path.join(__dirname, 'fixtures');

test('產生器 FAQ 跟 Mac 版完全相同（104 題，含 Flex 卡片與快速選項）', () => {
  const golden = JSON.parse(fs.readFileSync(path.join(fixtures, 'faqs_swift.json'), 'utf8'));
  const faqs = G.faqs(C.seedCatalog());
  assert.strictEqual(faqs.length, golden.length);
  faqs.forEach((f, i) => {
    assert.deepStrictEqual({ q: f.question, a: f.answer, k: f.keywords }, { q: golden[i].q, a: golden[i].a, k: golden[i].k }, `第 ${i + 1} 題`);
    // 卡片 JSON 字串逐字相同（兩邊都排序 key）、快速選項相同
    assert.strictEqual(f.flex || null, golden[i].flex || null, `第 ${i + 1} 題卡片`);
    assert.deepStrictEqual(f.quickReplies || null, golden[i].qr || null, `第 ${i + 1} 題快速選項`);
  });
});

test('背景知識文件跟 Mac 版完全相同', () => {
  const golden = fs.readFileSync(path.join(fixtures, 'doc_swift.txt'), 'utf8');
  const d = G.doc(C.seedCatalog());
  assert.strictEqual(d.title, G.DOC_TITLE);
  assert.strictEqual(d.content, golden);
});

const cases = [
  ['溫度衝擊測試怎麼做', '溫度衝擊測試怎麼做'], ['冷熱衝擊是什麼條件', '溫度衝擊測試怎麼做'],
  ['P5 可以耐多低溫', 'P5405CSA 低溫測試'], ['P5405CSA 冬天能用嗎', 'P5405CSA 低溫測試'],
  ['B1400 有做沙塵測試嗎', 'ExpertBook B1 沙塵測試'], ['B1400CBA 防塵嗎', 'B1400CBA 沙塵測試'],
  ['B5 摔到地上會壞嗎', 'B5302C 跌落測試'], ['L1 防摔嗎', 'L1400 跌落測試'],
  ['摔到地上會壞嗎', '跌落測試怎麼做'], ['掉地上會怎樣', '跌落測試怎麼做'],
  ['坐飛機帶著會不會壞', '高海拔測試怎麼做'], ['P5 可以帶上飛機嗎', 'P5405CSA 高海拔測試'],
  ['放在太陽下曬會怎樣', '太陽輻射測試怎麼做'], ['B5 有太陽輻射測試嗎', 'B5302C 太陽輻射測試'],
  ['淋到雨可以嗎', '可以防水嗎'], ['P5 防水嗎', '可以防水嗎'], ['打翻飲料怎麼辦', '可以防水嗎'],
  ['在沙漠用可以嗎', '在沙漠可以用嗎'], ['潮濕的地方可以用嗎', '濕度測試怎麼做'],
  ['L1400 濕度測試', 'L1400 濕度測試'], ['B1500 可以耐濕嗎', 'ExpertBook B1 濕度測試'],
  ['還有哪些測試項目', '軍規測試有哪些項目'], ['P5405CSA 的測試項目有哪些', 'P5405CSA 通過哪些測試'],
  ['B1 通過哪些軍規', 'ExpertBook B1 通過哪些測試'], ['哪一台最耐用', '哪一台測試最完整'],
  ['有哪些型號通過軍規', '有哪些型號通過軍規測試'], ['MIL-STD-810H 是什麼', 'MIL-STD-810H 是什麼'],
  ['軍規是什麼意思', 'MIL-STD-810H 是什麼'], ['810G 跟 810H 差在哪', '810G 和 810H 有什麼不同'],
  ['通過軍規摔壞有保固嗎', '通過軍規就保證不會壞嗎'], ['開車放車上會不會壞', '振動測試怎麼做'],
  ['B5 振動測試', 'B5302C 振動測試'], ['坐船可以用嗎', '艦載機械振動測試怎麼做'],
  ['P5 有防爆嗎', 'P5405CSA 爆炸性環境測試'], ['結露會不會壞', '凍融測試怎麼做'],
  ['B5302C 凍融', 'B5302C 凍融測試'], ['夏天放車內可以嗎', '高溫測試怎麼做'], ['P5 耐熱嗎', 'P5405CSA 高溫測試'],
  ['B1 可以摔嗎', 'ExpertBook B1 跌落測試'], ['P5 掉到地上', 'P5405CSA 跌落測試'], ['B5302C 可以帶去沙漠嗎', 'B5302C 沙塵測試'],
  ['L1400 冬天可以用嗎', 'L1400 低溫測試'], ['B1400CBA 有溫度衝擊嗎', 'B1400CBA 溫度衝擊測試'], ['P5 有做幾項測試', 'P5405CSA 通過哪些測試'],
  ['ExpertBook B5 的軍規', 'B5302C 通過哪些測試'], ['L1 撞到會壞嗎', 'L1400 衝擊測試'], ['低溫測試的條件', '低溫測試怎麼做'],
  ['高溫可以到幾度', '高溫測試怎麼做'], ['B5 防水嗎', '可以防水嗎'], ['下雨天可以帶出門嗎', '可以防水嗎'],
  ['沙塵測試呢', '沙塵測試怎麼做'], ['震動測試怎麼做', '振動測試怎麼做'], ['低溫測試呢', '低溫測試怎麼做'], ['沙塵測試呢 有通過的型號', '沙塵測試怎麼做'],
  ['P5 跟 B5 差在哪裡', 'P5405CSA 和 B5302C 比較'], ['B1400 跟 B1400CBA 有什麼不同', 'B1400CBA 和 B1400／B1500 比較'],
  ['L1400 和 P5405CSA 哪台比較耐用', 'P5405CSA 和 L1400 比較'], ['B5302C vs L1400', 'B5302C 和 L1400 比較'], ['B1 和 P5 差異', 'P5405CSA 和 B1400／B1500 比較'],
  ['B1400CBA 跟 L1 哪個好', 'B1400CBA 和 L1400 比較'],
  ['請列出這些項目的詳細測試條件', '所有測試項目的詳細條件'], ['列出所有測試的條件', '所有測試項目的詳細條件'],
  ['每一項的條件是什麼', '所有測試項目的詳細條件'], ['全部項目的詳細條件', '所有測試項目的詳細條件'], ['各項目的測試條件', '所有測試項目的詳細條件'],
  ['低溫的詳細條件', '低溫測試怎麼做'], ['P5 低溫詳細條件', 'P5405CSA 低溫測試'],
  ['528.1有哪些機種通過', '艦載機械振動測試怎麼做'], ['爆炸性環境測試有哪些型號', '爆炸性環境測試怎麼做'],
  ['通過軍規摔壞有保固嗎', '通過軍規就保證不會壞嗎'], ['低溫 C2 是哪些型號通過', '低溫測試怎麼做'], ['有哪些機種通過軍規', '有哪些型號通過軍規測試'],
  ['報告哪裡可以看', '測試報告在哪裡看'], ['你們有賣手機嗎', '(無)'], ['營業時間', '(無)'],
];

test('FAQ 比對回歸 75/75', () => {
  const faqs = G.faqs(C.seedCatalog());
  const fails = [];
  for (const [q, expect] of cases) {
    const cmp = R.modelTokens(q).length >= 2;
    const hit = R.matchFAQ(q, cmp ? faqs.filter((f) => f.question.includes('比較')) : faqs);
    const got = hit ? hit.question : '(無)';
    if (got !== expect) fails.push(`${q} → ${got}（預期：${expect}）`);
  }
  assert.strictEqual(cases.length, 75);
  assert.deepStrictEqual(fails, []);
});

test('一鍵產生：只替換自動產生的 FAQ，保留手動 FAQ', () => {
  const cat = C.seedCatalog();
  const d = defaultAccountData();
  d.faqs = [makeFAQ('營業時間', '9 點開門'), makeFAQ('P5405CSA 低溫測試', '舊的 CSV 匯入版本')];
  d.docs = [makeDoc('ASUS商用筆電-MIL-STD-810H軍規測試', '舊文件'), makeDoc('菜單', '咖啡')];
  assert.strictEqual(MIL.needsRegenerate(cat, d), true);
  const r = MIL.applyGenerated(d, cat);
  assert.strictEqual(r.faqs, 104);
  assert.strictEqual(r.removed, 1);
  assert.strictEqual(d.faqs.length, 105);
  assert.strictEqual(d.faqs[0].question, '營業時間');
  assert.deepStrictEqual(d.docs.map((x) => x.title), [G.DOC_TITLE, '菜單']);
  cat.lastGenerated = '2026-10-18T00:00:00Z';
  assert.strictEqual(MIL.needsRegenerate(cat, d), false);
  cat.models[0].passed.solar = [];
  assert.strictEqual(MIL.needsRegenerate(cat, d), true);
  // 再產生一次不會越來越多
  MIL.applyGenerated(d, cat);
  assert.strictEqual(d.faqs.length, 105);
  assert.strictEqual(d.docs.length, 2);
});

test('normalizeCatalog 補齊欄位', () => {
  const c = C.normalizeCatalog({ models: [{ code: 'X1' }] });
  assert.strictEqual(c.models[0].standard, 'MIL-STD-810H');
  assert.deepStrictEqual(c.models[0].passed, {});
  assert.strictEqual(c.lastGenerated, undefined);
});

const pdfDir = process.env.MLB_PDF_DIR || path.join(fixtures, 'pdfs');
const pdfMap = {
  'P5405CSA.pdf': 'P5405CSA', 'B5302C.pdf': 'B5302C', 'asusexpertbookb1-b1400cba.pdf': 'B1400CBA',
  'ASUSExpertBookB1-B1400-B1500.pdf': 'B1400／B1500', 'ASUSExpertBookL1-L1400.pdf': 'L1400',
};
// 程序順序不影響意義，用集合比較
const asSets = (o) => Object.keys(o).filter((k) => o[k].length).sort().map((k) => [k, [...o[k]].sort()]);

for (const [file, code] of Object.entries(pdfMap)) {
  test(`PDF 解析：${code}`, async (t) => {
    const f = path.join(pdfDir, file);
    if (!fs.existsSync(f)) return t.skip('沒有測試用 PDF');
    const r = await P.load(f);
    const m = C.seedCatalog().models.find((x) => x.code === code);
    assert.deepStrictEqual(asSets(r.passed), asSets(m.passed));
    assert.deepStrictEqual(asSets(r.describedOnly), asSets(m.describedOnly));
  });
}

test('PDF 解析：壞檔案給中文錯誤', async () => {
  await assert.rejects(P.load(Buffer.from('not a pdf')), /不是可以讀取的 PDF/);
});

test('卡片按鈕與「比較型號」快速選項都對到正確的 FAQ', () => {
  const faqs = G.faqs(C.seedCatalog());
  const route = (t) => R.matchFAQ(t, R.modelTokens(t).length >= 2 ? faqs.filter((f) => f.question.includes('比較')) : faqs);
  for (const f of faqs.filter((x) => x.flex)) {
    for (const b of (JSON.parse(f.flex).footer || { contents: [] }).contents) {
      assert.strictEqual((route(b.action.text) || {}).question, b.action.text, `「${f.question}」的按鈕「${b.action.label}」`);
    }
  }
  const pick = faqs.find((f) => f.question === '比較型號');
  assert.strictEqual(pick.quickReplies.length, 10);
  for (const q of pick.quickReplies) assert.ok((route(q) || {}).question.endsWith('比較'), q);
  assert.strictEqual(route('比較型號').question, '比較型號');
});

test('自訂測試項目：跟 Mac 版產生的 FAQ、卡片、背景知識完全相同', () => {
  const c = C.normalizeCatalog(JSON.parse(fs.readFileSync(path.join(fixtures, 'catalog_custom.json'), 'utf8')));
  const golden = JSON.parse(fs.readFileSync(path.join(fixtures, 'faqs_swift_custom.json'), 'utf8'));
  const faqs = G.faqs(c);
  assert.strictEqual(faqs.length, golden.length);
  faqs.forEach((f, i) => {
    assert.deepStrictEqual({ q: f.question, a: f.answer, k: f.keywords, flex: f.flex || null, qr: f.quickReplies || null },
      { q: golden[i].q, a: golden[i].a, k: golden[i].k, flex: golden[i].flex || null, qr: golden[i].qr || null }, `第 ${i + 1} 題`);
  });
  assert.strictEqual(G.doc(c).content, fs.readFileSync(path.join(fixtures, 'doc_swift_custom.txt'), 'utf8'));
  // 新項目可以被問到
  const route = (t) => R.matchFAQ(t, R.modelTokens(t).length >= 2 ? faqs.filter((f) => f.question.includes('比較')) : faqs);
  assert.strictEqual(route('淋雨測試怎麼做').question, '淋雨測試怎麼做');
  assert.strictEqual(route('P5 下雨天可以用嗎').question, 'P5405CSA 淋雨測試');
  assert.strictEqual(route('放冷凍庫會壞嗎').question, '低溫測試怎麼做');
  assert.ok(faqs.find((f) => f.question === 'P5405CSA 淋雨測試').answer.includes('降雨率 1.7 mm/min'));
});

test('自訂測試項目：PDF 文字用 Method 編號自動勾選；刪掉程序會清掉機種勾選', () => {
  const c = C.normalizeCatalog(JSON.parse(fs.readFileSync(path.join(fixtures, 'catalog_custom.json'), 'utf8')));
  const P = require('../src/core/mil/parser');
  const r = P.parse(['Test Report - B9999X\nMethod 506.6 - Procedure III Rain Pass\nMethod 500.6 - Procedure II Pass'], C.allTests(c));
  assert.deepStrictEqual(r.passed, { 'custom-rain': ['III'], altitude: ['II'] });
  c.tests.find((t) => t.id === 'custom-rain').procedures = c.tests.find((t) => t.id === 'custom-rain').procedures.filter((p) => p.id !== 'III');
  C.pruneModels(c);
  assert.deepStrictEqual(c.models[0].passed['custom-rain'], ['I']);
  assert.strictEqual(c.models[1].passed['custom-rain'], undefined);
});

test('手動修改過的自動產生題目，重新產生時保留', () => {
  const cat = C.seedCatalog();
  const d = defaultAccountData();
  MIL.applyGenerated(d, cat);
  const f = d.faqs.find((x) => x.question === 'P5405CSA 低溫測試');
  f.answer = '我自己寫的答案';
  f.keywords = f.keywords.filter((k) => k !== G.TAG).concat(MIL.EDITED);
  cat.lastGenerated = '2026-10-18T00:00:00Z';
  assert.strictEqual(MIL.needsRegenerate(cat, d), false);
  const r = MIL.applyGenerated(d, cat);
  assert.strictEqual(r.kept, 1);
  assert.strictEqual(d.faqs.filter((x) => x.question === 'P5405CSA 低溫測試').length, 1);
  assert.strictEqual(d.faqs.find((x) => x.question === 'P5405CSA 低溫測試').answer, '我自己寫的答案');
});
