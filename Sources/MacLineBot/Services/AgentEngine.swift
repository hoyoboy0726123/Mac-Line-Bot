import Foundation

/// Agent 模式（MIL 版）：Qwen 可以用工具反覆查知識庫，把顧客要的資料查齊後才回覆。
///
/// 防止小模型亂編的幾道關卡：
/// 1. 先由程式自動搜尋（問題裡列了好幾項就每項各查一次），模型不會從零開始憑記憶回答
/// 2. 回覆寫了「未列出／沒有具體」等缺口 → 要求它換關鍵字再查一次
/// 3. 回覆裡的「數字＋單位」都要在查到的資料裡找得到，找不到就退回重寫
struct AgentEngine {
    struct Result {
        var reply: String
        var answerable: Bool
        var rounds: Int
        var searches: [String]
    }

    let client: OllamaClient
    let pieces: [String]
    let vectors: [[Float]]
    let maxRounds = 6

    // MARK: 工具

    static let tools: [[String: Any]] = [
        tool("search", "用關鍵字或問題語意搜尋知識庫，回傳最相關的 5 段資料（含編號）。可以換不同關鍵字（項目名稱、Method 編號、型號）多查幾次",
             ["query": ["type": "string"]], required: ["query"]),
        tool("list_sections", "列出知識庫段落標題與編號，用來確認還有哪些項目沒查", [:], required: []),
        tool("read_sections", "依編號讀取段落全文，一次最多 8 段",
             ["ids": ["type": "array", "items": ["type": "integer"]] as [String: Any]], required: ["ids"]),
    ]

    private static func tool(_ name: String, _ description: String, _ properties: [String: Any], required: [String]) -> [String: Any] {
        [
            "type": "function",
            "function": [
                "name": name,
                "description": description,
                "parameters": ["type": "object", "properties": properties, "required": required] as [String: Any],
            ] as [String: Any],
        ]
    }

    private func search(_ query: String, top: Int = 5) async throws -> [(index: Int, relevant: Bool)] {
        let qv = VectorIndex.normalized(try await client.embed([query]).first ?? [])
        let semantic = vectors.map { VectorIndex.cosine(qv, $0) }
        return KnowledgeRetriever.rank(query, pieces: pieces, semantic: semantic).prefix(top).map { ($0.index, $0.relevant) }
    }

    private func render(_ ids: [Int]) -> String {
        ids.filter { pieces.indices.contains($0) }.map { "[\($0)] \(pieces[$0].prefix(900))" }.joined(separator: "\n\n")
    }

    private func listSections() -> String {
        // 「型號 × 單項」的段落太多，清單只列總覽類，細項用 search 查
        let modelPrefixes = ["問：P5405CSA ", "問：B5302C ", "問：B1400CBA ", "問：L1400 ", "問：ExpertBook B1 "]
        return pieces.enumerated().compactMap { i, p in
            let title = String(p.split(separator: "\n", maxSplits: 1).first ?? "")
            if modelPrefixes.contains(where: { title.hasPrefix($0) }) && !title.contains("通過哪些") { return nil }
            return "[\(i)] \(title.prefix(60))"
        }.joined(separator: "\n")
    }

    // MARK: 執行

    func run(question: String, history: [ChatMessage], store: StoreInfo, rules: ReplyRules) async throws -> Result {
        var seen = Set<Int>()
        var anyRelevant = false
        var searches: [String] = []

        // 1) 程式先搜尋：整句一次，問題列了好幾項就每項再各查一次
        var seedIds: [Int] = []
        for q in [question] + Self.splitItems(question) {
            let hits = try await search(q, top: q == question ? 5 : 3)
            searches.append(q)
            for h in hits where !seedIds.contains(h.index) { seedIds.append(h.index) }
            anyRelevant = anyRelevant || hits.contains { $0.relevant }
        }
        seen.formUnion(seedIds)
        var corpus = render(seedIds)

        var messages: [[String: Any]] = [["role": "system", "content": systemPrompt(store: store, rules: rules)]]
        for m in history.suffix(4) where m.role == .customer || m.role == .bot || m.role == .owner {
            messages.append(["role": m.role == .customer ? "user" : "assistant", "content": String(m.text.prefix(300))])
        }
        messages.append(["role": "user", "content": question])
        messages.append(["role": "assistant", "content": "", "tool_calls": [["function": ["name": "search", "arguments": ["query": question]]]]])
        messages.append(["role": "tool", "content": corpus, "tool_name": "search"])

        var checkedGaps = false
        var fixedNumbers = false
        for round in 1...maxRounds {
            let message = try await client.chatTurn(messages: messages, tools: Self.tools)
            messages.append(message)
            let calls = message["tool_calls"] as? [[String: Any]] ?? []

            if !calls.isEmpty {
                for call in calls {
                    let fn = call["function"] as? [String: Any] ?? [:]
                    let name = fn["name"] as? String ?? ""
                    let args = fn["arguments"] as? [String: Any] ?? [:]
                    var output = ""
                    switch name {
                    case "search":
                        let q = args["query"] as? String ?? question
                        let hits = try await search(q)
                        searches.append(q)
                        seen.formUnion(hits.map(\.index))
                        anyRelevant = anyRelevant || hits.contains { $0.relevant }
                        output = render(hits.map(\.index))
                    case "read_sections":
                        let ids = ((args["ids"] as? [Any]) ?? []).compactMap { ($0 as? Int) ?? Int("\($0)") }.prefix(8)
                        seen.formUnion(ids)
                        output = render(Array(ids))
                    case "list_sections":
                        output = listSections()
                    default:
                        output = "沒有這個工具"
                    }
                    corpus += "\n\n" + output
                    messages.append(["role": "tool", "content": output, "tool_name": name])
                }
                continue
            }

            let reply = AIEngine.formatForLINE(Self.stripMarkup(message["content"] as? String ?? ""))
            guard !reply.isEmpty else { throw OllamaError(message: "Agent 沒有產生回覆") }

            // 2) 回覆有缺口 → 換關鍵字再查（只要求一次，避免無限迴圈）
            let gaps = ["未明確", "未列出", "沒有具體", "無法提供", "未提及", "沒有詳細", "僅標註"].filter { reply.contains($0) }
            if !gaps.isEmpty, !checkedGaps, round < maxRounds {
                checkedGaps = true
                messages.append(["role": "user", "content": "請檢查：顧客問的每一項都查到具體資料了嗎？回覆中寫「\(gaps.joined(separator: "、"))」的項目，請換關鍵字用 search 再查（例如用項目名稱或 Method 編號）。查完後重新完整回覆。"])
                continue
            }

            // 3) 數字＋單位都要找得到出處
            let bad = Self.ungroundedNumbers(reply, corpus: corpus)
            if !bad.isEmpty, !fixedNumbers, round < maxRounds {
                fixedNumbers = true
                messages.append(["role": "user", "content": "回覆裡的「\(bad.joined(separator: "、"))」在查到的資料中找不到原文。請只用查到的資料、數字照抄，重新回覆。"])
                continue
            }
            if !bad.isEmpty { throw OllamaError(message: "回覆含有查不到出處的數字：\(bad.joined(separator: "、"))") }

            return Result(reply: reply, answerable: anyRelevant && !AIEngine.saysNoInfo(reply), rounds: round, searches: searches)
        }
        throw OllamaError(message: "Agent 查了 \(maxRounds) 輪還沒完成")
    }

