'use strict';
// Agent 模式：Qwen 可以用工具反覆查知識庫，把顧客要的資料查齊後才回覆（對照 Mac 版 AgentEngine.swift）
//
// 防止小模型亂編的幾道關卡：
// 1. 先由程式自動搜尋（問題列了好幾項就每項各查一次）
// 2. 回覆寫了「未列出／沒有具體」等缺口 → 要求它換關鍵字再查一次
// 3. 回覆裡的「數字＋單位」都要在查到的資料裡找得到，找不到就退回重寫

const { prefix } = require('./util');
const { rank } = require('./retriever');
const { normalized, cosine } = require('./vectors');
const ai = require('./ai');
const { OllamaError } = require('./ollama');

const MAX_ROUNDS = 6;

const tool = (name, description, properties, required) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

const TOOLS = [
  tool('search', '用關鍵字或問題語意搜尋知識庫，回傳最相關的 5 段資料（含編號）。可以換不同關鍵字（項目名稱、Method 編號、型號）多查幾次',
    { query: { type: 'string' } }, ['query']),
  tool('list_sections', '列出知識庫段落標題與編號，用來確認還有哪些項目沒查', {}, []),
  tool('read_sections', '依編號讀取段落全文，一次最多 8 段', { ids: { type: 'array', items: { type: 'integer' } } }, ['ids']),
];

/// 「沙塵、凍融和艦載振動這三項的條件」→ ["沙塵", "凍融", "艦載振動"]
function splitItems(question) {
  const q = question.replace(/(這|那)?(幾|三|兩|二|四|五|六)?項.*$/, '');
  const parts = q.split(/[、，,和跟及與/]/).map((p) => p.trim()).filter((p) => [...p].length >= 2);
  return parts.length >= 2 ? parts.slice(0, 6) : [];
}

/// 去掉模型偶爾輸出的 Markdown 粗體與 LaTeX：$10 \pm 7\text{ g/m}^3$ → 10 ± 7 g/m³
function stripMarkup(text) {
  let t = text || '';
  const pairs = [['\\pm', '±'], ['^\\circ', '°'], ['\\circ', '°'], ['^3', '³'], ['^2', '²'], ['\\times', '×'],
    ['\\sim', '～'], ['\\%', '%'], ['**', ''], ['__', ''], ['$', '']];
  for (const [a, b] of pairs) t = t.split(a).join(b);
  t = t.replace(/\\(text|mathrm)\{([^}]*)\}/g, '$2');
  t = t.replace(/^#+\s*/gm, '');
  return t;
}

/// 「數字＋單位」在資料原文找不到的清單，例如資料是「100 mm」但回覆寫「10 mm」
function ungroundedNumbers(reply, corpus) {
  // 長的單位放前面，避免「g/m³」被當成「g」
  const units = 'W/m²|ft/min|g/m³|m/s|個循環|分鐘|小時|公分|公尺|英尺|mm|cm|ms|Hz|°C|°F|天|次|%|G|g|位|筆';
  const re = new RegExp(`(-?\\d[\\d,]*(?:\\.\\d+)?)\\s*(${units})`, 'g');
  const squash = (s) => s.replace(/[ ,]/g, '');
  const body = squash(corpus);
  const bad = [];
  for (const m of reply.matchAll(re)) {
    const number = m[1].replace(/,/g, '');
    const unit = m[2];
    const k = number + unit;
    let found = false;
    for (let i = body.indexOf(k); i >= 0; i = body.indexOf(k, i + 1)) {
      // 前面不能緊接著數字（避免「100mm」裡的「00mm」被當成「0mm」）
      if (i === 0 || !/\p{N}/u.test(body[i - 1])) { found = true; break; }
    }
    const label = `${number} ${unit}`;
    if (!found && !bad.includes(label)) bad.push(label);
  }
  return bad;
}

class AgentEngine {
  constructor({ client, pieces, vectors }) {
    this.client = client;
    this.pieces = pieces;
    this.vectors = vectors;
  }

  async search(query, top = 5, signal) {
    const qv = normalized((await this.client.embed([query], { signal }))[0] || []);
    const semantic = this.vectors.map((v) => cosine(qv, v));
    return rank(query, this.pieces, semantic).slice(0, top);
  }

  render(ids) {
    return ids.filter((i) => i >= 0 && i < this.pieces.length).map((i) => `[${i}] ${prefix(this.pieces[i], 900)}`).join('\n\n');
  }

  listSections() {
    // 「型號 × 單項」的段落太多，清單只列總覽類，細項用 search 查
    const modelPrefixes = ['問：P5405CSA ', '問：B5302C ', '問：B1400CBA ', '問：L1400 ', '問：ExpertBook B1 '];
    return this.pieces.map((p, i) => {
      const title = p.split('\n')[0] || '';
      if (modelPrefixes.some((m) => title.startsWith(m)) && !title.includes('通過哪些')) return null;
      return `[${i}] ${prefix(title, 60)}`;
    }).filter(Boolean).join('\n');
  }

