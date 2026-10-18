import Foundation

/// 軍規 FAQ 的 LINE Flex 卡片（對照 Windows 版 src/core/mil/flex.js，兩邊產生的 JSON 內容相同）
/// 只用在「由資料產生」的答案；AI 的回答維持純文字。
enum MILFlex {
    typealias J = [String: Any]

    static let green = "#06C755", gray = "#8C8C8C", light = "#C7C7CC", orange = "#FF9500", textColor = "#333333"
    static let note = "※ 以華碩官方測試報告為準"
    static let legend = "✓ 通過（數字＝通過的程序數）　說明＝只在測試說明列出　— 報告中沒有"

    private static func text(_ t: String, _ o: J = [:]) -> J {
        var j: J = ["type": "text", "text": t, "wrap": true]
        for (k, v) in o { j[k] = v }
        return j
    }

    private static func box(_ layout: String, _ contents: [J], _ o: J = [:]) -> J {
        var j: J = ["type": "box", "layout": layout, "contents": contents]
        for (k, v) in o { j[k] = v }
        return j
    }

    private static func sep(_ margin: String? = nil) -> J {
        margin.map { ["type": "separator", "margin": $0] } ?? ["type": "separator"]
    }

    private static func button(_ label: String, _ msg: String) -> J {
        ["type": "button", "style": "link", "height": "sm", "action": ["type": "message", "label": label, "text": msg] as J]
    }

    private static func header(_ small: String, _ big: String) -> J {
        box("vertical", [text(small, ["size": "xs", "color": "#FFFFFF"]), text(big, ["size": "lg", "weight": "bold", "color": "#FFFFFF"])],
            ["backgroundColor": green, "paddingAll": "16px"])
    }

    /// 表格的一格：通過 ✓（部分通過顯示 n/m）、說明另列、或沒有
    private static func cell(_ m: MILModel, _ t: MILTestDef) -> (String, String) {
        let p = m.passes(t.id), d = m.described(t.id), n = t.procedures.count
        if !p.isEmpty { return (n > 1 && p.count < n ? "✓ \(p.count)/\(n)" : "✓", green) }
        if !d.isEmpty { return ("說明", orange) }
        return ("—", light)
    }

    private static func cellText(_ c: (String, String), _ flex: Int) -> J {
        text(c.0, ["size": "sm", "align": "center", "color": c.1, "weight": "bold", "flex": flex])
    }

    private static func inMultiFamily(_ c: MILCatalog, _ m: MILModel) -> MILFamily? {
        guard let f = c.family(of: m), c.multiFamilies.contains(where: { $0.name == f.name }) else { return nil }
        return f
    }

    /// 問這台的總表／某項細節要送出的文字（要剛好對到 FAQ 的問題）
    static func summaryQuestion(_ c: MILCatalog, _ m: MILModel) -> String? {
        if !m.aliases.isEmpty { return "\(m.code) 通過哪些測試" }
        return inMultiFamily(c, m).map { "\($0.name) 通過哪些測試" }
    }

    static func detailQuestion(_ c: MILCatalog, _ m: MILModel, _ t: MILTestDef) -> String? {
        if !m.aliases.isEmpty { return "\(m.code) \(t.short)測試" }
        return inMultiFamily(c, m).map { "\($0.name) \(t.short)測試" }
    }

    private static func bubble(_ h: J, _ body: J, _ buttons: [J]) -> J {
        var b: J = ["type": "bubble", "size": "mega", "header": h, "body": body]
        if !buttons.isEmpty { b["footer"] = box("vertical", buttons, ["spacing": "none"]) }
        return b
    }

    private static func actionText(_ j: J) -> String? { (j["action"] as? J)?["text"] as? String }

    // MARK: 兩台比較：表格

    static func compare(_ c: MILCatalog, _ a: MILModel, _ b: MILModel) -> J {
        var rows: [J] = [
            box("horizontal", [
                text("測試項目", ["size": "xs", "color": gray, "weight": "bold", "flex": 4]),
                text(a.code, ["size": "xs", "color": gray, "weight": "bold", "flex": 3, "align": "center"]),
                text(b.code, ["size": "xs", "color": gray, "weight": "bold", "flex": 3, "align": "center"]),
            ]),
            sep(),
        ]
        for t in c.allTests {
            rows.append(box("horizontal", [text(t.short, ["size": "sm", "color": textColor, "flex": 4]), cellText(cell(a, t), 3), cellText(cell(b, t), 3)]))
        }
        rows += [sep("md"), text(legend, ["size": "xxs", "color": gray, "margin": "md"]), text(note, ["size": "xxs", "color": gray])]
        var buttons: [J] = []
        for m in [a, b] {
            if let q = summaryQuestion(c, m), !buttons.contains(where: { actionText($0) == q }) { buttons.append(button("\(m.code) 全部項目", q)) }
        }
        return bubble(header("軍規測試比較", "\(a.code) vs \(b.code)"), box("vertical", rows, ["spacing": "sm"]), buttons)
    }

