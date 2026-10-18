import Foundation

/// 由「軍規機種」資料自動產生 FAQ 與背景知識文件。
/// 規則跟 knowledge/build_mil810h_faq.py 相同：每個型號 × 每個測試、系列、測試總覽、型號總表、兩兩比較、全部條件、一般問題。
enum MILGenerator {
    static let tag = "#MIL自動產生"
    static let docTitle = "華碩商用筆電 MIL-STD-810H 軍規測試（自動產生）"
    static let note = "※ 以華碩官方測試報告為準"

    struct Output {
        var faqs: [FAQItem]
        var doc: KnowledgeDoc
    }

    static func generate(_ c: MILCatalog) -> Output {
        Output(faqs: faqs(c), doc: doc(c))
    }

    // MARK: - 共用

    private static func labels(_ test: MILTestDef, _ procs: [String]) -> String {
        procs.compactMap { test.procedure($0)?.label }.joined(separator: "、")
    }

    private static func lines(_ m: MILModel, _ t: MILTestDef) -> [String] {
        var out = m.passes(t.id).compactMap { t.procedure($0).map { "・" + $0.line } }
        let desc = m.described(t.id).compactMap { t.procedure($0)?.line }
        if !desc.isEmpty { out.append("・測試說明另列：" + desc.joined(separator: "；")) }
        return out
    }

    private static func passedModels(_ c: MILCatalog, _ t: MILTestDef) -> [MILModel] {
        c.models.filter { !$0.passes(t.id).isEmpty }
    }

    /// 比較與清單用的名稱與叫法：型號沒有自己的叫法時，用系列的叫法
    private static func entityAliases(_ c: MILCatalog, _ m: MILModel) -> [String] {
        m.aliases.isEmpty ? (c.family(of: m)?.aliases ?? [m.code]) : m.aliases
    }

    private static func combos(_ a: [String], _ b: [String]) -> [String] {
        var seen = Set<String>(), out: [String] = []
        for x in a { for y in b { let k = "\(x)+\(y)"; if seen.insert(k).inserted { out.append(k) } } }
        return out
    }

    private static func faq(_ q: String, _ a: String, _ k: [String], general: Bool = false) -> FAQItem {
        var seen = Set<String>()
        let keys = k.filter { seen.insert($0).inserted } + (general ? ["#通用"] : []) + [tag]
        return FAQItem(question: q, answer: a, keywords: keys)
    }

    /// 附上 LINE Flex 卡片（JSON 字串）
    private static func withFlex(_ f: FAQItem, _ card: [String: Any]) -> FAQItem {
        var x = f
        x.flex = MILFlex.json(card)
        return x
    }

    // MARK: - 答案

    private static func modelTestAnswer(_ c: MILCatalog, _ m: MILModel, _ t: MILTestDef) -> String {
        if !m.passes(t.id).isEmpty {
            return ([ "✅ \(m.display) 有通過\(t.name)"] + lines(m, t) + [note]).joined(separator: "\n")
        }
        if !m.described(t.id).isEmpty {
            return (["📄 \(m.display) 的報告在測試說明中列出\(t.name)，但結果總表沒有列，請以華碩官方確認為準"] + lines(m, t) + [note]).joined(separator: "\n")
        }
        let others = passedModels(c, t).map(\.code).joined(separator: "、")
        return [
            "❌ \(m.display) 的官方測試報告中沒有\(t.name)",
            "・有通過\(t.short)測試的型號：\(others.isEmpty ? "（目前整理的機種都沒有）" : others)",
            note,
        ].joined(separator: "\n")
    }

    private static func familyTestAnswer(_ c: MILCatalog, _ f: MILFamily, _ t: MILTestDef) -> String {
        let members = c.models.filter { $0.family == f.name }
        var out = ["\(f.name) 有 \(members.count) 份官方報告，\(t.short)測試的結果不同："]
        for m in members {
            if !m.passes(t.id).isEmpty {
                out.append("【\(m.display)】✅ 有通過")
                out += lines(m, t)
            } else {
                out.append("【\(m.display)】❌ 報告中沒有這項")
            }
        }
        out.append("可以告訴我您的完整型號，幫您確認是哪一款 🙂")
        return out.joined(separator: "\n")
    }

