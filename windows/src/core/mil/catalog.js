'use strict';
// 軍規測試項目定義與機種資料（對照 Mac 版 MILCatalog.swift）

const { uuid } = require('../util');

const P = (id, label, detail) => ({ id, label, detail });
const T = (id, code, name, short, procedures, aliases) => ({ id, code, name, short, procedures, aliases });

const TESTS = [
  T('altitude', '500.6', '高海拔測試（Method 500.6 低氣壓）', '高海拔', [
    P('I', '儲存／空運（程序 I）', '模擬 40,000 英尺（約 12,192 公尺）、-20°C、12 小時，不開機'),
    P('II', '運作（程序 II）', '模擬 15,000 英尺（約 4,572 公尺）、5°C 與 40°C 各 12 小時，開機'),
  ], ['高海拔', '海拔', '低氣壓', '氣壓', '高山', '坐飛機', '搭飛機', '飛機', '搭機', '空運', '機艙', '500.6', 'altitude']),
  T('hot', '501.7', '高溫測試（Method 501.7）', '高溫', [
    P('A1op', '炎熱乾燥運作（A1）', '32～49°C 循環 3 天，開機'),
    P('A1st', '炎熱乾燥儲存（A1）', '33～71°C 循環 7 天，不開機'),
    P('A2op', '基本炎熱運作（A2）', '30～43°C、濕度 14～44%，3 天，開機'),
    P('A2st', '基本炎熱儲存（A2）', '30～63°C、濕度 5～44%，7 天，不開機'),
  ], ['高溫', '很熱', '炎熱', '夏天', '車內', '耐熱', '熱的地方', '幾度', '501.7', 'hot']),
  T('cold', '502.7', '低溫測試（Method 502.7）', '低溫', [
    P('C1st', '基本寒冷儲存（C1）', '-25～-33°C，7 天，不開機'),
    P('C1op', '基本寒冷運作（C1）', '-21～-32°C，3 天，開機'),
    P('C2st', '寒冷儲存（C2）', '-37～-46°C，7 天，不開機'),
    P('C2op', '寒冷運作（C2）', '-37～-46°C，3 天，開機'),
  ], ['低溫', '很冷', '寒冷', '冬天', '耐寒', '耐冷', '零下', '結冰', '雪地', '極寒', '冷的地方', '502.7', 'cold']),
  T('tshock', '503.7', '溫度衝擊測試（Method 503.7）', '溫度衝擊', [
    P('IA', '程序 I-A', '-25°C → 60°C 單向衝擊，停留 4 小時，不開機'),
    P('IB', '程序 I-B', '-25°C → 60°C → -25°C 單循環，停留 6 小時，不開機'),
    P('IC', '程序 I-C', '-51°C ↔ 71°C，1 小時、3 個循環，不開機'),
  ], ['溫度衝擊', '冷熱衝擊', '急速冷熱', '溫差', '冷熱交替', '忽冷忽熱', '503.7', 'temperature shock']),
  T('solar', '505.7', '太陽輻射測試（Method 505.7）', '太陽輻射', [
    P('I', '程序 I（類別 A1 循環）', '日照 1120 W/m²、49°C，3 個 24 小時循環'),
  ], ['太陽輻射', '太陽', '日照', '曬', '紫外線', '曝曬', '陽光', '505.7', 'solar']),
  T('humidity', '507.6', '濕度測試（Method 507.6）', '濕度', [
    P('II', '程序 II 加嚴循環', '30°C／60°C、95% RH，10 天，不開機'),
  ], ['濕度', '潮濕', '濕氣', '高濕', '防潮', '受潮', '耐濕', '防濕', '507.6', 'humidity']),
  T('dust', '510.7', '沙塵測試（Method 510.7）', '沙塵', [
    P('I', '吹塵（程序 I）', '粒子 10 ± 7 g/m³、風速 300～1750 ft/min、60°C'),
    P('II', '吹沙（程序 II）', '粒子 1.2 g/m³、風速 28 m/s、60°C'),
  ], ['沙塵', '灰塵', '粉塵', '防塵', '吹沙', '沙子', '風沙', '工地', '沙漠', '510.7', 'dust', 'sand']),
  T('explosive', '511.7', '爆炸性環境測試（Method 511.7）', '爆炸性環境', [
    P('I', '程序 I', '開機運作，高度 15,000～33,000 英尺，95% 正己烷爆炸性氣體'),
  ], ['爆炸', '易燃', '可燃氣體', '防爆', '511.7', 'explosive']),
  T('vibration', '514.8', '振動測試（Method 514.8）', '振動', [
    P('CI', '一般貨運（C-I）', '每軸 60 分鐘，開機'),
    P('CIV', '雙輪拖車（C-IV）', '5～500 Hz，每軸 32 分鐘，不開機'),
    P('CVII', '輪式車輛（C-VII）', '5～500 Hz，每軸 40 分鐘，不開機'),
    P('CVI', '複合輪式車輛（C-VI）', '5～500 Hz，每軸 40 分鐘，不開機'),
    P('E1', '一般最低完整性（E-1）', '7.7 g rms，每軸 60 分鐘，不開機'),
  ], ['振動', '震動', '搖晃', '顛簸', '運送', '車上', '開車', '搬運', '514.8', 'vibration']),
  T('drop', '516.8', '跌落測試（Method 516.8）', '跌落', [
    P('VI', '桌面跌落（程序 VI）', '開機中，從 100 mm（10 公分）高度跌落'),
    P('IV', '運輸跌落（程序 IV，含包裝）', '122 公分高、共 26 次'),
  ], ['跌落', '掉落', '摔落', '摔地上', '掉地上', '防摔', '抗摔', '耐摔', '摔壞', '摔了', '掉了', '摔', '掉', 'drop']),
  T('shock', '516.8', '衝擊測試（Method 516.8）', '衝擊', [
    P('I', '功能衝擊（程序 I）', '40 G、11 ms，共 18 次，開機'),
    P('II', '公路運輸衝擊（程序 II，含包裝）', '5.1～7.6 G、11 ms，3～42 次'),
    P('III', '脆弱度（程序 III）', '30～50 G 梯形波，共 18 次，不開機'),
    P('V', '墜毀危害（程序 V）', '75 G、6 ms，共 12 次，不開機'),
  ], ['衝擊', '撞擊', '碰撞', '撞到', 'G值', '516.8', 'shock']),
  T('freeze', '524.1', '凍融測試（Method 524.1）', '凍融', [
    P('III', '程序 III 急速溫度變化', '30°C ↔ -10°C、95% RH，1 小時、3 個循環'),
  ], ['凍融', '結霜', '結露', '起霧', '解凍', '524.1', 'freeze', 'thaw']),
  T('ship', '528.1', '艦載設備機械振動測試（Method 528.1）', '艦載機械振動', [
    P('1', '程序 1（Type 1）', '4～33 Hz，2 小時'),
  ], ['船上', '船艦', '艦載', '坐船', '搭船', '528.1', 'ship']),
];