    // MARK: 單一測試：條件 + 通過型號

    static func test(_ c: MILCatalog, _ t: MILTestDef) -> J {
        var rows: [J] = [text("測試條件", ["size": "sm", "weight": "bold", "color": textColor])]
        for p in t.procedures {
            rows.append(box("vertical", [text(p.label, ["size": "sm", "color": textColor]), text(p.detail, ["size": "xs", "color": gray])], ["margin": "sm"]))
        }
        rows += [sep("lg"), text("通過型號", ["size": "sm", "weight": "bold", "color": textColor, "margin": "lg"])]
        let passed = c.models.filter { !$0.passes(t.id).isEmpty }
        for m in passed {
            let labels = m.passes(t.id).compactMap { t.procedure($0)?.label }.joined(separator: "、")
            rows.append(box("horizontal", [text(m.code, ["size": "sm", "weight": "bold", "color": green, "flex": 3]), text(labels, ["size": "xs", "color": gray, "flex": 5])], ["margin": "sm"]))
        }
        if passed.isEmpty {
            let desc = c.models.filter { !$0.described(t.id).isEmpty }.map(\.code)
            rows.append(text("結果總表中沒有型號列出此項" + (desc.isEmpty ? "" : "（\(desc.joined(separator: "、")) 的測試說明有列出）"), ["size": "xs", "color": gray, "margin": "sm"]))
        }
        rows.append(text(note, ["size": "xxs", "color": gray, "margin": "lg"]))
        var buttons: [J] = []
        for m in passed {
            guard let q = detailQuestion(c, m, t), buttons.count < 4, !buttons.contains(where: { actionText($0) == q }) else { continue }
            let who = m.aliases.isEmpty ? (c.family(of: m)?.name ?? m.code) : m.code
            buttons.append(button("\(who) 細節", q))
        }
        return bubble(header("MIL-STD-810H Method \(t.code)", "\(t.short)測試"), box("vertical", rows, ["spacing": "xs"]), buttons)
    }

    // MARK: 單一型號：每項測試的結果

    static func model(_ c: MILCatalog, _ m: MILModel) -> J {
        var rows: [J] = c.allTests.map { t in
            box("horizontal", [
                text(t.short, ["size": "sm", "color": textColor, "flex": 4]),
                text(t.code, ["size": "xs", "color": gray, "flex": 2, "align": "center"]),
                cellText(cell(m, t), 2),
            ])
        }
        rows += [sep("md"), text(legend, ["size": "xxs", "color": gray, "margin": "md"]), text(note, ["size": "xxs", "color": gray])]
        return bubble(header("\(m.standard) 軍規測試", m.display), box("vertical", rows, ["spacing": "sm"]), [button("和其他型號比較", "比較型號")])
    }

    /// 比較型號的快速選項：「P5405CSA vs B5302C」
    static func pairLabel(_ c: MILCatalog, _ m: MILModel) -> String {
        if m.aliases.contains(m.code) { return m.code }
        if let a = m.aliases.first { return a }
        return c.family(of: m)?.aliases.first ?? m.code
    }

    /// 比較型號第一步：選第一台（送出「比較 P5405CSA」）
    static func compareStart(_ c: MILCatalog) -> [String] {
        c.models.prefix(13).map { "比較 \(pairLabel(c, $0))" }
    }

    /// 比較型號第二步：選要比的另一台（送出「P5405CSA vs B5302C」）
    static func compareWith(_ c: MILCatalog, _ m: MILModel) -> [String] {
        c.models.filter { $0.id != m.id }.prefix(13).map { "\(pairLabel(c, m)) vs \(pairLabel(c, $0))" }
    }

    static func json(_ v: J) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: v, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data("{}".utf8)
        return String(decoding: data, as: UTF8.self)
    }
}
