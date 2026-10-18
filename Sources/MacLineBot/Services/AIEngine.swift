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
        """
    }

    /// 依知識庫回答
    static func answer(question: String, knowledge: String, history: [ChatMessage], store: StoreInfo, rules: ReplyRules) async throws -> AIAnswer {
        #if canImport(FoundationModels)
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

    /// 回覆本身就在說「沒有資料」→ 視為答不出來，交給待補清單
    static func saysNoInfo(_ reply: String) -> Bool {
        // 有條列內容、或回覆夠長，代表有提供資訊，只是附帶說明某部分沒有資料
        if reply.contains("\n・") || reply.count > 80 { return false }
        let phrases = ["沒有這項資訊", "目前沒有資料", "沒有相關資料", "沒有相關資訊", "沒有資料提到", "資料中沒有", "沒有明確的資訊", "無法回答", "不清楚"]
        return phrases.contains { reply.contains($0) }
    }

    /// 從顧客訊息抽出預約欄位
    static func extractSlots(from text: String, today: String) async -> AISlots? {
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
        #if canImport(FoundationModels)
        let session = LanguageModelSession()
        return try await session.respond(to: prompt).content
        #else
        throw NSError(domain: "MacLineBot", code: 10, userInfo: [NSLocalizedDescriptionKey: "Apple Intelligence 不可用"])
        #endif
    }
}
