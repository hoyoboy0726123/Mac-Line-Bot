import SwiftUI

struct AccountsView: View {
    @Environment(AppState.self) private var app
    @State private var deleting: BotAccount?

    var body: some View {
        Page(section: .accounts, subtitle: "多個官方帳號同時跑，分店各有自己的知識庫") {
            HStack {
                Text("所有帳號共用同一個 Tunnel，用不同的 webhook 路徑區分。").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button { app.showSetupWizard = true } label: { Label("新增官方帳號", systemImage: "plus") }
                    .buttonStyle(.borderedProminent)
            }
            ForEach(app.accounts) { a in
                let d = app.data[a.id] ?? AccountData()
                Card(padding: 14) {
                    HStack(spacing: 12) {
                        AvatarView(name: a.displayName, url: a.pictureURL, size: 40)
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(a.displayName).font(.headline)
                                if a.id == app.selectedAccount?.id { Tag(text: "目前", color: .blue) }
                                if !a.isEnabled { Tag(text: "已暫停", color: .gray) }
                                if !a.hasCredentials { Tag(text: "缺金鑰", color: .red) }
                            }
                            Text("\(a.basicId.isEmpty ? "—" : a.basicId)・/webhook/\(a.slug)").font(.caption.monospaced()).foregroundStyle(.secondary)
                            Text("FAQ \(d.faqs.count)・文件 \(d.docs.count)・對話 \(d.conversations.count)・今日 \(d.today.received) 則").font(.caption).foregroundStyle(.tertiary)
                        }
                        Spacer()
                        Toggle("啟用", isOn: Binding(
                            get: { a.isEnabled },
                            set: { v in app.updateAccount(a.id) { $0.isEnabled = v } }
                        ))
                        .toggleStyle(.switch)
                        .labelsHidden()
                        Button("切換") { app.settings.selectedAccountId = a.id; app.section = .overview }
                            .disabled(a.id == app.selectedAccount?.id)
                        Button(role: .destructive) { deleting = a } label: { Image(systemName: "trash") }
                            .buttonStyle(.borderless)
                    }
                }
            }
        }
        .confirmationDialog("確定刪除「\(deleting?.displayName ?? "")」？", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("刪除（對話與知識庫都會移除）", role: .destructive) {
                if let d = deleting { app.deleteAccount(d.id) }
                deleting = nil
            }
        }
    }
}

struct SystemView: View {
    @Environment(AppState.self) private var app
    @State private var portText = ""
    @State private var prompt = "用一句話介紹你自己"
    @State private var aiResult = ""
    @State private var aiRunning = false

    var body: some View {
        @Bindable var app = app
        Page(section: .system, subtitle: "本機服務、Apple Intelligence 與資料位置") {
            Card {
                VStack(alignment: .leading, spacing: 10) {
                    Text("本機服務").font(.headline)
                    HStack {
                        StatusDot(color: app.serverRunning ? .green : .red)
                        Text(app.serverRunning ? "HTTP 服務 127.0.0.1:\(app.settings.port) 執行中" : (app.serverError ?? "未啟動"))
                        Spacer()
                        TextField("連接埠", text: $portText).frame(width: 80).textFieldStyle(.roundedBorder)
                        Button("套用並重啟") {
                            if let p = UInt16(portText), p > 1024 {
                                app.settings.port = p
                                app.restartServer()
                                if app.tunnel.state != .stopped { app.startTunnel() }
                            }
                        }
                    }
                    Toggle("開啟 App 時自動啟動 Tunnel", isOn: $app.settings.autoStart)
                    Toggle("登入 Mac 時自動開啟顧店", isOn: Binding(get: { app.launchAtLogin }, set: { app.launchAtLogin = $0 }))
                    Text("長期跑的話建議用 Mac mini，並到「系統設定 > 能源」關閉自動睡眠。").font(.caption).foregroundStyle(.secondary)
                }
            }

            Card {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("Apple Intelligence 本機模型").font(.headline)
                        Tag(text: app.aiStatus.isAvailable ? "可用" : "不可用", color: app.aiStatus.isAvailable ? .green : .orange)
                        Spacer()
                        Button("重新檢查") { app.refreshAIStatus() }
                    }
                    if !app.aiStatus.isAvailable {
                        Text(app.aiStatus.label).font(.callout).foregroundStyle(.orange)
                        Button("開啟 Apple Intelligence 設定") {
                            if let url = URL(string: "x-apple.systempreferences:com.apple.Siri-Settings.extension") { NSWorkspace.shared.open(url) }
                        }
                    }
                    Text("不用 API key、沒有 token 費用，顧客的對話和你的資料都留在這台電腦上。").font(.caption).foregroundStyle(.secondary)
                    HStack {
                        TextField("試問模型", text: $prompt).textFieldStyle(.roundedBorder)
                        Button(aiRunning ? "生成中…" : "試跑") {
                            aiRunning = true
                            Task {
                                do { aiResult = try await AIEngine.freeform(prompt) } catch { aiResult = "❌ \(error.localizedDescription)" }
                                aiRunning = false
                            }
                        }
                        .disabled(aiRunning || !app.aiStatus.isAvailable)
                    }
                    if !aiResult.isEmpty {
                        Text(aiResult).font(.callout).textSelection(.enabled)
                    }
                }
            }

            Card {
                VStack(alignment: .leading, spacing: 10) {
                    Text("資料").font(.headline)
                    Text(Persistence.baseURL.path).font(.caption.monospaced()).textSelection(.enabled)
                    HStack {
                        Button("在 Finder 打開") { NSWorkspace.shared.open(Persistence.baseURL) }
                        Button("打開日誌檔") { NSWorkspace.shared.open(Persistence.logFile) }
                        Spacer()
                        Button("重新執行設定精靈") { app.showSetupWizard = true }
                    }
                }
            }

            Card {
                VStack(alignment: .leading, spacing: 6) {
                    Text("系統日誌").font(.headline)
                    ForEach(app.logs.prefix(60)) { e in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            StatusDot(color: e.level == .info ? .green : e.level == .warning ? .orange : .red).scaleEffect(0.7)
                            Text(e.date.timeDisplay).font(.caption2.monospacedDigit()).foregroundStyle(.tertiary)
                            Text(e.message).font(.caption2).textSelection(.enabled)
                        }
                    }
                }
            }
        }
        .onAppear { portText = "\(app.settings.port)" }
    }
}
