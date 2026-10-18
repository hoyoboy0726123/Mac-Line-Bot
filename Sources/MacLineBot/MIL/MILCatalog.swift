import Foundation

// MARK: - 測試項目定義（MIL-STD-810H，條件取自華碩官方報告）

struct MILProcedure: Identifiable, Hashable {
    var id: String       // 例如 "C1st"
    var label: String    // 例如 "基本寒冷儲存（C1）"
    var detail: String   // 例如 "-25～-33°C，7 天，不開機"
    var line: String { "\(label)：\(detail)" }
}

struct MILTestDef: Identifiable, Hashable {
    var id: String       // 例如 "cold"
    var code: String     // 例如 "502.7"
    var name: String     // 例如 "低溫測試（Method 502.7）"
    var short: String    // 例如 "低溫"
    var procedures: [MILProcedure]
    var aliases: [String]

    func procedure(_ id: String) -> MILProcedure? { procedures.first { $0.id == id } }
}

enum MILTests {
    static let all: [MILTestDef] = [
        MILTestDef(id: "altitude", code: "500.6", name: "高海拔測試（Method 500.6 低氣壓）", short: "高海拔", procedures: [
            .init(id: "I", label: "儲存／空運（程序 I）", detail: "模擬 40,000 英尺（約 12,192 公尺）、-20°C、12 小時，不開機"),
            .init(id: "II", label: "運作（程序 II）", detail: "模擬 15,000 英尺（約 4,572 公尺）、5°C 與 40°C 各 12 小時，開機"),
        ], aliases: ["高海拔", "海拔", "低氣壓", "氣壓", "高山", "坐飛機", "搭飛機", "飛機", "搭機", "空運", "機艙", "500.6", "altitude"]),
        MILTestDef(id: "hot", code: "501.7", name: "高溫測試（Method 501.7）", short: "高溫", procedures: [
            .init(id: "A1op", label: "炎熱乾燥運作（A1）", detail: "32～49°C 循環 3 天，開機"),
            .init(id: "A1st", label: "炎熱乾燥儲存（A1）", detail: "33～71°C 循環 7 天，不開機"),
            .init(id: "A2op", label: "基本炎熱運作（A2）", detail: "30～43°C、濕度 14～44%，3 天，開機"),
            .init(id: "A2st", label: "基本炎熱儲存（A2）", detail: "30～63°C、濕度 5～44%，7 天，不開機"),
        ], aliases: ["高溫", "很熱", "炎熱", "夏天", "車內", "耐熱", "熱的地方", "幾度", "501.7", "hot"]),
        MILTestDef(id: "cold", code: "502.7", name: "低溫測試（Method 502.7）", short: "低溫", procedures: [
            .init(id: "C1st", label: "基本寒冷儲存（C1）", detail: "-25～-33°C，7 天，不開機"),
            .init(id: "C1op", label: "基本寒冷運作（C1）", detail: "-21～-32°C，3 天，開機"),
            .init(id: "C2st", label: "寒冷儲存（C2）", detail: "-37～-46°C，7 天，不開機"),
            .init(id: "C2op", label: "寒冷運作（C2）", detail: "-37～-46°C，3 天，開機"),
        ], aliases: ["低溫", "很冷", "寒冷", "冬天", "耐寒", "耐冷", "零下", "結冰", "雪地", "極寒", "冷的地方", "502.7", "cold"]),
        MILTestDef(id: "tshock", code: "503.7", name: "溫度衝擊測試（Method 503.7）", short: "溫度衝擊", procedures: [
            .init(id: "IA", label: "程序 I-A", detail: "-25°C → 60°C 單向衝擊，停留 4 小時，不開機"),
            .init(id: "IB", label: "程序 I-B", detail: "-25°C → 60°C → -25°C 單循環，停留 6 小時，不開機"),
            .init(id: "IC", label: "程序 I-C", detail: "-51°C ↔ 71°C，1 小時、3 個循環，不開機"),
        ], aliases: ["溫度衝擊", "冷熱衝擊", "急速冷熱", "溫差", "冷熱交替", "忽冷忽熱", "503.7", "temperature shock"]),
        MILTestDef(id: "solar", code: "505.7", name: "太陽輻射測試（Method 505.7）", short: "太陽輻射", procedures: [
            .init(id: "I", label: "程序 I（類別 A1 循環）", detail: "日照 1120 W/m²、49°C，3 個 24 小時循環"),
        ], aliases: ["太陽輻射", "太陽", "日照", "曬", "紫外線", "曝曬", "陽光", "505.7", "solar"]),
        MILTestDef(id: "humidity", code: "507.6", name: "濕度測試（Method 507.6）", short: "濕度", procedures: [
            .init(id: "II", label: "程序 II 加嚴循環", detail: "30°C／60°C、95% RH，10 天，不開機"),
        ], aliases: ["濕度", "潮濕", "濕氣", "高濕", "防潮", "受潮", "耐濕", "防濕", "507.6", "humidity"]),
        MILTestDef(id: "dust", code: "510.7", name: "沙塵測試（Method 510.7）", short: "沙塵", procedures: [
            .init(id: "I", label: "吹塵（程序 I）", detail: "粒子 10 ± 7 g/m³、風速 300～1750 ft/min、60°C"),
            .init(id: "II", label: "吹沙（程序 II）", detail: "粒子 1.2 g/m³、風速 28 m/s、60°C"),
        ], aliases: ["沙塵", "灰塵", "粉塵", "防塵", "吹沙", "沙子", "風沙", "工地", "沙漠", "510.7", "dust", "sand"]),
        MILTestDef(id: "explosive", code: "511.7", name: "爆炸性環境測試（Method 511.7）", short: "爆炸性環境", procedures: [
            .init(id: "I", label: "程序 I", detail: "開機運作，高度 15,000～33,000 英尺，95% 正己烷爆炸性氣體"),
        ], aliases: ["爆炸", "易燃", "可燃氣體", "防爆", "511.7", "explosive"]),
        MILTestDef(id: "vibration", code: "514.8", name: "振動測試（Method 514.8）", short: "振動", procedures: [
            .init(id: "CI", label: "一般貨運（C-I）", detail: "每軸 60 分鐘，開機"),
            .init(id: "CIV", label: "雙輪拖車（C-IV）", detail: "5～500 Hz，每軸 32 分鐘，不開機"),
            .init(id: "CVII", label: "輪式車輛（C-VII）", detail: "5～500 Hz，每軸 40 分鐘，不開機"),
            .init(id: "CVI", label: "複合輪式車輛（C-VI）", detail: "5～500 Hz，每軸 40 分鐘，不開機"),
            .init(id: "E1", label: "一般最低完整性（E-1）", detail: "7.7 g rms，每軸 60 分鐘，不開機"),
        ], aliases: ["振動", "震動", "搖晃", "顛簸", "運送", "車上", "開車", "搬運", "514.8", "vibration"]),
        MILTestDef(id: "drop", code: "516.8", name: "跌落測試（Method 516.8）", short: "跌落", procedures: [
            .init(id: "VI", label: "桌面跌落（程序 VI）", detail: "開機中，從 100 mm（10 公分）高度跌落"),
            .init(id: "IV", label: "運輸跌落（程序 IV，含包裝）", detail: "122 公分高、共 26 次"),
        ], aliases: ["跌落", "掉落", "摔落", "摔地上", "掉地上", "防摔", "抗摔", "耐摔", "摔壞", "摔了", "掉了", "摔", "掉", "drop"]),
        MILTestDef(id: "shock", code: "516.8", name: "衝擊測試（Method 516.8）", short: "衝擊", procedures: [
            .init(id: "I", label: "功能衝擊（程序 I）", detail: "40 G、11 ms，共 18 次，開機"),
            .init(id: "II", label: "公路運輸衝擊（程序 II，含包裝）", detail: "5.1～7.6 G、11 ms，3～42 次"),
            .init(id: "III", label: "脆弱度（程序 III）", detail: "30～50 G 梯形波，共 18 次，不開機"),
            .init(id: "V", label: "墜毀危害（程序 V）", detail: "75 G、6 ms，共 12 次，不開機"),
        ], aliases: ["衝擊", "撞擊", "碰撞", "撞到", "G值", "516.8", "shock"]),
        MILTestDef(id: "freeze", code: "524.1", name: "凍融測試（Method 524.1）", short: "凍融", procedures: [
            .init(id: "III", label: "程序 III 急速溫度變化", detail: "30°C ↔ -10°C、95% RH，1 小時、3 個循環"),
        ], aliases: ["凍融", "結霜", "結露", "起霧", "解凍", "524.1", "freeze", "thaw"]),
        MILTestDef(id: "ship", code: "528.1", name: "艦載設備機械振動測試（Method 528.1）", short: "艦載機械振動", procedures: [
            .init(id: "1", label: "程序 1（Type 1）", detail: "4～33 Hz，2 小時"),
        ], aliases: ["船上", "船艦", "艦載", "坐船", "搭船", "528.1", "ship"]),
    ]

