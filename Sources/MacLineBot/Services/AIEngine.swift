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
    @Guide(description: "顧客這則訊息的意圖。想訂位/預約是 reservation；要求找真人、專人、老闆是 humanAgent；打招呼是 greeting；道謝是 thanks；抱怨是 complaint；詢問店家資訊是 question")
    var intent: CustomerIntent

    @Guide(description: "「店家資料」裡是否有明確的資訊可以回答這個問題。資料沒有寫到的一律是 false，不可以自己推測")
    var answerable: Bool

    @Guide(description: "要回覆給顧客的訊息，使用繁體中文，簡短自然。answerable 為 false 時，誠實說目前沒有這項資訊")
    var reply: String
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
        1. 只能根據「店家資料」回答，資料沒有寫到的就誠實說目前沒有這項資訊，絕對不可以編造價格、時間、地址、活動或承諾。
        2. 一律使用繁體中文，回覆在 \(rules.maxReplyLength) 字以內。
        3. 不要提到你是 AI 模型、不要提到「店家資料」這幾個字。
        4. 不處理退款、法律、醫療等需要店家判斷的事情。
        """
    }

    /// 依知識庫回答
    static func answer(question: String, knowledge: String, history: [ChatMessage], store: StoreInfo, rules: ReplyRules) async throws -> AIAnswer {
        #if canImport(FoundationModels)
        let session = LanguageModelSession(instructions: instructions(store: store, rules: rules))
        var prompt = "店家資料：\n\(knowledge.isEmpty ? "（沒有資料）" : knowledge)\n\n"
        let recent = history.suffix(6).filter { $0.role == .customer || $0.role == .bot || $0.role == .owner }
        if !recent.isEmpty {
            prompt += "最近對話：\n"
            for m in recent {
                prompt += (m.role == .customer ? "顧客：" : "客服：") + String(m.text.prefix(200)) + "\n"
            }
            prompt += "\n"
        }
        prompt += "顧客最新訊息：\(question)"
        let response = try await session.respond(
            to: prompt,
            generating: KnowledgeAnswer.self,
            options: GenerationOptions(temperature: 0.2)
        )
        let r = response.content
        let intent: CustomerIntentKind = switch r.intent {
        case .question: .question
        case .reservation: .reservation
        case .humanAgent: .humanAgent
        case .greeting: .greeting
        case .thanks: .thanks
        case .complaint: .complaint
        case .other: .other
        }
        return AIAnswer(intent: intent, answerable: r.answerable, reply: r.reply.trimmingCharacters(in: .whitespacesAndNewlines))
        #else
        throw NSError(domain: "MacLineBot", code: 10, userInfo: [NSLocalizedDescriptionKey: "Apple Intelligence 不可用"])
        #endif
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
