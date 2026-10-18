'use strict';
// 圖文選單（LINE 聊天室下方的選單）：建立我們的選單 → 設成預設 → 刪掉舊選單（舊選單綁在個別使用者身上的也會一起解除）

const fs = require('fs');
const path = require('path');
const { edition } = require('./models');

const NAME = 'mac-line-bot';
const WIDTH = 2500, HEIGHT = 843;

/// 每個按鈕：顯示文字、英文小字、lucide 圖示、顏色、點了送出的文字（對到 FAQ 或轉人工）
const BUTTONS = {
  mil: [
    { label: '型號清單', sub: 'Models', icon: 'list', color: '#06C755', text: '有哪些型號通過軍規' },
    { label: '測試項目', sub: 'Tests', icon: 'flask-conical', color: '#30B0C7', text: '軍規測試有哪些項目' },
    { label: '比較型號', sub: 'Compare', icon: 'scale', color: '#5856D6', text: '比較型號' },
    { label: '找專人', sub: 'Contact', icon: 'headset', color: '#FF9500', text: '我要找真人' },
  ],
  base: [
    { label: '營業時間', sub: 'Hours', icon: 'clock', color: '#06C755', text: '營業時間' },
    { label: '我要預約', sub: 'Booking', icon: 'calendar-check', color: '#30B0C7', text: '我想預約' },
    { label: '店家資訊', sub: 'Info', icon: 'map-pin', color: '#5856D6', text: '請問店家地址和電話' },
    { label: '找專人', sub: 'Contact', icon: 'headset', color: '#FF9500', text: '我要找真人' },
  ],
};

const buttons = () => BUTTONS[edition.edition] || BUTTONS.base;

function definition() {
  const list = buttons();
  const w = Math.floor(WIDTH / list.length);
  return {
    size: { width: WIDTH, height: HEIGHT },
    selected: true,
    name: NAME,
    chatBarText: '功能選單',
    areas: list.map((b, i) => ({
      bounds: { x: i * w, y: 0, width: i === list.length - 1 ? WIDTH - i * w : w, height: HEIGHT },
      action: { type: 'message', label: b.label, text: b.text },
    })),
  };
}

const imagePath = () => path.join(__dirname, 'assets', `richmenu-${edition.edition === 'mil' ? 'mil' : 'base'}.png`);

/// 目前的選單狀況
async function status(api) {
  const [list, def] = await Promise.all([api.richMenuList(), api.defaultRichMenu()]);
  return {
    defaultId: def,
    menus: list.map((m) => ({
      id: m.richMenuId, name: m.name, chatBarText: m.chatBarText, ours: m.name === NAME, isDefault: m.richMenuId === def,
      buttons: (m.areas || []).map((a) => (a.action && (a.action.label || a.action.text || a.action.data)) || '?'),
    })),
    planned: buttons().map((b) => ({ label: b.label, text: b.text })),
  };
}

/// 套用我們的選單並刪掉其他選單
async function apply(api) {
  const id = await api.createRichMenu(definition());
  try {
    await api.uploadRichMenuImage(id, fs.readFileSync(imagePath()));
    await api.setDefaultRichMenu(id);
  } catch (e) {
    await api.deleteRichMenu(id).catch(() => {});
    throw e;
  }
  const deleted = [];
  for (const m of await api.richMenuList()) {
    if (m.richMenuId === id) continue;
    await api.deleteRichMenu(m.richMenuId);
    deleted.push(m.name || m.richMenuId);
  }
  return { id, deleted };
}

module.exports = { NAME, BUTTONS, buttons, definition, imagePath, status, apply };
