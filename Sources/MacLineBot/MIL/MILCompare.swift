import Foundation

/// 型號比較：顧客問的時候才即時產生（對照 Windows 版 src/core/mil/compare.js）
/// 以前每兩台預先存一題 FAQ，型號一多就爆量（41 款 = 820 題）；現在只存型號資料，問到才算。
///
/// 圖文選單「比較型號」的兩步選：
///   13 款以內：先選第一台 → 再選另一台（跟以前一樣）
///   超過 13 款（LINE 快速選項最多 13 個）：先選系列 → 選第一台 → 同系列的直接列、其他系列再點進去選 → 比較表
///   清單太長會分頁，最後一個按鈕是「第 N 頁」
enum MILCompare {
    struct Reply {
        var question: String
        var answer: String
        var flex: String?
        var quickReplies: [String]
    }

    struct Group {
        var name: String
        var models: [MILModel]
    }

    static let maxItems = 13 // LINE 快速選項上限
    static let pageSize = 12 // 分頁時每頁 12 個 + 「下一頁」
    static let startWords = ["比較型號", "型號比較", "比較機種", "機種比較", "比一比"]

    private static func norm(_ s: String) -> String { KnowledgeRetriever.normalize(s) }

    /// 系列：型號開頭的英文字＋第一個數字（P5405CSA → P5、BM3406CHA → BM3、B1400／B1500 → B1）
    static func groupOf(_ m: MILModel) -> String {
        (m.code.range(of: #"^[A-Za-z]+\d"#, options: .regularExpression).map { String(m.code[$0]) } ?? m.code).uppercased()
    }

    static func groups(_ c: MILCatalog) -> [Group] {
        var out: [Group] = []
        for m in c.models {
            let name = groupOf(m)
            if let i = out.firstIndex(where: { $0.name == name }) { out[i].models.append(m) } else { out.append(Group(name: name, models: [m])) }
        }
        return out
    }

    /// 顧客怎麼稱呼這台：型號別名；沒有別名就用系列的叫法
    private static func terms(_ c: MILCatalog, _ m: MILModel) -> [String] {
        if !m.aliases.isEmpty { return m.aliases }
        return c.family(of: m)?.aliases ?? [m.code]
    }

    /// 問題裡提到哪些型號（依出現順序）。長的叫法優先，「B1400CBA」不會被當成「B1400」
    static func resolve(_ c: MILCatalog, _ text: String) -> (models: [MILModel], covered: Int, length: Int) {
        let t = norm(text) as NSString
        struct Hit { var start: Int; var end: Int; var model: Int }
        var hits: [Hit] = []
        for (i, m) in c.models.enumerated() {
            for term in terms(c, m) {
                let n = norm(term)
                guard n.count >= 2 else { continue }
                var from = 0
                while from < t.length {
                    let r = t.range(of: n, options: .literal, range: NSRange(location: from, length: t.length - from))
                    if r.location == NSNotFound { break }
                    hits.append(Hit(start: r.location, end: r.location + r.length, model: i))
                    from = r.location + 1
                }
            }
        }
        hits.sort { a, b in
            if a.end - a.start != b.end - b.start { return a.end - a.start > b.end - b.start }
            if a.start != b.start { return a.start < b.start }
            return a.model < b.model
        }
        var taken: [Hit] = []
        for h in hits where !taken.contains(where: { h.start < $0.end && $0.start < h.end }) { taken.append(h) }
        taken.sort { $0.start < $1.start }
        var out: [Int] = []
        for h in taken where !out.contains(h.model) { out.append(h.model) }
        return (out.map { c.models[$0] }, taken.reduce(0) { $0 + $1.end - $1.start }, t.length)
    }

    /// 清單超過 13 個就分頁：每頁 12 個，最後一個按鈕到下一頁
    private static func paged(_ items: [String], _ page: Int, _ more: (Int) -> String) -> [String] {
        guard items.count > maxItems else { return items }
        let start = (page - 1) * pageSize
        guard start < items.count else { return [] }
        var list = Array(items[start..<min(items.count, start + pageSize)])
        if start + pageSize < items.count { list.append(more(page + 1)) }
        return list
    }

    private static func label(_ c: MILCatalog, _ m: MILModel) -> String { MILFlex.pairLabel(c, m) }
    private static func pickFirst(_ c: MILCatalog, _ m: MILModel) -> String { "比較 \(label(c, m))" }
    private static func pair(_ c: MILCatalog, _ a: MILModel, _ b: MILModel) -> String { "\(label(c, a)) vs \(label(c, b))" }

    /// 第一步：選第一台（太多就先選系列）
    static func startList(_ c: MILCatalog) -> [String] {
        if c.models.count <= maxItems { return c.models.map { pickFirst(c, $0) } }
        return groups(c).map { $0.models.count == 1 ? pickFirst(c, $0.models[0]) : "比較 \($0.name) 系列" }
    }

    /// 第二步：選要比的另一台（太多就同系列先列、其他系列點進去選）
    static func withList(_ c: MILCatalog, _ m: MILModel) -> [String] {
        if c.models.count <= maxItems { return c.models.filter { $0.id != m.id }.map { pair(c, m, $0) } }
        let mine = groupOf(m)
        let all = groups(c)
        var out = (all.first { $0.name == mine }?.models ?? []).filter { $0.id != m.id }.map { pair(c, m, $0) }
        for g in all where g.name != mine {
            out.append(g.models.count == 1 ? pair(c, m, g.models[0]) : "\(label(c, m)) 比 \(g.name) 系列")
        }
        return out
    }

    private static func findGroup(_ c: MILCatalog, _ name: String) -> Group? {
        let key = norm(name).uppercased()
        return groups(c).first { $0.name == key }
    }

    /// 只有一台、而且整句就只是那台的叫法（「比較 P5」的「P5」）
    private static func onlyModel(_ c: MILCatalog, _ text: String) -> MILModel? {
        let r = resolve(c, text)
        return r.models.count == 1 && r.covered == r.length ? r.models[0] : nil
    }

    /// 兩台比較：照型號清單的順序排（跟以前預先產生的題目一樣）
    private static func compareOf(_ c: MILCatalog, _ a: MILModel, _ b: MILModel) -> Reply {
        let ia = c.models.firstIndex { $0.id == a.id } ?? 0, ib = c.models.firstIndex { $0.id == b.id } ?? 0
        let (x, y) = ia <= ib ? (a, b) : (b, a)
        return Reply(question: "\(x.code) 和 \(y.code) 比較", answer: MILGenerator.compare(c, x, y), flex: MILFlex.json(MILFlex.compare(c, x, y)), quickReplies: [])
    }

    private static func match(_ pattern: String, _ text: String) -> [String]? {
        XLSXReader.groups(pattern, text).first
    }

    /// 處理比較相關的訊息；不是比較題回 nil
    static func handle(_ c: MILCatalog, _ text: String) -> Reply? {
        guard c.models.count >= 2 else { return nil }
        var body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        var page = 1
        if let r = body.range(of: #"\s*第\s*(\d+)\s*頁$"#, options: .regularExpression) {
            let digits = body[r].filter(\.isNumber)
            page = max(1, Int(digits) ?? 1)
            body = String(body[..<r.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        // 「比較 B3 系列」：列出這個系列的型號
        if let m = match(#"^比較\s*(.+?)\s*系列$"#, body), let g = findGroup(c, m[1]) {
            return Reply(question: "比較 \(g.name) 系列", answer: "\(g.name) 系列有 \(g.models.count) 款，要先選哪一台呢？👇", flex: nil,
                         quickReplies: paged(g.models.map { pickFirst(c, $0) }, page) { "比較 \(g.name) 系列 第\($0)頁" })
        }
        // 「P5405CSA 比 B3 系列」：選另一個系列裡的型號
        if let m = match(#"^(.+?)\s*比\s*(.+?)\s*系列$"#, body), let a = onlyModel(c, m[1]), let g = findGroup(c, m[2]) {
            return Reply(question: "\(label(c, a)) 比 \(g.name) 系列", answer: "要拿 \(a.display) 跟 \(g.name) 系列的哪一台比較呢？👇", flex: nil,
                         quickReplies: paged(g.models.filter { $0.id != a.id }.map { pair(c, a, $0) }, page) { "\(label(c, a)) 比 \(g.name) 系列 第\($0)頁" })
        }
        let r = resolve(c, body)
        // 兩台以上：直接給比較表
        if r.models.count >= 2 { return compareOf(c, r.models[0], r.models[1]) }
        // 「比較 P5405CSA」：選要比的另一台
        if let m = match(#"^比較\s*(.+)$"#, body), let a = onlyModel(c, m[1]) {
            return Reply(question: pickFirst(c, a), answer: "要拿 \(a.display) 跟哪一台比較呢？👇", flex: nil,
                         quickReplies: paged(withList(c, a), page) { "\(pickFirst(c, a)) 第\($0)頁" })
        }
        // 「比較型號」：第一步
        let nb = norm(body)
        if r.models.isEmpty, startWords.contains(where: { nb.contains(norm($0)) }) {
            let grouped = c.models.count > maxItems
            return Reply(
                question: "比較型號",
                answer: grouped
                    ? "目前有 \(c.models.count) 款，想比較哪兩台呢？先選第一台的系列 👇\n也可以直接輸入例如「P5 跟 B5 差在哪」🙂"
                    : "想比較哪兩台呢？先選第一台 👇\n也可以直接輸入例如「P5 跟 B5 差在哪」🙂",
                flex: nil,
                quickReplies: paged(startList(c), page) { "比較型號 第\($0)頁" })
        }
        return nil
    }
}
