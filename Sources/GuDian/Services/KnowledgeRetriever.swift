import Foundation

/// FAQ 比對與知識片段挑選。本地模型 context 很小，只挑最相關的內容餵進去。
enum KnowledgeRetriever {
    private static let fillers = ["請問", "想問", "我想", "你們", "妳們", "您們", "貴店", "一下", "可以", "嗎", "呢", "吧", "啊", "喔", "哦", "的", "是", "有沒有", "有"]

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
    static func matchFAQ(_ text: String, in faqs: [FAQItem]) -> FAQItem? {
        let q = core(text)
        guard q.count >= 2 else { return nil }
        var best: (FAQItem, Double)?
        for faq in faqs where faq.isEnabled {
            let fq = core(faq.question)
            var score = similarity(q, fq)
            if !fq.isEmpty, fq.count >= 2, q.contains(fq) || (fq.contains(q) && q.count >= 3) {
                score = max(score, 0.9)
            }
            for k in faq.keywords {
                let kk = normalize(k)
                if kk.count >= 2, q.contains(kk) { score = max(score, 0.75) }
            }
            if score > (best?.1 ?? 0) { best = (faq, score) }
        }
        guard let best, best.1 >= 0.62 else { return nil }
        return best.0
    }

    // MARK: 給模型的資料

    static func context(for text: String, data: AccountData, budget: Int = 2200) -> String {
        let q = core(text)
        var pieces: [(String, Double)] = []

        for faq in data.faqs where faq.isEnabled {
            let block = "問：\(faq.question)\n答：\(faq.answer)"
            let score = similarity(q, core(faq.question + faq.keywords.joined())) + similarity(q, core(faq.answer)) * 0.5
            pieces.append((block, score))
        }
        for doc in data.docs {
            for chunk in chunks(doc.content) {
                let block = "【\(doc.title)】\(chunk)"
                pieces.append((block, similarity(q, core(block))))
            }
        }

        var result = ""
        let store = data.store.asKnowledge
        if !store.isEmpty { result = "店家資訊：\n" + String(store.prefix(900)) + "\n\n" }
        for (block, _) in pieces.sorted(by: { $0.1 > $1.1 }) {
            if result.count + block.count > budget { continue }
            result += block + "\n\n"
        }
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
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
