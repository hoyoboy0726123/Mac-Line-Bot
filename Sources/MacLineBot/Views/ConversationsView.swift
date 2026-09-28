import SwiftUI

struct ConversationsView: View {
    @Environment(AppState.self) private var app
    @State private var search = ""
    @State private var filter = 0 // 0 全部 1 等待真人

    private var conversations: [Conversation] {
        app.selectedData.conversations.values
            .filter { filter == 0 || $0.mode == .human }
            .filter { search.isEmpty || $0.displayName.localizedCaseInsensitiveContains(search) || $0.messages.contains { $0.text.localizedCaseInsensitiveContains(search) } }
            .sorted { ($0.lastMessage?.date ?? .distantPast) > ($1.lastMessage?.date ?? .distantPast) }
    }

    var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                VStack(spacing: 8) {
                    PageHeader(section: .conversations, subtitle: "顧客對話與真人接手")
                    Picker("", selection: $filter) {
                        Text("全部").tag(0)
                        Text("等待真人").tag(1)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    TextField("搜尋顧客或訊息", text: $search)
                        .textFieldStyle(.roundedBorder)
                }
                .padding(14)
                List(selection: Binding(get: { app.focusedConversation }, set: { app.focusedConversation = $0 })) {
                    ForEach(conversations) { c in
                        ConversationRow(conversation: c).tag(c.id)
                    }
                }
                .listStyle(.inset)
                .overlay {
                    if conversations.isEmpty {
                        EmptyStateView(icon: "bubble.left.and.bubble.right", title: "還沒有對話", message: "顧客傳訊息給官方帳號後會出現在這裡")
                    }
                }
            }
            .frame(minWidth: 260, idealWidth: 300, maxWidth: 380)

            if let id = app.focusedConversation, let conv = app.selectedData.conversations[id] {
                ChatView(conversation: conv)
                    .frame(minWidth: 380)
            } else {
                EmptyStateView(icon: "text.bubble", title: "選一個對話", message: "可以直接在這裡回覆顧客，回覆後 AI 會自動閃開")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}

struct ConversationRow: View {
    var conversation: Conversation

    var body: some View {
        HStack(spacing: 10) {
            AvatarView(name: conversation.displayName, url: conversation.pictureURL, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(conversation.displayName).font(.callout.weight(.semibold)).lineLimit(1)
                    if conversation.mode == .human { Tag(text: "轉人工", color: .orange) }
                    if conversation.reservationDraft != nil { Tag(text: "預約中", color: .red) }
                    Spacer()
                    Text(conversation.lastMessage?.date.shortDisplay ?? "").font(.caption2).foregroundStyle(.tertiary)
                }
                HStack {
                    Text(conversation.lastMessage?.text ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                    if conversation.unread > 0 {
                        Text("\(conversation.unread)").font(.caption2.bold()).foregroundStyle(.white)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(Capsule().fill(Color.lineGreen))
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// LINE 風格的聊天視窗
struct ChatView: View {
    @Environment(AppState.self) private var app
    var conversation: Conversation
    @State private var draft = ""
    @State private var sending = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(Array(conversation.messages.enumerated()), id: \.element.id) { index, m in
                            if index == 0 || !Calendar.current.isDate(m.date, inSameDayAs: conversation.messages[index - 1].date) {
                                Text(dayLabel(m.date)).font(.caption2).foregroundStyle(.secondary)
                                    .padding(.horizontal, 10).padding(.vertical, 3)
                                    .background(Capsule().fill(Color.black.opacity(0.06)))
                            }
                            MessageBubble(message: m, name: conversation.displayName, pictureURL: conversation.pictureURL)
                                .id(m.id)
                        }
                    }
                    .padding(16)
                }
                .background(Color(red: 0.55, green: 0.64, blue: 0.75).opacity(0.18))
                .onAppear { scrollToEnd(proxy) }
                .onChange(of: conversation.messages.count) { _, _ in scrollToEnd(proxy) }
            }
            Divider()
            HStack(spacing: 8) {
                TextField("輸入訊息（以店家身分傳送）", text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...5)
                    .onSubmit(send)
                Button(action: send) {
                    Image(systemName: "paperplane.fill")
                }
                .buttonStyle(.borderedProminent)
                .tint(.lineGreen)
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || sending)
            }
            .padding(12)
        }
        .onAppear(perform: markRead)
        .onChange(of: conversation.id) { _, _ in markRead() }
    }

