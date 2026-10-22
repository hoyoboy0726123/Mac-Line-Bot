'use strict';
// FAQ 比對與知識片段挑選（逐行對照 Mac 版 KnowledgeRetriever.swift）

const { chars, count, prefix } = require('./util');
const { storeAsKnowledge, isMIL } = require('./models');

const fillers = ['請問', '想問', '我想', '你們', '妳們', '您們', '貴店', '一下', '可以', '嗎', '呢', '吧', '啊', '喔', '哦', '的', '是', '有沒有', '有', '會不會', '能不能', '到', '會'];

/// 小寫、去掉標點、空白與符號
const normalize = (text) => (text || '').toLowerCase().replace(/[\p{P}\p{S}\p{White_Space}\p{Cc}]/gu, '');

function core(text) {
  let s = normalize(text);
  for (const f of fillers) s = s.split(f).join('');
  return s.length ? s : normalize(text);
}

function bigrams(s) {
  const a = chars(s);
  if (a.length <= 1) return new Set(a.length ? [a.join('')] : []);
  const set = new Set();
  for (let i = 0; i < a.length - 1; i++) set.add(a[i] + a[i + 1]);
  return set;
}

const intersectCount = (x, y) => { let n = 0; for (const v of x) if (y.has(v)) n++; return n; };

function similarity(a, b) {
  const x = bigrams(a), y = bigrams(b);
  if (!x.size || !y.size) return 0;
  return (2 * intersectCount(x, y)) / (x.size + y.size);
}

// MARK: FAQ

/// 常見問題直接回標準答案（不經過模型）。關鍵字「A+B」代表兩個都要出現
function matchFAQ(text, faqs) {
  const q = core(text);
  if (count(q) < 2) return null;
  let best = null, bestScore = 0;
  for (const faq of faqs) {
    if (faq.isEnabled === false) continue;
    const fq = core(faq.question);
    let score = similarity(q, fq);
    if (fq === q) score = 1;
    else if (count(fq) >= 2 && (q.includes(fq) || (fq.includes(q) && count(q) >= 3))) {
      // 長度越接近越像同一題
      const closeness = Math.min(count(q), count(fq)) / Math.max(count(q), count(fq));
      score = Math.max(score, 0.75 + 0.2 * closeness);
    }
    for (const k of faq.keywords || []) {
      if (k.startsWith('#')) continue;
      const raw = k.split('+');
      const parts = raw.map((p) => { const c = core(p); return c.length ? c : normalize(p); }).filter((p) => p.length);
      if (!parts.length || parts.length !== raw.length) continue;
      if (parts.length === 1 && count(parts[0]) < 2) continue;
      // 每個部分要出現在不同位置：「B1400CBA」不能同時算成「B1400CBA」和「B1400」
      let rest = q, allFound = true;
      for (const part of [...parts].sort((a, b) => count(b) - count(a))) {
        const i = rest.indexOf(part);
        if (i < 0) { allFound = false; break; }
        rest = rest.slice(0, i) + '|' + rest.slice(i + part.length);
      }
      if (!allFound) continue;
      const n = parts.reduce((s, p) => s + count(p), 0);
      score = Math.max(score, Math.min(0.97, 0.7 + 0.06 * Math.min(parts.length, 3) + 0.01 * n));
    }
    // 「#通用」的一般問題降低優先
    if ((faq.keywords || []).includes('#通用')) score -= 0.1;
    if (score > bestScore) { best = faq; bestScore = score; }
  }
  return best && bestScore >= 0.62 ? best : null;
}

// MARK: 給模型的資料

function coverage(query, text) {
  const q = bigrams(query);
  if (!q.size) return 0;
  return intersectCount(q, bigrams(text)) / q.size;
}

function termScore(terms, text) {
  const ts = terms.map(normalize).filter((t) => count(t) >= 2);
  if (!ts.length) return 0;
  const hit = ts.reduce((sum, t) => (text.includes(t) ? sum + 1 : coverage(t, text) >= 0.5 ? sum + 0.5 : sum), 0);
  return Math.min(1, hit / Math.min(ts.length, 4));
}

function chunks(text, size = 350) {
  const paragraphs = (text || '').split('\n\n').map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const p of paragraphs) {
    const a = chars(p);
    if (a.length <= size) { out.push(p); continue; }
    for (let i = 0; i < a.length; i += size) out.push(a.slice(i, i + size).join(''));
  }
  return out;
}

/// 知識庫所有段落（FAQ + 文件），順序固定，向量索引也用同一份
function pieces(data) {
  const out = [];
  for (const faq of data.faqs || []) if (faq.isEnabled !== false) out.push(`問：${faq.question}\n答：${faq.answer}`);
  for (const doc of data.docs || []) for (const c of chunks(doc.content)) out.push(`【${doc.title}】${c}`);
  return out;
}

const firstLine = (piece) => piece.split('\n')[0] || '';

function lexicalScore(q, piece, terms) {
  const body = core(piece);
  return coverage(q, body) + coverage(q, core(firstLine(piece))) * 0.5 + termScore(terms, body) * 0.8;
}

/// 問題裡的型號代碼，例如「P5 跟 B5」→ ["p5", "b5"]（MIL 版用）
function modelTokens(text) {
  if (!isMIL) return [];
  const t = normalize(text);
  const out = [];
  for (const m of t.matchAll(/[a-z]+[0-9]+[a-z0-9]*/g)) {
    const tok = m[0];
    if (tok.startsWith('milstd') || tok.startsWith('method') || tok.startsWith('ip')) continue;
    if (!out.includes(tok)) out.push(tok);
  }
  return out;
}

