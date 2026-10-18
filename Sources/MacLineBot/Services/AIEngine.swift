import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

enum AIStatus: Equatable {
    case available
    case unavailable(String)

    var isAvailable: Bool { self == .available }
    var label: String {
        switch self {
        case .available: "可用"
        case .unavailable(let reason): reason
        }
    }
}

enum CustomerIntentKind: String {
    case question, reservation, humanAgent, greeting, thanks, complaint, other
}

struct AIAnswer {
    var intent: CustomerIntentKind
    var answerable: Bool
    var reply: String
    var model: String = "Apple"
}

struct AISlots {
    var date: String?
    var time: String?
    var people: Int?
    var name: String?
    var phone: String?
}

#if canImport(FoundationModels)
@Generable
enum CustomerIntent {
    case question
    case reservation
    case humanAgent
    case greeting
    case thanks
    case complaint
    case other
}

@Generable
struct KnowledgeAnswer {
    @Guide(description: "顧客這則訊息的意圖。想訂位/預約是 reservation；要求找真人、專人、老闆是 humanAgent；打招呼是 greeting；道謝是 thanks；抱怨是 complaint；詢問店家、產品或服務的資訊是 question")
    var intent: CustomerIntent

    @Guide(description: "從參考資料中原文摘錄跟顧客問題有關的句子，純文字寫成一行，不要換行、不要條列符號，100 字以內。只要資料有提到相關內容就要摘錄；參考資料完全沒有相關內容時才留空字串")
    var evidence: String

    @Guide(description: "要回覆給顧客的訊息，繁體中文。有摘錄到資料時，用摘錄的內容具體回答（數字、條件、型號照抄）：第一行一句話總結，有兩項以上的條件、程序、型號或項目時，每一項換行並用「・」開頭條列。沒有摘錄到資料時，誠實說目前沒有這項資訊")
    var reply: String
}

@Generable
struct SearchTerms {
    @Guide(description: "把顧客的口語問題轉換成技術文件或商品資料裡可能出現的關鍵詞：同義詞、正式術語、英文術語、相關測試或規格名稱。5 到 10 個，每個 2 到 8 個字")
    var keywords: [String]
}

@Generable
struct ReservationSlots {
    @Guide(description: "預約日期，照顧客原本的說法，例如「10/12」「明天」「下週六」。沒有提到就留空")
    var date: String?

    @Guide(description: "預約時間，例如「19:00」「晚上七點」。沒有提到就留空")
    var time: String?

    @Guide(description: "用餐或到店人數。沒有提到就留空")
    var people: Int?

    @Guide(description: "訂位人的姓名或稱呼。沒有提到就留空")
    var name: String?

    @Guide(description: "手機號碼。沒有提到就留空")
    var phone: String?
}
#endif

struct AITimeoutError: LocalizedError {
    var seconds: Double
    var errorDescription: String? { "AI 超過 \(Int(seconds)) 秒沒有回應" }
}

/// 只讓第一個結果（完成或逾時）生效
private final class OnceFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    func claim() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if done { return false }
        done = true
        return true
    }
}

/// 用 macOS 內建 Apple Intelligence 本地模型：不用 API key、沒有 token 費用，資料不出這台電腦。
final class AIEngine {
    static func status() -> AIStatus {
        #if canImport(FoundationModels)
        let availability = SystemLanguageModel.default.availability
        if case .available = availability { return .available }
        if case .unavailable(let reason) = availability {
            switch reason {
            case .deviceNotEligible: return .unavailable("這台 Mac 不支援 Apple Intelligence")
            case .appleIntelligenceNotEnabled: return .unavailable("尚未開啟 Apple Intelligence")
            case .modelNotReady: return .unavailable("模型下載中，請稍候")
            @unknown default: return .unavailable("Apple Intelligence 暫時無法使用")
            }
        }
        return .unavailable("Apple Intelligence 暫時無法使用")
        #else
        return .unavailable("此系統沒有 FoundationModels（需要 macOS 26 以上）")
        #endif
    }