    static func test(_ id: String) -> MILTestDef? { all.first { $0.id == id } }
}

// MARK: - 機種資料（使用者可以在 App 裡新增、編輯）

struct MILModel: Identifiable, Codable, Hashable {
    var id = UUID()
    /// 型號代碼，例如 P5405CSA（同一份報告涵蓋多款時可寫 B1400／B1500）
    var code: String
    /// 顯示名稱，例如 ExpertBook P5 14 吋（P5405CSA）
    var display: String
    /// 顧客可能的叫法，例如 P5405CSA、P5405、ExpertBook P5、P5。留空代表只透過系列名稱回答
    var aliases: [String] = []
    /// 系列，例如 ExpertBook B1。同系列有兩台以上時，問「B1 有沒有…」會把各台結果一起列出
    var family: String = ""
    /// 結果總表列為 Pass 的程序：測試 id → 程序 id
    var passed: [String: [String]] = [:]
    /// 只出現在測試說明、結果總表沒有列的程序
    var describedOnly: [String: [String]] = [:]
    var reportURL: String = ""
    var standard: String = "MIL-STD-810H"

    func passes(_ test: String) -> [String] { passed[test] ?? [] }
    func described(_ test: String) -> [String] { describedOnly[test] ?? [] }
    var passedTestCount: Int { MILTests.all.filter { !passes($0.id).isEmpty }.count }
}