    private static func testOverview(_ c: MILCatalog, _ t: MILTestDef) -> String {
        var out = ["\(t.name)的條件："] + t.procedures.map { "・" + $0.line }
        out.append("通過型號：")
        let passed = passedModels(c, t)
        for m in passed { out.append("・\(m.display)：\(labels(t, m.passes(t.id)))") }
        if passed.isEmpty {
            let described = c.models.filter { !$0.described(t.id).isEmpty }.map(\.code)
            out.append("・結果總表中沒有型號列出此項" + (described.isEmpty ? "" : "（\(described.joined(separator: "、")) 的測試說明有列出）"))
        }
        out.append(note)
        return out.joined(separator: "\n")
    }

    private static func modelSummary(_ m: MILModel) -> String {
        var out = ["\(m.display) 通過的 \(m.standard) 測試："]
        out += MILTests.all.filter { !m.passes($0.id).isEmpty }.map { "・" + $0.name }
        let missing = MILTests.all.filter { m.passes($0.id).isEmpty }.map(\.short)
        if !missing.isEmpty { out.append("報告中沒有：" + missing.joined(separator: "、")) }
        out.append(m.aliases.first.map { "想看某一項的詳細條件，可以直接問例如「\($0) 低溫測試」" } ?? note)
        return out.joined(separator: "\n")
    }

    private static func familySummary(_ c: MILCatalog, _ f: MILFamily) -> String {
        let members = c.models.filter { $0.family == f.name }
        var out = ["\(f.name) 有 \(members.count) 份官方報告："]
        for m in members {
            out.append("【\(m.display)】")
            out.append("・" + MILTests.all.filter { !m.passes($0.id).isEmpty }.map(\.short).joined(separator: "、"))
            let missing = MILTests.all.filter { m.passes($0.id).isEmpty }.map(\.short)
            if !missing.isEmpty { out.append("・報告中沒有：" + missing.joined(separator: "、")) }
        }
        out.append("可以告訴我您的完整型號，幫您確認是哪一款 🙂")
        return out.joined(separator: "\n")
    }

    private static func compare(_ a: MILModel, _ b: MILModel) -> String {
        var both: [String] = [], onlyA: [String] = [], onlyB: [String] = [], diff: [String] = []
        for t in MILTests.all {
            let pa = a.passes(t.id), pb = b.passes(t.id)
            if !pa.isEmpty && !pb.isEmpty {
                both.append(t.short)
                let extraA = pa.filter { !pb.contains($0) }, extraB = pb.filter { !pa.contains($0) }
                if !extraA.isEmpty { diff.append("・\(t.short)：\(a.code) 另有 \(labels(t, extraA))") }
                if !extraB.isEmpty { diff.append("・\(t.short)：\(b.code) 另有 \(labels(t, extraB))") }
            } else if !pa.isEmpty { onlyA.append(t.short) }
            else if !pb.isEmpty { onlyB.append(t.short) }
        }
        var out = ["\(a.display) 和 \(b.display) 的軍規測試比較："]
        out.append("✅ 兩台都有：" + (both.isEmpty ? "無" : both.joined(separator: "、")))
        out.append("🔹 只有 \(a.code) 有：" + (onlyA.isEmpty ? "無" : onlyA.joined(separator: "、")))
        out.append("🔸 只有 \(b.code) 有：" + (onlyB.isEmpty ? "無" : onlyB.joined(separator: "、")))
        if !diff.isEmpty { out.append("同一項目的程序差異："); out += diff }
        var notes: [String] = []
        for m in [a, b] {
            for t in MILTests.all where !m.described(t.id).isEmpty {
                notes.append("\(m.code) 的測試說明另列\(t.short)（\(labels(t, m.described(t.id)))）")
            }
        }
        if !notes.isEmpty { out.append("📄 " + notes.joined(separator: "；")) }
        out.append("想看某一項的詳細條件，可以直接問例如「\(a.aliases.first ?? a.code) 低溫測試」")
        return out.joined(separator: "\n")
    }

    private static func allConditions(_ c: MILCatalog) -> String {
        var out = ["華碩商用筆電 MIL-STD-810H 各測試項目的詳細條件："]
        for (i, t) in MILTests.all.enumerated() {
            out.append("")
            out.append("\(i + 1). \(t.short)（\(t.code)）")
            out += t.procedures.map { "・" + $0.line }
            let passed = passedModels(c, t).map(\.code)
            let described = c.models.filter { !$0.described(t.id).isEmpty }.map(\.code)
            out.append("通過型號：" + (passed.isEmpty
                ? (described.isEmpty ? "目前整理的機種都沒有" : "\(described.joined(separator: "、")) 的測試說明有列出（結果總表未列）")
                : passed.joined(separator: "、")))
        }
        out += ["", "想看某一台型號的條件，可以問例如「P5 低溫測試」", note]
        return out.joined(separator: "\n")
    }

