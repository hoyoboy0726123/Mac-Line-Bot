import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // 用 swift run 直接執行時也要有 Dock 圖示與選單
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        Task { @MainActor in AppState.shared.start() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // 關掉視窗也要繼續顧店，從選單列圖示再打開
        false
    }

    func applicationWillTerminate(_ notification: Notification) {
        MainActor.assumeIsolated { AppState.shared.shutdown() }
    }
}

@main
struct GuDianApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var app = AppState.shared

    var body: some Scene {
        Window("顧店", id: "main") {
            RootView()
                .environment(app)
                .environment(\.locale, Locale(identifier: "zh_Hant_TW"))
                .frame(minWidth: 980, minHeight: 640)
        }
        .defaultSize(width: 1180, height: 760)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("顧店") {
                Button("重啟 Tunnel") { app.startTunnel() }
                    .keyboardShortcut("r", modifiers: [.command, .shift])
                Button(app.settings.aiAutoReply ? "暫停 AI 自動回覆" : "開啟 AI 自動回覆") {
                    app.settings.aiAutoReply.toggle()
                }
                Divider()
                Button("設定精靈…") { app.showSetupWizard = true }
            }
        }

        MenuBarExtra {
            MenuBarContent()
                .environment(app)
        } label: {
            Image(systemName: app.health.level == .ok ? "storefront.fill" : "storefront")
        }
        .menuBarExtraStyle(.window)
    }
}

struct MenuBarContent: View {
    @Environment(AppState.self) private var app
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        @Bindable var app = app
        let health = app.health
        let s = app.selectedData.today
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                IconBadge(systemName: "storefront.fill", color: .lineGreen, size: 26)
                VStack(alignment: .leading, spacing: 0) {
                    Text("顧店").font(.headline)
                    HStack(spacing: 4) {
                        StatusDot(color: health.level == .ok ? .green : health.level == .warning ? .orange : .red)
                        Text(health.title).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Divider()
            Text("今日：收到 \(s.received)・回覆 \(s.replied)・轉人工 \(s.handoff)").font(.caption)
            let waiting = app.selectedData.conversations.values.filter { $0.mode == .human }.count
            if waiting > 0 {
                Text("🙋 \(waiting) 位顧客等待真人回覆").font(.caption).foregroundStyle(.orange)
            }
            Toggle("AI 自動回覆", isOn: $app.settings.aiAutoReply)
                .toggleStyle(.switch)
                .controlSize(.small)
            Divider()
            HStack {
                Button("打開顧店") {
                    openWindow(id: "main")
                    NSApp.activate(ignoringOtherApps: true)
                }
                Spacer()
                Button("結束") { NSApp.terminate(nil) }
            }
        }
        .padding(14)
        .frame(width: 260)
    }
}