struct MILFamily: Identifiable, Codable, Hashable {
    var id = UUID()
    var name: String            // 例如 ExpertBook B1
    var aliases: [String] = []  // 例如 B1400、B1500、ExpertBook B1、B1
}

struct MILCatalog: Codable {
    var models: [MILModel] = []
    var families: [MILFamily] = []
    var lastGenerated: Date?

    func family(of model: MILModel) -> MILFamily? {
        guard !model.family.isEmpty else { return nil }
        return families.first { $0.name == model.family }
    }

    /// 有兩台以上機種的系列才需要「系列」答案
    var multiFamilies: [MILFamily] {
        families.filter { f in models.filter { $0.family == f.name }.count >= 2 }
    }

    // MARK: 預設資料：目前整理的 5 份華碩官方報告

    static var seed: MILCatalog {
        var c = MILCatalog()
        c.families = [MILFamily(name: "ExpertBook B1", aliases: ["B1400", "B1500", "ExpertBook B1", "B1"])]
        c.models = [
            MILModel(code: "P5405CSA", display: "ExpertBook P5 14 吋（P5405CSA）",
                     aliases: ["P5405CSA", "P5405", "ExpertBook P5", "P5"],
                     passed: ["altitude": ["I", "II"], "hot": ["A2op", "A2st"], "cold": ["C1st", "C1op"], "tshock": ["IA", "IB", "IC"],
                              "solar": ["I"], "humidity": ["II"], "dust": ["I", "II"], "vibration": ["CI", "CIV", "CVII", "E1"],
                              "drop": ["VI"], "shock": ["I", "II", "III", "V"], "freeze": ["III"], "ship": ["1"]],
                     describedOnly: ["hot": ["A1op", "A1st"], "cold": ["C2st", "C2op"], "explosive": ["I"], "vibration": ["CVI"]],
                     reportURL: "https://www.asus.com/tw/event/militarygradereport/asusexpertbookp5405csa.pdf"),
            MILModel(code: "B5302C", display: "ExpertBook B5（B5302C）",
                     aliases: ["B5302C", "B5302", "ExpertBook B5", "B5"],
                     passed: ["altitude": ["I", "II"], "hot": ["A1op", "A1st", "A2op", "A2st"], "cold": ["C1st", "C1op", "C2st", "C2op"],
                              "tshock": ["IC"], "humidity": ["II"], "dust": ["II"], "vibration": ["CVI", "CIV", "CI"],
                              "drop": ["IV", "VI"], "shock": ["I", "II", "III"], "freeze": ["III"], "ship": ["1"]],
                     reportURL: "https://www.asus.com/event/militarygradereport/ASUSExpertBookB5-B5302C.pdf"),
            MILModel(code: "B1400CBA", display: "ExpertBook B1 第 12 代（B1400CBA）",
                     aliases: ["B1400CBA", "B1 12代", "B1第12代", "12代B1"], family: "ExpertBook B1",
                     passed: ["altitude": ["I", "II"], "hot": ["A1op", "A1st", "A2op", "A2st"], "cold": ["C1st", "C1op", "C2st", "C2op"],
                              "humidity": ["II"], "dust": ["II"], "vibration": ["CI", "CIV", "CVII"], "drop": ["VI"],
                              "shock": ["I", "II", "III", "V"], "ship": ["1"]],
                     reportURL: "https://www.asus.com/event/militarygradereport/asusexpertbookb1-b1400cba.pdf"),
            MILModel(code: "B1400／B1500", display: "ExpertBook B1（B1400／B1500）",
                     aliases: [], family: "ExpertBook B1",
                     passed: ["altitude": ["I", "II"], "hot": ["A1op", "A1st", "A2op", "A2st"], "cold": ["C1st", "C1op"],
                              "vibration": ["CI", "CIV", "CVII"], "drop": ["VI"], "shock": ["I", "III"], "ship": ["1"]],
                     reportURL: "https://www.asus.com/event/militarygradereport/ASUSExpertBookB1-B1400-B1500.pdf"),
            MILModel(code: "L1400", display: "ExpertBook L1（L1400）",
                     aliases: ["L1400", "ExpertBook L1", "L1"],
                     passed: ["altitude": ["I", "II"], "hot": ["A1op", "A1st", "A2op", "A2st"], "cold": ["C1st", "C1op", "C2st", "C2op"],
                              "humidity": ["II"], "vibration": ["CI", "CIV", "CVII"], "drop": ["VI"], "shock": ["I"]],
                     reportURL: "https://www.asus.com/event/militarygradereport/ASUSExpertBookL1-L1400.pdf"),
        ]
        return c
    }
}
