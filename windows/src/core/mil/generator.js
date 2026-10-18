'use strict';
// 由「軍規機種」資料自動產生 FAQ 與背景知識文件（逐行對照 Mac 版 MILGenerator.swift，輸出文字完全相同）

const { count } = require('../util');
const { makeFAQ, makeDoc } = require('../models');
const C = require('./catalog');
const F = require('./flex');

const TAG = '#MIL自動產生';
const DOC_TITLE = '華碩商用筆電 MIL-STD-810H 軍規測試（自動產生）';
const NOTE = '※ 以華碩官方測試報告為準';

// MARK: 共用

const labels = (t, procs) => procs.map((p) => C.procedure(t, p)).filter(Boolean).map((p) => p.label).join('、');

function lines(m, t) {
  const out = C.passes(m, t).map((p) => C.procedure(t, p)).filter(Boolean).map((p) => '・' + C.procLine(p));
  const desc = C.described(m, t).map((p) => C.procedure(t, p)).filter(Boolean).map(C.procLine);
  if (desc.length) out.push('・測試說明另列：' + desc.join('；'));
  return out;
}

const passedModels = (c, t) => c.models.filter((m) => C.passes(m, t).length);

/// 型號沒有自己的叫法時，用系列的叫法
function entityAliases(c, m) {
  if (m.aliases.length) return m.aliases;
  const f = C.familyOf(c, m);
  return f ? f.aliases : [m.code];
}

function combos(a, b) {
  const seen = new Set(), out = [];
  for (const x of a) for (const y of b) { const k = `${x}+${y}`; if (!seen.has(k)) { seen.add(k); out.push(k); } }
  return out;
}

function faq(q, a, k, general = false) {
  const seen = new Set();
  const keys = k.filter((x) => (seen.has(x) ? false : (seen.add(x), true))).concat(general ? ['#通用'] : [], [TAG]);
  return makeFAQ(q, a, keys);
}

/// 附上 LINE Flex 卡片（JSON 字串）
const withFlex = (f, card) => { f.flex = F.json(card); return f; };

// MARK: 答案

function modelTestAnswer(c, m, t) {
  if (C.passes(m, t).length) return [`✅ ${m.display} 有通過${t.name}`, ...lines(m, t), NOTE].join('\n');
  if (C.described(m, t).length) {
    return [`📄 ${m.display} 的報告在測試說明中列出${t.name}，但結果總表沒有列，請以華碩官方確認為準`, ...lines(m, t), NOTE].join('\n');
  }
  const others = passedModels(c, t).map((x) => x.code).join('、');
  return [
    `❌ ${m.display} 的官方測試報告中沒有${t.name}`,
    `・有通過${t.short}測試的型號：${others || '（目前整理的機種都沒有）'}`,
    NOTE,
  ].join('\n');
}

function familyTestAnswer(c, f, t) {
  const members = c.models.filter((m) => m.family === f.name);
  const out = [`${f.name} 有 ${members.length} 份官方報告，${t.short}測試的結果不同：`];
  for (const m of members) {
    if (C.passes(m, t).length) {
      out.push(`【${m.display}】✅ 有通過`);
      out.push(...lines(m, t));
    } else {
      out.push(`【${m.display}】❌ 報告中沒有這項`);
    }
  }
  out.push('可以告訴我您的完整型號，幫您確認是哪一款 🙂');
  return out.join('\n');
}

function testOverview(c, t) {
  const out = [`${t.name}的條件：`, ...t.procedures.map((p) => '・' + C.procLine(p))];
  out.push('通過型號：');
  const passed = passedModels(c, t);
  for (const m of passed) out.push(`・${m.display}：${labels(t, C.passes(m, t))}`);
  if (!passed.length) {
    const desc = c.models.filter((m) => C.described(m, t).length).map((m) => m.code);
    out.push('・結果總表中沒有型號列出此項' + (desc.length ? `（${desc.join('、')} 的測試說明有列出）` : ''));
  }
  out.push(NOTE);
  return out.join('\n');
}

