import Foundation

// MARK: - 帳號

/// 一個 LINE 官方帳號（分店）。Channel secret / access token 另存在 Keychain。
struct BotAccount: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    /// Webhook 路徑：/webhook/<slug>
    var slug: String
    var displayName: String
    var basicId: String = ""
    var botUserId: String = ""
    var pictureURL: String?
    /// 已綁定、會收到通知的店家 LINE userId
    var ownerUserIds: [String] = []
    /// 店家在 LINE 傳「綁定 xxxxxx」完成綁定
    var bindCode: String = BotAccount.makeBindCode()
    var isEnabled: Bool = true
    var createdAt: Date = Date()

    // 不寫進 JSON，由 Keychain 載入
    var channelSecret: String = ""
    var channelAccessToken: String = ""

    enum CodingKeys: String, CodingKey {
        case id, slug, displayName, basicId, botUserId, pictureURL, ownerUserIds, bindCode, isEnabled, createdAt
    }

    var hasCredentials: Bool { !channelSecret.isEmpty && !channelAccessToken.isEmpty }
    var initial: String { String(displayName.first ?? "A").uppercased() }

    static func makeBindCode() -> String {
        String(format: "%06d", Int.random(in: 0...999_999))
    }
}

// MARK: - 店家資訊

struct StoreInfo: Codable, Hashable {
    var name: String = ""
    var intro: String = ""
    var address: String = ""
    var phone: String = ""
    var businessHours: String = ""
    var website: String = ""
    var payment: String = ""
    var parking: String = ""
    var extraNotes: String = ""

    var asKnowledge: String {
        var lines: [String] = []
        func add(_ label: String, _ value: String) {
            let v = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !v.isEmpty { lines.append("\(label)：\(v)") }
        }
        add("店名", name)
        add("簡介", intro)
        add("地址", address)
        add("電話", phone)
        add("營業時間", businessHours)
        add("網站", website)
        add("付款方式", payment)
        add("停車", parking)
        add("其他", extraNotes)
        return lines.joined(separator: "\n")
    }
}

// MARK: - 知識庫

struct FAQItem: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    var question: String
    var answer: String
    /// 額外觸發關鍵字（逗號分隔輸入）
    var keywords: [String] = []
    var isEnabled: Bool = true
    var hitCount: Int = 0
    var updatedAt: Date = Date()
}

struct KnowledgeDoc: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    var title: String
    var content: String
    var updatedAt: Date = Date()
}

struct PendingQuestion: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    var question: String
    var askedBy: String = ""
    var count: Int = 1
    var firstAskedAt: Date = Date()
    var lastAskedAt: Date = Date()
}

// MARK: - 回覆規則

enum ReplyTone: String, Codable, CaseIterable, Identifiable {
    case friendly, professional, lively
    var id: String { rawValue }
    var label: String {
        switch self {
        case .friendly: "親切溫暖"
        case .professional: "專業簡潔"
        case .lively: "活潑可愛"
        }
    }
    var instruction: String {
        switch self {
        case .friendly: "語氣親切、溫暖、有禮貌。"
        case .professional: "語氣專業、簡潔、直接。"
        case .lively: "語氣活潑、熱情，可以適度使用表情符號。"
        }
    }
}

struct ReplyRules: Codable, Hashable {
    var tone: ReplyTone = .friendly
    var useEmoji: Bool = true
    var maxReplyLength: Int = 150

    // 轉人工
    var handoffKeywords: [String] = ["真人", "專人", "客服人員", "找老闆", "人工"]
    var blockedKeywords: [String] = ["退款", "客訴", "投訴", "律師", "報警"]
    var handoffMessage: String = "已為您通知專人，稍後會由專人為您回覆，請稍候。"
    /// 真人接手後，多久沒有店家回覆就交還 AI（分鐘）
    var humanModeMinutes: Int = 30

    // 回答不出來
    var fallbackMessage: String = "這個問題我目前沒有資料，已經幫您轉告店家，會盡快回覆您 🙏"
    var greetingMessage: String = "您好，歡迎加入！有任何問題都可以直接問我喔 😊"

    // 預約
    var reservationEnabled: Bool = true
    var reservationKeywords: [String] = ["預約", "訂位", "預定", "訂桌", "booking"]
    var maxPartySize: Int = 20
    var askName: Bool = true
    var askPhone: Bool = false

    // 通知
    var dailySummaryEnabled: Bool = true
    var dailySummaryHour: Int = 21
    var dailySummaryMinute: Int = 0
    var pendingReminderEnabled: Bool = true
    var pendingReminderMinutes: Int = 10
    var disconnectNotifyEnabled: Bool = true
    var notifyUnanswered: Bool = true
}

// MARK: - 對話

enum ChatRole: String, Codable {
    case customer, bot, owner, system
}

enum ReplySource: String, Codable {
    case faq, ai, handoff, fallback, reservation, owner, greeting, blocked, system

    var label: String {
        switch self {
        case .faq: "FAQ"
        case .ai: "AI"
        case .handoff: "轉人工"
        case .fallback: "待補"
        case .reservation: "預約"
        case .owner: "店家"
        case .greeting: "歡迎"
        case .blocked: "敏感"
        case .system: "系統"
        }
    }
}