    // MARK: - FAQ

    static func faqs(_ c: MILCatalog) -> [FAQItem] {
        var out: [FAQItem] = []
        let tests = MILTests.all

        // 1) 每個型號 × 每個測試
        for m in c.models where !m.aliases.isEmpty {
            for t in tests {
                out.append(faq("\(m.code) \(t.short)測試", modelTestAnswer(c, m, t), combos(m.aliases, t.aliases)))
            }
        }
        // 2) 系列 × 每個測試（同系列兩台以上）
        for f in c.multiFamilies {
            for t in tests {
                out.append(faq("\(f.name) \(t.short)測試", familyTestAnswer(c, f, t), combos(f.aliases, t.aliases)))
            }
        }
        // 3) 每個測試總覽（沙漠交給「在沙漠可以用嗎」）
        for t in tests {
            let keys = t.aliases.filter { $0 != "幾度" && $0 != "沙漠" && $0.count >= 2 }
            out.append(withFlex(faq("\(t.short)測試怎麼做", testOverview(c, t), keys), MILFlex.test(c, t)))
        }
        // 4) 每個型號 / 系列通過哪些測試
        let summaryWords = ["測試項目", "哪些測試", "通過", "軍規", "810", "幾項", "耐用"]
        for m in c.models where !m.aliases.isEmpty {
            out.append(withFlex(faq("\(m.code) 通過哪些測試", modelSummary(m), combos(m.aliases, summaryWords)), MILFlex.model(c, m)))
        }
        for f in c.multiFamilies {
            out.append(faq("\(f.name) 通過哪些測試", familySummary(c, f), combos(f.aliases, summaryWords)))
        }
        // 5) 兩兩比較（由資料算出差異，不靠模型推理）
        for i in c.models.indices {
            for j in c.models.indices where j > i {
                let a = c.models[i], b = c.models[j]
                out.append(withFlex(faq("\(a.code) 和 \(b.code) 比較", compare(a, b), combos(entityAliases(c, a), entityAliases(c, b))), MILFlex.compare(c, a, b)))
            }
        }
        // 圖文選單「比較型號」：用快速選項選兩台
        if c.models.count >= 2 {
            var f = faq("比較型號", "想比較哪兩台呢？點下面的選項，或直接輸入例如「P5 跟 B5 差在哪」🙂", ["比較型號", "型號比較", "比較機種", "機種比較", "比一比"])
            f.quickReplies = MILFlex.comparePairs(c)
            out.append(f)
        }
        // 6) 一次列出全部條件
        out.append(faq("所有測試項目的詳細條件", allConditions(c), [
            "列出+項目+條件", "列出+項目+詳細", "所有+條件", "全部+條件", "每一項+條件", "每個項目+條件", "各項目+條件", "各項+條件",
            "這些項目+條件", "這些項目+詳細", "所有+測試+詳細", "全部+測試+詳細", "所有項目", "全部項目+條件", "詳細+測試條件+列出",
            "測試條件+有哪些", "完整+條件", "全部的條件",
        ]))
        // 7) 一般問題
        out += generalFAQs(c)
        return out
    }