const test = (id) => TESTS.find((t) => t.id === id) || null;
const procedure = (t, id) => (t && t.procedures.find((p) => p.id === id)) || null;
const procLine = (p) => `${p.label}：${p.detail}`;

// MARK: 機種

const testId = (t) => (typeof t === 'string' ? t : t.id);
const passes = (m, t) => (m.passed && m.passed[testId(t)]) || [];
const described = (m, t) => (m.describedOnly && m.describedOnly[testId(t)]) || [];
const passedTestCount = (m) => TESTS.filter((t) => passes(m, t).length).length;

function familyOf(c, m) {
  if (!m.family) return null;
  return c.families.find((f) => f.name === m.family) || null;
}

/// 有兩台以上機種的系列才需要「系列」答案
const multiFamilies = (c) => c.families.filter((f) => c.models.filter((m) => m.family === f.name).length >= 2);

const newModel = (fields = {}) => ({
  id: uuid(), code: '', display: '', aliases: [], family: '', passed: {}, describedOnly: {}, reportURL: '', standard: 'MIL-STD-810H',
  ...fields,
});

const newFamily = (name, aliases = []) => ({ id: uuid(), name, aliases });

function normalizeCatalog(raw) {
  const c = raw || {};
  const out = {
    models: (c.models || []).map((m) => newModel({ ...m, aliases: m.aliases || [], passed: m.passed || {}, describedOnly: m.describedOnly || {} })),
    families: (c.families || []).map((f) => ({ id: f.id || uuid(), name: f.name || '', aliases: f.aliases || [] })),
  };
  if (c.lastGenerated) out.lastGenerated = c.lastGenerated;
  return out;
}

