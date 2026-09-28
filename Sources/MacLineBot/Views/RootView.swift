import SwiftUI

struct RootView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        @Bindable var app = app
        NavigationSplitView {
            Sidebar()
                .navigationSplitViewColumnWidth(min: 210, ideal: 230, max: 280)
        } detail: {
            detail
                .navigationTitle("")
        }
        .sheet(isPresented: $app.showSetupWizard) {
            SetupWizardView()
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch app.section {
        case .overview: OverviewView()
        case .conversations: ConversationsView()
        case .reservations: ReservationsView()
        case .usage: UsageView()
        case .knowledge: KnowledgeView()
        case .store: StoreInfoView()
        case .rules: RulesView()
        case .line: LineConnectionView()
        case .accounts: AccountsView()
        case .system: SystemView()
        }
    }
}

struct Sidebar: View {
    @Environment(AppState.self) private var app

    var body: some View {
        @Bindable var app = app
        VStack(spacing: 0) {
            AccountSwitcher()
                .padding(.horizontal, 10)
                .padding(.top, 8)
                .padding(.bottom, 6)

            List(selection: Binding<SidebarSection?>(get: { app.section }, set: { if let s = $0 { app.section = s } })) {
                ForEach(SidebarSection.groups) { group in
                    Section(group.title) {
                        ForEach(group.items) { s in
                            Label {
                                HStack {
                                    Text(s.title)
                                    Spacer()
                                    if let badge = badge(for: s), badge > 0 {
                                        Text("\(badge)")
                                            .font(.caption2.bold())
                                            .padding(.horizontal, 6).padding(.vertical, 1)
                                            .background(Capsule().fill(Color.red))
                                            .foregroundStyle(.white)
                                    }
                                }
                            } icon: {
                                IconBadge(systemName: s.icon, color: .named(s.tint), size: 20)
                            }
                            .tag(s)
                        }
                    }
                }
            }
            .listStyle(.sidebar)

            ServiceStatusFooter()
                .padding(10)
        }
    }

    private func badge(for s: SidebarSection) -> Int? {
        let d = app.selectedData
        switch s {
        case .conversations: return d.conversations.values.filter { $0.mode == .human }.count
        case .reservations: return d.reservations.filter { $0.status == .pending }.count
        case .knowledge: return d.pending.count
        default: return nil
        }
    }
}

struct AccountSwitcher: View {
    @Environment(AppState.self) private var app

    var body: some View {
        Menu {
            ForEach(app.accounts) { a in
                Button {
                    app.settings.selectedAccountId = a.id
                } label: {
                    if a.id == app.selectedAccount?.id {
                        Label(a.displayName, systemImage: "checkmark")
                    } else {
                        Text(a.displayName)
                    }
                }
            }
            Divider()
            Button("管理帳號…") { app.section = .accounts }
            Button("新增官方帳號…") { app.showSetupWizard = true }
        } label: {
            HStack(spacing: 8) {
                Text(app.selectedAccount?.initial ?? "A")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(RoundedRectangle(cornerRadius: 7).fill(Color.blue.gradient))
                VStack(alignment: .leading, spacing: 0) {
                    Text(app.selectedAccount?.displayName ?? "尚未設定帳號")
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(1)
                    HStack(spacing: 4) {
                        StatusDot(color: app.tunnel.state == .running ? .green : .orange)
                            .scaleEffect(0.7)
                        Text(app.selectedAccount?.basicId.isEmpty == false ? app.selectedAccount!.basicId : "未連線")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Image(systemName: "chevron.up.chevron.down").font(.caption2).foregroundStyle(.secondary)
            }
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.05)))
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
    }
}

/// 側邊欄底部：Mac-Line-Bot 正常運作 / AI 自動回覆 開關
struct ServiceStatusFooter: View {
    @Environment(AppState.self) private var app

    var body: some View {
        @Bindable var app = app
        let health = app.health
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                IconBadge(systemName: "storefront.fill", color: .lineGreen, size: 26)
                VStack(alignment: .leading, spacing: 0) {
                    Text("Mac-Line-Bot").font(.system(size: 12, weight: .semibold))
                    HStack(spacing: 4) {
                        StatusDot(color: health.level == .ok ? .green : health.level == .warning ? .orange : .red)
                            .scaleEffect(0.7)
                        Text(health.level == .ok ? "正常運作" : health.title)
                            .font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
            Toggle(isOn: $app.settings.aiAutoReply) {
                Text("AI 自動回覆").font(.system(size: 11))
            }
            .toggleStyle(.switch)
            .controlSize(.mini)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.05)))
    }
}
