import Foundation

/// 一則要回給顧客的訊息
struct BotReply {
    var text: String
    var source: ReplySource
    var quickReplies: [String] = []
    var latency: Double?

    var lineMessage: LineAPI.Message { LineMessage.text(text, quickReplies: quickReplies) }
}

// MARK: - Webhook 入口

extension AppState {
    func handleHTTP(_ req: HTTPRequest) async -> HTTPResponse {
        if req.method == "GET", req.path == "/" || req.path == "/health" {
            return .text("ok maclinebot")
        }
        guard req.path.hasPrefix("/webhook/") else { return .text("Not Found", status: 404) }
        guard req.method == "POST" else { return .text("Method Not Allowed", status: 405) }

        let slug = String(req.path.dropFirst("/webhook/".count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let account = accounts.first(where: { $0.slug == slug }) else {
            log(.warning, "收到未知 webhook 路徑：\(req.path)")
            return .text("Not Found", status: 404)
        }
        guard LineAPI.verify(signature: req.headers["x-line-signature"], body: req.body, secret: account.channelSecret) else {
            accountLog(account.id, .warning, "webhook 簽章驗證失敗，已拒絕")
            return .text("Unauthorized", status: 401)
        }
        guard let body = try? JSONDecoder().decode(WebhookBody.self, from: req.body) else {
            return .text("Bad Request", status: 400)
        }
        lastEventAt = Date()
        if body.events.isEmpty {
            accountLog(account.id, "webhook 測試通過")
            var s = webhookStatus[account.id] ?? WebhookStatus()
            s.synced = true
            s.reachable = true
            s.lastCheck = Date()
            s.message = "外部可連線"
            webhookStatus[account.id] = s
        }
        // 先回 200 給 LINE，再慢慢處理
        for event in body.events {
            let id = account.id
            Task { @MainActor in await self.process(event, accountId: id) }
        }
        return .text("OK")
    }

    // MARK: - 事件分派

    func process(_ event: WebhookEvent, accountId: UUID) async {
        guard let account = account(accountId), account.isEnabled else { return }
        if event.deliveryContext?.isRedelivery == true {
            accountLog(accountId, "收到重送事件，略過")
            return
        }
        guard event.source?.type == "user", let userId = event.userId else {
            if event.type == "message" { accountLog(accountId, "略過群組訊息") }
            return
        }
        switch event.type {
        case "message":
            await handleMessage(event, userId: userId, account: account)
        case "postback":
            await handlePostback(event, userId: userId, account: account)
        case "follow":
            await ensureConversation(accountId, userId: userId, api: LineAPI(token: account.channelAccessToken))
            let rules = data[accountId]?.rules ?? ReplyRules()
            if let token = event.replyToken, !rules.greetingMessage.isEmpty {
                try? await LineAPI(token: account.channelAccessToken).reply(token, [LineMessage.text(rules.greetingMessage)])
                appendMessage(accountId, userId, ChatMessage(role: .bot, text: rules.greetingMessage, source: .greeting))
            }
            accountLog(accountId, "新好友加入")
        case "unfollow":
            accountLog(accountId, "有好友封鎖了帳號")
        default:
            break
        }
    }

    private func ensureConversation(_ id: UUID, userId: String, api: LineAPI) async {
        if data[id]?.conversations[userId] != nil { return }
        update(id) { $0.conversations[userId] = Conversation(id: userId) }
        let profile = try? await api.profile(userId: userId)
        if let profile {
            update(id) {
                $0.conversations[userId]?.displayName = profile.displayName
                $0.conversations[userId]?.pictureURL = profile.pictureUrl
            }
        }
    }

    func appendMessage(_ id: UUID, _ userId: String, _ message: ChatMessage) {
        update(id) { d in
            if d.conversations[userId] == nil { d.conversations[userId] = Conversation(id: userId) }
            d.conversations[userId]?.append(message)
        }
    }

    func conversation(_ id: UUID, _ userId: String) -> Conversation? {
        data[id]?.conversations[userId]
    }

    // MARK: - 訊息

    private func handleMessage(_ event: WebhookEvent, userId: String, account: BotAccount) async {
        let id = account.id
        let api = LineAPI(token: account.channelAccessToken)
        guard let message = event.message else { return }
        let text: String = switch message.type {
        case "text": message.text ?? ""
        case "sticker": "[貼圖]"
        case "image": "[圖片]"
        case "video": "[影片]"
        case "audio": "[語音]"
        case "location": "[位置]"
        case "file": "[檔案]"
        default: "[\(message.type)]"
        }

        // 綁定店家 LINE：傳「綁定 123456」
        if message.type == "text", let reply = tryBind(text, userId: userId, account: account) {
            if let token = event.replyToken { try? await api.reply(token, [LineMessage.text(reply)]) }
            return
        }
        // 店家的指令（#代碼 回覆、交還、摘要…）
        if message.type == "text", account.ownerUserIds.contains(userId),
           let reply = await handleOwnerCommand(text, account: account) {
            if let token = event.replyToken { try? await api.reply(token, [LineMessage.text(reply)]) }
            return
        }

        await ensureConversation(id, userId: userId, api: api)
        let name = conversation(id, userId)?.displayName ?? "顧客"
        appendMessage(id, userId, ChatMessage(role: .customer, text: text))
        update(id) { d in
            d.today.received += 1
            d.conversations[userId]?.unread += 1
            d.conversations[userId]?.reminderSent = false
        }
        accountLog(id, "收到 \(name)：\(text.prefix(40))")

        guard message.type == "text" else {
            if message.type != "sticker", conversation(id, userId)?.mode == .ai, settings.aiAutoReply,
               let token = event.replyToken {
                let r = "收到囉！目前我只看得懂文字訊息，可以用文字描述您的問題，或輸入「真人」請專人協助 🙏"
                try? await api.reply(token, [LineMessage.text(r)])
                appendMessage(id, userId, ChatMessage(role: .bot, text: r, source: .system))
            }
            return
        }

        let started = Date()
        guard var reply = await decide(text: text, userId: userId, account: account, api: api) else { return }
        reply.latency = Date().timeIntervalSince(started)
        guard let token = event.replyToken else { return }
        do {
            try await api.reply(token, [reply.lineMessage])
            appendMessage(id, userId, ChatMessage(role: .bot, text: reply.text, source: reply.source, latency: reply.latency))
            update(id) { $0.today.replied += 1 }
            accountLog(id, String(format: "%@ reply %.1fs 來源=%@", name, reply.latency ?? 0, reply.source.rawValue))
        } catch {
            // replyToken 過期就改用 push
            if (try? await api.push(to: userId, [reply.lineMessage])) != nil {
                appendMessage(id, userId, ChatMessage(role: .bot, text: reply.text, source: reply.source, latency: reply.latency))
                update(id) { $0.today.replied += 1 }
                accountLog(id, .warning, "reply 失敗，改用 push 送出")
            } else {
                accountLog(id, .error, "回覆失敗：\(error.localizedDescription)")
            }
        }
    }

    /// 決定要怎麼回：轉人工 → 預約 → FAQ → AI → 待補
    private func decide(text: String, userId: String, account: BotAccount, api: LineAPI) async -> BotReply? {
        let id = account.id
        guard settings.aiAutoReply else { return nil }
        guard let conv = conversation(id, userId), conv.mode == .ai else { return nil }
        let d = data[id] ?? AccountData()
        let rules = d.rules

        if let hit = KnowledgeRetriever.containsAny(text, rules.handoffKeywords) {
            return await startHandoff(id, userId: userId, reason: "命中轉人工關鍵字「\(hit)」", lastText: text, source: .handoff)
        }
        if let hit = KnowledgeRetriever.containsAny(text, rules.blockedKeywords) {
            return await startHandoff(id, userId: userId, reason: "敏感問題「\(hit)」", lastText: text, source: .blocked)
        }
        if rules.reservationEnabled {
            if conv.reservationDraft != nil {
                return await continueReservation(id, userId: userId, text: text)
            }
            if KnowledgeRetriever.containsAny(text, rules.reservationKeywords) != nil {
                return await beginReservation(id, userId: userId, text: text)
            }
        }
        if let faq = KnowledgeRetriever.matchFAQ(text, in: d.faqs) {
            update(id) { d in
                d.today.faq += 1
                if let i = d.faqs.firstIndex(where: { $0.id == faq.id }) { d.faqs[i].hitCount += 1 }
            }
            return BotReply(text: faq.answer, source: .faq)
        }

        guard aiStatus.isAvailable else {
            return unanswered(id, userId: userId, question: text)
        }
        Task { await api.startLoading(chatId: userId, seconds: 20) }
        let started = Date()
        do {
            let knowledge = KnowledgeRetriever.context(for: text, data: d)
            let history = Array(conv.messages.dropLast())
            let answer = try await AIEngine.answer(question: text, knowledge: knowledge, history: history, store: d.store, rules: rules)
            let ms = Date().timeIntervalSince(started) * 1000
            switch answer.intent {
            case .humanAgent:
                return await startHandoff(id, userId: userId, reason: "AI 判斷顧客要找專人", lastText: text, source: .handoff)
            case .complaint:
                return await startHandoff(id, userId: userId, reason: "AI 判斷為客訴，交給你處理", lastText: text, source: .blocked)
            case .reservation where rules.reservationEnabled:
                return await beginReservation(id, userId: userId, text: text)
            default:
                if !answer.answerable, answer.intent == .question || answer.intent == .other {
                    return unanswered(id, userId: userId, question: text)
                }
                guard !answer.reply.isEmpty else { return unanswered(id, userId: userId, question: text) }
                update(id) {
                    $0.today.ai += 1
                    $0.today.aiMilliseconds += ms
                }
                return BotReply(text: answer.reply, source: .ai)
            }
        } catch {
            accountLog(id, .warning, "AI 生成失敗：\(error.localizedDescription)")
            return unanswered(id, userId: userId, question: text)
        }
    }

    // MARK: - 答不出來 → 待補清單

    private func unanswered(_ id: UUID, userId: String, question: String) -> BotReply {
        let rules = data[id]?.rules ?? ReplyRules()
        let name = conversation(id, userId)?.displayName ?? ""
        let key = KnowledgeRetriever.core(question)
        var isNew = false
        update(id) { d in
            d.today.unanswered += 1
            if let i = d.pending.firstIndex(where: { KnowledgeRetriever.core($0.question) == key }) {
                d.pending[i].count += 1
                d.pending[i].lastAskedAt = Date()
            } else {
                d.pending.insert(PendingQuestion(question: question, askedBy: name), at: 0)
                isNew = true
            }
        }
        accountLog(id, "知識庫沒有答案，已加入待補清單：\(question.prefix(30))")
        if rules.notifyUnanswered, isNew {
            let code = conversation(id, userId)?.handoffCode ?? ""
            Task {
                await notifyOwners(id, [LineMessage.text("❓ \(name) 問了知識庫沒有的問題：\n「\(question.prefix(200))」\n\n已加入待補清單。要直接回覆請傳：\n#\(code) 你的回覆")])
            }
        }
        return BotReply(text: rules.fallbackMessage, source: .fallback)
    }

    // MARK: - 轉人工

    private func startHandoff(_ id: UUID, userId: String, reason: String, lastText: String, source: ReplySource) async -> BotReply {
        let rules = data[id]?.rules ?? ReplyRules()
        update(id) { d in
            d.today.handoff += 1
            d.conversations[userId]?.mode = .human
            d.conversations[userId]?.humanSince = Date()
            d.conversations[userId]?.lastOwnerReplyAt = nil
            d.conversations[userId]?.reservationDraft = nil
            d.conversations[userId]?.reminderSent = false
        }
        appendMessage(id, userId, ChatMessage(role: .system, text: "已轉真人：\(reason)", source: .system))
        let conv = conversation(id, userId)
        let name = conv?.displayName ?? "顧客"
        let code = conv?.handoffCode ?? ""
        accountLog(id, "handoff：\(reason)")
        await notifyOwners(id, [
            LineMessage.text("🙋 \(name) 需要專人協助\n原因：\(reason)\n最新訊息：「\(lastText.prefix(200))」\n\n直接傳「#\(code) 你的回覆」就會轉給顧客，你回覆後 AI 會自動閃開。"),
            LineMessage.buttons(
                text: "處理完畢後可以把 \(name) 交還給 AI",
                actions: [("交還 AI", "action=resume&uid=\(userId)")],
                altText: "\(name) 需要專人協助"
            ),
        ])
        return BotReply(text: rules.handoffMessage, source: source)
    }

    func resumeAI(_ id: UUID, userId: String, reason: String) {
        guard conversation(id, userId)?.mode == .human else { return }
        update(id) { d in
            d.conversations[userId]?.mode = .ai
            d.conversations[userId]?.humanSince = nil
            d.conversations[userId]?.reminderSent = false
        }
        appendMessage(id, userId, ChatMessage(role: .system, text: "AI 已接手：\(reason)", source: .system))
        accountLog(id, "\(conversation(id, userId)?.displayName ?? "") 交還 AI（\(reason)）")
    }

    /// 店家從 App 或 LINE 回覆顧客
    @discardableResult
    func sendOwnerMessage(_ id: UUID, userId: String, text: String) async -> Bool {
        guard let a = account(id), a.hasCredentials else { return false }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        do {
            try await LineAPI(token: a.channelAccessToken).push(to: userId, [LineMessage.text(trimmed)])
        } catch {
            accountLog(id, .error, "傳送失敗：\(error.localizedDescription)")
            return false
        }
        update(id) { d in
            d.conversations[userId]?.mode = .human
            if d.conversations[userId]?.humanSince == nil { d.conversations[userId]?.humanSince = Date() }
            d.conversations[userId]?.lastOwnerReplyAt = Date()
            d.conversations[userId]?.unread = 0
            d.conversations[userId]?.reminderSent = false
        }
        appendMessage(id, userId, ChatMessage(role: .owner, text: trimmed, source: .owner))
        return true
    }

    // MARK: - 綁定 / 店家指令

    private func tryBind(_ text: String, userId: String, account: BotAccount) -> String? {
        let t = text.trimmingCharacters(in: .whitespaces)
        guard t.hasPrefix("綁定") else { return nil }
        let code = t.dropFirst(2).trimmingCharacters(in: .whitespaces)
        guard code == account.bindCode else { return "綁定碼不正確，請到 Mac-Line-Bot App 的「LINE 連線」頁面查看最新綁定碼。" }
        updateAccount(account.id) { a in
            if !a.ownerUserIds.contains(userId) { a.ownerUserIds.append(userId) }
            a.bindCode = BotAccount.makeBindCode()
        }
        accountLog(account.id, "店家 LINE 綁定成功 ...\(userId.suffix(6))")
        return "✅ 綁定成功！之後轉人工、預約、每日摘要、斷線通知都會推播到這裡。\n\n傳「指令」可以看所有可用指令。"
    }

    private func handleOwnerCommand(_ raw: String, account: BotAccount) async -> String? {
        let id = account.id
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let d = data[id] ?? AccountData()

        // #ABCD 回覆內容
        if text.hasPrefix("#") || text.hasPrefix("＃") {
            let body = text.dropFirst()
            let code = String(body.prefix(4)).uppercased()
            let content = body.dropFirst(4).trimmingCharacters(in: .whitespacesAndNewlines)
            guard let conv = d.conversations.values.first(where: { $0.handoffCode == code }) else {
                return "找不到代碼 #\(code) 的顧客。"
            }
            guard !content.isEmpty else { return "請在代碼後面加上要回覆的內容，例如：#\(code) 您好，我是店長" }
            let ok = await sendOwnerMessage(id, userId: conv.id, text: content)
            return ok ? "已傳送給 \(conv.displayName) ✅\nAI 會先暫停，\(d.rules.humanModeMinutes) 分鐘沒有新回覆就自動交還 AI。" : "傳送失敗，請稍後再試。"
        }
        for prefix in ["交還", "恢復"] where text.hasPrefix(prefix) {
            let code = text.dropFirst(prefix.count).trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "").uppercased()
            guard let conv = d.conversations.values.first(where: { $0.handoffCode == code }) else { return "找不到代碼 \(code) 的顧客。" }
            resumeAI(id, userId: conv.id, reason: "店家交還")
            return "已把 \(conv.displayName) 交還給 AI 🤖"
        }
        switch text {
        case "摘要", "今日摘要":
            return dailySummary(id)
        case "待補", "待補清單":
            let list = d.pending.prefix(10).enumerated().map { "\($0.offset + 1). \($0.element.question)（\($0.element.count) 次）" }
            return list.isEmpty ? "目前沒有待補問題 🎉" : "📝 待補清單（到 App 的知識庫可一鍵補成 FAQ）\n" + list.joined(separator: "\n")
        case "預約", "待確認":
            let list = d.reservations.filter { $0.status == .pending }.prefix(10).map { "・\($0.customerName) \($0.date) \($0.time) \($0.people) 位" }
            return list.isEmpty ? "目前沒有待確認的預約。" : "📅 待確認預約\n" + list.joined(separator: "\n")
        case "待回覆":
            let list = d.conversations.values.filter { $0.mode == .human }.map { "・#\($0.handoffCode) \($0.displayName)" }
            return list.isEmpty ? "目前沒有等待真人回覆的顧客。" : "🙋 等待真人回覆\n" + list.joined(separator: "\n")
        case "指令", "說明", "help":
            return """
            🛠 Mac-Line-Bot 指令
            #代碼 內容 → 回覆顧客
            交還 代碼 → 交還給 AI
            待回覆 → 等待真人的顧客
            預約 → 待確認預約
            待補 → 待補問題
            摘要 → 今日數據
            """
        default:
            return nil
        }
    }

    // MARK: - Postback（預約接受 / 婉拒、交還 AI）

    private func handlePostback(_ event: WebhookEvent, userId: String, account: BotAccount) async {
        let id = account.id
        let api = LineAPI(token: account.channelAccessToken)
        guard let raw = event.postback?.data else { return }
        let p = parsePostback(raw)
        var reply: String?

        switch p["action"] {
        case "rsv":
            guard account.ownerUserIds.contains(userId) else { reply = "只有店家可以處理預約。"; break }
            guard let rid = p["id"].flatMap(UUID.init(uuidString:)) else { break }
            let accept = p["op"] == "accept"
            reply = await decideReservation(id, reservationId: rid, accept: accept)
        case "resume":
            guard account.ownerUserIds.contains(userId), let uid = p["uid"] else { break }
            resumeAI(id, userId: uid, reason: "店家交還")
            reply = "已交還給 AI 🤖"
        default:
            break
        }
        if let reply, let token = event.replyToken {
            try? await api.reply(token, [LineMessage.text(reply)])
        }
    }

    /// 接受或婉拒預約（LINE 按鈕與 App 共用），回傳給店家的文字
    @discardableResult
    func decideReservation(_ id: UUID, reservationId: UUID, accept: Bool) async -> String {
        guard let a = account(id), let r = data[id]?.reservations.first(where: { $0.id == reservationId }) else {
            return "找不到這筆預約。"
        }
        guard r.status == .pending else { return "這筆預約已經是「\(r.status.label)」了。" }
        let status: ReservationStatus = accept ? .accepted : .declined
        update(id) { d in
            if let i = d.reservations.firstIndex(where: { $0.id == reservationId }) {
                d.reservations[i].status = status
                d.reservations[i].decidedAt = Date()
            }
        }
        let storeName = data[id]?.store.name ?? ""
        let text = accept
            ? "✅ 您的預約已確認！\n\(r.summary)\n\n期待您的光臨！\(storeName.isEmpty ? "" : "— \(storeName)")"
            : "很抱歉 🙇 \(r.date) \(r.time) 的時段已經客滿，無法接受這次預約。\n歡迎改約其他時間，直接傳「預約」就可以重新登記喔！"
        do {
            try await LineAPI(token: a.channelAccessToken).push(to: r.userId, [LineMessage.text(text)])
            appendMessage(id, r.userId, ChatMessage(role: .bot, text: text, source: .reservation))
        } catch {
            accountLog(id, .error, "通知顧客預約結果失敗：\(error.localizedDescription)")
        }
        accountLog(id, "預約 \(r.customerName) \(r.date) \(r.time) → \(status.label)")
        return accept ? "已接受 \(r.customerName) 的預約，顧客已收到確認 ✅" : "已婉拒 \(r.customerName) 的預約，已通知顧客。"
    }

    // MARK: - 預約收單

    private func beginReservation(_ id: UUID, userId: String, text: String) async -> BotReply {
        var draft = ReservationDraft()
        await fillDraft(&draft, text: text, askingName: false)
        update(id) { $0.conversations[userId]?.reservationDraft = draft }
        accountLog(id, "開始預約收單")
        return await nextReservationStep(id, userId: userId)
    }

    private func continueReservation(_ id: UUID, userId: String, text: String) async -> BotReply {
        guard var draft = conversation(id, userId)?.reservationDraft else {
            return await beginReservation(id, userId: userId, text: text)
        }
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.contains("取消") || t == "不用了" || t == "算了" {
            update(id) { $0.conversations[userId]?.reservationDraft = nil }
            return BotReply(text: "好的，已取消這次的預約登記，有需要隨時再跟我說 😊", source: .reservation)
        }
        // 預約流程拖太久（超過 2 小時）就重來
        if Date().timeIntervalSince(draft.startedAt) > 7200 {
            update(id) { $0.conversations[userId]?.reservationDraft = nil }
            return await beginReservation(id, userId: userId, text: text)
        }
        if draft.awaitingConfirm {
            let yes = ["確認", "確認送出", "對", "好", "好的", "是", "是的", "沒問題", "ok", "OK", "正確", "可以", "送出"]
            if yes.contains(t) || t.hasPrefix("確認") || t.hasPrefix("沒問題") {
                return await submitReservation(id, userId: userId)
            }
            if t.contains("重新") || t.contains("重填") {
                draft = ReservationDraft()
                update(id) { $0.conversations[userId]?.reservationDraft = draft }
                return await nextReservationStep(id, userId: userId)
            }
            draft.awaitingConfirm = false
        }
        let rules = data[id]?.rules ?? ReplyRules()
        // 單純回數字時，依目前問到的欄位判斷
        if let n = Int(t) {
            if draft.date != nil, draft.time != nil, draft.people == nil { draft.people = n }
            else if draft.date != nil, draft.time == nil, (0...23).contains(n) { draft.time = String(format: "%02d:00", n < 11 ? n + 12 : n) }
        }
        let askingName = draft.date != nil && draft.time != nil && draft.people != nil && draft.name == nil && rules.askName
        await fillDraft(&draft, text: t, askingName: askingName)
        update(id) { $0.conversations[userId]?.reservationDraft = draft }
        return await nextReservationStep(id, userId: userId)
    }

    private func fillDraft(_ draft: inout ReservationDraft, text: String, askingName: Bool) async {
        let before = draft
        ReservationParser.fill(&draft, from: text)
        let stillMissing = draft.date == nil || draft.time == nil || draft.people == nil
        if stillMissing || askingName, aiStatus.isAvailable {
            let today = ReservationParser.display(Date())
            if let slots = await AIEngine.extractSlots(from: text, today: today) {
                if draft.date == nil, let s = slots.date, !s.isEmpty { draft.date = ReservationParser.date(in: s) ?? s }
                if draft.time == nil, let s = slots.time, !s.isEmpty { draft.time = ReservationParser.time(in: s) ?? s }
                if draft.people == nil, let p = slots.people, p > 0 { draft.people = p }
                if draft.name == nil, let n = slots.name, !n.isEmpty { draft.name = n }
                if draft.phone == nil, let ph = slots.phone, !ph.isEmpty { draft.phone = ph }
            }
        }
        if askingName, draft.name == nil, ReservationParser.looksLikeName(text), before.name == nil {
            draft.name = text.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    private func nextReservationStep(_ id: UUID, userId: String) async -> BotReply {
        guard let draft = conversation(id, userId)?.reservationDraft else {
            return BotReply(text: "請問想預約哪一天呢？", source: .reservation)
        }
        let rules = data[id]?.rules ?? ReplyRules()
        if draft.date == nil {
            return BotReply(text: "好的，幫您登記預約 📅 請問想預約哪一天呢？（例如：10/12 或 明天）", source: .reservation, quickReplies: ["今天", "明天", "後天", "取消預約"])
        }
        if draft.time == nil {
            return BotReply(text: "\(draft.date!) 沒問題！請問大約幾點呢？（例如：晚上 7 點）", source: .reservation, quickReplies: ["中午 12 點", "晚上 6 點", "晚上 7 點", "取消預約"])
        }
        if draft.people == nil {
            return BotReply(text: "請問幾位呢？", source: .reservation, quickReplies: ["1 位", "2 位", "3 位", "4 位", "5 位", "6 位"])
        }
        if let people = draft.people, people > rules.maxPartySize {
            return await startHandoff(id, userId: userId, reason: "預約人數 \(people) 位超過上限", lastText: "預約 \(draft.date!) \(draft.time!) \(people) 位", source: .handoff)
        }
        if rules.askName, draft.name == nil {
            return BotReply(text: "請問訂位大名是？", source: .reservation)
        }
        if rules.askPhone, draft.phone == nil {
            return BotReply(text: "請留一支聯絡電話 📞", source: .reservation)
        }
        update(id) { $0.conversations[userId]?.reservationDraft?.awaitingConfirm = true }
        var s = "幫您確認預約內容：\n📅 \(draft.date!) \(draft.time!)\n👥 \(draft.people!) 位"
        if let n = draft.name { s += "\n🙋 \(n)" }
        if let p = draft.phone { s += "\n📞 \(p)" }
        s += "\n\n請問確認送出嗎？"
        return BotReply(text: s, source: .reservation, quickReplies: ["確認送出", "重新填寫", "取消預約"])
    }

    private func submitReservation(_ id: UUID, userId: String) async -> BotReply {
        guard let conv = conversation(id, userId), let draft = conv.reservationDraft,
              let date = draft.date, let time = draft.time, let people = draft.people else {
            return await nextReservationStep(id, userId: userId)
        }
        let r = Reservation(
            userId: userId, customerName: conv.displayName, date: date, time: time, people: people,
            contactName: draft.name ?? "", phone: draft.phone ?? "", note: draft.note ?? ""
        )
        update(id) { d in
            d.reservations.insert(r, at: 0)
            d.today.reservations += 1
            d.conversations[userId]?.reservationDraft = nil
        }
        accountLog(id, "收到預約：\(conv.displayName) \(date) \(time) \(people) 位")
        await notifyOwners(id, [
            LineMessage.buttons(
                text: "📅 新預約 #\(r.code)\n\(conv.displayName)\n\(date) \(time)｜\(people) 位\(r.contactName.isEmpty ? "" : "｜\(r.contactName)")\(r.phone.isEmpty ? "" : "\n📞 \(r.phone)")",
                actions: [("接受", "action=rsv&op=accept&id=\(r.id.uuidString)"), ("婉拒", "action=rsv&op=decline&id=\(r.id.uuidString)")],
                altText: "新預約：\(conv.displayName) \(date) \(time) \(people) 位"
            ),
        ])
        return BotReply(text: "已收到您的預約申請 🙏 店家確認後會馬上通知您！\n\n\(r.summary)", source: .reservation)
    }

    // MARK: - 試答（不送出、不記錄）

    func preview(_ text: String, accountId: UUID) async -> BotReply {
        let d = data[accountId] ?? AccountData()
        let rules = d.rules
        if let hit = KnowledgeRetriever.containsAny(text, rules.handoffKeywords) {
            return BotReply(text: rules.handoffMessage + "\n\n（命中轉人工關鍵字「\(hit)」）", source: .handoff)
        }
        if let hit = KnowledgeRetriever.containsAny(text, rules.blockedKeywords) {
            return BotReply(text: rules.handoffMessage + "\n\n（敏感問題「\(hit)」）", source: .blocked)
        }
        if rules.reservationEnabled, KnowledgeRetriever.containsAny(text, rules.reservationKeywords) != nil {
            return BotReply(text: "（會開始預約收單流程）", source: .reservation)
        }
        if let faq = KnowledgeRetriever.matchFAQ(text, in: d.faqs) {
            return BotReply(text: faq.answer, source: .faq)
        }
        guard aiStatus.isAvailable else { return BotReply(text: rules.fallbackMessage, source: .fallback) }
        let started = Date()
        do {
            let a = try await AIEngine.answer(question: text, knowledge: KnowledgeRetriever.context(for: text, data: d), history: [], store: d.store, rules: rules)
            let latency = Date().timeIntervalSince(started)
            if a.intent == .question, !a.answerable {
                return BotReply(text: rules.fallbackMessage + "\n\n（知識庫沒有答案，會加入待補清單）", source: .fallback, latency: latency)
            }
            return BotReply(text: a.reply, source: .ai, latency: latency)
        } catch {
            return BotReply(text: "AI 生成失敗：\(error.localizedDescription)", source: .system)
        }
    }

    // MARK: - 排程工作

    func runConversationTimers(_ id: UUID, now: Date) {
        guard let d = data[id] else { return }
        let rules = d.rules
        for conv in d.conversations.values where conv.mode == .human {
            // 店家回覆後一段時間沒動靜 → 自動交還 AI
            if let last = conv.lastOwnerReplyAt {
                let lastActivity = max(last, conv.lastCustomerMessageAt ?? last)
                if now.timeIntervalSince(lastActivity) > Double(rules.humanModeMinutes) * 60 {
                    resumeAI(id, userId: conv.id, reason: "\(rules.humanModeMinutes) 分鐘無人回覆，自動交還")
                    continue
                }
            } else if let since = conv.humanSince, now.timeIntervalSince(since) > 12 * 3600 {
                resumeAI(id, userId: conv.id, reason: "超過 12 小時未處理，自動交還")
                continue
            }
            // 待回覆提醒
            guard rules.pendingReminderEnabled, !conv.reminderSent,
                  let lastCustomer = conv.lastCustomerMessageAt,
                  lastCustomer > (conv.lastOwnerReplyAt ?? .distantPast),
                  now.timeIntervalSince(lastCustomer) > Double(rules.pendingReminderMinutes) * 60 else { continue }
            update(id) { $0.conversations[conv.id]?.reminderSent = true }
            let minutes = Int(now.timeIntervalSince(lastCustomer) / 60)
            let preview = conv.messages.last(where: { $0.role == .customer })?.text.prefix(100) ?? ""
            Task {
                await notifyOwners(id, [LineMessage.text("⏰ 待回覆提醒\n\(conv.displayName) 已經等了 \(minutes) 分鐘\n最新訊息：「\(preview)」\n\n回覆請傳：#\(conv.handoffCode) 你的回覆")])
            }
        }
    }

    func sendDailySummaryIfNeeded(_ id: UUID, now: Date) {
        guard let d = data[id], d.rules.dailySummaryEnabled else { return }
        let key = DailyStats.key(for: now)
        guard d.lastSummarySent != key else { return }
        let c = Calendar.current.dateComponents([.hour, .minute], from: now)
        let nowMinutes = (c.hour ?? 0) * 60 + (c.minute ?? 0)
        guard nowMinutes >= d.rules.dailySummaryHour * 60 + d.rules.dailySummaryMinute else { return }
        update(id) { $0.lastSummarySent = key }
        let text = dailySummary(id)
        Task { await notifyOwners(id, [LineMessage.text(text)]) }
        accountLog(id, "已送出每日摘要")
    }

    func dailySummary(_ id: UUID) -> String {
        let d = data[id] ?? AccountData()
        let s = d.today
        let pendingRsv = d.reservations.filter { $0.status == .pending }.count
        let waiting = d.conversations.values.filter { $0.mode == .human }.count
        var text = """
        📊 \(d.store.name.isEmpty ? "今日" : d.store.name) 每日摘要（\(ReservationParser.display(Date()))）
        收到訊息 \(s.received) 則｜已回覆 \(s.replied) 則
        FAQ 直接回答 \(s.faq)｜AI 生成 \(s.ai)
        轉人工 \(s.handoff)｜新預約 \(s.reservations)
        待確認預約 \(pendingRsv) 筆｜等待真人 \(waiting) 位
        """
        let today = d.pending.filter { Calendar.current.isDateInToday($0.lastAskedAt) }.prefix(5)
        if !today.isEmpty {
            text += "\n\n📝 今天答不出來的問題：\n" + today.map { "・\($0.question.prefix(40))" }.joined(separator: "\n")
            text += "\n到 App 知識庫可一鍵補成 FAQ，越用越準！"
        }
        return text
    }
}
