#!/usr/bin/env python3
"""
產生華碩商用筆電 MIL-STD-810H 的 FAQ（CSV，可直接在 App「知識庫 → 常見問題 → 匯入 CSV」匯入）。

資料全部來自華碩官方公開的測試報告 PDF（見文末 SOURCES），
每個型號 × 每個測試項目都產生一題，關鍵字用「型號+項目」組合，讓各種問法都能精準命中。

用法：python3 knowledge/build_mil810h_faq.py  →  產生 knowledge/ASUS商用筆電-MIL-STD-810H-FAQ.csv
"""
import csv
import os

NOTE = "※ 以華碩官方測試報告為準"

# ---------- 測試項目：名稱、各程序的條件、各種口語說法 ----------
TESTS = {
    "altitude": {
        "name": "高海拔測試（Method 500.6 低氣壓）",
        "short": "高海拔",
        "params": {
            "I": "儲存／空運（程序 I）：模擬 40,000 英尺（約 12,192 公尺）、-20°C、12 小時，不開機",
            "II": "運作（程序 II）：模擬 15,000 英尺（約 4,572 公尺）、5°C 與 40°C 各 12 小時，開機",
        },
        "aliases": ["高海拔", "海拔", "低氣壓", "氣壓", "高山", "坐飛機", "搭飛機", "飛機", "搭機", "空運", "機艙", "500.6", "altitude"],
    },
    "hot": {
        "name": "高溫測試（Method 501.7）",
        "short": "高溫",
        "params": {
            "A1op": "炎熱乾燥運作（A1）：32～49°C 循環 3 天，開機",
            "A1st": "炎熱乾燥儲存（A1）：33～71°C 循環 7 天，不開機",
            "A2op": "基本炎熱運作（A2）：30～43°C、濕度 14～44%，3 天，開機",
            "A2st": "基本炎熱儲存（A2）：30～63°C、濕度 5～44%，7 天，不開機",
        },
        "aliases": ["高溫", "很熱", "炎熱", "夏天", "車內", "耐熱", "熱的地方", "幾度", "501.7", "hot"],
    },
    "cold": {
        "name": "低溫測試（Method 502.7）",
        "short": "低溫",
        "params": {
            "C1st": "基本寒冷儲存（C1）：-25～-33°C，7 天，不開機",
            "C1op": "基本寒冷運作（C1）：-21～-32°C，3 天，開機",
            "C2st": "寒冷儲存（C2）：-37～-46°C，7 天，不開機",
            "C2op": "寒冷運作（C2）：-37～-46°C，3 天，開機",
        },
        "aliases": ["低溫", "很冷", "寒冷", "冬天", "耐寒", "耐冷", "零下", "結冰", "雪地", "極寒", "冷的地方", "502.7", "cold"],
    },
    "tshock": {
        "name": "溫度衝擊測試（Method 503.7）",
        "short": "溫度衝擊",
        "params": {
            "IA": "程序 I-A：-25°C → 60°C 單向衝擊，停留 4 小時，不開機",
            "IB": "程序 I-B：-25°C → 60°C → -25°C 單循環，停留 6 小時，不開機",
            "IC": "程序 I-C：-51°C ↔ 71°C，1 小時、3 個循環，不開機",
        },
        "aliases": ["溫度衝擊", "冷熱衝擊", "急速冷熱", "溫差", "冷熱交替", "忽冷忽熱", "503.7", "temperature shock"],
    },
    "solar": {
        "name": "太陽輻射測試（Method 505.7）",
        "short": "太陽輻射",
        "params": {
            "I": "程序 I（類別 A1 循環）：日照 1120 W/m²、49°C，3 個 24 小時循環",
        },
        "aliases": ["太陽輻射", "太陽", "日照", "曬", "紫外線", "曝曬", "陽光", "505.7", "solar"],
    },
    "humidity": {
        "name": "濕度測試（Method 507.6）",
        "short": "濕度",
        "params": {
            "II": "程序 II 加嚴循環：30°C／60°C、95% RH，10 天，不開機",
        },
        "aliases": ["濕度", "潮濕", "濕氣", "高濕", "防潮", "受潮", "耐濕", "防濕", "507.6", "humidity"],
    },
    "dust": {
        "name": "沙塵測試（Method 510.7）",
        "short": "沙塵",
        "params": {
            "I": "吹塵（程序 I）：粒子 10 ± 7 g/m³、風速 300～1750 ft/min、60°C",
            "II": "吹沙（程序 II）：粒子 1.2 g/m³、風速 28 m/s、60°C",
        },
        "aliases": ["沙塵", "灰塵", "粉塵", "防塵", "吹沙", "沙子", "風沙", "工地", "沙漠", "510.7", "dust", "sand"],
    },
    "explosive": {
        "name": "爆炸性環境測試（Method 511.7）",
        "short": "爆炸性環境",
        "params": {
            "I": "程序 I：開機運作，高度 15,000～33,000 英尺，95% 正己烷爆炸性氣體",
        },
        "aliases": ["爆炸", "易燃", "可燃氣體", "防爆", "511.7", "explosive"],
    },
    "vibration": {
        "name": "振動測試（Method 514.8）",
        "short": "振動",
        "params": {
            "CI": "一般貨運（C-I）：每軸 60 分鐘，開機",
            "CIV": "雙輪拖車（C-IV）：5～500 Hz，每軸 32 分鐘，不開機",
            "CVII": "輪式車輛（C-VII）：5～500 Hz，每軸 40 分鐘，不開機",
            "CVI": "複合輪式車輛（C-VI）：5～500 Hz，每軸 40 分鐘，不開機",
            "E1": "一般最低完整性（E-1）：7.7 g rms，每軸 60 分鐘，不開機",
        },
        "aliases": ["振動", "震動", "搖晃", "顛簸", "運送", "車上", "開車", "搬運", "514.8", "vibration"],
    },
    "drop": {
        "name": "跌落測試（Method 516.8）",
        "short": "跌落",
        "params": {
            "VI": "桌面跌落（程序 VI）：開機中，從 100 mm（10 公分）高度跌落",
            "IV": "運輸跌落（程序 IV，含包裝）：122 公分高、共 26 次",
        },
        "aliases": ["跌落", "掉落", "摔落", "摔地上", "掉地上", "防摔", "抗摔", "耐摔", "摔壞", "摔了", "掉了", "摔", "掉", "drop"],
    },
    "shock": {
        "name": "衝擊測試（Method 516.8）",
        "short": "衝擊",
        "params": {
            "I": "功能衝擊（程序 I）：40 G、11 ms，共 18 次，開機",
            "II": "公路運輸衝擊（程序 II，含包裝）：5.1～7.6 G、11 ms，3～42 次",
            "III": "脆弱度（程序 III）：30～50 G 梯形波，共 18 次，不開機",
            "V": "墜毀危害（程序 V）：75 G、6 ms，共 12 次，不開機",
        },
        "aliases": ["衝擊", "撞擊", "碰撞", "撞到", "G值", "516.8", "shock"],
    },
    "freeze": {
        "name": "凍融測試（Method 524.1）",
        "short": "凍融",
        "params": {
            "III": "程序 III 急速溫度變化：30°C ↔ -10°C、95% RH，1 小時、3 個循環",
        },
        "aliases": ["凍融", "結霜", "結露", "起霧", "解凍", "524.1", "freeze", "thaw"],
    },
    "ship": {
        "name": "艦載設備機械振動測試（Method 528.1）",
        "short": "艦載機械振動",
        "params": {
            "1": "程序 1（Type 1）：4～33 Hz，2 小時",
        },
        "aliases": ["船上", "船艦", "艦載", "坐船", "搭船", "528.1", "ship"],
    },
}