    private static func generalFAQs(_ c: MILCatalog) -> [FAQItem] {
        let ranked = c.models.sorted { $0.passedTestCount > $1.passedTestCount }
        var best = "目前還沒有整理機種"
        if let top = ranked.first {
            var lines = ["測試項目最完整的是 \(top.display)，通過 \(top.passedTestCount) 大類 💪",
                         "・" + MILTests.all.filter { !top.passes($0.id).isEmpty }.map(\.short).joined(separator: "、")]
            let described = MILTests.all.filter { top.passes($0.id).isEmpty && !top.described($0.id).isEmpty }.map(\.short)
            if !described.isEmpty { lines.append("・測試說明另列" + described.joined(separator: "、")) }
            if ranked.count > 1 { lines.append("其次是 \(ranked[1].display)（\(ranked[1].passedTestCount) 大類）") }
            best = lines.joined(separator: "\n")
        }
        let modelList = (["目前整理的華碩商用筆電 MIL-STD-810H 官方報告共 \(c.models.count) 款："]
            + c.models.map { "・" + $0.display } + ["其他型號可以請專人幫您確認 🙂"]).joined(separator: "\n")
        let testList = (["華碩商用筆電的 MIL-STD-810H 測試項目（依型號不同）："]
            + MILTests.all.map { "・\($0.code) \($0.short)" } + ["想看某一項的條件，可以直接問例如「低溫測試怎麼做」"]).joined(separator: "\n")

        return [
            faq("MIL-STD-810H 是什麼",
                "MIL-STD-810H 是美國國防部制定的環境測試標準 📋\n・模擬產品在高低溫、濕度、高海拔、振動、衝擊、沙塵等環境下的耐受度\n・華碩指定商用筆電（ExpertBook 系列）依型號通過 MIL-STD-810G 或 810H\n・測試項目與條件依型號而異\n" + note,
                ["810H是什麼", "810是什麼", "軍規是什麼", "什麼是軍規", "軍規標準", "美軍標準", "MIL-STD", "MILSTD", "軍規認證", "軍規+意思", "軍規+代表"]),
            faq("810G 和 810H 有什麼不同",
                "810G 和 810H 是同一套標準的不同版本：\n・MIL-STD-810G：2008 年發布\n・MIL-STD-810H：2019 年發布的新版\n・華碩商用筆電依型號通過 810G 或 810H\n目前整理的機種都是 810H 的官方報告；其他型號可以請專人幫您確認 🙂",
                ["810G", "810g+810h", "810G+差別", "810G+差異", "810G+不同", "新版+舊版"]),
            faq("有哪些型號通過軍規測試", modelList,
                ["哪些型號", "哪幾台", "哪些機種", "哪幾款", "型號清單", "通過軍規的型號", "有軍規的"], general: true),
            faq("哪一台測試最完整", best,
                ["最完整", "最多項", "最耐用", "最堅固", "最強", "測試最多", "推薦哪", "哪台最", "哪一台最", "哪款最"]),
            faq("軍規測試有哪些項目", testList,
                ["測試項目", "哪些測試", "有什麼測試", "幾項測試", "測了什麼", "測哪些", "12大類", "測試清單", "還有哪些", "全部測試", "所有測試"], general: true),
            faq("通過軍規就保證不會壞嗎",
                "軍規測試代表在實驗室條件下通過測試，但不是保證 🙏\n・MIL-STD-810 測試只針對指定型號進行\n・不代表適合軍事用途，也不代表符合美國國防部採購規範\n・在這些條件下造成的損壞（或嘗試重現測試）視為意外損壞，不在標準保固範圍\n・可另購華碩 Premium Care 意外損壞保護",
                ["保證", "保固", "不會壞", "軍事用途", "軍用", "國防部", "意外損壞", "Premium Care", "摔壞+保固", "保不保固", "壞了+怎麼辦"]),
            faq("可以防水嗎",
                "❌ 華碩商用筆電的 MIL-STD-810H 報告中沒有防水或淋雨測試\n・濕度測試（Method 507.6）是高濕環境的耐受度，不等於防水\n・請避免讓筆電淋雨、泡水或打翻飲料\n・若不小心進水，請立即關機並送修檢查",
                ["防水", "淋雨", "下雨", "泡水", "進水", "潑到", "打翻", "飲料", "雨天", "雨中", "IP65", "IP68", "IPX"]),
            faq("在沙漠可以用嗎", desertAnswer(c), ["沙漠", "中東", "很熱+沙"]),
            faq("測試報告在哪裡看",
                "華碩官方 MIL-STD-810H 測試報告：\n・可在華碩官網各型號的產品規格頁查詢\n・官方報告網址：asus.com/event/militarygradereport/\n・華碩支援頁「軍用標準 (MIL-STD 810) 介紹」\n需要特定型號的報告，可以請專人協助 🙂",
                ["測試報告", "報告+哪裡", "官方報告", "證明", "認證文件", "資料來源", "哪裡查", "下載+報告", "PDF"]),
        ]
    }

    private static func desertAnswer(_ c: MILCatalog) -> String {
        let dust = MILTests.test("dust")!
        let models = passedModels(c, dust).map { m in "\(m.code)（\(m.passes("dust").compactMap { dust.procedure($0)?.label.components(separatedBy: "（").first }.joined(separator: "＋"))）" }
        return [
            "沙漠環境可以參考高溫和沙塵兩項測試：",
            "・高溫：炎熱乾燥運作 32～49°C 3 天（開機）、儲存 33～71°C 7 天",
            "・吹沙：粒子 1.2 g/m³、風速 28 m/s、60°C",
            "・吹塵：粒子 10 ± 7 g/m³、60°C",
            "沙塵通過型號：" + (models.isEmpty ? "目前整理的機種都沒有" : models.joined(separator: "、")),
            note,
        ].joined(separator: "\n")
    }

