'use strict';
// AI 回答（Windows 版只用本機 Ollama：Qwen 回答 + bge-m3 檢索）。提示詞與 Mac 版相同。

const { TONES } = require('./models');
const { prefix, count, withTimeout } = require('./util');
const { OllamaError } = require('./ollama');

function instructions(store, rules) {
  const name = store.name ? store.name : '這家店';
  const tone = (TONES[rules.tone] || TONES.friendly).instruction;
  return `你是「${name}」的 LINE 官方帳號客服。
${tone}${rules.useEmoji ? '可以使用少量表情符號。' : '不要使用表情符號。'}
規則：
1. 先在「參考資料」中找出跟問題有關的內容，再用這些內容回答。資料有寫的就要具體回答，不要說沒有資料。
2. 顧客問「可不可以、會不會壞、能不能用」這類問題時，不要回答沒有資訊，而是說明資料中相關的測試或規格條件（數字照抄），讓顧客自己判斷；不要保證一定不會壞。
3. 參考資料完全沒有相關內容時，才說目前沒有這項資訊；絕對不可以編造資料以外的價格、規格、時間、地址、活動或承諾。
4. 每個數字、條件都要跟它所屬的型號或項目對應，不可以把 A 型號的資料說成 B 型號的；資料寫「沒有」某項測試時，就直接回答沒有。顧客提到參考資料裡沒有的型號時，直接說目前沒有這個型號的資料，絕對不可以假設它是另一個型號、也不可以拿別的型號的資料來回答。
5. 一律使用繁體中文，不要夾雜英文單字（型號、Method 編號、單位除外）。排版要清楚好讀：第一行先用一句話回答重點；有兩項以上的內容就換行條列，每行用「・」開頭、一行只放一項；最後可以補一行提醒。不要把很多項目擠成一大段。一般回覆 ${rules.maxReplyLength} 字以內，條列時可以較長但最多 10 點。
6. 不要提到你是 AI 模型，不要說「根據資料」「參考資料」，也不要提到文件標題。
7. 不處理退款、法律、醫療等需要店家判斷的事情。
8. 不要說「可以安全使用」「沒問題」「可正常使用」「一定不會壞」這類保證的話。
9. 不要自行推測資料沒寫的內容（例如型號的世代、上市時間、價格）。
10. 報告裡沒有列出的測試，要說「報告中沒有這項測試」，不可以說「未通過」或「不合格」。
12. 顧客要你列出很多項目時，參考資料裡有的就完整列出；參考資料剛好沒有包含某一項的細節時，寫「可以再單獨詢問這一項」，絕對不要寫「資料中未列出」「沒有具體條件」。
11. 顧客比較兩個型號時，參考資料裡有兩邊各自的測試清單就是可以回答：逐項對照，列出「兩台都有」「只有 A 有」「只有 B 有」，不要說沒有差異資料。`;
}

/// 參考資料 + 最近對話 + 顧客最新訊息
function prompt(question, knowledge, history) {
  let p = `參考資料：\n${knowledge || '（沒有資料）'}\n\n`;
  const recent = (history || []).slice(-6).filter((m) => ['customer', 'bot', 'owner'].includes(m.role));
  if (recent.length) {
    p += '最近對話：\n';
    for (const m of recent) p += (m.role === 'customer' ? '顧客：' : '客服：') + prefix(m.text, 200) + '\n';
    p += '\n';
  }
  return p + `顧客最新訊息：${question}`;
}

const answerSchema = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['question', 'reservation', 'humanAgent', 'greeting', 'thanks', 'complaint', 'other'] },
    evidence: { type: 'string' },
    reply: { type: 'string' },
  },
  required: ['intent', 'evidence', 'reply'],
};

/// 依知識庫回答 → { intent, answerable, reply, model }
async function answer({ question, knowledge, history, store, rules, client, signal }) {
  const system = instructions(store, rules) + `

輸出 JSON：
- intent：顧客意圖（question 詢問資訊／reservation 想預約／humanAgent 要找真人／greeting 打招呼／thanks 道謝／complaint 抱怨／other）
- evidence：從參考資料原文摘錄最相關的 1～2 句，最多 120 字；完全沒有相關內容才留空字串
- reply：給顧客的回覆，照上面的排版規則`;
  const j = await client.chatJSON({ system, user: prompt(question, knowledge, history), schema: answerSchema, timeout: 45, signal });
  const intent = answerSchema.properties.intent.enum.includes(j.intent) ? j.intent : 'other';
  const evidence = String(j.evidence || '').trim();
  const reply = formatForLINE(String(j.reply || ''));
  if (!reply) throw new OllamaError('沒有產生回覆');
  return { intent, answerable: !!evidence && !saysNoInfo(reply), reply, model: client.chatModel };
}

/// 沒有向量時：把口語問題轉成資料裡可能出現的術語（例如「摔到地上」→ 跌落、衝擊、Drop）
async function searchTerms(question, client, signal) {
  try {
    const j = await client.chatJSON({
      system: '你負責幫客服搜尋資料庫。只輸出關鍵詞，不要回答問題。把顧客的口語問題轉換成技術文件或商品資料裡可能出現的關鍵詞：同義詞、正式術語、英文術語、相關測試或規格名稱。5 到 10 個，每個 2 到 8 個字。',
      user: `顧客問題：${question}`,
      schema: { type: 'object', properties: { keywords: { type: 'array', items: { type: 'string' } } }, required: ['keywords'] },
      temperature: 0, maxTokens: 150, timeout: 10, signal,
    });
    return (j.keywords || []).filter((k) => typeof k === 'string').slice(0, 10);
  } catch {
    return [];
  }
}