    private func systemPrompt(store: StoreInfo, rules: ReplyRules) -> String {
        AIEngine.instructions(store: store, rules: rules) + """

        工作方式（你可以使用工具）：
        A. 系統已經先幫你搜尋過，結果在對話裡。先判斷這些資料夠不夠回答：不夠就用 search（換關鍵字、項目名稱、Method 編號、型號）、list_sections、read_sections 繼續查。顧客要列出好幾項時，每一項都要查到具體內容。
        B. 只能使用查到的資料，絕對不可以用你自己的知識補充或編造任何數字、測試項目或規格。
        D. 數字一律用阿拉伯數字，連同單位照抄原文（例如「10 ± 7 g/m³」「300～1750 ft/min」「60°C」），不可以改寫成國字或換算單位。
        C. 資料查齊後，直接用文字回覆顧客（不要再呼叫工具）。不要用 Markdown 粗體、標題或 LaTeX 數學式，純文字即可。
        """
    }

    // MARK: 工具函式

    /// 「沙塵、凍融和艦載振動這三項的條件」→ ["沙塵", "凍融", "艦載振動"]
    static func splitItems(_ question: String) -> [String] {
        var q = question
        if let r = q.range(of: "(這|那)?(幾|三|兩|二|四|五|六)?項.*$", options: .regularExpression) { q.removeSubrange(r) }
        let parts = q.components(separatedBy: CharacterSet(charactersIn: "、，,和跟及與/"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.count >= 2 }
        return parts.count >= 2 ? Array(parts.prefix(6)) : []
    }

    /// 去掉模型偶爾輸出的 Markdown 粗體與 LaTeX：$10 \pm 7\text{ g/m}^3$ → 10 ± 7 g/m³
    static func stripMarkup(_ text: String) -> String {
        var t = text
        let replacements: [(String, String)] = [
            ("\\pm", "±"), ("^\\circ", "°"), ("\\circ", "°"), ("^3", "³"), ("^2", "²"), ("\\times", "×"),
            ("\\sim", "～"), ("\\%", "%"), ("**", ""), ("__", ""), ("$", ""),
        ]
        for (a, b) in replacements { t = t.replacingOccurrences(of: a, with: b) }
        // \text{ g/m} → g/m
        t = t.replacingOccurrences(of: "\\\\(text|mathrm)\\{([^}]*)\\}", with: "$2", options: .regularExpression)
        t = t.replacingOccurrences(of: "(?m)^#+\\s*", with: "", options: .regularExpression)
        return t
    }

    /// 「數字＋單位」在資料原文找不到的清單，例如資料是「100 mm」但回覆寫「10 mm」
    static func ungroundedNumbers(_ reply: String, corpus: String) -> [String] {
        // 長的單位放前面，避免「g/m³」被當成「g」
        let units = "W/m²|ft/min|g/m³|m/s|個循環|分鐘|小時|公分|公尺|英尺|mm|cm|ms|Hz|°C|°F|天|次|%|G|g|位|筆"
        guard let re = try? NSRegularExpression(pattern: "(-?\\d[\\d,]*(?:\\.\\d+)?)\\s*(\(units))") else { return [] }
        let squash: (String) -> String = { $0.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: "") }
        let body = squash(corpus)
        var bad: [String] = []
        let ns = reply as NSString
        for m in re.matches(in: reply, range: NSRange(location: 0, length: ns.length)) {
            let number = ns.substring(with: m.range(at: 1)).replacingOccurrences(of: ",", with: "")
            let unit = ns.substring(with: m.range(at: 2))
            let key = number + unit
            // 前面不能緊接著數字（避免「100mm」裡的「00mm」被當成「0mm」）
            let found = body.ranges(of: key).contains { r in
                r.lowerBound == body.startIndex || !body[body.index(before: r.lowerBound)].isNumber
            }
            if !found, !bad.contains(number + " " + unit) { bad.append(number + " " + unit) }
        }
        return bad
    }
}