# ---------- 各型號：通過哪些程序（None = 報告沒有此項）；desc = 只出現在測試說明 ----------
MODELS = {
    "P5405CSA": {
        "display": "ExpertBook P5 14 吋（P5405CSA）",
        "aliases": ["P5405CSA", "P5405", "ExpertBook P5", "P5"],
        "tests": {
            "altitude": ["I", "II"],
            "hot": ["A2op", "A2st"],
            "cold": ["C1st", "C1op"],
            "tshock": ["IA", "IB", "IC"],
            "solar": ["I"],
            "humidity": ["II"],
            "dust": ["I", "II"],
            "explosive": None,
            "vibration": ["CI", "CIV", "CVII", "E1"],
            "drop": ["VI"],
            "shock": ["I", "II", "III", "V"],
            "freeze": ["III"],
            "ship": ["1"],
        },
        "desc": {
            "hot": ["A1op", "A1st"],
            "cold": ["C2st", "C2op"],
            "explosive": ["I"],
            "vibration": ["CVI"],
        },
    },
    "B5302C": {
        "display": "ExpertBook B5（B5302C）",
        "aliases": ["B5302C", "B5302", "ExpertBook B5", "B5"],
        "tests": {
            "altitude": ["I", "II"],
            "hot": ["A1op", "A1st", "A2op", "A2st"],
            "cold": ["C1st", "C1op", "C2st", "C2op"],
            "tshock": ["IC"],
            "solar": None,
            "humidity": ["II"],
            "dust": ["II"],
            "explosive": None,
            "vibration": ["CVI", "CIV", "CI"],
            "drop": ["IV", "VI"],
            "shock": ["I", "II", "III"],
            "freeze": ["III"],
            "ship": ["1"],
        },
    },
    "B1400CBA": {
        "display": "ExpertBook B1 第 12 代（B1400CBA）",
        "aliases": ["B1400CBA", "B1 12代", "B1第12代", "12代B1"],
        "tests": {
            "altitude": ["I", "II"],
            "hot": ["A1op", "A1st", "A2op", "A2st"],
            "cold": ["C1st", "C1op", "C2st", "C2op"],
            "tshock": None,
            "solar": None,
            "humidity": ["II"],
            "dust": ["II"],
            "explosive": None,
            "vibration": ["CI", "CIV", "CVII"],
            "drop": ["VI"],
            "shock": ["I", "II", "III", "V"],
            "freeze": None,
            "ship": ["1"],
        },
    },
    "B1400/B1500": {
        "display": "ExpertBook B1（B1400／B1500）",
        "aliases": [],  # 由下面的「B1 系列」統一回答，避免跟 B1400CBA 搞混
        "tests": {
            "altitude": ["I", "II"],
            "hot": ["A1op", "A1st", "A2op", "A2st"],
            "cold": ["C1st", "C1op"],
            "tshock": None,
            "solar": None,
            "humidity": None,
            "dust": None,
            "explosive": None,
            "vibration": ["CI", "CIV", "CVII"],
            "drop": ["VI"],
            "shock": ["I", "III"],
            "freeze": None,
            "ship": ["1"],
        },
    },
    "L1400": {
        "display": "ExpertBook L1（L1400）",
        "aliases": ["L1400", "ExpertBook L1", "L1"],
        "tests": {
            "altitude": ["I", "II"],
            "hot": ["A1op", "A1st", "A2op", "A2st"],
            "cold": ["C1st", "C1op", "C2st", "C2op"],
            "tshock": None,
            "solar": None,
            "humidity": ["II"],
            "dust": None,
            "explosive": None,
            "vibration": ["CI", "CIV", "CVII"],
            "drop": ["VI"],
            "shock": ["I"],
            "freeze": None,
            "ship": None,
        },
    },
}

