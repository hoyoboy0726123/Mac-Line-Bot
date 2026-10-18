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

    /// 錯誤訊息加上是哪一步失敗
    private static func step<T>(_ name: String, _ work: () async throws -> T) async throws -> T {
        do { return try await work() } catch let e as LineAPIError { throw LineAPIError(status: e.status, message: "\(name)：\(e.message)") }
    }

    static func status(_ api: LineAPI) async throws -> [Menu] {
        let list = try await step("讀取選單清單") { try await api.richMenuList() }
        let def = try await step("讀取預設選單") { try await api.defaultRichMenu() }
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

    /// 已經完全換好：只剩一個選單，是我們的、而且是預設
    static func isDone(_ menus: [Menu]) -> Bool { menus.count == 1 && menus[0].ours && menus[0].isDefault }

    /// 套用我們的選單並刪掉其他選單，回傳被取代的選單名稱
    /// - userIds：已知的顧客與店家，解除舊專案綁在他們身上的個別選單
    static func apply(_ api: LineAPI, userIds: [String] = []) async throws -> [String] {
        // 上次已經設好預設選單（只是舊選單還沒刪完）就沿用，不重複建立
        let current = try await status(api)
        var id = current.first(where: { $0.ours && $0.isDefault })?.id ?? ""
        if id.isEmpty {
            let newId = try await step("建立選單") { try await api.createRichMenu(definition) }
            do {
                try await step("上傳圖片") { try await api.uploadRichMenuImage(newId, png: RichMenuImage.png) }
                try await step("設為預設") { try await api.setDefaultRichMenu(newId) }
            } catch {
                try? await api.deleteRichMenu(newId)
                throw error
            }
            id = newId
        }
        if !userIds.isEmpty {
            try await step("解除個別選單") { try await api.unlinkRichMenus(userIds: userIds) }
        }
        var deleted: [String] = []
        for m in try await step("讀取選單清單") { try await api.richMenuList() } {
            guard let other = m["richMenuId"] as? String, other != id else { continue }
            try await step("刪除舊選單") { try await api.deleteRichMenu(other) }
            deleted.append((m["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? other)
        }
        return deleted
    }
}

extension AppState {
    /// 這個帳號認識的所有 LINE 使用者（顧客 + 綁定的店家）
    func knownUserIds(_ id: UUID) -> [String] {
        Array(Set((data[id]?.conversations.keys).map(Array.init) ?? []).union(account(id)?.ownerUserIds ?? []))
    }

    /// 啟動時：LINE 上的預設選單不是我們的，就自動套用並取代舊選單
    func ensureRichMenus() async {
        for a in accounts where a.hasCredentials && a.isEnabled {
            let api = LineAPI(token: a.channelAccessToken)
            // LINE 的選單 API 有頻率限制（429），等一下再試，最多 4 次
            let waits = [30, 120, 300, 600, 1200]
            for attempt in 1...(waits.count + 1) {
                do {
                    let menus = try await RichMenu.status(api)
                    if RichMenu.isDone(menus) { break }
                    let deleted = try await RichMenu.apply(api, userIds: knownUserIds(a.id))
                    accountLog(a.id, "已自動套用圖文選單" + (deleted.isEmpty ? "" : "，取代舊選單：" + deleted.joined(separator: "、")))
                    break
                } catch let e as LineAPIError where e.status == 429 && attempt <= waits.count {
                    accountLog(a.id, "LINE 選單 API 忙碌中（\(e.message)），\(waits[attempt - 1]) 秒後重試")
                    try? await Task.sleep(for: .seconds(waits[attempt - 1]))
                } catch {
                    accountLog(a.id, .warning, "自動套用圖文選單失敗：\(error.localizedDescription)（可到 LINE 連線頁手動套用）")
                    break
                }
            }
        }
    }

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
