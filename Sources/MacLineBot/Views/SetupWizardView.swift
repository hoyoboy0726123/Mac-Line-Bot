import SwiftUI

/// 設定精靈：走完七步，LINE 官方帳號就會開始自己回訊息
struct SetupWizardView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var step = 0
    @State private var secret = ""
    @State private var token = ""
    @State private var accountId: UUID?
    @State private var verifying = false
    @State private var error: String?
    @State private var installing = false
    @State private var newQuestion = ""
    @State private var newAnswer = ""

    private let titles = ["歡迎", "建立官方帳號", "填入金鑰", "店家資訊", "常見問題", "建立連線", "綁定你的 LINE"]

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    content
                }
                .padding(24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            footer
        }
        .frame(width: 640, height: 560)
        .onAppear {
            refreshCloudflared()
            // 已有帳號時是「新增另一個帳號」，從第 2 步開始
            if !app.accounts.isEmpty, app.settings.onboardingCompleted { step = 1 }
            // 上次精靈沒走完：接續同一個帳號，避免重複建立
            if !app.settings.onboardingCompleted, let first = app.accounts.first {
                accountId = first.id
                secret = first.channelSecret
                token = first.channelAccessToken
            }
        }
    }

    // MARK: 版面

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                IconBadge(systemName: "storefront.fill", color: .lineGreen, size: 30)
                Text("Mac-Line-Bot 設定精靈").font(.title3.bold())
                Spacer()
                Text("第 \(step + 1) / \(titles.count) 步").font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: 4) {
                ForEach(titles.indices, id: \.self) { i in
                    VStack(spacing: 4) {
                        Capsule().fill(i <= step ? Color.lineGreen : Color.secondary.opacity(0.2)).frame(height: 4)
                        Text(titles[i]).font(.system(size: 9)).foregroundStyle(i == step ? Color.primary : Color.secondary)
                    }
                }
            }
        }
        .padding(20)
    }

    private var footer: some View {
        HStack {
            if app.settings.onboardingCompleted || !app.accounts.isEmpty {
                Button("稍後再說") { dismiss() }
            }
            Spacer()
            if step > 0 {
                Button("上一步") { step -= 1; error = nil }
            }
            Button(step == titles.count - 1 ? "完成 🎉" : "下一步") { next() }
                .buttonStyle(.borderedProminent)
                .tint(.lineGreen)
                .disabled(!canContinue || verifying)
                .keyboardShortcut(.defaultAction)
        }
        .padding(16)
    }

    private var account: BotAccount? { accountId.flatMap { app.account($0) } }

    private var canContinue: Bool {
        switch step {
        case 2: return !secret.isEmpty && !token.isEmpty
        default: return true
        }
    }

    @ViewBuilder
    private var content: some View {
        switch step {
        case 0: welcome
        case 1: createOA
        case 2: credentials
        case 3: storeInfo
        case 4: faqs
        case 5: connect
        default: bind
        }
    }

    // MARK: 步驟

    private var welcome: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("讓 Mac 幫你顧好 LINE 客服 👋").font(.title2.bold())
            Text("Mac-Line-Bot 用 macOS 內建的 Apple Intelligence 本地模型回覆 LINE 官方帳號的訊息。不用 API key、沒有 token 費用，顧客的對話和你的資料都留在自己的電腦上。")
                .foregroundStyle(.secondary)
            Card {
                VStack(alignment: .leading, spacing: 8) {
                    checkRow("Apple 晶片的 Mac", ok: isAppleSilicon)
                    checkRow("macOS 26 以上", ok: ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26)
                    checkRow("Apple Intelligence：\(app.aiStatus.label)", ok: app.aiStatus.isAvailable)
                    checkRow("本機服務 127.0.0.1:\(app.settings.port)", ok: app.serverRunning)
                }
            }
            if !app.aiStatus.isAvailable {
                Text("Apple Intelligence 還沒準備好也可以先繼續，期間只會用常見問題回答。到「系統設定 > Apple Intelligence 與 Siri」開啟。")
                    .font(.caption).foregroundStyle(.orange)
            }
            Text("長期跑的話 Mac mini 是首選 💡").font(.caption).foregroundStyle(.secondary)
        }
    }

    private var createOA: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("準備 LINE 官方帳號").font(.title2.bold())
            instruction(1, "到 LINE Official Account Manager 建立官方帳號（已經有就跳過）", link: "https://manager.line.biz/")
            instruction(2, "在官方帳號的「設定 → Messaging API」按「啟用 Messaging API」")
            instruction(3, "到 LINE Developers 找到這個 Channel", link: "https://developers.line.biz/console/")
            instruction(4, "在「Basic settings」複製 Channel secret")
            instruction(5, "在「Messaging API」最下面發行 Channel access token（long-lived）")
            instruction(6, "在官方帳號的「回應設定」關閉「自動回應訊息」，開啟「Webhook」")
        }
    }

    private var credentials: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("填入 Messaging API 金鑰").font(.title2.bold())
            Text("金鑰只存在這台 Mac。").font(.caption).foregroundStyle(.secondary)
            Form {
                SecureField("Channel secret", text: $secret)
                SecureField("Channel access token", text: $token)
            }
            if verifying { ProgressView("驗證中…").controlSize(.small) }
            if let error { Text(error).foregroundStyle(.red).font(.callout) }
            if let account, !account.basicId.isEmpty {
                HStack {
                    AvatarView(name: account.displayName, url: account.pictureURL, size: 36)
                    VStack(alignment: .leading) {
                        Text(account.displayName).font(.headline)
                        Text(account.basicId).font(.caption).foregroundStyle(.secondary)
                    }
                    Image(systemName: "checkmark.seal.fill").foregroundStyle(.green)
                }
            }
        }
    }

    private var storeInfo: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("店家資訊").font(.title2.bold())
            Text("AI 回答時一定會參考這些資料，之後都可以在「店家資訊」修改。").font(.caption).foregroundStyle(.secondary)
            if let id = accountId {
                let b = storeBinding(id)
                Form {
                    TextField("店名", text: b.name)
                    TextField("地址", text: b.address)
                    TextField("電話", text: b.phone)
                    TextField("營業時間", text: b.businessHours, axis: .vertical).lineLimit(2...4)
                    TextField("一句話介紹", text: b.intro, axis: .vertical).lineLimit(1...3)
                }
            }
        }
    }

    private var faqs: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("常見問題").font(.title2.bold())
            Text("先放幾題最常被問的，常見問題會直接回標準答案；之後 AI 答不出來的問題會自動整理成待補清單。")
                .font(.caption).foregroundStyle(.secondary)
            if let id = accountId {
                ForEach(app.data[id]?.faqs ?? []) { f in
                    HStack(alignment: .top) {
                        VStack(alignment: .leading) {
                            Text(f.question).font(.callout.weight(.semibold))
                            Text(f.answer).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        }
                        Spacer()
                        Button { app.update(id) { $0.faqs.removeAll { $0.id == f.id } } } label: { Image(systemName: "minus.circle") }
                            .buttonStyle(.borderless)
                    }
                }
                Divider()
                TextField("問題，例如：可以帶寵物嗎", text: $newQuestion).textFieldStyle(.roundedBorder)
                TextField("答案", text: $newAnswer, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder)
                Button("加入") {
                    app.update(id) { $0.faqs.append(FAQItem(question: newQuestion, answer: newAnswer)) }
                    newQuestion = ""
                    newAnswer = ""
                }
                .disabled(newQuestion.isEmpty || newAnswer.isEmpty)
            }
        }
    }

    @State private var cloudflared: String?

    private var connect: some View {
        let status = accountId.flatMap { app.webhookStatus[$0] }
        return VStack(alignment: .leading, spacing: 12) {
            Text("建立連線").font(.title2.bold())
            Text("Mac-Line-Bot 會用 Cloudflare Tunnel 產生一個公開網址，並自動設定到 LINE 的 webhook，不用開 port、不用固定 IP。")
                .font(.caption).foregroundStyle(.secondary)
            Card {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        checkRow("cloudflared", ok: cloudflared != nil)
                        Spacer()
                        if cloudflared == nil {
                            Button(installing ? "下載中…" : "一鍵安裝") {
                                installing = true
                                Task {
                                    do {
                                        _ = try await TunnelManager.install()
                                        refreshCloudflared()
                                        app.startTunnel()
                                    } catch {
                                        self.error = error.localizedDescription
                                    }
                                    installing = false
                                }
                            }
                            .disabled(installing)
                        }
                    }
                    checkRow("Tunnel：\(app.tunnel.state.label)", ok: app.tunnel.state == .running)
                    checkRow("公開網址：\(app.tunnel.publicURL ?? "等待中")", ok: app.tunnel.publicURL != nil)
                    checkRow("LINE Webhook：\(status?.synced == true ? "已同步並測試通過" : (status?.message.isEmpty == false ? status!.message : "等待中"))", ok: status?.synced == true)
                }
            }
            HStack {
                Button(app.tunnel.state == .stopped ? "開始連線" : "重新連線") { app.startTunnel() }
                    .disabled(cloudflared == nil)
                if app.tunnel.publicURL != nil, let id = accountId {
                    Button("重新設定 Webhook") { Task { await app.syncWebhook(id) } }
                }
                if app.tunnel.state == .starting { ProgressView().controlSize(.small) }
            }
            if let error { Text(error).foregroundStyle(.red).font(.caption) }
            Text("Quick Tunnel 每次重啟網址會變，Mac-Line-Bot 會自動幫你更新 LINE 後台。想要固定網址，之後可以在「LINE 連線」改用自訂網域。")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private var bind: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("最後一步：綁定你的 LINE").font(.title2.bold())
            Text("用你自己的 LINE 加官方帳號為好友，然後傳送：").foregroundStyle(.secondary)
            if let account {
                Text("綁定 \(account.bindCode)")
                    .font(.system(size: 30, weight: .bold, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(.horizontal, 18).padding(.vertical, 10)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.lineGreen.opacity(0.12)))
                if account.ownerUserIds.isEmpty {
                    HStack { ProgressView().controlSize(.small); Text("等待綁定中…").foregroundStyle(.secondary) }
                } else {
                    Label("綁定成功！", systemImage: "checkmark.circle.fill").foregroundStyle(.green).font(.headline)
                }
            }
            Card {
                VStack(alignment: .leading, spacing: 6) {
                    Text("綁定後你會在 LINE 收到：").font(.callout.weight(.semibold))
                    Text("・顧客要找專人、問到不該回的問題時的通知（傳「#代碼 內容」直接回覆）")
                    Text("・預約單，按一下接受或婉拒，顧客馬上收到確認")
                    Text("・每日摘要、待回覆提醒、斷線通知")
                }
                .font(.caption)
            }
            Text("也可以先跳過，之後在「LINE 連線」頁面綁定。").font(.caption).foregroundStyle(.secondary)
        }
    }

    // MARK: 小元件

    private func checkRow(_ text: String, ok: Bool) -> some View {
        HStack(spacing: 8) {
            Image(systemName: ok ? "checkmark.circle.fill" : "circle.dashed").foregroundStyle(ok ? .green : .orange)
            Text(text).font(.callout).lineLimit(1).truncationMode(.middle)
        }
    }

    private func instruction(_ n: Int, _ text: String, link: String? = nil) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(n)").font(.caption.bold()).foregroundStyle(.white)
                .frame(width: 20, height: 20).background(Circle().fill(Color.lineGreen))
            VStack(alignment: .leading, spacing: 2) {
                Text(text).font(.callout)
                if let link, let url = URL(string: link) {
                    Link(link, destination: url).font(.caption)
                }
            }
        }
    }

    private var isAppleSilicon: Bool {
        #if arch(arm64)
        return true
        #else
        return false
        #endif
    }

    private func refreshCloudflared() {
        cloudflared = TunnelManager.locate(custom: app.settings.cloudflaredPath)
    }

    private func storeBinding(_ id: UUID) -> Binding<StoreInfo> {
        Binding(
            get: { app.data[id]?.store ?? StoreInfo() },
            set: { v in app.update(id) { $0.store = v } }
        )
    }

    // MARK: 流程

    private func next() {
        error = nil
        switch step {
        case 2:
            verifying = true
            Task {
                let s = secret.trimmingCharacters(in: .whitespacesAndNewlines)
                let t = token.trimmingCharacters(in: .whitespacesAndNewlines)
                do {
                    let info = try await LineAPI(token: t).botInfo()
                    if let id = accountId {
                        app.updateAccount(id) { $0.channelSecret = s; $0.channelAccessToken = t }
                    } else {
                        accountId = app.addAccount(name: info.displayName, secret: s, token: t).id
                    }
                    if let id = accountId { try? await app.refreshBotInfo(id) }
                    verifying = false
                    step += 1
                } catch {
                    self.error = "驗證失敗：\(error.localizedDescription)"
                    verifying = false
                }
            }
        case 4:
            step += 1
            if app.tunnel.state == .stopped || app.tunnel.publicURL == nil {
                app.startTunnel()
            } else if let id = accountId {
                Task { await app.syncWebhook(id) }
            }
        case titles.count - 1:
            app.settings.onboardingCompleted = true
            app.section = .overview
            dismiss()
        default:
            step += 1
        }
    }
}
