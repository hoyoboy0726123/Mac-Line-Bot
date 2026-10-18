'use strict';
// LINE Messaging API 呼叫（對照 Mac 版 LineAPI.swift）

const crypto = require('crypto');
const { prefix } = require('./util');

/// 測試時可以把 API 指到本機假伺服器
const BASE = () => process.env.MLB_LINE_API || 'https://api.line.me';
/// 圖片上傳用另一個網域
const DATA_BASE = () => process.env.MLB_LINE_DATA_API || process.env.MLB_LINE_API || 'https://api-data.line.me';

class LineAPIError extends Error {
  constructor(status, message) { super(`LINE API ${status}：${message}`); this.status = status; }
}

class LineAPI {
  constructor(token) { this.token = token; }

  async call(method, path, body) {
    const headers = { Authorization: `Bearer ${this.token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(BASE() + path, {
        method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      throw new LineAPIError(0, e.name === 'TimeoutError' ? '連線逾時' : '無法連線到 LINE（請檢查網路）');
    }
    const text = await res.text();
    if (res.status < 200 || res.status >= 300) {
      let message = text;
      try {
        const obj = JSON.parse(text);
        if (obj.message) {
          message = obj.message;
          const d = (obj.details || []).map((x) => x.message).filter(Boolean).join('; ');
          if (d) message += `（${d}）`;
        }
      } catch { /* 不是 JSON */ }
      throw new LineAPIError(res.status, message);
    }
    try { return text ? JSON.parse(text) : {}; } catch { return {}; }
  }

  reply(replyToken, messages) { return this.call('POST', '/v2/bot/message/reply', { replyToken, messages: messages.slice(0, 5) }); }
  push(to, messages) { return this.call('POST', '/v2/bot/message/push', { to, messages: messages.slice(0, 5) }); }

  /// 顯示「輸入中」動畫，讓顧客知道 AI 在想
  async startLoading(chatId, seconds = 20) {
    await this.call('POST', '/v2/bot/chat/loading/start', { chatId, loadingSeconds: seconds }).catch(() => {});
  }

  async botInfo() {
    const o = await this.call('GET', '/v2/bot/info');
    return { userId: o.userId || '', basicId: o.basicId || '', displayName: o.displayName || '', pictureUrl: o.pictureUrl || null };
  }

  async profile(userId) {
    const o = await this.call('GET', `/v2/bot/profile/${encodeURIComponent(userId)}`);
    return { displayName: o.displayName || 'LINE 使用者', pictureUrl: o.pictureUrl || null };
  }

  setWebhook(endpoint) { return this.call('PUT', '/v2/bot/channel/webhook/endpoint', { endpoint }); }

  async testWebhook(endpoint) {
    const o = await this.call('POST', '/v2/bot/channel/webhook/test', endpoint ? { endpoint } : {});
    return { success: !!o.success, statusCode: o.statusCode || 0, reason: o.reason || '', detail: o.detail || '' };
  }

  async quota() {
    const o = await this.call('GET', '/v2/bot/message/quota');
    return { type: o.type || 'none', value: o.value == null ? null : o.value };
  }

  async consumption() {
    const o = await this.call('GET', '/v2/bot/message/quota/consumption');
    return o.totalUsage || 0;
  }

  // MARK: 圖文選單

  richMenuList() { return this.call('GET', '/v2/bot/richmenu/list').then((o) => o.richmenus || []); }
  async defaultRichMenu() {
    try { return (await this.call('GET', '/v2/bot/user/all/richmenu')).richMenuId || null; } catch (e) { if (e.status === 404) return null; throw e; }
  }
  createRichMenu(def) { return this.call('POST', '/v2/bot/richmenu', def).then((o) => o.richMenuId); }
  /// 解除個別使用者身上的選單（最多 500 人一次），他們就會看到預設選單
  async unlinkRichMenus(userIds) {
    for (let i = 0; i < userIds.length; i += 500) await this.call('POST', '/v2/bot/richmenu/bulk/unlink', { userIds: userIds.slice(i, i + 500) });
  }
    setDefaultRichMenu(id) { return this.call('POST', `/v2/bot/user/all/richmenu/${id}`); }
  deleteRichMenu(id) { return this.call('DELETE', `/v2/bot/richmenu/${id}`); }
  async uploadRichMenuImage(id, png) {
    const res = await fetch(`${DATA_BASE()}/v2/bot/richmenu/${id}/content`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'image/png' }, body: png, signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new LineAPIError(res.status, (await res.text()) || '上傳選單圖片失敗');
  }

  /// 請 LINE 檢查訊息格式（不會真的送出）
  async validate(messages) {
    try { await this.call('POST', '/v2/bot/message/validate/push', { messages }); return null; } catch (e) { return e.message; }
  }

  /// 驗證 x-line-signature（固定時間比較）
  static verify(signature, body, secret) {
    if (!signature || !secret) return false;
    const expected = crypto.createHmac('sha256', secret).update(body).digest('base64');
    const a = Buffer.from(expected), b = Buffer.from(String(signature));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}

// MARK: 訊息組裝

const LineMessage = {
  text(text, quickReplies = []) {
    const m = { type: 'text', text: prefix(text, 5000) };
    if (quickReplies.length) {
      m.quickReply = {
        items: quickReplies.slice(0, 13).map((label) => ({ type: 'action', action: { type: 'message', label: prefix(label, 20), text: label } })),
      };
    }
    return m;
  },
  /// Flex 卡片：altText 是通知與聊天列表顯示的文字
  flex(altText, contents, quickReplies = []) {
    const m = { type: 'flex', altText: prefix(altText, 400), contents: typeof contents === 'string' ? JSON.parse(contents) : contents };
    const q = LineMessage.text('', quickReplies).quickReply;
    if (q) m.quickReply = q;
    return m;
  },
  /// 按鈕範本：店家一鍵接受 / 婉拒（無標題時內文上限 160 字）
  buttons(text, actions, altText) {
    return {
      type: 'template',
      altText: prefix(altText, 400),
      template: {
        type: 'buttons',
        text: prefix(text, 160),
        actions: actions.slice(0, 4).map(([label, data]) => ({ type: 'postback', label: prefix(label, 20), data, displayText: label })),
      },
    };
  },
};

/// 解析 postback data：action=rsv&id=xxx
function parsePostback(data) {
  const out = {};
  for (const pair of String(data || '').split('&')) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    const k = pair.slice(0, i), v = pair.slice(i + 1);
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

module.exports = { LineAPI, LineAPIError, LineMessage, parsePostback };