B1_FAMILY_ALIASES = ["B1400", "B1500", "ExpertBook B1", "B1"]
ORDER = list(MODELS)


def passed_models(test):
    return [m for m in ORDER if MODELS[m]["tests"].get(test)]


def model_lines(model, test):
    """某型號某項目的條列內容"""
    procs = MODELS[model]["tests"].get(test) or []
    desc = MODELS[model].get("desc", {}).get(test) or []
    lines = ["・" + TESTS[test]["params"][p] for p in procs]
    if desc:
        lines.append("・測試說明另列：" + "；".join(TESTS[test]["params"][p] for p in desc))
    return lines


def model_test_answer(model, test):
    t = TESTS[test]
    d = MODELS[model]["display"]
    procs = MODELS[model]["tests"].get(test)
    desc = MODELS[model].get("desc", {}).get(test)
    if procs:
        return "\n".join([f"✅ {d} 有通過{t['name']}"] + model_lines(model, test) + [NOTE])
    if desc:
        return "\n".join([f"📄 {d} 的報告在測試說明中列出{t['name']}，但結果總表沒有列，請以華碩官方確認為準"]
                         + model_lines(model, test) + [NOTE])
    others = "、".join(passed_models(test)) or "（本資料的 5 款都沒有）"
    return "\n".join([f"❌ {d} 的官方測試報告中沒有{t['name']}",
                      f"・有通過{t['short']}測試的型號：{others}", NOTE])