/// 模型偶爾會把多項內容擠成一段：用「；」分隔的三項以上自動改成條列
function formatForLINE(raw) {
  let text = (raw || '').trim();
  const tally = (s, c) => [...s].filter((x) => x === c).length;
  for (;;) {
    const last = text.slice(-1);
    if (!last) break;
    if ('`}"'.includes(last) || (last === '」' && tally(text, '「') < tally(text, '」'))) {
      text = text.slice(0, -1).trim();
    } else break;
  }
  text = text.split('\n').map((line) => {
    const t = line.replace(/^[ \t]+|[ \t]+$/g, '');
    for (const p of ['- ', '* ', '• ', '‧ ']) if (t.startsWith(p)) return '・' + t.slice(p.length);
    return t;
  }).join('\n');
  if (text.includes('\n・')) return text;
  const parts = text.split('；').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return text;
  const lines = [];
  let first = parts[0];
  const colon = [...first].findIndex((c) => c === '：' || c === ':');
  if (colon >= 0) {
    const a = [...first];
    lines.push(a.slice(0, colon + 1).join(''));
    first = a.slice(colon + 1).join('').replace(/^[ \t]+|[ \t]+$/g, '');
  }
  lines.push('・' + first);
  for (const p of parts.slice(1)) {
    const dot = p.indexOf('。');
    if (dot >= 0 && dot + 1 < p.length) {
      lines.push('・' + p.slice(0, dot));
      lines.push(p.slice(dot + 1).replace(/^[ \t]+|[ \t]+$/g, ''));
    } else {
      lines.push('・' + (p.endsWith('。') ? p.slice(0, -1) : p));
    }
  }
  return lines.join('\n');
}

/// 回覆本身就在說「沒有資料」→ 視為答不出來，交給待補清單
function saysNoInfo(reply) {
  if (reply.includes('\n・') || count(reply) > 80) return false;
  const phrases = ['沒有這項資訊', '目前沒有資料', '沒有相關資料', '沒有相關資訊', '沒有資料提到', '資料中沒有', '沒有明確的資訊', '無法回答', '不清楚'];
  // 「目前沒有 B7 型號的電池使用時間資料」這種中間夾了字的說法
  return phrases.some((p) => reply.includes(p)) || /^[^\n]{0,6}(目前)?(沒有|查不到|找不到)[^\n，。]{0,24}(資料|資訊)/.test(reply.trim());
}

/// 判斷訊息類型（跟 Agent 查資料同時進行）：太模糊要反問、問機器人是誰、要找真人……
const ROUTES = ['question', 'vague', 'aboutBot', 'greeting', 'thanks', 'humanAgent', 'complaint', 'reservation', 'other'];
async function route({ question, history, client, signal }) {
  const recent = (history || []).slice(-4).filter((m) => ['customer', 'bot', 'owner'].includes(m.role))
    .map((m) => (m.role === 'customer' ? '顧客：' : '客服：') + prefix(m.text, 120)).join('\n');
  try {
    const j = await client.chatJSON({
      system: `你負責判斷 LINE 客服收到的顧客最新訊息屬於哪一類，只輸出 JSON。
- question：有具體想問的內容，例如某個型號、某項測試、某種使用情境、價格、保固（就算你不知道答案也算）；要看清單也算，例如「查通過機種」「有哪些型號」「測試項目有哪些」
- vague：想查資料，但沒說要查哪個型號或哪個項目，從最近對話也看不出主題（例如「我要查」「幫我查一下」「查一下測試結果」「有資料嗎」）
- aboutBot：問你是誰、你能做什麼、要怎麼問
- greeting：打招呼；thanks：道謝；humanAgent：要找真人或業務；complaint：抱怨、不滿；reservation：要預約某個時間（訂位、預約到店），退貨、詢問門市地址都不算
- other：以上都不是`,
      user: (recent ? `最近對話：\n${recent}\n\n` : '') + `顧客最新訊息：${question}`,
      schema: { type: 'object', properties: { intent: { type: 'string', enum: ROUTES } }, required: ['intent'] },
      temperature: 0, maxTokens: 40, timeout: 15, signal,
    });
    return ROUTES.includes(j.intent) ? j.intent : 'question';
  } catch {
    return 'question';
  }
}

/// 從顧客訊息抽出預約欄位
async function extractSlots(text, today, client) {
  const keys = ['date', 'time', 'people', 'name', 'phone'];
  try {
    const j = await withTimeout(25, (signal) => client.chatJSON({
      system: `你負責從顧客的訊息中抽出訂位資訊。今天是 ${today}。只抽訊息中明確提到的內容，沒提到的欄位填空字串。date 照顧客說法（例如 10/12、明天），time 例如 19:00，people 只填數字。`,
      user: text,
      schema: { type: 'object', properties: Object.fromEntries(keys.map((k) => [k, { type: 'string' }])), required: keys },
      temperature: 0, maxTokens: 120, signal,
    }));
    const str = (k) => { const v = String(j[k] || '').trim(); return v || null; };
    const people = str('people');
    return { date: str('date'), time: str('time'), people: people ? parseInt(people.replace(/\D/g, ''), 10) || null : null, name: str('name'), phone: str('phone') };
  } catch {
    return null;
  }
}

module.exports = { instructions, prompt, answer, route, searchTerms, formatForLINE, saysNoInfo, extractSlots };
