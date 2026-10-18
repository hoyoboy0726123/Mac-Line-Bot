import Foundation

/// 圖文選單（LINE 聊天室下方的選單）：建立我們的選單 → 設成預設 → 刪掉舊選單
/// 按鈕與圖片跟 Windows 版相同（圖片由 windows/scripts/make-richmenu.js 產生）
enum RichMenu {
    static let name = "mac-line-bot"

    struct Button {
        var label: String
        var text: String
    }

    static let buttons: [Button] = [
        Button(label: "型號清單", text: "有哪些型號通過軍規"),
        Button(label: "測試項目", text: "軍規測試有哪些項目"),
        Button(label: "比較型號", text: "比較型號"),
        Button(label: "找專人", text: "我要找真人"),
    ]

    static var definition: [String: Any] {
        let width = 2500, height = 843
        let w = width / buttons.count
        let areas: [[String: Any]] = buttons.enumerated().map { i, b in
            [
                "bounds": ["x": i * w, "y": 0, "width": i == buttons.count - 1 ? width - i * w : w, "height": height],
                "action": ["type": "message", "label": b.label, "text": b.text],
            ]
        }
        return ["size": ["width": width, "height": height], "selected": true, "name": name, "chatBarText": "功能選單", "areas": areas]
    }

    struct Menu: Identifiable {
        var id: String
        var name: String
        var buttons: [String]
        var ours: Bool
        var isDefault: Bool
    }

    static func status(_ api: LineAPI) async throws -> [Menu] {
        let list = try await api.richMenuList()
        let def = try await api.defaultRichMenu()
        return list.map { m in
            let id = m["richMenuId"] as? String ?? ""
            let name = m["name"] as? String ?? ""
            let labels = ((m["areas"] as? [[String: Any]]) ?? []).map { a -> String in
                let action = a["action"] as? [String: Any] ?? [:]
                return (action["label"] as? String) ?? (action["text"] as? String) ?? "?"
            }
            return Menu(id: id, name: name, buttons: labels, ours: name == RichMenu.name, isDefault: id == def)
        }
    }

    /// 套用我們的選單並刪掉其他選單，回傳被取代的選單名稱
    static func apply(_ api: LineAPI) async throws -> [String] {
        let id = try await api.createRichMenu(definition)
        do {
            try await api.uploadRichMenuImage(id, png: RichMenuImage.png)
            try await api.setDefaultRichMenu(id)
        } catch {
            try? await api.deleteRichMenu(id)
            throw error
        }
        var deleted: [String] = []
        for m in try await api.richMenuList() {
            guard let other = m["richMenuId"] as? String, other != id else { continue }
            try await api.deleteRichMenu(other)
            deleted.append((m["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? other)
        }
        return deleted
    }
}

extension AppState {
    /// 請 LINE 檢查所有卡片格式（不會送出）；有問題的卡片在日誌列出，回覆時會自動改用文字
    func validateFlex(_ id: UUID) async {
        guard let a = account(id), a.hasCredentials else { return }
        let api = LineAPI(token: a.channelAccessToken)
        let faqs = (data[id]?.faqs ?? []).filter { $0.flex != nil }
        let message: (FAQItem) -> LineAPI.Message? = { LineMessage.flex($0.answer, json: $0.flex ?? "", quickReplies: $0.quickReplies ?? []) }
        var bad = 0
        for start in stride(from: 0, to: faqs.count, by: 5) {
            let batch = Array(faqs[start..<min(start + 5, faqs.count)])
            guard await api.validate(batch.compactMap(message)) != nil else { continue }
            for f in batch {
                if let m = message(f), let e = await api.validate([m]) {
                    bad += 1
                    accountLog(id, .warning, "卡片格式有誤（\(f.question)）：\(e)")
                }
            }
        }
        accountLog(id, bad > 0 ? .warning : .info, bad > 0 ? "LINE 卡片檢查：\(bad) 張有問題，會改用文字回覆" : "LINE 卡片檢查通過（\(faqs.count) 張）")
    }
}