function modelSummary(c, m) {
  const out = [`${m.display} 通過的 ${m.standard} 測試：`];
  out.push(...C.allTests(c).filter((t) => C.passes(m, t).length).map((t) => '・' + t.name));
  const missing = C.allTests(c).filter((t) => !C.passes(m, t).length).map((t) => t.short);
  if (missing.length) out.push('報告中沒有：' + missing.join('、'));
  out.push(m.aliases.length ? `想看某一項的詳細條件，可以直接問例如「${m.aliases[0]} 低溫測試」` : NOTE);
  return out.join('\n');
}

function familySummary(c, f) {
  const members = c.models.filter((m) => m.family === f.name);
  const out = [`${f.name} 有 ${members.length} 份官方報告：`];
  for (const m of members) {
    out.push(`【${m.display}】`);
    out.push('・' + C.allTests(c).filter((t) => C.passes(m, t).length).map((t) => t.short).join('、'));
    const missing = C.allTests(c).filter((t) => !C.passes(m, t).length).map((t) => t.short);
    if (missing.length) out.push('・報告中沒有：' + missing.join('、'));
  }
  out.push('可以告訴我您的完整型號，幫您確認是哪一款 🙂');
  return out.join('\n');
}

function compare(c, a, b) {
  const both = [], onlyA = [], onlyB = [], diff = [];
  for (const t of C.allTests(c)) {
    const pa = C.passes(a, t), pb = C.passes(b, t);
    if (pa.length && pb.length) {
      both.push(t.short);
      const extraA = pa.filter((x) => !pb.includes(x)), extraB = pb.filter((x) => !pa.includes(x));
      if (extraA.length) diff.push(`・${t.short}：${a.code} 另有 ${labels(t, extraA)}`);
      if (extraB.length) diff.push(`・${t.short}：${b.code} 另有 ${labels(t, extraB)}`);
    } else if (pa.length) onlyA.push(t.short);
    else if (pb.length) onlyB.push(t.short);
  }
  const out = [`${a.display} 和 ${b.display} 的軍規測試比較：`];
  out.push('✅ 兩台都有：' + (both.length ? both.join('、') : '無'));
  out.push(`🔹 只有 ${a.code} 有：` + (onlyA.length ? onlyA.join('、') : '無'));
  out.push(`🔸 只有 ${b.code} 有：` + (onlyB.length ? onlyB.join('、') : '無'));
  if (diff.length) { out.push('同一項目的程序差異：'); out.push(...diff); }
  const notes = [];
  for (const m of [a, b]) {
    for (const t of C.allTests(c)) {
      if (C.described(m, t).length) notes.push(`${m.code} 的測試說明另列${t.short}（${labels(t, C.described(m, t))}）`);
    }
  }
  if (notes.length) out.push('📄 ' + notes.join('；'));
  out.push(`想看某一項的詳細條件，可以直接問例如「${a.aliases[0] || a.code} 低溫測試」`);
  return out.join('\n');
}

function allConditions(c) {
  const out = ['華碩商用筆電 MIL-STD-810H 各測試項目的詳細條件：'];
  C.allTests(c).forEach((t, i) => {
    out.push('');
    out.push(`${i + 1}. ${t.short}（${t.code}）`);
    out.push(...t.procedures.map((p) => '・' + C.procLine(p)));
    const passed = passedModels(c, t).map((m) => m.code);
    const desc = c.models.filter((m) => C.described(m, t).length).map((m) => m.code);
    out.push('通過型號：' + (passed.length ? passed.join('、')
      : (desc.length ? `${desc.join('、')} 的測試說明有列出（結果總表未列）` : '目前整理的機種都沒有')));
  });
  out.push('', '想看某一台型號的條件，可以問例如「P5 低溫測試」', NOTE);
  return out.join('\n');
}

// MARK: FAQ

