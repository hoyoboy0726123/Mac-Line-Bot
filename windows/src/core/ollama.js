'use strict';
// 呼叫本機 Ollama（qwen3.5:9b 回答、bge-m3 向量）。
// 用原生 /api/chat：/v1 相容端點不會帶 think 參數，Qwen 會開始「思考」而慢到不能用。

class OllamaError extends Error {
  constructor(message) { super(`Ollama：${message}`); this.name = 'OllamaError'; }
}

/// 所有呼叫用同一個 context 大小，Ollama 才不會為了不同大小重新載入模型
const CONTEXT_SIZE = 16384;

/// 合併兩個中止訊號（逾時 + 外部取消）
function combine(signal, ms) {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

class OllamaClient {
  constructor({ baseURL, chatModel, embedModel }) {
    this.baseURL = (baseURL || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
    this.chatModel = chatModel;
    this.embedModel = embedModel;
  }

  async post(path, body, timeoutSec, signal) {
    let res;
    try {
      res = await fetch(this.baseURL + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: combine(signal, timeoutSec * 1000),
      });
    } catch (e) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new OllamaError('回應逾時');
      throw new OllamaError('無法連線（Ollama 沒有在執行？）');
    }
    const obj = await res.json().catch(() => ({}));
    if (res.status !== 200) throw new OllamaError(obj.error || `HTTP ${res.status}`);
    return obj;
  }

  // MARK: 狀態

  /// 已安裝的模型名稱；Ollama 沒在跑就丟錯
  async installedModels() {
    const res = await fetch(this.baseURL + '/api/tags', { signal: AbortSignal.timeout(3000) });
    const obj = await res.json().catch(() => ({}));
    return (obj.models || []).map((m) => m.name).filter(Boolean);
  }

  static has(model, installed) {
    return installed.includes(model) || installed.includes(model + ':latest');
  }

  /// 先把模型載入記憶體並常駐，第一位顧客就不用等冷啟動
  async warmUp() {
    await this.post('/api/chat', {
      model: this.chatModel, messages: [{ role: 'user', content: 'hi' }],
      think: false, stream: false, keep_alive: -1, options: { num_predict: 1, num_ctx: CONTEXT_SIZE },
    }, 180).catch(() => {});
    await this.embed(['暖機']).catch(() => {});
  }

  /// 下載模型，onProgress(完成比例 0~1, 狀態文字)
  async pull(model, onProgress) {
    const res = await fetch(this.baseURL + '/api/pull', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    });
    if (!res.ok || !res.body) throw new OllamaError(`下載 ${model} 失敗（HTTP ${res.status}）`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let j;
        try { j = JSON.parse(line); } catch { continue; }
        if (j.error) throw new OllamaError(j.error);
        const ratio = j.total ? (j.completed || 0) / j.total : null;
        onProgress && onProgress(ratio, j.status || '');
      }
    }
  }

  // MARK: 對話

  /// 結構化輸出：format 傳 JSON Schema，Ollama 會用 grammar 限制成合法 JSON
  async chatJSON({ system, user, schema, temperature = 0.2, maxTokens = 450, timeout = 20, signal }) {
    const r = await this.post('/api/chat', {
      model: this.chatModel,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: false, think: false, keep_alive: -1, format: schema,
      options: { temperature, num_predict: maxTokens, num_ctx: CONTEXT_SIZE },
    }, timeout, signal);
    try {
      return JSON.parse((r.message && r.message.content) || '');
    } catch {
      throw new OllamaError('回傳的 JSON 格式不正確');
    }
  }

  async chat(prompt, { timeout = 60, signal } = {}) {
    const r = await this.post('/api/chat', {
      model: this.chatModel, messages: [{ role: 'user', content: prompt }],
      stream: false, think: false, keep_alive: -1, options: { num_predict: 600, num_ctx: CONTEXT_SIZE },
    }, timeout, signal);
    return ((r.message && r.message.content) || '').trim();
  }

  /// Agent 用：帶工具的一輪對話，回傳模型的 message（可能有 tool_calls）
  async chatTurn(messages, tools, { maxTokens = 1200, timeout = 60, signal } = {}) {
    const r = await this.post('/api/chat', {
      model: this.chatModel, messages, tools,
      stream: false, think: false, keep_alive: -1,
      // 不要加 repeat_penalty：會懲罰「照抄數字」，模型反而改寫成國字
      options: { temperature: 0.2, num_predict: maxTokens, num_ctx: CONTEXT_SIZE },
    }, timeout, signal);
    if (!r.message) throw new OllamaError('沒有回傳訊息');
    return r.message;
  }

  // MARK: 向量

  async embed(texts, { timeout = 60, signal } = {}) {
    if (!texts.length) return [];
    const r = await this.post('/api/embed', { model: this.embedModel, input: texts, keep_alive: -1 }, timeout, signal);
    if (!Array.isArray(r.embeddings) || r.embeddings.length !== texts.length) throw new OllamaError('向量回傳數量不符');
    return r.embeddings;
  }
}

module.exports = { OllamaClient, OllamaError, CONTEXT_SIZE };