def b1_family_answer(test):
    t = TESTS[test]
    parts = [f"ExpertBook B1 有兩份官方報告，{t['short']}測試的結果不同："]
    for m in ["B1400/B1500", "B1400CBA"]:
        d = MODELS[m]["display"]
        if MODELS[m]["tests"].get(test):
            parts.append(f"【{d}】✅ 有通過")
            parts += model_lines(m, test)
        else:
            parts.append(f"【{d}】❌ 報告中沒有這項")
    parts.append("可以告訴我您的完整型號，幫您確認是哪一款 🙂")
    return "\n".join(parts)


def test_overview_answer(test):
    t = TESTS[test]
    lines = [f"{t['name']}的條件："]
    lines += ["・" + v for v in t["params"].values()]
    lines.append("通過型號：")
    for m in ORDER:
        procs = MODELS[m]["tests"].get(test)
        if procs:
            names = "、".join(TESTS[test]["params"][p].split("：")[0] for p in procs)
            lines.append(f"・{MODELS[m]['display']}：{names}")
    if not any(MODELS[m]["tests"].get(test) for m in ORDER):
        lines.append("・結果總表中沒有型號列出此項（P5405CSA 的測試說明有列出）")
    lines.append(NOTE)
    return "\n".join(lines)


def model_summary_answer(model):
    d = MODELS[model]["display"]
    lines = [f"{d} 通過的 MIL-STD-810H 測試："]
    for test in TESTS:
        if MODELS[model]["tests"].get(test):
            lines.append(f"・{TESTS[test]['name']}")
    missing = [TESTS[t]["short"] for t in TESTS if not MODELS[model]["tests"].get(t)]
    if missing:
        lines.append("報告中沒有：" + "、".join(missing))
    lines.append("想看某一項的詳細條件，可以直接問例如「" + MODELS[model]["aliases"][0] + " 低溫測試」" if MODELS[model]["aliases"] else NOTE)
    return "\n".join(lines)


faqs = []  # (question, answer, keywords)

# 1) 每個型號 × 每個測試
for m in ORDER:
    for test in TESTS:
        if not MODELS[m]["aliases"]:
            continue
        kws = [f"{a}+{x}" for a in MODELS[m]["aliases"] for x in TESTS[test]["aliases"]]
        faqs.append((f"{m} {TESTS[test]['short']}測試", model_test_answer(m, test), kws))

# 2) B1 系列（B1400 / B1500 / B1）× 每個測試：兩份報告一起回答
for test in TESTS:
    kws = [f"{a}+{x}" for a in B1_FAMILY_ALIASES for x in TESTS[test]["aliases"]]
    faqs.append((f"ExpertBook B1 {TESTS[test]['short']}測試", b1_family_answer(test), kws))

# 3) 每個測試項目的總覽
for test in TESTS:
    # 只用項目本身的說法；不要加「+測試」「+條件」這種泛用組合，會搶走更精準的題目
    kws = [a for a in TESTS[test]["aliases"] if a not in ("幾度", "沙漠") and len(a) >= 2]  # 沙漠交給「在沙漠可以用嗎」
    faqs.append((f"{TESTS[test]['short']}測試怎麼做", test_overview_answer(test), kws))

# 4) 每個型號通過哪些測試
for m in ORDER:
    if not MODELS[m]["aliases"]:
        continue
    kws = [f"{a}+{x}" for a in MODELS[m]["aliases"] for x in ["測試項目", "哪些測試", "通過", "軍規", "810", "幾項", "耐用"]]
    faqs.append((f"{m} 通過哪些測試", model_summary_answer(m), kws))

