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
            for k in faq.keywords {
                let raw = k.split(separator: "+").map(String.init)
                // 跟問題用同樣方式處理（「撞到」→「撞」），組合裡的單字（例如「曬」）也要出現
                let parts = raw.map { part -> String in
                    let c = core(part)
                    return c.isEmpty ? normalize(part) : c
                }.filter { !$0.isEmpty }
                guard !parts.isEmpty, parts.count == raw.count else { continue }
                if parts.count == 1, parts[0].count < 2 { continue }
                guard parts.allSatisfy({ q.contains($0) }) else { continue }
                let chars = parts.reduce(0) { $0 + $1.count }
                score = max(score, min(0.97, 0.7 + 0.06 * Double(min(parts.count, 3)) + 0.01 * Double(chars)))
            }
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
    static func context(for text: String, data: AccountData, terms: [String] = [], budget: Int = 1800, maxPieces: Int = 4) -> String {
        let q = core(text)
        var pieces: [(String, Double)] = []

        for faq in data.faqs where faq.isEnabled {
            let block = "問：\(faq.question)\n答：\(faq.answer)"
            let score = max(coverage(q, in: core(faq.question + faq.keywords.joined())), coverage(q, in: core(faq.answer)) * 0.8)
                + termScore(terms, in: core(faq.question + faq.answer)) * 0.8
            pieces.append((block, score))
        }
        for doc in data.docs {
            for chunk in chunks(doc.content) {
                // 段落第一行通常是標題，命中標題加分
                let title = chunk.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
                let body = core(chunk)
                let score = coverage(q, in: body) + coverage(q, in: core(title)) * 0.5 + termScore(terms, in: body) * 0.8
                pieces.append(("【\(doc.title)】\(chunk)", score))
            }
        }

        var result = ""
        let store = data.store.asKnowledge
        if !store.isEmpty { result = "店家資訊：\n" + String(store.prefix(600)) + "\n\n" }
        let ranked = pieces.sorted { $0.1 > $1.1 }
        let best = ranked.first?.1 ?? 0
        var used = 0
        for (block, score) in ranked {
            guard used < maxPieces, score >= 0.15, score >= best * 0.5 else { break }
            if result.count + block.count > budget { continue }
            result += block + "\n\n"
            used += 1
        }
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
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
