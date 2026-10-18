'use strict';
// 知識庫段落的 bge-m3 向量快取。key = 段落文字 SHA256 前 12 bytes（跟 Mac 版相同），內容沒變就不用重算

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const key = (text) => crypto.createHash('sha256').update(text, 'utf8').digest().subarray(0, 12).toString('hex');

function normalized(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return n > 0 ? v.map((x) => x / n) : v;
}

/// 兩個已正規化的向量做內積 = cosine 相似度
function cosine(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

class VectorIndex {
  constructor() {
    this.model = null;
    this.vectors = new Map();
    this.pending = null; // 同時有兩個請求時排隊，避免重複計算
  }

  file() {
    const safe = this.model.replace(/[/:]/g, '_');
    return path.join(store.baseDir(), `vectors-${safe}.json`);
  }

  load(model) {
    if (this.model === model) return;
    this.model = model;
    const obj = store.load(this.file());
    this.vectors = new Map(Object.entries(obj || {}));
  }

  save() {
    store.save(Object.fromEntries(this.vectors), this.file());
  }

  get count() { return this.vectors.size; }

  /// 取得這些文字的向量，缺的一次批次算好
  async get(texts, client) {
    const run = async () => {
      this.load(client.embedModel);
      const keys = texts.map(key);
      const missing = [...new Set(texts.filter((t, i) => !this.vectors.has(keys[i])))];
      for (let i = 0; i < missing.length; i += 32) {
        const batch = missing.slice(i, i + 32);
        const result = await client.embed(batch, { timeout: 180 });
        batch.forEach((t, j) => this.vectors.set(key(t), normalized(result[j])));
      }
      if (missing.length) this.save();
      return keys.map((k) => this.vectors.get(k) || []);
    };
    const prev = this.pending || Promise.resolve();
    const p = prev.catch(() => {}).then(run);
    this.pending = p;
    return p;
  }

  async rebuild(texts, client) {
    this.load(client.embedModel);
    this.vectors = new Map();
    await this.get(texts, client);
    return this.vectors.size;
  }
}

module.exports = { VectorIndex, key, normalized, cosine, shared: new VectorIndex() };
