'use strict';
// 核心模組測試（不需要 Ollama、不需要網路）

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const retriever = require('../src/core/retriever');
const ai = require('../src/core/ai');
const agent = require('../src/core/agent');
const reservation = require('../src/core/reservation');
const { parseFAQCSV } = require('../src/core/csv');
const { LineAPI, parsePostback, LineMessage } = require('../src/core/line');
const { hashPassword, checkPassword } = require('../src/core/servers');
const models = require('../src/core/models');

test('文字正規化與 FAQ 比對', () => {
  assert.strictEqual(retriever.normalize('請問，營業 時間？'), '請問營業時間');
  assert.strictEqual(retriever.core('請問你們的營業時間嗎'), '營業時間');
  const faqs = models.sampleAccountData().faqs;
  assert.strictEqual(retriever.matchFAQ('你們幾點開門', faqs).question, '營業時間');
  assert.strictEqual(retriever.matchFAQ('可以用 LINE Pay 嗎', faqs).question, '可以刷卡嗎');
  assert.strictEqual(retriever.matchFAQ('停車方便嗎', faqs), null);
});

test('型號、追問與多項判斷', () => {
  // 型號辨識只有 MIL 版會用
  assert.deepStrictEqual(retriever.modelTokens('P5 跟 B5302C 差在哪 MIL-STD-810H'), models.isMIL ? ['p5', 'b5302c'] : []);
  assert.ok(retriever.refersToPrevious('第13項是什麼'));
  assert.ok(retriever.isFollowUp('那低溫呢'));
  assert.deepStrictEqual(agent.splitItems('沙塵、凍融和艦載振動這三項的條件'), ['沙塵', '凍融', '艦載振動']);
  assert.deepStrictEqual(agent.splitItems('P5 低溫測試'), []);
});

test('寒暄、問機器人不算追問', () => {
  for (const t of ['你好', '謝謝你', '好的！', 'OK']) {
    assert.ok(retriever.isSmallTalk(t), t);
    assert.ok(!retriever.isFollowUp(t), t);
  }
  for (const t of ['你是誰', '您能做什麼', '怎麼用']) {
    assert.ok(retriever.isAboutBot(t), t);
    assert.ok(!retriever.isFollowUp(t), t);
  }
  assert.ok(retriever.isFollowUp('那低溫呢'));
  assert.ok(retriever.isFollowUp('B5呢'));
  assert.ok(!retriever.isAboutBot('你是P5嗎'));
});

test('回覆排版與無資料判斷', () => {
  assert.strictEqual(ai.formatForLINE('條件如下：A 測試；B 測試；C 測試。'), '條件如下：\n・A 測試\n・B 測試\n・C 測試');
  assert.strictEqual(ai.formatForLINE('- 第一\n- 第二'), '・第一\n・第二');
  assert.ok(ai.saysNoInfo('目前沒有資料喔'));
  assert.ok(!ai.saysNoInfo('有的：\n・A\n・B，目前沒有資料的部分可以再問'));
});

test('Agent：數字出處檢查與去除 LaTeX', () => {
  assert.deepStrictEqual(agent.ungroundedNumbers('高度 10 mm', '從 100 mm（10 公分）高度跌落'), ['10 mm']);
  assert.deepStrictEqual(agent.ungroundedNumbers('高度 100 mm', '從 100 mm 高度'), []);
  assert.strictEqual(agent.stripMarkup('$10 \\pm 7\\text{ g/m}^3$ **重點**'), '10 ± 7 g/m³ 重點');
});

test('預約欄位抽取', () => {
  const now = new Date(2026, 9, 18); // 週日
  assert.strictEqual(reservation.date('明天', now), '10/19（週一）');
  assert.strictEqual(reservation.date('下週三', now), '10/28（週三）');
  assert.strictEqual(reservation.date('10/12', now), '10/12（週二）'); // 已過 → 明年
  assert.strictEqual(reservation.time('晚上七點半'), '19:30');
  assert.strictEqual(reservation.time('中午12點'), '12:00');
  assert.strictEqual(reservation.time('19:15'), '19:15');
  assert.strictEqual(reservation.people('我們 4 位'), 4);
  assert.strictEqual(reservation.people('兩個人'), 2);
  assert.strictEqual(reservation.phone('0912-345-678'), '0912345678');
});

test('CSV 匯入（含引號、逗號、換行）', () => {
  const faqs = parseFAQCSV('﻿問題,答案,關鍵字\n"營業時間","週一到五\n9:00-18:00","幾點;開門"\n"價格","1,000 元",\n');
  assert.strictEqual(faqs.length, 2);
  assert.strictEqual(faqs[0].answer, '週一到五\n9:00-18:00');
  assert.deepStrictEqual(faqs[0].keywords, ['幾點', '開門']);
  assert.strictEqual(faqs[1].answer, '1,000 元');
});

test('LINE 簽章、postback 與訊息', () => {
  const body = Buffer.from('{"events":[]}');
  const sig = crypto.createHmac('sha256', 's3cret').update(body).digest('base64');
  assert.ok(LineAPI.verify(sig, body, 's3cret'));
  assert.ok(!LineAPI.verify(sig, body, 'wrong'));
  assert.ok(!LineAPI.verify(undefined, body, 's3cret'));
  assert.deepStrictEqual(parsePostback('action=rsv&op=accept&id=AB%20C'), { action: 'rsv', op: 'accept', id: 'AB C' });
  assert.strictEqual(LineMessage.text('hi', ['a', 'b']).quickReply.items.length, 2);
});

test('區網密碼', () => {
  const h = hashPassword('123456');
  assert.ok(checkPassword('123456', h));
  assert.ok(!checkPassword('12345', h));
});

test('資料格式跟 Mac 版相容（日期不帶毫秒、UUID 大寫）', () => {
  const f = models.makeFAQ('q', 'a');
  assert.match(f.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(f.id, /^[0-9A-F-]{36}$/);
  const d = models.normalizeAccountData({ faqs: [{ id: 'X', question: 'q', answer: 'a' }] });
  assert.strictEqual(d.faqs[0].isEnabled, true);
  assert.strictEqual(d.rules.humanModeMinutes, 30);
});
