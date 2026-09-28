import AppKit
import SwiftUI

struct LineConnectionView: View {
    @Environment(AppState.self) private var app
    @State private var secret = ""
    @State private var token = ""
    @State private var message: String?
    @State private var busy = false
    @State private var installing = false

    var body: some View {
        @Bindable var app = app
        Page(section: .line, subtitle: "LINE 官方帳號、Cloudflare Tunnel 與你的 LINE 綁定") {
            if let account = app.selectedAccount {
                credentialsCard(account)
                tunnelCard
                webhookCard(account)
                bindCard(account)
            } else {
                Card { EmptyStateView(icon: "link", title: "還沒有帳號", message: "先用設定精靈新增一個 LINE 官方帳號") }
                Button("開啟設定精靈") { app.showSetupWizard = true }
            }
        }
        .onAppear(perform: loadFields)
        .onChange(of: app.selectedAccount?.id) { _, _ in loadFields() }
    }

    private func loadFields() {
        secret = app.selectedAccount?.channelSecret ?? ""
        token = app.selectedAccount?.channelAccessToken ?? ""
    }

    // MARK: 金鑰

    private func credentialsCard(_ account: BotAccount) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Messaging API").font(.headline)
                    Spacer()
                    Link("開啟 LINE Developers", destination: URL(string: "https://developers.line.biz/console/")!)
                        .font(.caption)
                }
                Form {
                    SecureField("Channel secret", text: $secret)
                    SecureField("Channel access token", text: $token)
                }
                HStack {
                    if !account.basicId.isEmpty {
                        AvatarView(name: account.displayName, url: account.pictureURL, size: 24)
                        Text("\(account.displayName)  \(account.basicId)").font(.callout)
                    }
                    if let message { Text(message).font(.caption).foregroundStyle(.secondary) }
                    Spacer()
                    Button(busy ? "驗證中…" : "儲存並驗證") {
                        busy = true
                        Task {
                            app.updateAccount(account.id) {
                                $0.channelSecret = secret.trimmingCharacters(in: .whitespacesAndNewlines)
                                $0.channelAccessToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
                            }
                            do {
                                try await app.refreshBotInfo(account.id)
                                message = "✅ 連線成功"
                                if app.tunnel.publicURL != nil { await app.syncWebhook(account.id) }
                            } catch {
                                message = "❌ \(error.localizedDescription)"
                            }
                            busy = false
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(busy || secret.isEmpty || token.isEmpty)
                }
            }
        }
    }

    // MARK: Tunnel

    private var tunnelCard: some View {
        @Bindable var app = app
        let binary = TunnelManager.locate(custom: app.settings.cloudflaredPath)
        return Card {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Cloudflare Tunnel").font(.headline)
                    Tag(text: app.tunnel.state.label, color: app.tunnel.state == .running ? .green : .orange)
                    Spacer()
                    if let pid = app.tunnel.pid { Text("pid \(pid)").font(.caption).foregroundStyle(.tertiary) }
                }
                Text("讓 LINE 可以從外部連進這台 Mac，不用開 port、不用固定 IP。").font(.caption).foregroundStyle(.secondary)

                HStack {
                    Image(systemName: binary == nil ? "xmark.circle.fill" : "checkmark.circle.fill")
                        .foregroundStyle(binary == nil ? .red : .green)
                    Text(binary ?? "尚未安裝 cloudflared").font(.system(.caption, design: .monospaced))
                    Spacer()
                    if binary == nil {
                        Button(installing ? "下載中…" : "一鍵安裝") {
                            installing = true
                            Task {
                                do {
                                    let path = try await TunnelManager.install()
                                    app.log(.info, "cloudflared 已安裝：\(path)")
                                    app.startTunnel()
                                } catch {
                                    app.log(.error, "安裝 cloudflared 失敗：\(error.localizedDescription)")
                                }
                                installing = false
                            }
                        }
                        .disabled(installing)
                    }
                }

                Picker("模式", selection: $app.settings.tunnelMode) {
                    ForEach(TunnelMode.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.radioGroup)

                if app.settings.tunnelMode == .named {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("在 Cloudflare Zero Trust 建立 Tunnel，Public Hostname 指到 http://localhost:\(app.settings.port)，再把 Token 和網域貼進來。同一個網域可以開很多子網域，例如 bot.你的網域.com。")
                            .font(.caption).foregroundStyle(.secondary)
                        TextField("自訂網域（例如 bot.mydomain.com）", text: $app.settings.namedHostname)
                        SecureField("Tunnel Token", text: $app.namedTunnelToken)
                    }
                    .textFieldStyle(.roundedBorder)
                }

                HStack {
                    Spacer()
                    Button("停止") { app.stopAll() }
                        .disabled(app.tunnel.state == .stopped)
                    Button(app.tunnel.state == .stopped ? "啟動 Tunnel" : "重啟 Tunnel") { app.startTunnel() }
                        .buttonStyle(.borderedProminent)
                }
            }
        }
    }

    // MARK: Webhook

    private func webhookCard(_ account: BotAccount) -> some View {
        let url = app.webhookURL(for: account)
        let status = app.webhookStatus[account.id]
        return Card {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Webhook").font(.headline)
                    if let status { Tag(text: status.synced ? "已同步" : "未同步", color: status.synced ? .green : .orange) }
                    Spacer()
                }
                Text(url ?? "Tunnel 建立後會自動產生，並自動設定到 LINE 後台").font(.system(.callout, design: .monospaced))
                    .textSelection(.enabled)
                if let status, !status.message.isEmpty {
                    Text(status.message).font(.caption).foregroundStyle(.secondary)
                }
                Text("記得在 LINE Official Account Manager 把「回應設定 → 自動回應訊息」關掉、「Webhook」打開，不然會有兩則回覆。")
                    .font(.caption).foregroundStyle(.orange)
                HStack {
                    Spacer()
                    Button("檢查") { Task { await app.checkWebhook(account.id) } }
                        .disabled(url == nil)
                    Button("重新設定到 LINE") { Task { await app.syncWebhook(account.id) } }
                        .buttonStyle(.borderedProminent)
                        .disabled(url == nil || !account.hasCredentials)
                }
            }
        }
    }

    // MARK: 綁定

    private func bindCard(_ account: BotAccount) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 10) {
                Text("綁定你的 LINE").font(.headline)
                Text("用你自己的 LINE 加官方帳號好友，傳送下面這句就完成綁定。之後轉人工、預約、每日摘要、待回覆提醒、斷線通知都會推播給你，也可以直接在 LINE 按接受/婉拒預約、用「#代碼 內容」回覆顧客。")
                    .font(.caption).foregroundStyle(.secondary)
                HStack {
                    Text("綁定 \(account.bindCode)")
                        .font(.system(size: 22, weight: .bold, design: .monospaced))
                        .textSelection(.enabled)
                        .padding(.horizontal, 14).padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.lineGreen.opacity(0.12)))
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString("綁定 \(account.bindCode)", forType: .string)
                    } label: { Image(systemName: "doc.on.doc") }
                    .buttonStyle(.borderless)
                    Spacer()
                    Button("換一組") { app.updateAccount(account.id) { $0.bindCode = BotAccount.makeBindCode() } }
                }
                if account.ownerUserIds.isEmpty {
                    Label("尚未綁定任何人", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange).font(.callout)
                } else {
                    ForEach(account.ownerUserIds, id: \.self) { uid in
                        HStack {
                            Image(systemName: "person.crop.circle.badge.checkmark").foregroundStyle(.green)
                            Text("已綁定 …\(uid.suffix(8))").font(.callout)
                            Spacer()
                            Button("測試推播") {
                                Task { await app.notifyOwners(account.id, [LineMessage.text("👋 這是 Mac-Line-Bot 的測試通知，收到代表綁定成功！")]) }
                            }
                            Button("解除", role: .destructive) {
                                app.updateAccount(account.id) { $0.ownerUserIds.removeAll { $0 == uid } }
                            }
                        }
                    }
                }
            }
        }
    }
}