    static func instructions(store: StoreInfo, rules: ReplyRules) -> String {
        let name = store.name.isEmpty ? "這家店" : store.name
        return """
        你是「\(name)」的 LINE 官方帳號客服。
        \(rules.tone.instruction)\(rules.useEmoji ? "可以使用少量表情符號。" : "不要使用表情符號。")
        規則：
        1. 先在「參考資料」中找出跟問題有關的內容，再用這些內容回答。資料有寫的就要具體回答，不要說沒有資料。
        2. 顧客問「可不可以、會不會壞、能不能用」這類問題時，不要回答沒有資訊，而是說明資料中相關的測試或規格條件（數字照抄），讓顧客自己判斷；不要保證一定不會壞。
        3. 參考資料完全沒有相關內容時，才說目前沒有這項資訊；絕對不可以編造資料以外的價格、規格、時間、地址、活動或承諾。
        4. 每個數字、條件都要跟它所屬的型號或項目對應，不可以把 A 型號的資料說成 B 型號的；資料寫「沒有」某項測試時，就直接回答沒有。
        5. 一律使用繁體中文。排版要清楚好讀：第一行先用一句話回答重點；有兩項以上的內容就換行條列，每行用「・」開頭、一行只放一項；最後可以補一行提醒。不要把很多項目擠成一大段。一般回覆 \(rules.maxReplyLength) 字以內，條列時可以較長但最多 10 點。
        6. 不要提到你是 AI 模型，不要說「根據資料」「參考資料」，也不要提到文件標題。
        7. 不處理退款、法律、醫療等需要店家判斷的事情。
        8. 不要說「可以安全使用」「沒問題」「可正常使用」「一定不會壞」這類保證的話。
        9. 不要自行推測資料沒寫的內容（例如型號的世代、上市時間、價格）。
        10. 報告裡沒有列出的測試，要說「報告中沒有這項測試」，不可以說「未通過」或「不合格」。
        12. 顧客要你列出很多項目時，參考資料裡有的就完整列出；參考資料剛好沒有包含某一項的細節時，寫「可以再單獨詢問這一項」，絕對不要寫「資料中未列出」「沒有具體條件」。
        11. 顧客比較兩個型號時，參考資料裡有兩邊各自的測試清單就是可以回答：逐項對照，列出「兩台都有」「只有 A 有」「只有 B 有」，不要說沒有差異資料。
        """
    }

    /// 參考資料 + 最近對話 + 顧客最新訊息（Apple 與 Qwen 共用）
    static func prompt(question: String, knowledge: String, history: [ChatMessage]) -> String {
        var prompt = "參考資料：\n\(knowledge.isEmpty ? "（沒有資料）" : knowledge)\n\n"
        let recent = history.suffix(6).filter { $0.role == .customer || $0.role == .bot || $0.role == .owner }
        if !recent.isEmpty {
            prompt += "最近對話：\n"
            for m in recent {
                prompt += (m.role == .customer ? "顧客：" : "客服：") + String(m.text.prefix(200)) + "\n"
            }
            prompt += "\n"
        }
        prompt += "顧客最新訊息：\(question)"
        return prompt
    }

    // MARK: - 模型選擇：Qwen（Ollama）為主，Apple 本機模型為備援

    struct Config {
        var useOllama = false
        var ollamaReady = false
        var appleFallback = true
        var client = OllamaClient(baseURL: "http://127.0.0.1:11434", chatModel: "qwen3.5:9b", embedModel: "bge-m3")
        var ollamaTimeout: Double = 25
        var agentMode = true

        var usingOllama: Bool { useOllama && ollamaReady }
    }

    private static let configLock = NSLock()
    nonisolated(unsafe) private static var _config = Config()
    static var config: Config {
        get { configLock.lock(); defer { configLock.unlock() }; return _config }
        set { configLock.lock(); _config = newValue; configLock.unlock() }
    }

    /// 目前有沒有任何一個模型可以用
    static var anyAvailable: Bool { config.usingOllama || status().isAvailable }

    /// 給畫面顯示：目前實際回答用的模型
    static var activeModelName: String {
        config.usingOllama ? config.client.chatModel : "Apple 本機模型"
    }

    /// 依知識庫回答：先用 Qwen，失敗或逾時再用 Apple 模型
    static func answer(question: String, knowledge: String, history: [ChatMessage], store: StoreInfo, rules: ReplyRules) async throws -> AIAnswer {
        let cfg = config
        if cfg.usingOllama {
            do {
                return try await withTimeout(cfg.ollamaTimeout) {
                    try await ollamaAnswer(question: question, knowledge: knowledge, history: history, store: store, rules: rules, client: cfg.client)
                }
            } catch {
                guard cfg.appleFallback, status().isAvailable else { throw error }
                NSLog("Qwen 失敗，改用 Apple 模型：\(error.localizedDescription)")
            }
        }
        return try await appleAnswer(question: question, knowledge: knowledge, history: history, store: store, rules: rules)
    }

    private static let answerSchema: [String: Any] = [
        "type": "object",
        "properties": [
            "intent": ["type": "string", "enum": ["question", "reservation", "humanAgent", "greeting", "thanks", "complaint", "other"]],
            "evidence": ["type": "string"],
            "reply": ["type": "string"],
        ] as [String: Any],
        "required": ["intent", "evidence", "reply"],
    ]