  systemPrompt(store, rules) {
    return ai.instructions(store, rules) + `

工作方式（你可以使用工具）：
A. 系統已經先幫你搜尋過，結果在對話裡。先判斷這些資料夠不夠回答：不夠就用 search（換關鍵字、項目名稱、Method 編號、型號）、list_sections、read_sections 繼續查。顧客要列出好幾項時，每一項都要查到具體內容。
B. 只能使用查到的資料，絕對不可以用你自己的知識補充或編造任何數字、測試項目或規格。
D. 數字一律用阿拉伯數字，連同單位照抄原文（例如「10 ± 7 g/m³」「300～1750 ft/min」「60°C」），不可以改寫成國字或換算單位。
C. 資料查齊後，直接用文字回覆顧客（不要再呼叫工具）。不要用 Markdown 粗體、標題或 LaTeX 數學式，純文字即可。`;
  }

  /// → { reply, answerable, rounds, searches }
  async run({ question, history, store, rules, signal }) {
    let anyRelevant = false;
    const searches = [];

    // 1) 程式先搜尋：整句一次，問題列了好幾項就每項再各查一次
    const seedIds = [];
    for (const q of [question, ...splitItems(question)]) {
      const hits = await this.search(q, q === question ? 5 : 3, signal);
      searches.push(q);
      for (const h of hits) if (!seedIds.includes(h.index)) seedIds.push(h.index);
      anyRelevant = anyRelevant || hits.some((h) => h.relevant);
    }
    let corpus = this.render(seedIds);

    const messages = [{ role: 'system', content: this.systemPrompt(store, rules) }];
    for (const m of (history || []).slice(-4)) {
      if (!['customer', 'bot', 'owner'].includes(m.role)) continue;
      messages.push({ role: m.role === 'customer' ? 'user' : 'assistant', content: prefix(m.text, 300) });
    }
    messages.push({ role: 'user', content: question });
    messages.push({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'search', arguments: { query: question } } }] });
    messages.push({ role: 'tool', content: corpus, tool_name: 'search' });

    let checkedGaps = false, fixedNumbers = false;
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const message = await this.client.chatTurn(messages, TOOLS, { signal });
      messages.push(message);
      const calls = message.tool_calls || [];

      if (calls.length) {
        for (const call of calls) {
          const fn = call.function || {};
          const name = fn.name || '';
          let args = fn.arguments || {};
          if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
          let output = '';
          if (name === 'search') {
            const q = args.query || question;
            const hits = await this.search(q, 5, signal);
            searches.push(q);
            anyRelevant = anyRelevant || hits.some((h) => h.relevant);
            output = this.render(hits.map((h) => h.index));
          } else if (name === 'read_sections') {
            const ids = (Array.isArray(args.ids) ? args.ids : []).map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x)).slice(0, 8);
            output = this.render(ids);
          } else if (name === 'list_sections') {
            output = this.listSections();
          } else {
            output = '沒有這個工具';
          }
          corpus += '\n\n' + output;
          messages.push({ role: 'tool', content: output, tool_name: name });
        }
        continue;
      }

      const reply = ai.formatForLINE(stripMarkup(message.content || ''));
      if (!reply) throw new OllamaError('Agent 沒有產生回覆');

      // 2) 回覆有缺口 → 換關鍵字再查（只要求一次）
      const gaps = ['未明確', '未列出', '沒有具體', '無法提供', '未提及', '沒有詳細', '僅標註'].filter((g) => reply.includes(g));
      if (gaps.length && !checkedGaps && round < MAX_ROUNDS) {
        checkedGaps = true;
        messages.push({ role: 'user', content: `請檢查：顧客問的每一項都查到具體資料了嗎？回覆中寫「${gaps.join('、')}」的項目，請換關鍵字用 search 再查（例如用項目名稱或 Method 編號）。查完後重新完整回覆。` });
        continue;
      }

      // 3) 數字＋單位都要找得到出處
      const bad = ungroundedNumbers(reply, corpus);
      if (bad.length && !fixedNumbers && round < MAX_ROUNDS) {
        fixedNumbers = true;
        messages.push({ role: 'user', content: `回覆裡的「${bad.join('、')}」在查到的資料中找不到原文。請只用查到的資料、數字照抄，重新回覆。` });
        continue;
      }
      if (bad.length) throw new OllamaError(`回覆含有查不到出處的數字：${bad.join('、')}`);

      return { reply, answerable: anyRelevant && !ai.saysNoInfo(reply), rounds: round, searches };
    }
    throw new OllamaError(`Agent 查了 ${MAX_ROUNDS} 輪還沒完成`);
  }
}

module.exports = { AgentEngine, TOOLS, splitItems, stripMarkup, ungroundedNumbers };
