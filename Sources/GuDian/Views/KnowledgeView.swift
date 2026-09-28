import SwiftUI
import UniformTypeIdentifiers

struct KnowledgeView: View {
    @Environment(AppState.self) private var app
    @State private var tab = 0
    @State private var editingFAQ: FAQItem?
    @State private var editingDoc: KnowledgeDoc?
    @State private var importing = false

    var body: some View {
        let d = app.selectedData
        Page(section: .knowledge, subtitle: "常見問題直接回標準答案，其他問題 AI 依這裡的資料回答，沒資料就老實說沒有") {
            Picker("", selection: $tab) {
                Text("常見問題 \(d.faqs.count)").tag(0)
                Text("文件資料 \(d.docs.count)").tag(1)
                Text("待補清單 \(d.pending.count)").tag(2)
                Text("試答").tag(3)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            switch tab {
            case 0: faqList(d)
            case 1: docList(d)
            case 2: pendingList(d)
            default: TryAnswerView()
            }
        }
        .sheet(item: $editingFAQ) { faq in
            FAQEditor(faq: faq) { saved in
                app.updateSelected { d in
                    if let i = d.faqs.firstIndex(where: { $0.id == saved.id }) { d.faqs[i] = saved } else { d.faqs.insert(saved, at: 0) }
                    // 從待補清單補成 FAQ 的，順手移除
                    d.pending.removeAll { KnowledgeRetriever.core($0.question) == KnowledgeRetriever.core(saved.question) }
                }
            }
        }
        .sheet(item: $editingDoc) { doc in
            DocEditor(doc: doc) { saved in
                app.updateSelected { d in
                    if let i = d.docs.firstIndex(where: { $0.id == saved.id }) { d.docs[i] = saved } else { d.docs.insert(saved, at: 0) }
                }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.plainText, .commaSeparatedText, .text], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            importFiles(urls)
        }
    }

    // MARK: FAQ

    @ViewBuilder
    private func faqList(_ d: AccountData) -> some View {
        HStack {
            Text("顧客問題跟這裡的問題或關鍵字相符，就直接回標準答案，不經過 AI。").font(.caption).foregroundStyle(.secondary)
            Spacer()
            Button { importing = true } label: { Label("匯入 CSV", systemImage: "square.and.arrow.down") }
            Button { editingFAQ = FAQItem(question: "", answer: "") } label: { Label("新增", systemImage: "plus") }
                .buttonStyle(.borderedProminent)
        }
        if d.faqs.isEmpty {
            Card { EmptyStateView(icon: "list.bullet.rectangle", title: "還沒有常見問題", message: "新增營業時間、價格、地址等最常被問的問題") }
        }
        ForEach(d.faqs) { faq in
            Card(padding: 12) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(faq.question).font(.headline)
                            if !faq.isEnabled { Tag(text: "停用", color: .gray) }
                            if faq.hitCount > 0 { Tag(text: "命中 \(faq.hitCount)", color: .teal) }
                        }
                        Text(faq.answer).font(.callout).foregroundStyle(.secondary).lineLimit(3)
                        if !faq.keywords.isEmpty {
                            Text("關鍵字：" + faq.keywords.joined(separator: "、")).font(.caption).foregroundStyle(.tertiary)
                        }
                    }
                    Spacer()
                    Button("編輯") { editingFAQ = faq }
                    Button(role: .destructive) {
                        app.updateSelected { $0.faqs.removeAll { $0.id == faq.id } }
                    } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless)
                }
            }
        }
    }

    // MARK: 文件

    @ViewBuilder
    private func docList(_ d: AccountData) -> some View {
        HStack {
            Text("菜單、價目表、服務說明、注意事項…貼進來，AI 會挑相關段落來回答。").font(.caption).foregroundStyle(.secondary)
            Spacer()
            Button { importing = true } label: { Label("匯入文字檔", systemImage: "square.and.arrow.down") }
            Button { editingDoc = KnowledgeDoc(title: "", content: "") } label: { Label("新增", systemImage: "plus") }
                .buttonStyle(.borderedProminent)
        }
        if d.docs.isEmpty {
            Card { EmptyStateView(icon: "doc.text", title: "還沒有文件", message: "把菜單、價目表或服務說明貼進來") }
        }
        ForEach(d.docs) { doc in
            Card(padding: 12) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(doc.title.isEmpty ? "未命名" : doc.title).font(.headline)
                        Text(doc.content).font(.callout).foregroundStyle(.secondary).lineLimit(3)
                        Text("\(doc.content.count) 字・更新於 \(doc.updatedAt.shortDisplay)").font(.caption).foregroundStyle(.tertiary)
                    }
                    Spacer()
                    Button("編輯") { editingDoc = doc }
                    Button(role: .destructive) {
                        app.updateSelected { $0.docs.removeAll { $0.id == doc.id } }
                    } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless)
                }
            }
        }
    }

    // MARK: 待補清單

    @ViewBuilder
    private func pendingList(_ d: AccountData) -> some View {
        Text("AI 答不出來的問題會自動整理在這裡，一鍵補成 FAQ，越用越準。").font(.caption).foregroundStyle(.secondary)
        if d.pending.isEmpty {
            Card { EmptyStateView(icon: "checkmark.seal", title: "沒有待補問題 🎉", message: "目前的知識庫都答得出來") }
        }
        ForEach(d.pending.sorted { $0.count > $1.count }) { p in
            Card(padding: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(p.question).font(.callout.weight(.medium))
                        Text("被問 \(p.count) 次・最近 \(p.lastAskedAt.shortDisplay)" + (p.askedBy.isEmpty ? "" : "・\(p.askedBy)"))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("忽略") {
                        app.updateSelected { $0.pending.removeAll { $0.id == p.id } }
                    }
                    Button {
                        editingFAQ = FAQItem(question: p.question, answer: "")
                    } label: {
                        Label("補成 FAQ", systemImage: "plus.bubble")
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        }
    }

    // MARK: 匯入

    /// CSV：問題,答案[,關鍵字1;關鍵字2]；其他文字檔當作文件
    private func importFiles(_ urls: [URL]) {
        for url in urls {
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
            if url.pathExtension.lowercased() == "csv" {
                let faqs = text.components(separatedBy: .newlines).compactMap { line -> FAQItem? in
                    let cols = line.components(separatedBy: ",")
                    guard cols.count >= 2 else { return nil }
                    let q = cols[0].trimmingCharacters(in: CharacterSet(charactersIn: " \""))
                    let a = cols[1].trimmingCharacters(in: CharacterSet(charactersIn: " \""))
                    guard !q.isEmpty, !a.isEmpty, q != "問題" else { return nil }
                    let k = cols.count > 2 ? cols[2].split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) } : []
                    return FAQItem(question: q, answer: a, keywords: k)
                }
                app.updateSelected { $0.faqs.append(contentsOf: faqs) }
                app.log(.info, "匯入 \(faqs.count) 筆 FAQ")
            } else {
                let doc = KnowledgeDoc(title: url.deletingPathExtension().lastPathComponent, content: text)
                app.updateSelected { $0.docs.insert(doc, at: 0) }
                app.log(.info, "匯入文件：\(doc.title)")
            }
        }
    }
}