    static func ollamaAnswer(question: String, knowledge: String, history: [ChatMessage], store: StoreInfo, rules: ReplyRules, client: OllamaClient) async throws -> AIAnswer {
        let system = instructions(store: store, rules: rules) + """

        輸出 JSON：
        - intent：顧客意圖（question 詢問資訊／reservation 想預約／humanAgent 要找真人／greeting 打招呼／thanks 道謝／complaint 抱怨／other）
        - evidence：從參考資料原文摘錄最相關的 1～2 句，最多 120 字；完全沒有相關內容才留空字串
        - reply：給顧客的回覆，照上面的排版規則
        """
        let j = try await client.chatJSON(system: system, user: prompt(question: question, knowledge: knowledge, history: history), schema: answerSchema)
        let intent = CustomerIntentKind(rawValue: j["intent"] as? String ?? "") ?? .other
        let evidence = (j["evidence"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let reply = formatForLINE(j["reply"] as? String ?? "")
        guard !reply.isEmpty else { throw OllamaError(message: "沒有產生回覆") }
        return AIAnswer(intent: intent, answerable: !evidence.isEmpty && !saysNoInfo(reply), reply: reply, model: client.chatModel)
    }

    /// Apple 本機模型（FoundationModels）回答
    static func appleAnswer(question: String, knowledge: String, history: [ChatMessage], store: StoreInfo, rules: ReplyRules) async throws -> AIAnswer {
        #if canImport(FoundationModels)
        guard status().isAvailable else { throw NSError(domain: "MacLineBot", code: 10, userInfo: [NSLocalizedDescriptionKey: "Apple Intelligence 不可用"]) }
        let prompt = prompt(question: question, knowledge: knowledge, history: history)
        // 小模型偶爾會產生格式壞掉的結構化輸出，換個溫度重試一次
        var lastError: Error?
        var content: KnowledgeAnswer?
        for temperature in [0.2, 0.5] {
            do {
                let attempt = LanguageModelSession(instructions: instructions(store: store, rules: rules))
                content = try await attempt.respond(
                    to: prompt,
                    generating: KnowledgeAnswer.self,
                    options: GenerationOptions(temperature: temperature)
                ).content
                break
            } catch {
                lastError = error
            }
        }
        guard let r = content else { throw lastError ?? NSError(domain: "MacLineBot", code: 11) }
        let intent: CustomerIntentKind = switch r.intent {
        case .question: .question
        case .reservation: .reservation
        case .humanAgent: .humanAgent
        case .greeting: .greeting
        case .thanks: .thanks
        case .complaint: .complaint
        case .other: .other
        }
        // 有摘錄到資料就算答得出來（先摘錄再回答，小模型比較不會過度保守）
        let evidence = r.evidence.trimmingCharacters(in: .whitespacesAndNewlines)
        let reply = formatForLINE(r.reply)
        return AIAnswer(intent: intent, answerable: !evidence.isEmpty && !saysNoInfo(reply), reply: reply)
        #else
        throw NSError(domain: "MacLineBot", code: 10, userInfo: [NSLocalizedDescriptionKey: "Apple Intelligence 不可用"])
        #endif
    }

    /// 語意理解：把顧客的口語問題轉成資料裡可能出現的術語（例如「摔到地上」→ 跌落、衝擊、Drop）
    static func searchTerms(for question: String) async -> [String] {
        #if canImport(FoundationModels)
        guard status().isAvailable else { return [] }
        let session = LanguageModelSession(instructions: "你負責幫客服搜尋資料庫。只輸出關鍵詞，不要回答問題。")
        do {
            let r = try await session.respond(to: "顧客問題：\(question)", generating: SearchTerms.self, options: GenerationOptions(temperature: 0))
            return Array(r.content.keywords.prefix(10))
        } catch {
            return []
        }
        #else
        return []
        #endif
    }

    /// 模型偶爾還是會把多項內容擠成一段：用「；」分隔的三項以上自動改成條列
    static func formatForLINE(_ raw: String) -> String {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        // 去掉模型偶爾殘留在結尾的 ``` } " 和沒成對的 」
        while let last = text.last, "`}\"".contains(last) || (last == "」" && text.filter({ $0 == "「" }).count < text.filter({ $0 == "」" }).count) {
            text.removeLast()
            text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        // 模型有時會用 - 或 * 當項目符號，統一成「・」
        text = text.components(separatedBy: "\n").map { line in
            let t = line.trimmingCharacters(in: .whitespaces)
            for prefix in ["- ", "* ", "• ", "‧ "] where t.hasPrefix(prefix) {
                return "・" + t.dropFirst(prefix.count)
            }
            return t
        }.joined(separator: "\n")
        guard !text.contains("\n・") else { return text }
        let parts = text.components(separatedBy: "；").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        guard parts.count >= 3 else { return text }
        // 第一項若有「：」，冒號前當標題
        var lines: [String] = []
        var first = parts[0]
        if let colon = first.firstIndex(where: { $0 == "：" || $0 == ":" }) {
            lines.append(String(first[...colon]))
            first = String(first[first.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
        }
        lines.append("・" + first)
        for p in parts.dropFirst() {
            // 最後一項後面接的句子（例如「通過型號…」）拆成獨立一行
            if let dot = p.firstIndex(of: "。"), p.index(after: dot) < p.endIndex {
                lines.append("・" + p[...dot].dropLast())
                lines.append(String(p[p.index(after: dot)...]).trimmingCharacters(in: .whitespaces))
            } else {
                lines.append("・" + (p.hasSuffix("。") ? String(p.dropLast()) : p))
            }
        }
        return lines.joined(separator: "\n")
    }

    /// 幫 AI 呼叫加上時間上限：模型被其他程式搶資源時可能一直不回，不能讓顧客無限等待
    static func withTimeout<T>(_ seconds: Double, _ operation: @escaping () async throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            let once = OnceFlag()
            let work = Task {
                do {
                    let value = try await operation()
                    if once.claim() { continuation.resume(returning: value) }
                } catch {
                    if once.claim() { continuation.resume(throwing: error) }
                }
            }
            Task {
                try? await Task.sleep(for: .seconds(seconds))
                if once.claim() {
                    work.cancel()
                    continuation.resume(throwing: AITimeoutError(seconds: seconds))
                }
            }
        }
    }

    /// 回覆本身就在說「沒有資料」→ 視為答不出來，交給待補清單
    static func saysNoInfo(_ reply: String) -> Bool {
        // 有條列內容、或回覆夠長，代表有提供資訊，只是附帶說明某部分沒有資料
        if reply.contains("\n・") || reply.count > 80 { return false }
        let phrases = ["沒有這項資訊", "目前沒有資料", "沒有相關資料", "沒有相關資訊", "沒有資料提到", "資料中沒有", "沒有明確的資訊", "無法回答", "不清楚"]
        return phrases.contains { reply.contains($0) }
    }

    /// 從顧客訊息抽出預約欄位
    static func extractSlots(from text: String, today: String) async -> AISlots? {
        let cfg = config
        if cfg.usingOllama {
            let schema: [String: Any] = [
                "type": "object",
                "properties": ["date": ["type": "string"], "time": ["type": "string"], "people": ["type": "string"],
                               "name": ["type": "string"], "phone": ["type": "string"]] as [String: Any],
                "required": ["date", "time", "people", "name", "phone"],
            ]
            if let j = try? await withTimeout(cfg.ollamaTimeout, {
                try await cfg.client.chatJSON(
                    system: "你負責從顧客的訊息中抽出訂位資訊。今天是 \(today)。只抽訊息中明確提到的內容，沒提到的欄位填空字串。date 照顧客說法（例如 10/12、明天），time 例如 19:00，people 只填數字。",
                    user: text, schema: schema, temperature: 0, maxTokens: 120)
            }) {
                func str(_ k: String) -> String? {
                    let v = (j[k] as? String ?? "").trimmingCharacters(in: .whitespaces)
                    return v.isEmpty ? nil : v
                }
                return AISlots(date: str("date"), time: str("time"), people: str("people").flatMap { Int($0.filter(\.isNumber)) },
                               name: str("name"), phone: str("phone"))
            }
        }
        #if canImport(FoundationModels)
        guard status().isAvailable else { return nil }
        let session = LanguageModelSession(instructions: "你負責從顧客的訊息中抽出訂位資訊。今天是 \(today)。只抽訊息中明確提到的內容，沒提到的欄位留空。")
        do {
            let r = try await session.respond(to: text, generating: ReservationSlots.self, options: GenerationOptions(temperature: 0))
            let s = r.content
            return AISlots(date: s.date, time: s.time, people: s.people, name: s.name, phone: s.phone)
        } catch {
            return nil
        }
        #else
        return nil
        #endif
    }

    /// 單純聊天測試（系統頁的 AI 試用）
    static func freeform(_ prompt: String) async throws -> String {
        let cfg = config
        if cfg.usingOllama { return try await cfg.client.chat(prompt) }
        #if canImport(FoundationModels)
        let session = LanguageModelSession()
        return try await session.respond(to: prompt).content
        #else
        throw NSError(domain: "MacLineBot", code: 10, userInfo: [NSLocalizedDescriptionKey: "Apple Intelligence 不可用"])
        #endif
    }
}