function faqs(c) {
  const out = [];
  const tests = C.allTests(c);
  // 1) 每個型號 × 每個測試
  for (const m of c.models) {
    if (!m.aliases.length) continue;
    for (const t of tests) out.push(faq(`${m.code} ${t.short}測試`, modelTestAnswer(c, m, t), combos(m.aliases, t.aliases)));
  }
  // 2) 系列 × 每個測試
  for (const f of C.multiFamilies(c)) {
    for (const t of tests) out.push(faq(`${f.name} ${t.short}測試`, familyTestAnswer(c, f, t), combos(f.aliases, t.aliases)));
  }
  // 3) 每個測試總覽（沙漠交給「在沙漠可以用嗎」）
  for (const t of tests) {
    const keys = t.aliases.filter((a) => a !== '幾度' && a !== '沙漠' && count(a) >= 2);
    out.push(withFlex(faq(`${t.short}測試怎麼做`, testOverview(c, t), keys), F.test(c, t)));
  }
  // 4) 每個型號 / 系列通過哪些測試
  const summaryWords = ['測試項目', '哪些測試', '通過', '軍規', '810', '幾項', '耐用'];
  for (const m of c.models) {
    if (m.aliases.length) out.push(withFlex(faq(`${m.code} 通過哪些測試`, modelSummary(c, m), combos(m.aliases, summaryWords)), F.model(c, m)));
  }
  for (const f of C.multiFamilies(c)) out.push(faq(`${f.name} 通過哪些測試`, familySummary(c, f), combos(f.aliases, summaryWords)));
  // 5) 兩兩比較
  for (let i = 0; i < c.models.length; i++) {
    for (let j = i + 1; j < c.models.length; j++) {
      const a = c.models[i], b = c.models[j];
      out.push(withFlex(faq(`${a.code} 和 ${b.code} 比較`, compare(c, a, b), combos(entityAliases(c, a), entityAliases(c, b))), F.compare(c, a, b)));
    }
  }
  // 圖文選單「比較型號」：用快速選項選兩台
  if (c.models.length >= 2) {
    const f = faq('比較型號', '想比較哪兩台呢？點下面的選項，或直接輸入例如「P5 跟 B5 差在哪」🙂', ['比較型號', '型號比較', '比較機種', '機種比較', '比一比']);
    f.quickReplies = F.comparePairs(c);
    out.push(f);
  }
  // 6) 一次列出全部條件
  out.push(faq('所有測試項目的詳細條件', allConditions(c), [
    '列出+項目+條件', '列出+項目+詳細', '所有+條件', '全部+條件', '每一項+條件', '每個項目+條件', '各項目+條件', '各項+條件',
    '這些項目+條件', '這些項目+詳細', '所有+測試+詳細', '全部+測試+詳細', '所有項目', '全部項目+條件', '詳細+測試條件+列出',
    '測試條件+有哪些', '完整+條件', '全部的條件',
  ]));
  // 7) 一般問題
  out.push(...generalFAQs(c));
  return out;
}

