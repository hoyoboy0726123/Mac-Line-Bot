import Foundation

/// FAQ 比對與知識片段挑選。本地模型 context 很小，只挑最相關的內容餵進去。
enum KnowledgeRetriever {
    private static let fillers = ["請問", "想問", "我想", "你們", "妳們", "您們", "貴店", "一下", "可以", "嗎", "呢", "吧", "啊", "喔", "哦", "的", "是", "有沒有", "有", "會不會", "能不能", "到", "會"]

    static func normalize(_ text: String) -> String {
        var scalars = String.UnicodeScalarView()
        for u in text.lowercased().unicodeScalars
        where !CharacterSet.punctuationCharacters.contains(u)
            && !CharacterSet.whitespacesAndNewlines.contains(u)
            && !CharacterSet.symbols.contains(u) {
            scalars.append(u)
        }
        return String(scalars)
    }

    static func core(_ text: String) -> String {
        var s = normalize(text)
        for f in fillers { s = s.replacingOccurrences(of: f, with: "") }
        return s.isEmpty ? normalize(text) : s
    }

    static func bigrams(_ s: String) -> Set<String> {
        let chars = Array(s)
        guard chars.count > 1 else { return chars.isEmpty ? [] : [String(chars)] }
        var set = Set<String>()
        for i in 0..<(chars.count - 1) { set.insert(String(chars[i...i + 1])) }
        return set
    }

    static func similarity(_ a: String, _ b: String) -> Double {
        let x = bigrams(a), y = bigrams(b)
        guard !x.isEmpty, !y.isEmpty else { return 0 }
        return 2 * Double(x.intersection(y).count) / Double(x.count + y.count)
    }

    // MARK: FAQ

    /// 常見問題直接回標準答案（不經過模型）
    /// 關鍵字可以用「+」表示要同時出現，例如「P5+低溫」；命中越多、越長的關鍵字分數越高，
    /// 所以「P5 可以耐多低溫」會選中「P5 低溫」那題，而不是泛用的「低溫測試」。
    static func matchFAQ(_ text: String, in faqs: [FAQItem]) -> FAQItem? {
        let q = core(text)
        guard q.count >= 2 else { return nil }
        var best: (FAQItem, Double)?
        for faq in faqs where faq.isEnabled {
            let fq = core(faq.question)
            var score = similarity(q, fq)
            if fq == q { score = 1 }
            else if fq.count >= 2, q.contains(fq) || (fq.contains(q) && q.count >= 3) {
                // 長度越接近越像同一題：「沙塵測試呢」應該選「沙塵測試怎麼做」而不是「ExpertBook B1 沙塵測試」
                let closeness = Double(min(q.count, fq.count)) / Double(max(q.count, fq.count))
                score = max(score, 0.75 + 0.2 * closeness)
            }
            // 取「最好的一個」關鍵字：組合的部分越多、命中的字越長，分數越高
            for k in faq.keywords where !k.hasPrefix("#") {
                let raw = k.split(separator: "+").map(String.init)
                // 跟問題用同樣方式處理（「撞到」→「撞」），組合裡的單字（例如「曬」）也要出現
                let parts = raw.map { part -> String in
                    let c = core(part)
                    return c.isEmpty ? normalize(part) : c
                }.filter { !$0.isEmpty }
                guard !parts.isEmpty, parts.count == raw.count else { continue }
                if parts.count == 1, parts[0].count < 2 { continue }
                // 每個部分要出現在不同位置：「B1400CBA」不能同時算成「B1400CBA」和「B1400」兩個型號
                var rest = q
                var allFound = true
                for part in parts.sorted(by: { $0.count > $1.count }) {
                    guard let r = rest.range(of: part) else { allFound = false; break }
                    rest.replaceSubrange(r, with: "|")
                }
                guard allFound else { continue }
                let chars = parts.reduce(0) { $0 + $1.count }
                score = max(score, min(0.97, 0.7 + 0.06 * Double(min(parts.count, 3)) + 0.01 * Double(chars)))
            }
            // 「#通用」的一般問題降低優先：「528.1 有哪些機種通過」要選 528.1 那題，不是「有哪些型號通過軍規」
            if faq.keywords.contains("#通用") { score -= 0.1 }
            if score > (best?.1 ?? 0) { best = (faq, score) }
        }
        guard let best, best.1 >= 0.62 else { return nil }
        return best.0
    }

