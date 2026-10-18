'use strict';
// 軍規機種的「一鍵產生知識庫」（對照 Mac 版 MILState.swift）

const G = require('./generator');

const OLD_DOC_TITLE = 'ASUS商用筆電-MIL-STD-810H軍規測試';
/// 自動產生的題目被手動改過後換成這個標記，重新產生時保留，不會被覆蓋
const EDITED = '#手動修改';
const editedQuestions = (data) => new Set((data.faqs || []).filter((f) => (f.keywords || []).includes(EDITED)).map((f) => f.question));

/// 機種資料改過、還沒重新產生
function needsRegenerate(catalog, data) {
  if (!catalog) return false;
  if (!catalog.lastGenerated) return true;
  const sig = (f) => [f.question, f.answer, f.flex || '', (f.quickReplies || []).join('|')].join('\u0001');
  const kept = editedQuestions(data);
  const generated = new Set(G.faqs(catalog).filter((f) => !kept.has(f.question)).map(sig));
  const current = new Set((data.faqs || []).filter((f) => (f.keywords || []).includes(G.TAG)).map(sig));
  if (generated.size !== current.size) return true;
  for (const k of generated) if (!current.has(k)) return true;
  return false;
}

/// 只替換自動產生的部分，手動新增的 FAQ 不會動。呼叫端負責設定 lastGenerated 與重建向量
function applyGenerated(data, catalog) {
  const out = G.generate(catalog);
  const kept = editedQuestions(data);
  const fresh = out.faqs.filter((f) => !kept.has(f.question));
  const newQuestions = new Set(fresh.map((f) => f.question));
  const before = data.faqs.length;
  data.faqs = data.faqs.filter((f) => !(f.keywords || []).includes(G.TAG) && !newQuestions.has(f.question));
  const removed = before - data.faqs.length;
  data.faqs.push(...fresh);
  data.docs = (data.docs || []).filter((d) => d.title !== G.DOC_TITLE && d.title !== OLD_DOC_TITLE);
  data.docs.unshift(out.doc);
  return { faqs: fresh.length, kept: kept.size, removed, paragraphs: out.doc.content.split('\n\n').length };
}

module.exports = { EDITED, needsRegenerate, applyGenerated, ...G, catalog: require('./catalog'), parser: require('./parser') };
