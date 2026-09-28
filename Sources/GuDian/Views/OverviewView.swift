import SwiftUI

struct OverviewView: View {
    @Environment(AppState.self) private var app
    @State private var warningsOnly = false
    @State private var checking = false

    var body: some View {
        Page(section: .overview, subtitle: "服務狀態、今日數據與最近活動", maxWidth: 980) {
            statusCard
            webhookCard
            SectionTitle(title: "今日數據")
            statsGrid
            HStack(alignment: .top, spacing: 12) {
                recentCard
                logCard
            }
        }
    }

    // MARK: 狀態

    private var statusCard: some View {
        let health = app.health
        let color: Color = health.level == .ok ? .green : health.level == .warning ? .orange : .red
        return Card(padding: 20) {
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .top, spacing: 14) {
                    ZStack {
                        Circle().fill(color.gradient).frame(width: 46, height: 46)
                        Image(systemName: health.level == .ok ? "checkmark" : "exclamationmark")
                            .font(.system(size: 22, weight: .bold)).foregroundStyle(.white)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(health.title).font(.title3.bold())
                        Text(health.detail).font(.subheadline).foregroundStyle(.secondary)
                        HStack(spacing: 4) {
                            Image(systemName: "tray.and.arrow.down")
                            Text("上次收到顧客訊息：\(app.lastEventAt?.shortDisplay ?? "尚未收到")")
                        }
                        .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if app.tunnel.state == .stopped {
                        Button {
                            app.startTunnel()
                        } label: {
                            Label("啟動", systemImage: "play.fill")
                        }
                        .buttonStyle(.borderedProminent)
                    } else {
                        Button {
                            app.startTunnel()
                        } label: {
                            Label("重啟 Tunnel", systemImage: "arrow.clockwise")
                        }
                        Button {
                            app.stopAll()
                        } label: {
                            Label("停止", systemImage: "stop.fill")
                        }
                    }
                }
                pipeline
            }
        }
    }

    private var pipeline: some View {
        let webhookOK = app.selectedAccount.flatMap { app.webhookStatus[$0.id]?.synced } ?? false
        let nodes: [(String, String, String, Bool)] = [
            ("desktopcomputer", "本機服務", "127.0.0.1:\(app.settings.port)", app.serverRunning),
            ("network", "Cloudflare Tunnel", app.tunnel.state.label, app.tunnel.state == .running),
            ("message.fill", "LINE Webhook", webhookOK ? "已同步" : "未同步", webhookOK),
            ("apple.intelligence", "Apple 本機模型", app.aiStatus.isAvailable ? "可用" : "不可用", app.aiStatus.isAvailable),
        ]
        return HStack(spacing: 0) {
            ForEach(Array(nodes.enumerated()), id: \.offset) { index, node in
                VStack(spacing: 6) {
                    ZStack(alignment: .bottomTrailing) {
                        Circle()
                            .fill((node.3 ? Color.green : Color.orange).opacity(0.15))
                            .frame(width: 36, height: 36)
                            .overlay(Image(systemName: node.0).foregroundStyle(node.3 ? .green : .orange))
                        StatusDot(color: node.3 ? .green : .orange)
                            .overlay(Circle().stroke(Color.cardBackground, lineWidth: 2))
                    }
                    Text(node.1).font(.caption.weight(.semibold))
                    Text(node.2).font(.caption2).foregroundStyle(.secondary)
                }
                .frame(width: 130)
                if index < nodes.count - 1 {
                    Rectangle()
                        .fill(node.3 && nodes[index + 1].3 ? Color.green.opacity(0.5) : Color.secondary.opacity(0.25))
                        .frame(height: 2)
                        .padding(.bottom, 34)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: Webhook 網址

    private var webhookCard: some View {
        let account = app.selectedAccount
        let url = account.flatMap { app.webhookURL(for: $0) }
        let status = account.flatMap { app.webhookStatus[$0.id] }
        return Card(padding: 14) {
            HStack(spacing: 12) {
                IconBadge(systemName: "globe", color: .indigo, size: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text("公開 Webhook 網址").font(.caption).foregroundStyle(.secondary)
                    HStack(spacing: 6) {
                        Text(url ?? "Tunnel 尚未建立")
                            .font(.system(.callout, design: .monospaced))
                            .lineLimit(1).truncationMode(.middle)
                            .textSelection(.enabled)
                        if let url {
                            Button {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(url, forType: .string)
                            } label: {
                                Image(systemName: "doc.on.doc")
                            }
                            .buttonStyle(.borderless)
                            .help("複製")
                        }
                    }
                }
                Spacer()
                if let status, let check = status.lastCheck {
                    HStack(spacing: 4) {
                        StatusDot(color: status.reachable == true ? .green : .red)
                        Text("\(status.reachable == true ? "外部可連線" : "外部無法連線")・\(check.shortDisplay)")
                    }
                    .font(.caption)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Capsule().fill((status.reachable == true ? Color.green : Color.red).opacity(0.12)))
                }
                Button(checking ? "檢查中…" : "檢查") {
                    guard let id = account?.id else { return }
                    checking = true
                    Task {
                        await app.checkWebhook(id)
                        checking = false
                    }
                }
                .disabled(url == nil || checking)
            }
        }
    }

    // MARK: 數據

    private var statsGrid: some View {
        let s = app.selectedData.today
        return Grid(horizontalSpacing: 12, verticalSpacing: 12) {
            GridRow {
                StatTile(icon: "tray.and.arrow.down.fill", color: .blue, value: "\(s.received)", label: "收到訊息")
                StatTile(icon: "paperplane.fill", color: .green, value: "\(s.replied)", label: "已回覆")
                StatTile(icon: "list.bullet.rectangle.fill", color: .teal, value: "\(s.faq)", label: "FAQ 直接回答")
            }
            GridRow {
                StatTile(icon: "sparkles", color: .purple, value: "\(s.ai)", label: "AI 生成回覆")
                StatTile(icon: "person.fill", color: .orange, value: "\(s.handoff)", label: "轉人工")
                StatTile(icon: "arrow.triangle.2.circlepath", color: .gray, value: "\(s.urlChanges)", label: "網址變動")
            }
        }
    }

    // MARK: 最近處理

    private var recentCard: some View {
        let convs = app.selectedData.conversations.values
            .filter { $0.lastMessage != nil }
            .sorted { ($0.lastMessage?.date ?? .distantPast) > ($1.lastMessage?.date ?? .distantPast) }
            .prefix(6)
        return Card(padding: 14) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    IconBadge(systemName: "clock.fill", color: .blue, size: 22)
                    Text("最近處理").font(.headline)
                }
                if convs.isEmpty {
                    Text("還沒有對話").font(.subheadline).foregroundStyle(.secondary).padding(.vertical, 20)
                        .frame(maxWidth: .infinity)
                }
                ForEach(Array(convs)) { c in
                    Button {
                        app.focusedConversation = c.id
                        app.section = .conversations
                    } label: {
                        HStack(alignment: .top, spacing: 8) {
                            AvatarView(name: c.displayName, url: c.pictureURL, size: 26)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text(c.displayName).font(.callout.weight(.semibold))
                                    if c.mode == .human { Tag(text: "轉人工", color: .orange) }
                                    if let src = c.lastMessage?.source, src != .owner, c.mode == .ai {
                                        Tag(text: src.label, color: .secondary)
                                    }
                                }
                                Text(c.lastMessage?.text ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                            Text(c.lastMessage?.date.shortDisplay ?? "").font(.caption2).foregroundStyle(.tertiary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: 系統日誌

    private var logCard: some View {
        let entries = app.logs.filter { !warningsOnly || $0.level != .info }.prefix(14)
        return Card(padding: 14) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    IconBadge(systemName: "doc.text.fill", color: .gray, size: 22)
                    Text("系統日誌").font(.headline)
                    Spacer()
                    Toggle("只看警告", isOn: $warningsOnly)
                        .toggleStyle(.switch).controlSize(.mini).font(.caption)
                }
                ForEach(Array(entries)) { e in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        StatusDot(color: e.level == .info ? .green : e.level == .warning ? .orange : .red)
                            .scaleEffect(0.7)
                        Text(e.date.timeDisplay).font(.caption2.monospacedDigit()).foregroundStyle(.tertiary)
                        Text(e.message).font(.caption2).lineLimit(2).textSelection(.enabled)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}