/// 預設資料：目前整理的 5 份華碩官方報告
function seedCatalog() {
  return {
    families: [newFamily('ExpertBook B1', ['B1400', 'B1500', 'ExpertBook B1', 'B1'])],
    models: [
      newModel({
        code: 'P5405CSA', display: 'ExpertBook P5 14 吋（P5405CSA）',
        aliases: ['P5405CSA', 'P5405', 'ExpertBook P5', 'P5'],
        passed: {
          altitude: ['I', 'II'], hot: ['A2op', 'A2st'], cold: ['C1st', 'C1op'], tshock: ['IA', 'IB', 'IC'],
          solar: ['I'], humidity: ['II'], dust: ['I', 'II'], vibration: ['CI', 'CIV', 'CVII', 'E1'],
          drop: ['VI'], shock: ['I', 'II', 'III', 'V'], freeze: ['III'], ship: ['1'],
        },
        describedOnly: { hot: ['A1op', 'A1st'], cold: ['C2st', 'C2op'], explosive: ['I'], vibration: ['CVI'] },
        reportURL: 'https://www.asus.com/tw/event/militarygradereport/asusexpertbookp5405csa.pdf',
      }),
      newModel({
        code: 'B5302C', display: 'ExpertBook B5（B5302C）',
        aliases: ['B5302C', 'B5302', 'ExpertBook B5', 'B5'],
        passed: {
          altitude: ['I', 'II'], hot: ['A1op', 'A1st', 'A2op', 'A2st'], cold: ['C1st', 'C1op', 'C2st', 'C2op'],
          tshock: ['IC'], humidity: ['II'], dust: ['II'], vibration: ['CVI', 'CIV', 'CI'],
          drop: ['IV', 'VI'], shock: ['I', 'II', 'III'], freeze: ['III'], ship: ['1'],
        },
        reportURL: 'https://www.asus.com/event/militarygradereport/ASUSExpertBookB5-B5302C.pdf',
      }),
      newModel({
        code: 'B1400CBA', display: 'ExpertBook B1 第 12 代（B1400CBA）',
        aliases: ['B1400CBA', 'B1 12代', 'B1第12代', '12代B1'], family: 'ExpertBook B1',
        passed: {
          altitude: ['I', 'II'], hot: ['A1op', 'A1st', 'A2op', 'A2st'], cold: ['C1st', 'C1op', 'C2st', 'C2op'],
          humidity: ['II'], dust: ['II'], vibration: ['CI', 'CIV', 'CVII'], drop: ['VI'],
          shock: ['I', 'II', 'III', 'V'], ship: ['1'],
        },
        reportURL: 'https://www.asus.com/event/militarygradereport/asusexpertbookb1-b1400cba.pdf',
      }),
      newModel({
        code: 'B1400／B1500', display: 'ExpertBook B1（B1400／B1500）',
        aliases: [], family: 'ExpertBook B1',
        passed: {
          altitude: ['I', 'II'], hot: ['A1op', 'A1st', 'A2op', 'A2st'], cold: ['C1st', 'C1op'],
          vibration: ['CI', 'CIV', 'CVII'], drop: ['VI'], shock: ['I', 'III'], ship: ['1'],
        },
        reportURL: 'https://www.asus.com/event/militarygradereport/ASUSExpertBookB1-B1400-B1500.pdf',
      }),
      newModel({
        code: 'L1400', display: 'ExpertBook L1（L1400）',
        aliases: ['L1400', 'ExpertBook L1', 'L1'],
        passed: {
          altitude: ['I', 'II'], hot: ['A1op', 'A1st', 'A2op', 'A2st'], cold: ['C1st', 'C1op', 'C2st', 'C2op'],
          humidity: ['II'], vibration: ['CI', 'CIV', 'CVII'], drop: ['VI'], shock: ['I'],
        },
        reportURL: 'https://www.asus.com/event/militarygradereport/ASUSExpertBookL1-L1400.pdf',
      }),
    ],
  };
}

module.exports = {
  TESTS, test, procedure, procLine, passes, described, passedTestCount, familyOf, multiFamilies,
  newModel, newFamily, normalizeCatalog, seedCatalog,
};