    // MARK: 給模型的資料

    /// 問題的雙字詞有多少比例出現在這段資料裡（不會因為段落長就被扣分）
    static func coverage(_ query: String, in text: String) -> Double {
        let q = bigrams(query)
        guard !q.isEmpty else { return 0 }
        return Double(q.intersection(bigrams(text)).count) / Double(q.count)
    }

    /// 挑出跟問題最相關的幾段。只放真的相關的，小模型被雜訊干擾會變得很保守
    /// AI 幫忙把口語問題轉成的關鍵詞，命中幾個（整個詞出現算 1，部分出現算 0.5）
    static func termScore(_ terms: [String], in text: String) -> Double {
        let ts = terms.map(normalize).filter { $0.count >= 2 }
        guard !ts.isEmpty else { return 0 }
        let hit = ts.reduce(0.0) { sum, t in
            if text.contains(t) { return sum + 1 }
            return coverage(t, in: text) >= 0.5 ? sum + 0.5 : sum
        }
        return min(1, hit / Double(min(ts.count, 4)))
    }

    /// - Parameter terms: AI 從問題延伸出的同義詞、正式術語（語意理解），可以是空的
    /// 知識庫的所有段落（FAQ + 文件段落），順序固定，向量索引也用同一份
    static func pieces(of data: AccountData) -> [String] {
        var out: [String] = []
        for faq in data.faqs where faq.isEnabled {
            out.append("問：\(faq.question)\n答：\(faq.answer)")
        }
        for doc in data.docs {
            for chunk in chunks(doc.content) { out.append("【\(doc.title)】\(chunk)") }
        }
        return out
    }

    /// 雙字詞分數（沒有向量時唯一的依據；有向量時當輔助）
    static func lexicalScore(_ q: String, piece: String, terms: [String]) -> Double {
        let body = core(piece)
        let firstLine = piece.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
        return coverage(q, in: body) + coverage(q, in: core(firstLine)) * 0.5 + termScore(terms, in: body) * 0.8
    }

