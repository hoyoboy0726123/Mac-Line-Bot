'use strict';
// 雲端版的向量快取：取代 windows/src/core/vectors.js（介面相同）
// 每段文字一個 Float32Array，存在 Durable Object（vec:<模型>:<key>），不用 JSON 省 CPU。

const crypto = require('crypto');

const key = (text) => crypto.createHash('sha256').update(text, 'utf8').digest().subarray(0, 12).toString('hex');

function normalized(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = n > 0 ? v[i] / n : v[i];
  return out;
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

let storage = null;
const prefixOf = (model) => `vec:${model}:`;

class VectorIndex {
  constructor() {
    this.model = null;
    this.vectors = new Map();
    this.pending = null;
  }

  /// Durable Object 啟動時讀出這個模型的所有向量
  async init(st, model) {
    storage = st;
    this.model = model;
    this.vectors = new Map();
    const all = await st.list({ prefix: prefixOf(model) });
    for (const [k, v] of all) this.vectors.set(k.slice(prefixOf(model).length), v instanceof Float32Array ? v : new Float32Array(v));
  }

  get count() { return this.vectors.size; }

  async get(texts, client) {
    const run = async () => {
      if (this.model !== client.embedModel) { this.model = client.embedModel; this.vectors = new Map(); }
      const keys = texts.map(key);
      const missing = [...new Set(texts.filter((t, i) => !this.vectors.has(keys[i])))];
      for (let i = 0; i < missing.length; i += 32) {
        const batch = missing.slice(i, i + 32);
        const result = await client.embed(batch, { timeout: 180 });
        const entries = {};
        batch.forEach((t, j) => {
          const v = normalized(result[j]);
          this.vectors.set(key(t), v);
          entries[prefixOf(this.model) + key(t)] = v;
        });
        if (storage) await storage.put(entries);
      }
      return keys.map((k) => this.vectors.get(k) || []);
    };
    const prev = this.pending || Promise.resolve();
    const p = prev.catch(() => {}).then(run);
    this.pending = p;
    return p;
  }

  /// 重建：清掉這個模型的所有向量再重算
  async rebuild(texts, client) {
    this.model = client.embedModel;
    if (storage) {
      const old = await storage.list({ prefix: prefixOf(this.model) });
      const ks = [...old.keys()];
      for (let i = 0; i < ks.length; i += 128) await storage.delete(ks.slice(i, i + 128));
    }
    this.vectors = new Map();
    await this.get(texts, client);
    return this.vectors.size;
  }
}

module.exports = { VectorIndex, key, normalized, cosine, shared: new VectorIndex() };
