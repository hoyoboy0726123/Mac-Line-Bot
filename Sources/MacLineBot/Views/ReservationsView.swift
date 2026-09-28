import SwiftUI

struct ReservationsView: View {
    @Environment(AppState.self) private var app
    @State private var filter: ReservationStatus? = .pending
    @State private var busy: UUID?

    private var items: [Reservation] {
        app.selectedData.reservations.filter { filter == nil || $0.status == filter }
    }

    var body: some View {
        Page(section: .reservations, subtitle: "AI 收好的預約單，按一下接受或婉拒，顧客馬上收到確認") {
            HStack {
                Picker("", selection: $filter) {
                    Text("待確認").tag(ReservationStatus?.some(.pending))
                    Text("已接受").tag(ReservationStatus?.some(.accepted))
                    Text("已婉拒").tag(ReservationStatus?.some(.declined))
                    Text("全部").tag(ReservationStatus?.none)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(maxWidth: 380)
                Spacer()
                Toggle("啟用預約收單", isOn: app.binding(\.rules.reservationEnabled))
                    .toggleStyle(.switch)
            }

            if items.isEmpty {
                Card { EmptyStateView(icon: "calendar.badge.clock", title: "沒有預約", message: "顧客說「我想預約」時，AI 會問完日期、時間、人數，整理成一筆放在這裡") }
            }
            ForEach(items) { r in
                Card(padding: 14) {
                    HStack(alignment: .top, spacing: 14) {
                        VStack(spacing: 2) {
                            Text(r.date).font(.headline)
                            Text(r.time).font(.title3.bold()).monospacedDigit()
                        }
                        .frame(width: 110)
                        .padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.red.opacity(0.08)))

                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 6) {
                                Text(r.customerName).font(.headline)
                                Tag(text: r.status.label, color: color(r.status))
                                Text("#\(r.code)").font(.caption).foregroundStyle(.tertiary)
                            }
                            Text("👥 \(r.people) 位" + (r.contactName.isEmpty ? "" : "・🙋 \(r.contactName)") + (r.phone.isEmpty ? "" : "・📞 \(r.phone)"))
                                .font(.callout)
                            Text("建立於 \(r.createdAt.shortDisplay)" + (r.decidedAt.map { "・處理於 \($0.shortDisplay)" } ?? ""))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if r.status == .pending {
                            HStack {
                                Button("婉拒") { decide(r, accept: false) }
                                Button("接受") { decide(r, accept: true) }
                                    .buttonStyle(.borderedProminent)
                                    .tint(.green)
                            }
                            .disabled(busy == r.id)
                        } else {
                            Button {
                                app.focusedConversation = r.userId
                                app.section = .conversations
                            } label: {
                                Image(systemName: "bubble.left")
                            }
                            .help("查看對話")
                        }
                    }
                }
                .contextMenu {
                    Button("標記為已取消") {
                        app.updateSelected { d in
                            if let i = d.reservations.firstIndex(where: { $0.id == r.id }) { d.reservations[i].status = .cancelled }
                        }
                    }
                    Button("刪除", role: .destructive) {
                        app.updateSelected { $0.reservations.removeAll { $0.id == r.id } }
                    }
                }
            }
        }
    }

    private func color(_ s: ReservationStatus) -> Color {
        switch s {
        case .pending: .orange
        case .accepted: .green
        case .declined: .red
        case .cancelled: .gray
        }
    }

    private func decide(_ r: Reservation, accept: Bool) {
        guard let id = app.selectedAccount?.id else { return }
        busy = r.id
        Task {
            await app.decideReservation(id, reservationId: r.id, accept: accept)
            busy = nil
        }
    }
}