    // MARK: - 背景知識文件（給 Agent / 向量檢索用，段落以空行分隔、每段 350 字內）

    static func doc(_ c: MILCatalog) -> KnowledgeDoc {
        var paras: [String] = []
        paras.append("""
        MIL-STD-810H 軍規測試 總覽（華碩 ASUS 商用筆電 ExpertBook）
        MIL-STD-810 是美國國防部制定的環境測試標準，用來模擬產品在高低溫、濕度、高海拔、振動、衝擊、沙塵等環境下的耐受度。華碩指定商用筆電（ExpertBook 系列）依型號不同，通過 MIL-STD-810G 或 MIL-STD-810H。測試項目與參數依型號而異，以華碩官方公布的各型號測試報告為準。
        """)
        paras.append("""
        軍規測試 注意事項 免責聲明 保固
        華碩說明：MIL-STD-810 測試只針對指定產品進行，在實驗室條件下執行，不代表產品適合軍事用途，也不代表符合美國國防部採購規範。測試結果不保證未來在相同條件下的表現。在這些條件下造成的損壞（或嘗試重現測試）視為意外損壞，不在標準保固範圍內，可另購華碩 Premium Care 意外損壞保護。
        """)
        paras.append("本資料涵蓋的華碩商用筆電型號\n目前整理 \(c.models.count) 款華碩官方 MIL-STD-810H 測試報告：" + c.models.map(\.display).joined(separator: "、") + "。其他型號請查閱華碩官網該型號的規格頁或測試報告。")

        for t in MILTests.all {
            let title = "Method \(t.code) \(t.short) \(t.name)（\(t.aliases.filter { !$0.contains(".") }.prefix(8).joined(separator: " "))）"
            paras.append(title + "\n條件：" + t.procedures.map(\.line).joined(separator: "；") + "。")
            let passed = passedModels(c, t).map { "\($0.code)（\(labels(t, $0.passes(t.id)))）" }
            let described = c.models.filter { !$0.described(t.id).isEmpty }.map { "\($0.code)（\(labels(t, $0.described(t.id)))）" }
            let missing = c.models.filter { $0.passes(t.id).isEmpty && $0.described(t.id).isEmpty }.map(\.code)
            var body = "Method \(t.code) \(t.short)測試 通過型號\n"
            body += passed.isEmpty ? "結果總表中沒有型號列出此項。" : "通過：" + passed.joined(separator: "、") + "。"
            if !described.isEmpty { body += "測試說明另列（結果總表未列）：" + described.joined(separator: "、") + "。" }
            if !missing.isEmpty { body += "報告中沒有這項測試：" + missing.joined(separator: "、") + "。" }
            if t.id == "humidity" { body += "注意：濕度測試是高濕環境的耐受度，不等於防水，報告中沒有淋雨或防水（Method 506 Rain）測試。" }
            paras.append(body)
        }

        for m in c.models {
            let passed = MILTests.all.filter { !m.passes($0.id).isEmpty }.map { "\($0.code) \($0.short)（\(labels($0, m.passes($0.id)))）" }
            let missing = MILTests.all.filter { m.passes($0.id).isEmpty }.map(\.short)
            var p = "\(m.display) 通過的軍規測試\(m.aliases.isEmpty ? "" : "（" + m.aliases.joined(separator: " ") + "）")\n"
            p += passed.joined(separator: "、") + "。"
            if !missing.isEmpty { p += "報告中沒有：" + missing.joined(separator: "、") + "。" }
            paras.append(p)
        }

        let urls = c.models.map(\.reportURL).filter { !$0.isEmpty }
        paras.append("資料來源 官方測試報告\n本資料整理自華碩官方公開的 MIL-STD-810H 測試報告 PDF" + (urls.isEmpty ? "" : "（" + urls.joined(separator: " ") + "）") + "，以及華碩支援頁「軍用標準 (MIL-STD 810) 介紹」。各型號以華碩官網最新公布資訊為準。")

        return KnowledgeDoc(title: docTitle, content: paras.joined(separator: "\n\n"))
    }
}