b1_summary = "\n".join([
    "ExpertBook B1 有兩份官方報告：",
    "【ExpertBook B1（B1400／B1500）】",
    "・高海拔、高溫（A1／A2）、低溫（C1）、振動、跌落、衝擊（程序 I、III）、艦載機械振動",
    "・報告中沒有：濕度、沙塵、寒冷 C2、溫度衝擊、太陽輻射、凍融",
    "【ExpertBook B1 第 12 代（B1400CBA）】",
    "・高海拔、高溫（A1／A2）、低溫（C1／C2）、濕度、吹沙、振動、跌落、衝擊（程序 I、II、III、V）、艦載機械振動",
    "可以告訴我您的完整型號，幫您確認是哪一款 🙂",
])
faqs.append(("ExpertBook B1 通過哪些測試", b1_summary,
             [f"{a}+{x}" for a in B1_FAMILY_ALIASES for x in ["測試項目", "哪些測試", "通過", "軍規", "810", "幾項", "耐用"]]))

# 4.5) 兩兩型號比較（MIL 版）：由資料表直接算出差異，不靠模型推理
ENTITIES = {
    "P5405CSA": ("P5405CSA", MODELS["P5405CSA"]["aliases"]),
    "B5302C": ("B5302C", MODELS["B5302C"]["aliases"]),
    "B1400CBA": ("B1400CBA", MODELS["B1400CBA"]["aliases"]),
    "B1400/B1500": ("B1400／B1500", ["B1400", "B1500", "ExpertBook B1", "B1"]),
    "L1400": ("L1400", MODELS["L1400"]["aliases"]),
}


def proc_label(test, procs):
    # 用條件說明冒號前的名稱，例如「基本寒冷儲存（C1）」，顧客看得懂
    return "、".join(TESTS[test]["params"][p].split("：")[0] for p in procs)


def compare_answer(a, b):
    na, nb = ENTITIES[a][0], ENTITIES[b][0]
    ta, tb = MODELS[a]["tests"], MODELS[b]["tests"]
    both, only_a, only_b, diff = [], [], [], []
    for test, t in TESTS.items():
        pa, pb = ta.get(test), tb.get(test)
        if pa and pb:
            both.append(t["short"])
            extra_a = [x for x in pa if x not in pb]
            extra_b = [x for x in pb if x not in pa]
            if extra_a:
                diff.append(f"・{t['short']}：{na} 另有 {proc_label(test, extra_a)}")
            if extra_b:
                diff.append(f"・{t['short']}：{nb} 另有 {proc_label(test, extra_b)}")
        elif pa:
            only_a.append(t["short"])
        elif pb:
            only_b.append(t["short"])
    lines = [f"{MODELS[a]['display']} 和 {MODELS[b]['display']} 的軍規測試比較："]
    lines.append("✅ 兩台都有：" + ("、".join(both) if both else "無"))
    lines.append(f"🔹 只有 {na} 有：" + ("、".join(only_a) if only_a else "無"))
    lines.append(f"🔸 只有 {nb} 有：" + ("、".join(only_b) if only_b else "無"))
    if diff:
        lines.append("同一項目的程序差異：")
        lines += diff
    notes = []
    for m in (a, b):
        for test, procs in MODELS[m].get("desc", {}).items():
            notes.append(f"{ENTITIES[m][0]} 的測試說明另列{TESTS[test]['short']}（{proc_label(test, procs)}）")
    if notes:
        lines.append("📄 " + "；".join(notes))
    lines.append("想看某一項的詳細條件，可以直接問例如「" + na + " 低溫測試」")
    return "\n".join(lines)


keys = list(ENTITIES)
for i in range(len(keys)):
    for j in range(i + 1, len(keys)):
        a, b = keys[i], keys[j]
        kws = [f"{x}+{y}" for x in ENTITIES[a][1] for y in ENTITIES[b][1]]
        faqs.append((f"{ENTITIES[a][0]} 和 {ENTITIES[b][0]} 比較", compare_answer(a, b), kws))

# 4.6) 一次列出所有測試項目的詳細條件（一次問全部時，AI 拿不到全部資料，改由資料直接產生）
CODES = {"altitude": "500.6", "hot": "501.7", "cold": "502.7", "tshock": "503.7", "solar": "505.7", "humidity": "507.6",
         "dust": "510.7", "explosive": "511.7", "vibration": "514.8", "drop": "516.8", "shock": "516.8", "freeze": "524.1", "ship": "528.1"}
