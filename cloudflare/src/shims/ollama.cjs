'use strict';
// 雲端版的 AI：取代 windows/src/core/ollama.js，介面跟 OllamaClient 相同，底層改呼叫 Workers AI（env.AI）
// 回答：@cf/qwen/qwen3-30b-a3b-fp8；向量：@cf/baai/bge-m3（跟本機版同一個向量模型）

class OllamaError extends Error {
  constructor(message) { super(`Workers AI：${message}`); this.name = 'OllamaError'; }
}

const CONTEXT_SIZE = 16384;
const DEFAULT_CHAT = '@cf/qwen/qwen3-30b-a3b-fp8';
const DEFAULT_EMBED = '@cf/baai/bge-m3';

let binding = null;
/// Durable Object 啟動時把 env.AI 交給這裡
const setAI = (ai) => { binding = ai; };

/// 用量統計（顯示在「使用量」頁）
const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };

/// Qwen3 預設會先「思考」很久；/no_think 讓它直接回答
const NO_THINK = '/no_think';

/// 去掉 <think>…</think>
const stripThink = (s) => String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*?<\/think>/, '').trim();

/// Ollama 格式的訊息 → OpenAI 格式（Workers AI 用）
function toOpenAI(messages) {
  const out = [];
  let pending = [];
  let seq = 0;
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
      const calls = m.tool_calls.map((c) => {
        const id = c.id || `call_${++seq}`;
        const fn = c.function || {};
        pending.push({ id, name: fn.name });
        return { id, type: 'function', function: { name: fn.name, arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments || {}) } };
      });
      out.push({ role: 'assistant', content: m.content || '', tool_calls: calls });
    } else if (m.role === 'tool') {
      const i = pending.findIndex((p) => !m.tool_name || p.name === m.tool_name);
      const call = i >= 0 ? pending.splice(i, 1)[0] : { id: `call_${++seq}`, name: m.tool_name };
      out.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: m.content });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

/// Workers AI 的回傳有兩種格式：{ response, tool_calls } 或 OpenAI 的 { choices: [{ message }] }
function fromResult(r) {
  if (r && r.usage) {
    usage.inputTokens += r.usage.prompt_tokens || 0;
    usage.outputTokens += r.usage.completion_tokens || 0;
  }
  const msg = r && r.choices && r.choices[0] && r.choices[0].message;
  if (msg) {
    return {
      content: stripThink(msg.content || ''),
      tool_calls: (msg.tool_calls || []).map((c) => ({ id: c.id, function: { name: c.function && c.function.name, arguments: (c.function && c.function.arguments) || {} } })),
    };
  }
  const text = typeof r === 'string' ? r : (r && (typeof r.response === 'string' ? r.response : r.response != null ? JSON.stringify(r.response) : '')) || '';
  return {
    content: stripThink(text),
    tool_calls: ((r && r.tool_calls) || []).map((c) => ({ function: { name: c.name || (c.function && c.function.name), arguments: c.arguments || (c.function && c.function.arguments) || {} } })),
  };
}

class OllamaClient {
  constructor({ chatModel, embedModel }) {
    this.chatModel = chatModel && chatModel.startsWith('@') ? chatModel : DEFAULT_CHAT;
    this.embedModel = embedModel && embedModel.startsWith('@') ? embedModel : DEFAULT_EMBED;
  }

  async run(model, input, timeoutSec, signal) {
    if (!binding) throw new OllamaError('沒有設定 AI 綁定');
    usage.calls += 1;
    const work = binding.run(model, input);
    const limits = [new Promise((_, reject) => setTimeout(() => reject(new OllamaError('回應逾時')), timeoutSec * 1000))];
    if (signal) limits.push(new Promise((_, reject) => signal.addEventListener('abort', () => reject(new OllamaError('已取消')), { once: true })));
    try {
      return await Promise.race([work, ...limits]);
    } catch (e) {
      if (e instanceof OllamaError) throw e;
      throw new OllamaError(e.message || String(e));
    }
  }

  // MARK: 狀態（雲端模型一定在）

  async installedModels() { return [this.chatModel, this.embedModel]; }
  static has() { return true; }
  async warmUp() {}
  async pull() {}

  // MARK: 對話

  async chatJSON({ system, user, schema, temperature = 0.2, maxTokens = 450, timeout = 20, signal }) {
    const r = await this.run(this.chatModel, {
      messages: [{ role: 'system', content: `${system}\n\n只輸出一個 JSON 物件，不要其他文字。${NO_THINK}` }, { role: 'user', content: user }],
      temperature, max_tokens: maxTokens + 200,
      response_format: { type: 'json_schema', json_schema: schema },
    }, timeout, signal);
    const { content } = fromResult(r);
    if (r && typeof r.response === 'object' && r.response) return r.response;
    const m = /\{[\s\S]*\}/.exec(content);
    try {
      return JSON.parse(m ? m[0] : content);
    } catch {
      throw new OllamaError('回傳的 JSON 格式不正確');
    }
  }

  async chat(prompt, { timeout = 60, signal } = {}) {
    const r = await this.run(this.chatModel, { messages: [{ role: 'user', content: `${prompt}\n${NO_THINK}` }], max_tokens: 800 }, timeout, signal);
    return fromResult(r).content;
  }

  /// Agent：帶工具的一輪對話，回傳 Ollama 格式的 message
  async chatTurn(messages, tools, { maxTokens = 1200, timeout = 60, signal } = {}) {
    const msgs = toOpenAI(messages);
    if (msgs[0] && msgs[0].role === 'system') msgs[0] = { ...msgs[0], content: `${msgs[0].content}\n${NO_THINK}` };
    const r = await this.run(this.chatModel, { messages: msgs, tools, temperature: 0.2, max_tokens: maxTokens }, timeout, signal);
    const m = fromResult(r);
    return { role: 'assistant', content: m.content, tool_calls: m.tool_calls.length ? m.tool_calls : undefined };
  }

  // MARK: 向量

  async embed(texts, { timeout = 60, signal } = {}) {
    if (!texts.length) return [];
    const r = await this.run(this.embedModel, { text: texts }, timeout, signal);
    const data = r && (r.data || r.embeddings);
    if (!Array.isArray(data) || data.length !== texts.length) throw new OllamaError('向量回傳數量不符');
    return data;
  }
}

module.exports = { OllamaClient, OllamaError, CONTEXT_SIZE, setAI, usage, DEFAULT_CHAT, DEFAULT_EMBED, toOpenAI, fromResult };