/// - semantic：每個段落跟問題的 bge-m3 相似度，順序同 pieces()；null 代表沒有向量
function context(text, data, { terms = [], semantic = null, budget = 1800, maxPieces = 4 } = {}) {
  const q = core(text);
  const all = pieces(data);
  let scored = [];
  const models = modelTokens(text);
  const comparing = models.length >= 2 || (isMIL && ['差', '不同', '比較', '差異', '哪個好', '哪台好', 'vs'].some((w) => text.toLowerCase().includes(w)));

  if (semantic && semantic.length === all.length) {
    all.forEach((piece, i) => {
      const sem = semantic[i];
      let lex = Math.min(1, lexicalScore(q, piece, terms));
      if (models.length) {
        const first = normalize(firstLine(piece));
        const body = normalize(piece);
        const mentioned = models.filter((m) => first.includes(m) || body.includes(m));
        if (models.some((m) => first.includes(m))) lex += 0.4;
        if (comparing && first.includes('通過哪些測試') && mentioned.length) lex += 0.6 + 0.1 * mentioned.length;
      }
      if (!(sem >= 0.5 || lex >= 0.35)) return;
      scored.push([piece, 0.65 * sem + 0.35 * lex]);
    });
  } else {
    for (const piece of all) scored.push([piece, lexicalScore(q, piece, terms)]);
  }

  let result = '';
  const store = storeAsKnowledge(data.store || {});
  if (store) result = '店家資訊：\n' + prefix(store, 600) + '\n\n';
  let used = 0;
  if (comparing && models.length) {
    for (const piece of all) {
      const first = normalize(firstLine(piece));
      if (!(first.includes('通過哪些測試') && models.some((m) => normalize(piece).includes(m)) && used < maxPieces
        && count(result) + count(piece) <= budget)) continue;
      result += piece + '\n\n';
      used++;
    }
    scored = scored.filter(([p]) => !result.includes(p));
  }
  const ranked = [...scored].sort((a, b) => b[1] - a[1]);
  const best = ranked.length ? ranked[0][1] : 0;
  const minScore = semantic == null ? 0.15 : 0.3;
  const ratio = semantic == null ? 0.5 : 0.75;
  for (const [block, score] of ranked) {
    if (!(used < maxPieces && score >= minScore && score >= best * ratio)) break;
    if (count(result) + count(block) > budget) continue;
    result += block + '\n\n';
    used++;
  }
  return result.trim();
}

/// Agent 搜尋工具用：所有段落依混合分數排序；relevant = 語意或字面至少一邊有把握
function rank(text, all, semantic) {
  const q = core(text);
  const models = modelTokens(text);
  const out = all.map((piece, i) => {
    let lex = Math.min(1, lexicalScore(q, piece, []));
    if (models.length && models.some((m) => normalize(firstLine(piece)).includes(m))) lex += 0.4;
    const sem = semantic && i < semantic.length ? semantic[i] : 0;
    const score = semantic == null ? lex : 0.65 * sem + 0.35 * lex;
    return { index: i, score, relevant: sem >= 0.5 || lex >= 0.35 };
  });
  return out.sort((a, b) => b.score - a.score);
}

/// 「第13項」「第三個」這類指向上一則內容的說法
const refersToPrevious = (text) => /第\s*([0-9]+|[一二三四五六七八九十]+)\s*(項|個|點|款|台)/.test(text);

/// 接著上一題的追問：「有通過的型號」「那低溫呢」
/// 打招呼、道謝、「好的」這類寒暄：很短但不是追問
const SMALL_TALK = /^(你好|您好|哈囉|嗨|hi|hello|hey|早安|午安|晚安|謝謝|謝啦|感謝|多謝|thanks?|thank you|ok|okay|好|好的|好喔|了解|瞭解|收到|知道了|沒問題|掰掰|再見|bye)(你|您|囉|啦|喔|哦|呀|唷)?[\s!！。.~～?？]*$/i;

const isSmallTalk = (text) => SMALL_TALK.test((text || '').trim());
/// 問機器人本身：「你是誰」「你能做什麼」「要怎麼問」
const ABOUT_BOT = /^(請問)?(你|您)(是誰|是什麼|是機器人嗎|是真人嗎|能做什麼|可以做什麼|會什麼|能幫我什麼|可以幫我什麼)|^(這個?)?(要)?(怎麼用|怎麼問|可以問什麼|能問什麼)/;
const isAboutBot = (text) => ABOUT_BOT.test((text || '').trim()) && count((text || '').trim()) <= 14;

function isFollowUp(text) {
  const t = (text || '').trim();
  if (isSmallTalk(t) || isAboutBot(t)) return false;
  const markers = ['這些', '那些', '這個', '那個', '這項', '那項', '它', '其他', '還有', '呢', '哪些型號', '有通過', '哪幾台', '那', '上面', '剛剛'];
  return count(t) <= 6 || markers.some((m) => t.includes(m));
}

/// context 裡有沒有真的放進知識庫內容（只有店家基本資料不算）
const hasKnowledge = (ctx) => ctx.includes('【') || ctx.includes('問：');

function containsAny(text, keywords) {
  const t = normalize(text);
  return (keywords || []).find((k) => { const kk = normalize(k); return kk.length && t.includes(kk); }) || null;
}

module.exports = {
  isSmallTalk, isAboutBot, normalize, core, bigrams, similarity, matchFAQ, coverage, termScore, chunks, pieces, lexicalScore,
  modelTokens, context, rank, refersToPrevious, isFollowUp, hasKnowledge, containsAny,
};