// MARK: - 編輯器

struct FAQEditor: View {
    @State var faq: FAQItem
    var onSave: (FAQItem) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(faq.answer.isEmpty && faq.question.isEmpty ? "新增常見問題" : "編輯常見問題").font(.title3.bold())
            Form {
                TextField("問題", text: $faq.question)
                KeywordField(title: "關鍵字", keywords: $faq.keywords)
                Toggle("啟用", isOn: $faq.isEnabled)
            }
            Text("標準答案").font(.caption).foregroundStyle(.secondary)
            TextEditor(text: $faq.answer)
                .font(.body)
                .frame(minHeight: 140)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.3)))
            HStack {
                Spacer()
                Button("取消") { dismiss() }
                Button("儲存") {
                    faq.updatedAt = Date()
                    onSave(faq)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(faq.question.isEmpty || faq.answer.isEmpty)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 520)
    }
}

struct DocEditor: View {
    @State var doc: KnowledgeDoc
    var onSave: (KnowledgeDoc) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("文件資料").font(.title3.bold())
            TextField("標題（例如：菜單、價目表）", text: $doc.title)
            TextEditor(text: $doc.content)
                .font(.body)
                .frame(minHeight: 320)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.3)))
            HStack {
                Text("\(doc.content.count) 字").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("取消") { dismiss() }
                Button("儲存") {
                    doc.updatedAt = Date()
                    onSave(doc)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(doc.content.isEmpty)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 620)
    }
}

/// 不用真的傳 LINE，直接測試顧客問這句 AI 會怎麼回
struct TryAnswerView: View {
    @Environment(AppState.self) private var app
    @State private var question = ""
    @State private var result: BotReply?
    @State private var running = false

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 10) {
                Text("模擬顧客提問").font(.headline)
                HStack {
                    TextField("例如：請問你們的營業時間？", text: $question)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit(run)
                    Button(running ? "思考中…" : "試答", action: run)
                        .buttonStyle(.borderedProminent)
                        .disabled(question.isEmpty || running)
                }
                if let result {
                    HStack(alignment: .top) {
                        Tag(text: result.source.label, color: .purple)
                        if let l = result.latency { Text(String(format: "%.1fs", l)).font(.caption).foregroundStyle(.secondary) }
                    }
                    Text(result.text)
                        .textSelection(.enabled)
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 14).fill(Color.bubbleGreen.opacity(0.6)))
                }
            }
        }
    }

    private func run() {
        guard !question.isEmpty, let id = app.selectedAccount?.id else { return }
        running = true
        Task {
            result = await app.preview(question, accountId: id)
            running = false
        }
    }
}