function generalFAQs(c) {
  const ranked = [...c.models].sort((a, b) => C.passedTestCount(b, C.allTests(c)) - C.passedTestCount(a, C.allTests(c)));
  let best = '目前還沒有整理機種';
  if (ranked.length) {
    const top = ranked[0];
    const ls = [`測試項目最完整的是 ${top.display}，通過 ${C.passedTestCount(top, C.allTests(c))} 大類 💪`,
      '・' + C.allTests(c).filter((t) => C.passes(top, t).length).map((t) => t.short).join('、')];
    const desc = C.allTests(c).filter((t) => !C.passes(top, t).length && C.described(top, t).length).map((t) => t.short);
    if (desc.length) ls.push('・測試說明另列' + desc.join('、'));
    if (ranked.length > 1) ls.push(`其次是 ${ranked[1].display}（${C.passedTestCount(ranked[1], C.allTests(c))} 大類）`);
    best = ls.join('\n');
  }
  const modelList = [`目前整理的華碩商用筆電 MIL-STD-810H 官方報告共 ${c.models.length} 款：`,
    ...c.models.map((m) => '・' + m.display), '其他型號可以請專人幫您確認 🙂'].join('\n');
  const testList = ['華碩商用筆電的 MIL-STD-810H 測試項目（依型號不同）：',
    ...C.allTests(c).map((t) => `・${t.code} ${t.short}`), '想看某一項的條件，可以直接問例如「低溫測試怎麼做」'].join('\n');

  return [
    faq('MIL-STD-810H 是什麼',
      'MIL-STD-810H 是美國國防部制定的環境測試標準 📋\n・模擬產品在高低溫、濕度、高海拔、振動、衝擊、沙塵等環境下的耐受度\n・華碩指定商用筆電（ExpertBook 系列）依型號通過 MIL-STD-810G 或 810H\n・測試項目與條件依型號而異\n' + NOTE,
      ['810H是什麼', '810是什麼', '軍規是什麼', '什麼是軍規', '軍規標準', '美軍標準', 'MIL-STD', 'MILSTD', '軍規認證', '軍規+意思', '軍規+代表']),
    faq('810G 和 810H 有什麼不同',
      '810G 和 810H 是同一套標準的不同版本：\n・MIL-STD-810G：2008 年發布\n・MIL-STD-810H：2019 年發布的新版\n・華碩商用筆電依型號通過 810G 或 810H\n目前整理的機種都是 810H 的官方報告；其他型號可以請專人幫您確認 🙂',
      ['810G', '810g+810h', '810G+差別', '810G+差異', '810G+不同', '新版+舊版']),
    faq('有哪些型號通過軍規測試', modelList,
      ['哪些型號', '哪幾台', '哪些機種', '哪幾款', '型號清單', '通過軍規的型號', '有軍規的'], true),
    faq('哪一台測試最完整', best,
      ['最完整', '最多項', '最耐用', '最堅固', '最強', '測試最多', '推薦哪', '哪台最', '哪一台最', '哪款最']),
    faq('軍規測試有哪些項目', testList,
      ['測試項目', '哪些測試', '有什麼測試', '幾項測試', '測了什麼', '測哪些', '12大類', '測試清單', '還有哪些', '全部測試', '所有測試'], true),
    faq('通過軍規就保證不會壞嗎',
      '軍規測試代表在實驗室條件下通過測試，但不是保證 🙏\n・MIL-STD-810 測試只針對指定型號進行\n・不代表適合軍事用途，也不代表符合美國國防部採購規範\n・在這些條件下造成的損壞（或嘗試重現測試）視為意外損壞，不在標準保固範圍\n・可另購華碩 Premium Care 意外損壞保護',
      ['保證', '保固', '不會壞', '軍事用途', '軍用', '國防部', '意外損壞', 'Premium Care', '摔壞+保固', '保不保固', '壞了+怎麼辦']),
    faq('可以防水嗎',
      '❌ 華碩商用筆電的 MIL-STD-810H 報告中沒有防水或淋雨測試\n・濕度測試（Method 507.6）是高濕環境的耐受度，不等於防水\n・請避免讓筆電淋雨、泡水或打翻飲料\n・若不小心進水，請立即關機並送修檢查',
      ['防水', '淋雨', '下雨', '泡水', '進水', '潑到', '打翻', '飲料', '雨天', '雨中', 'IP65', 'IP68', 'IPX']),
    faq('在沙漠可以用嗎', desertAnswer(c), ['沙漠', '中東', '很熱+沙']),
    faq('測試報告在哪裡看',
      '華碩官方 MIL-STD-810H 測試報告：\n・可在華碩官網各型號的產品規格頁查詢\n・官方報告網址：asus.com/event/militarygradereport/\n・華碩支援頁「軍用標準 (MIL-STD 810) 介紹」\n需要特定型號的報告，可以請專人協助 🙂',
      ['測試報告', '報告+哪裡', '官方報告', '證明', '認證文件', '資料來源', '哪裡查', '下載+報告', 'PDF']),
  ];
}

function desertAnswer(c) {
  const dust = C.findTest(c, 'dust') || C.test('dust');
  const models = passedModels(c, dust).map((m) => `${m.code}（${C.passes(m, 'dust').map((p) => C.procedure(dust, p)).filter(Boolean).map((p) => p.label.split('（')[0]).join('＋')}）`);
  return [
    '沙漠環境可以參考高溫和沙塵兩項測試：',
    '・高溫：炎熱乾燥運作 32～49°C 3 天（開機）、儲存 33～71°C 7 天',
    '・吹沙：粒子 1.2 g/m³、風速 28 m/s、60°C',
    '・吹塵：粒子 10 ± 7 g/m³、60°C',
    '沙塵通過型號：' + (models.length ? models.join('、') : '目前整理的機種都沒有'),
    NOTE,
  ].join('\n');
}