    /// - Parameters:
    ///   - terms: AI 從問題延伸出的術語（沒有向量時用）
    ///   - semantic: 每個段落跟問題的 bge-m3 相似度，順序同 `pieces(of:)`；nil 代表沒有向量
    static func context(for text: String, data: AccountData, terms: [String] = [], semantic: [Double]? = nil,
                        budget: Int = 1800, maxPieces: Int = 4) -> String {
        let q = core(text)
        let all = pieces(of: data)
        var scored: [(String, Double)] = []

        // 型號客製（MIL）：問題裡的型號代碼（P5、B5302C、B1400CBA…）
        let models = modelTokens(text)
        let comparing = models.count >= 2 || ["差", "不同", "比較", "差異", "哪個好", "哪台好", "vs"].contains { text.lowercased().contains($0) }

        if let semantic, semantic.count == all.count {
            // 混合排序：語意為主、字面為輔。兩邊都沒把握的段落不送給模型（避免無關問題也硬塞資料）
            for (i, piece) in all.enumerated() {
                let sem = semantic[i]
                var lex = min(1, lexicalScore(q, piece: piece, terms: terms))
                if !models.isEmpty {
                    let first = normalize(piece.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? "")
                    let body = normalize(piece)
                    let mentioned = models.filter { first.contains($0) || body.contains($0) }
                    if models.contains(where: { first.contains($0) }) { lex += 0.4 }
                    // 比較型號：每個型號的「通過哪些測試」總表一定要放進去
                    if comparing, first.contains("通過哪些測試"), !mentioned.isEmpty { lex += 0.6 + 0.1 * Double(mentioned.count) }
                }
                guard sem >= 0.5 || lex >= 0.35 else { continue }
                scored.append((piece, 0.65 * sem + 0.35 * lex))
            }
        } else {
            for piece in all {
                scored.append((piece, lexicalScore(q, piece: piece, terms: terms)))
            }
        }

        var result = ""
        let store = data.store.asKnowledge
        if !store.isEmpty { result = "店家資訊：\n" + String(store.prefix(600)) + "\n\n" }
        var used = 0
        // 比較型號時，每個提到的型號的測試總表優先放進去（不受分數比例限制）
        if comparing, !models.isEmpty {
            for piece in all {
                let first = normalize(piece.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? "")
                guard first.contains("通過哪些測試"), models.contains(where: { normalize(piece).contains($0) }),
                      used < maxPieces, result.count + piece.count <= budget else { continue }
                result += piece + "\n\n"
                used += 1
            }
            scored.removeAll { result.contains($0.0) }
        }
        let ranked = scored.sorted { $0.1 > $1.1 }
        let best = ranked.first?.1 ?? 0
        let minScore = semantic == nil ? 0.15 : 0.3
        let ratio = semantic == nil ? 0.5 : 0.75
        for (block, score) in ranked {
            guard used < maxPieces, score >= minScore, score >= best * ratio else { break }
            if result.count + block.count > budget { continue }
            result += block + "\n\n"
            used += 1
        }
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Agent 搜尋工具用：所有段落依「語意 + 字面 + 型號」混合分數排序。
    /// relevant = 語意或字面至少一邊有把握（用來判斷是不是真的查到相關資料）
    static func rank(_ text: String, pieces all: [String], semantic: [Double]?) -> [(index: Int, score: Double, relevant: Bool)] {
        let q = core(text)
        let models = modelTokens(text)
        var out: [(index: Int, score: Double, relevant: Bool)] = []
        for (i, piece) in all.enumerated() {
            var lex = min(1, lexicalScore(q, piece: piece, terms: []))
            if !models.isEmpty {
                let first = normalize(piece.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? "")
                if models.contains(where: { first.contains($0) }) { lex += 0.4 }
            }
            let sem = semantic.flatMap { i < $0.count ? $0[i] : nil } ?? 0
            let score = semantic == nil ? lex : 0.65 * sem + 0.35 * lex
            out.append((i, score, sem >= 0.5 || lex >= 0.35))
        }
        return out.sorted { $0.score > $1.score }
    }

    /// 問題裡的型號代碼，例如「P5 跟 B5」→ ["p5", "b5"]、「B1400CBA」→ ["b1400cba"]
    static func modelTokens(_ text: String) -> [String] {
        guard let re = try? NSRegularExpression(pattern: "[a-z]+[0-9]+[a-z0-9]*") else { return [] }
        let t = normalize(text)
        let r = NSRange(t.startIndex..., in: t)
        var out: [String] = []
        for m in re.matches(in: t, range: r) {
            guard let range = Range(m.range, in: t) else { continue }
            let tok = String(t[range])
            // 810、500.6 這類標準編號不是型號
            if tok.hasPrefix("milstd") || tok.hasPrefix("method") || tok.hasPrefix("ip") { continue }
            if !out.contains(tok) { out.append(tok) }
        }
        return out
    }

    /// 指向上一則訊息內容的說法（「第13項」「第三個」），FAQ 看不到上下文，要交給 Agent
    static func refersToPrevious(_ text: String) -> Bool {
        text.range(of: "第\\s*([0-9]+|[一二三四五六七八九十]+)\\s*(項|個|點|款|台)", options: .regularExpression) != nil
    }

    /// 是不是接著上一題的追問：「有通過的型號」「那低溫呢」「這些項目的內容」
    static func isFollowUp(_ text: String) -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let markers = ["這些", "那些", "這個", "那個", "這項", "那項", "它", "其他", "還有", "呢", "哪些型號", "有通過", "哪幾台", "那", "上面", "剛剛"]
        return t.count <= 6 || markers.contains { t.contains($0) }
    }

    /// context 裡有沒有真的放進知識庫內容（只有店家基本資料不算）
    static func hasKnowledge(_ context: String) -> Bool {
        context.contains("【") || context.contains("問：")
    }

    static func chunks(_ text: String, size: Int = 350) -> [String] {
        let paragraphs = text.components(separatedBy: "\n\n").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        var out: [String] = []
        for p in paragraphs {
            if p.count <= size { out.append(p); continue }
            var rest = Substring(p)
            while !rest.isEmpty {
                out.append(String(rest.prefix(size)))
                rest = rest.dropFirst(size)
            }
        }
        return out
    }

    static func containsAny(_ text: String, _ keywords: [String]) -> String? {
        let t = normalize(text)
        return keywords.first { k in
            let kk = normalize(k)
            return !kk.isEmpty && t.contains(kk)
        }
    }
}