all_lines = ["華碩商用筆電 MIL-STD-810H 各測試項目的詳細條件："]
for i, (test, t) in enumerate(TESTS.items(), 1):
    all_lines.append("")
    all_lines.append(f"{i}. {t['short']}（{CODES[test]}）")
    all_lines += ["・" + v for v in t["params"].values()]
    passed = [ENTITIES[m][0] for m in ORDER if MODELS[m]["tests"].get(test)]
    all_lines.append("通過型號：" + ("、".join(passed) if passed else "P5405CSA 的測試說明有列出（結果總表未列）"))
all_lines += ["", "想看某一台型號的條件，可以問例如「P5 低溫測試」", NOTE]
faqs.append(("所有測試項目的詳細條件", "\n".join(all_lines), [
    "列出+項目+條件", "列出+項目+詳細", "所有+條件", "全部+條件", "每一項+條件", "每個項目+條件", "各項目+條件", "各項+條件",
    "這些項目+條件", "這些項目+詳細", "所有+測試+詳細", "全部+測試+詳細", "所有項目", "全部項目+條件", "詳細+測試條件+列出",
    "測試條件+有哪些", "完整+條件", "全部的條件",
]))

# 5) 一般問題
general = [
    ("MIL-STD-810H 是什麼",
     "MIL-STD-810H 是美國國防部制定的環境測試標準 📋\n"
     "・模擬產品在高低溫、濕度、高海拔、振動、衝擊、沙塵等環境下的耐受度\n"
     "・華碩指定商用筆電（ExpertBook 系列）依型號通過 MIL-STD-810G 或 810H\n"
     "・測試項目與條件依型號而異\n" + NOTE,
     ["810H是什麼", "810是什麼", "軍規是什麼", "什麼是軍規", "軍規標準", "美軍標準", "MIL-STD", "MILSTD", "軍規認證", "軍規+意思", "軍規+代表"]),
    ("810G 和 810H 有什麼不同",
     "810G 和 810H 是同一套標準的不同版本：\n"
     "・MIL-STD-810G：2008 年發布\n"
     "・MIL-STD-810H：2019 年發布的新版\n"
     "・華碩商用筆電依型號通過 810G 或 810H\n"
     "本資料整理的 5 款都是 810H 的官方報告；其他型號可以請專人幫您確認 🙂",
     ["810G", "810g+810h", "810G+差別", "810G+差異", "810G+不同", "新版+舊版"]),
    ("有哪些型號通過軍規測試",
     "目前整理的華碩商用筆電 MIL-STD-810H 官方報告共 5 款：\n"
     "・ExpertBook P5 14 吋（P5405CSA）\n"
     "・ExpertBook B5（B5302C）\n"
     "・ExpertBook B1 第 12 代（B1400CBA）\n"
     "・ExpertBook B1（B1400／B1500）\n"
     "・ExpertBook L1（L1400）\n"
     "其他型號可以請專人幫您確認 🙂",
     ["哪些型號", "哪幾台", "哪些機種", "哪幾款", "型號清單", "通過軍規的型號", "有軍規的"]),
    ("哪一台測試最完整",
     "測試項目最完整的是 ExpertBook P5 14 吋（P5405CSA）💪\n"
     "・12 大類：高海拔、高溫、低溫、溫度衝擊、太陽輻射、濕度、沙塵、振動、衝擊、凍融、艦載機械振動\n"
     "・測試說明另列爆炸性環境\n"
     "其次是 ExpertBook B5（B5302C），另外有 122 公分運輸跌落測試",
     ["最完整", "最多項", "最耐用", "最堅固", "最強", "測試最多", "推薦哪", "哪台最", "哪一台最", "哪款最"]),
    ("軍規測試有哪些項目",
     "華碩商用筆電的 MIL-STD-810H 測試項目（依型號不同）：\n"
     "・500.6 高海拔\n・501.7 高溫\n・502.7 低溫\n・503.7 溫度衝擊\n・505.7 太陽輻射\n・507.6 濕度\n"
     "・510.7 沙塵\n・511.7 爆炸性環境\n・514.8 振動\n・516.8 衝擊與跌落\n・524.1 凍融\n・528.1 艦載機械振動\n"
     "想看某一項的條件，可以直接問例如「低溫測試怎麼做」",
     ["測試項目", "哪些測試", "有什麼測試", "幾項測試", "測了什麼", "測哪些", "12大類", "測試清單", "還有哪些", "全部測試", "所有測試"]),
    ("通過軍規就保證不會壞嗎",
     "軍規測試代表在實驗室條件下通過測試，但不是保證 🙏\n"
     "・MIL-STD-810 測試只針對指定型號進行\n"
     "・不代表適合軍事用途，也不代表符合美國國防部採購規範\n"
     "・在這些條件下造成的損壞（或嘗試重現測試）視為意外損壞，不在標準保固範圍\n"
     "・可另購華碩 Premium Care 意外損壞保護",
     ["保證", "保固", "不會壞", "軍事用途", "軍用", "國防部", "意外損壞", "Premium Care", "摔壞+保固", "保不保固", "壞了+怎麼辦"]),
    ("可以防水嗎",
     "❌ 華碩商用筆電的 MIL-STD-810H 報告中沒有防水或淋雨測試\n"
     "・濕度測試（Method 507.6）是高濕環境的耐受度，不等於防水\n"
     "・請避免讓筆電淋雨、泡水或打翻飲料\n"
     "・若不小心進水，請立即關機並送修檢查",
     ["防水", "淋雨", "下雨", "泡水", "進水", "潑到", "打翻", "飲料", "雨天", "雨中", "IP65", "IP68", "IPX"]),
    ("在沙漠可以用嗎",
     "沙漠環境可以參考高溫和沙塵兩項測試：\n"
     "・高溫：炎熱乾燥運作 32～49°C 3 天（開機）、儲存 33～71°C 7 天\n"
     "・吹沙：粒子 1.2 g/m³、風速 28 m/s、60°C\n"
     "・吹塵：粒子 10 ± 7 g/m³、60°C\n"
     "沙塵通過型號：P5405CSA（吹塵＋吹沙）、B5302C、B1400CBA（吹沙）\n" + NOTE,
     ["沙漠", "中東", "很熱+沙"]),
    ("測試報告在哪裡看",
     "華碩官方 MIL-STD-810H 測試報告：\n"
     "・可在華碩官網各型號的產品規格頁查詢\n"
     "・官方報告網址：asus.com/event/militarygradereport/\n"
     "・華碩支援頁「軍用標準 (MIL-STD 810) 介紹」\n"
     "需要特定型號的報告，可以請專人協助 🙂",
     ["測試報告", "報告+哪裡", "官方報告", "證明", "認證文件", "資料來源", "哪裡查", "下載+報告", "PDF"]),
]
# 「有哪些型號／有哪些項目」這類清單題標成「#通用」：問題裡有提到具體測試或型號時，讓更精準的題目優先
LIST_TYPE = {"有哪些型號通過軍規測試", "軍規測試有哪些項目"}
faqs += [(q, a, k + ["#通用"] if q in LIST_TYPE else k) for q, a, k in general]

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ASUS商用筆電-MIL-STD-810H-FAQ.csv")
with open(out, "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f, quoting=csv.QUOTE_ALL)
    w.writerow(["問題", "答案", "關鍵字"])
    for q, a, k in faqs:
        # 去重、保持順序
        seen, ks = set(), []
        for x in k:
            if x not in seen:
                seen.add(x)
                ks.append(x)
        w.writerow([q, a, ";".join(ks)])
print(f"產生 {len(faqs)} 題 → {out}")

SOURCES = """
https://www.asus.com/tw/event/militarygradereport/asusexpertbookp5405csa.pdf
https://www.asus.com/event/militarygradereport/ASUSExpertBookB5-B5302C.pdf
https://www.asus.com/event/militarygradereport/asusexpertbookb1-b1400cba.pdf
https://www.asus.com/event/militarygradereport/ASUSExpertBookB1-B1400-B1500.pdf
https://www.asus.com/event/militarygradereport/ASUSExpertBookL1-L1400.pdf
https://www.asus.com/tw/support/faq/1050608/
"""