// MARK: 背景知識文件（給 Agent / 向量檢索用，段落以空行分隔）

function doc(c) {
  const paras = [];
  paras.push('MIL-STD-810H 軍規測試 總覽（華碩 ASUS 商用筆電 ExpertBook）\nMIL-STD-810 是美國國防部制定的環境測試標準，用來模擬產品在高低溫、濕度、高海拔、振動、衝擊、沙塵等環境下的耐受度。華碩指定商用筆電（ExpertBook 系列）依型號不同，通過 MIL-STD-810G 或 MIL-STD-810H。測試項目與參數依型號而異，以華碩官方公布的各型號測試報告為準。');
  paras.push('軍規測試 注意事項 免責聲明 保固\n華碩說明：MIL-STD-810 測試只針對指定產品進行，在實驗室條件下執行，不代表產品適合軍事用途，也不代表符合美國國防部採購規範。測試結果不保證未來在相同條件下的表現。在這些條件下造成的損壞（或嘗試重現測試）視為意外損壞，不在標準保固範圍內，可另購華碩 Premium Care 意外損壞保護。');
  paras.push(`本資料涵蓋的華碩商用筆電型號\n目前整理 ${c.models.length} 款華碩官方 MIL-STD-810H 測試報告：` + c.models.map((m) => m.display).join('、') + '。其他型號請查閱華碩官網該型號的規格頁或測試報告。');

  for (const t of C.allTests(c)) {
    const title = `Method ${t.code} ${t.short} ${t.name}（${t.aliases.filter((a) => !a.includes('.')).slice(0, 8).join(' ')}）`;
    paras.push(title + '\n條件：' + t.procedures.map(C.procLine).join('；') + '。');
    const passed = passedModels(c, t).map((m) => `${m.code}（${labels(t, C.passes(m, t))}）`);
    const desc = c.models.filter((m) => C.described(m, t).length).map((m) => `${m.code}（${labels(t, C.described(m, t))}）`);
    const missing = c.models.filter((m) => !C.passes(m, t).length && !C.described(m, t).length).map((m) => m.code);
    let body = `Method ${t.code} ${t.short}測試 通過型號\n`;
    body += passed.length ? '通過：' + passed.join('、') + '。' : '結果總表中沒有型號列出此項。';
    if (desc.length) body += '測試說明另列（結果總表未列）：' + desc.join('、') + '。';
    if (missing.length) body += '報告中沒有這項測試：' + missing.join('、') + '。';
    if (t.id === 'humidity') body += '注意：濕度測試是高濕環境的耐受度，不等於防水，報告中沒有淋雨或防水（Method 506 Rain）測試。';
    paras.push(body);
  }

  for (const m of c.models) {
    const passed = C.allTests(c).filter((t) => C.passes(m, t).length).map((t) => `${t.code} ${t.short}（${labels(t, C.passes(m, t))}）`);
    const missing = C.allTests(c).filter((t) => !C.passes(m, t).length).map((t) => t.short);
    let p = `${m.display} 通過的軍規測試${m.aliases.length ? '（' + m.aliases.join(' ') + '）' : ''}\n`;
    p += passed.join('、') + '。';
    if (missing.length) p += '報告中沒有：' + missing.join('、') + '。';
    paras.push(p);
  }

  const urls = c.models.map((m) => m.reportURL).filter(Boolean);
  paras.push('資料來源 官方測試報告\n本資料整理自華碩官方公開的 MIL-STD-810H 測試報告 PDF' + (urls.length ? '（' + urls.join(' ') + '）' : '') + '，以及華碩支援頁「軍用標準 (MIL-STD 810) 介紹」。各型號以華碩官網最新公布資訊為準。');

  return makeDoc(DOC_TITLE, paras.join('\n\n'));
}

const generate = (c) => ({ faqs: faqs(c), doc: doc(c) });

module.exports = { TAG, DOC_TITLE, NOTE, generate, faqs, doc };