struct ChatMessage: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    var role: ChatRole
    var text: String
    var date: Date = Date()
    var source: ReplySource?
    var latency: Double?
}

enum ConversationMode: String, Codable {
    case ai, human
}

struct Conversation: Identifiable, Codable, Hashable {
    /// LINE userId
    var id: String
    var displayName: String = "LINE 使用者"
    var pictureURL: String?
    var messages: [ChatMessage] = []
    var mode: ConversationMode = .ai
    var humanSince: Date?
    var lastOwnerReplyAt: Date?
    var reminderSent: Bool = false
    var unread: Int = 0
    /// 店家在 LINE 用 #代碼 回覆
    var handoffCode: String = Conversation.makeCode()
    var reservationDraft: ReservationDraft?

    var lastMessage: ChatMessage? { messages.last }
    var lastCustomerMessageAt: Date? { messages.last(where: { $0.role == .customer })?.date }

    static func makeCode() -> String {
        let chars = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        return String((0..<4).map { _ in chars.randomElement()! })
    }

    mutating func append(_ message: ChatMessage, limit: Int = 500) {
        messages.append(message)
        if messages.count > limit { messages.removeFirst(messages.count - limit) }
    }
}

// MARK: - 預約

struct ReservationDraft: Codable, Hashable {
    var date: String?
    var time: String?
    var people: Int?
    var name: String?
    var phone: String?
    var note: String?
    var awaitingConfirm: Bool = false
    var startedAt: Date = Date()
}

enum ReservationStatus: String, Codable, CaseIterable, Identifiable {
    case pending, accepted, declined, cancelled
    var id: String { rawValue }
    var label: String {
        switch self {
        case .pending: "待確認"
        case .accepted: "已接受"
        case .declined: "已婉拒"
        case .cancelled: "已取消"
        }
    }
}

struct Reservation: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    var code: String = Conversation.makeCode()
    var userId: String
    var customerName: String
    var date: String
    var time: String
    var people: Int
    var contactName: String = ""
    var phone: String = ""
    var note: String = ""
    var status: ReservationStatus = .pending
    var createdAt: Date = Date()
    var decidedAt: Date?

    var summary: String {
        var s = "📅 \(date) \(time)\n👥 \(people) 位"
        if !contactName.isEmpty { s += "\n🙋 \(contactName)" }
        if !phone.isEmpty { s += "\n📞 \(phone)" }
        if !note.isEmpty { s += "\n📝 \(note)" }
        return s
    }
}

// MARK: - 數據

struct DailyStats: Codable, Hashable {
    var dateKey: String
    var received = 0
    var replied = 0
    var faq = 0
    var ai = 0
    var handoff = 0
    var urlChanges = 0
    var reservations = 0
    var unanswered = 0
    var aiMilliseconds: Double = 0

    var avgAILatency: Double { ai == 0 ? 0 : aiMilliseconds / Double(ai) / 1000 }

    static func key(for date: Date = Date()) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}

// MARK: - 每個帳號的所有資料

struct AccountData: Codable {
    var store = StoreInfo()
    var faqs: [FAQItem] = []
    var docs: [KnowledgeDoc] = []
    var pending: [PendingQuestion] = []
    var rules = ReplyRules()
    var conversations: [String: Conversation] = [:]
    var reservations: [Reservation] = []
    var stats: [String: DailyStats] = [:]
    var lastSummarySent: String?

    var today: DailyStats {
        get { stats[DailyStats.key()] ?? DailyStats(dateKey: DailyStats.key()) }
        set { stats[DailyStats.key()] = newValue }
    }

    static var sample: AccountData {
        var d = AccountData()
        d.store = StoreInfo(
            name: "我的小店",
            intro: "歡迎光臨！",
            businessHours: "週二至週五：上午 9:00 至晚上 8:00\n週六、週日：上午 8:30 至晚上 9:00\n每週一公休"
        )
        d.faqs = [
            FAQItem(question: "營業時間", answer: "・週二至週五：上午 9:00 至晚上 8:00\n・週六、週日：上午 8:30 至晚上 9:00\n每週一公休", keywords: ["幾點", "開門", "營業", "公休"]),
            FAQItem(question: "可以刷卡嗎", answer: "可以喔！我們接受信用卡、LINE Pay 與現金。", keywords: ["刷卡", "付款", "Line Pay"]),
        ]
        return d
    }
}

// MARK: - 全域設定

enum TunnelMode: String, Codable, CaseIterable, Identifiable {
    case quick, named
    var id: String { rawValue }
    var label: String {
        switch self {
        case .quick: "Quick Tunnel（免設定，網址會變）"
        case .named: "自訂網域（固定網址）"
        }
    }
}

struct AppSettings: Codable {
    var port: UInt16 = 8787
    var aiAutoReply: Bool = true
    var tunnelMode: TunnelMode = .quick
    /// 自訂網域，例如 bot.mydomain.com（named tunnel 用）
    var namedHostname: String = ""
    var cloudflaredPath: String = ""
    var selectedAccountId: UUID?
    var onboardingCompleted: Bool = false
    var autoStart: Bool = true
}

// MARK: - 日誌

enum LogLevel: String, Codable {
    case info, warning, error
}

struct LogEntry: Identifiable, Hashable {
    var id = UUID()
    var date = Date()
    var level: LogLevel
    var message: String
}