    private var header: some View {
        HStack(spacing: 10) {
            AvatarView(name: conversation.displayName, url: conversation.pictureURL, size: 34)
            VStack(alignment: .leading, spacing: 1) {
                Text(conversation.displayName).font(.headline)
                Text(conversation.mode == .human ? "真人接手中・代碼 #\(conversation.handoffCode)" : "AI 自動回覆中")
                    .font(.caption).foregroundStyle(conversation.mode == .human ? Color.orange : Color.secondary)
            }
            Spacer()
            if conversation.mode == .human {
                Button {
                    guard let id = app.selectedAccount?.id else { return }
                    app.resumeAI(id, userId: conversation.id, reason: "店家在 App 交還")
                } label: {
                    Label("交還 AI", systemImage: "sparkles")
                }
            } else {
                Button {
                    guard let id = app.selectedAccount?.id else { return }
                    app.update(id) { d in
                        d.conversations[conversation.id]?.mode = .human
                        d.conversations[conversation.id]?.humanSince = Date()
                        d.conversations[conversation.id]?.lastOwnerReplyAt = Date()
                    }
                } label: {
                    Label("我來接手", systemImage: "person.fill")
                }
            }
        }
        .padding(12)
    }

    private func dayLabel(_ d: Date) -> String {
        if Calendar.current.isDateInToday(d) { return "今天" }
        if Calendar.current.isDateInYesterday(d) { return "昨天" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "zh_Hant_TW")
        f.dateFormat = "M/d（EEE）"
        return f.string(from: d)
    }

    private func scrollToEnd(_ proxy: ScrollViewProxy) {
        if let last = conversation.messages.last { proxy.scrollTo(last.id, anchor: .bottom) }
    }

    private func markRead() {
        guard let id = app.selectedAccount?.id, conversation.unread > 0 else { return }
        app.update(id) { $0.conversations[conversation.id]?.unread = 0 }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let id = app.selectedAccount?.id else { return }
        sending = true
        Task {
            if await app.sendOwnerMessage(id, userId: conversation.id, text: text) { draft = "" }
            sending = false
        }
    }
}

struct MessageBubble: View {
    var message: ChatMessage
    var name: String
    var pictureURL: String?

    var body: some View {
        switch message.role {
        case .system:
            Text(message.text).font(.caption2).foregroundStyle(.secondary)
                .padding(.horizontal, 10).padding(.vertical, 3)
                .background(Capsule().fill(Color.black.opacity(0.06)))
        case .customer:
            HStack(alignment: .top, spacing: 8) {
                AvatarView(name: name, url: pictureURL, size: 30)
                bubble(color: Color.cardBackground, textColor: .primary)
                meta(alignment: .leading)
                Spacer(minLength: 60)
            }
        case .bot, .owner:
            HStack(alignment: .bottom, spacing: 6) {
                Spacer(minLength: 60)
                meta(alignment: .trailing)
                bubble(color: .bubbleGreen, textColor: .black)
            }
        }
    }

    private func bubble(color: Color, textColor: Color) -> some View {
        Text(message.text)
            .font(.callout)
            .foregroundStyle(textColor)
            .textSelection(.enabled)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(color))
    }

    private func meta(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            Spacer(minLength: 0)
            if let source = message.source, message.role != .customer {
                Text(source.label + (message.latency.map { String(format: " %.1fs", $0) } ?? ""))
                    .font(.system(size: 9)).foregroundStyle(.secondary)
            }
            Text(message.date.shortDisplay).font(.system(size: 9)).foregroundStyle(.secondary)
        }
        .fixedSize()
    }
}
