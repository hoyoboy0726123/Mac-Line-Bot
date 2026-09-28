import Charts
import SwiftUI

struct UsageView: View {
    @Environment(AppState.self) private var app
    @State private var quota: (type: String, value: Int?)?
    @State private var consumption: Int?
    @State private var quotaError: String?

    private struct Point: Identifiable {
        var id: String { day + kind }
        var day: String
        var kind: String
        var value: Int
    }

    private var lastDays: [DailyStats] {
        let cal = Calendar.current
        return (0..<14).reversed().map { offset in
            let date = cal.date(byAdding: .day, value: -offset, to: Date()) ?? Date()
            let key = DailyStats.key(for: date)
            return app.selectedData.stats[key] ?? DailyStats(dateKey: key)
        }
    }

    var body: some View {
        let days = lastDays
        let points = days.flatMap { s -> [Point] in
            let label = String(s.dateKey.suffix(5)).replacingOccurrences(of: "-", with: "/")
            return [
                Point(day: label, kind: "FAQ", value: s.faq),
                Point(day: label, kind: "AI", value: s.ai),
                Point(day: label, kind: "轉人工", value: s.handoff),
            ]
        }
        let total = days.reduce(into: DailyStats(dateKey: "")) { t, s in
            t.received += s.received; t.replied += s.replied; t.faq += s.faq; t.ai += s.ai
            t.handoff += s.handoff; t.reservations += s.reservations; t.unanswered += s.unanswered
            t.aiMilliseconds += s.aiMilliseconds
        }

        Page(section: .usage, subtitle: "近 14 天的處理量，全部在本機運算，沒有 token 費用") {
            Grid(horizontalSpacing: 12, verticalSpacing: 12) {
                GridRow {
                    StatTile(icon: "tray.and.arrow.down.fill", color: .blue, value: "\(total.received)", label: "收到訊息")
                    StatTile(icon: "paperplane.fill", color: .green, value: "\(total.replied)", label: "已回覆")
                    StatTile(icon: "calendar", color: .red, value: "\(total.reservations)", label: "預約單")
                }
                GridRow {
                    StatTile(icon: "percent", color: .teal, value: automationRate(total), label: "自動處理率")
                    StatTile(icon: "timer", color: .purple, value: String(format: "%.1fs", total.avgAILatency), label: "AI 平均回覆時間")
                    StatTile(icon: "questionmark.bubble.fill", color: .orange, value: "\(total.unanswered)", label: "答不出來")
                }
            }

            Card {
                VStack(alignment: .leading, spacing: 10) {
                    Text("每日回覆來源").font(.headline)
                    Chart(points) { p in
                        BarMark(x: .value("日期", p.day), y: .value("則數", p.value))
                            .foregroundStyle(by: .value("來源", p.kind))
                    }
                    .chartForegroundStyleScale(["FAQ": Color.teal, "AI": Color.purple, "轉人工": Color.orange])
                    .frame(height: 220)
                }
            }

            Card {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("LINE 訊息額度").font(.headline)
                        Spacer()
                        Button("重新整理") { Task { await loadQuota() } }
                    }
                    Text("回覆（reply）不計費；推播通知、預約確認、真人回覆使用 push，會算進官方帳號的每月額度。")
                        .font(.caption).foregroundStyle(.secondary)
                    if let quotaError {
                        Text(quotaError).font(.caption).foregroundStyle(.red)
                    } else if let quota {
                        let limit = quota.value
                        let used = consumption ?? 0
                        HStack {
                            Text("本月已用 \(used) 則" + (limit.map { " / 上限 \($0) 則" } ?? "（無上限）"))
                            Spacer()
                        }
                        if let limit, limit > 0 {
                            ProgressView(value: Double(min(used, limit)), total: Double(limit))
                                .tint(Double(used) / Double(limit) > 0.8 ? .red : .green)
                        }
                    } else {
                        ProgressView().controlSize(.small)
                    }
                }
            }
        }
        .task(id: app.selectedAccount?.id) { await loadQuota() }
    }

    private func automationRate(_ s: DailyStats) -> String {
        let auto = s.faq + s.ai
        let all = auto + s.handoff + s.unanswered
        guard all > 0 else { return "—" }
        return "\(Int(Double(auto) / Double(all) * 100))%"
    }

    private func loadQuota() async {
        guard let a = app.selectedAccount, a.hasCredentials else {
            quotaError = "尚未設定 LINE 帳號"
            return
        }
        let api = LineAPI(token: a.channelAccessToken)
        do {
            quota = try await api.quota()
            consumption = try await api.consumption()
            quotaError = nil
        } catch {
            quotaError = error.localizedDescription
        }
    }
}
