import SwiftUI
import UniformTypeIdentifiers

/// 軍規機種管理：看目前有哪些機種、各通過哪些測試，新增／編輯後一鍵產生 FAQ 與背景知識
struct MILModelsView: View {
    @Environment(AppState.self) private var app
    @State private var editing: MILModel?
    @State private var importingPDF = false
    @State private var showURLImport = false
    @State private var generating = false
    @State private var result: String?
    @State private var errorText: String?
    @State private var editingFamilies = false

    var body: some View {
        let catalog = app.milCatalog
        Page(section: .milModels, subtitle: "華碩商用筆電 MIL-STD-810H 機種與測試項目，改完按「產生」就會更新 FAQ 與背景知識", maxWidth: 1180) {
            toolbar(catalog)
            if let errorText { Text(errorText).font(.callout).foregroundStyle(.red) }
            matrix(catalog)
            legend
            familiesCard(catalog)
        }
        .sheet(item: $editing) { model in
            MILModelEditor(model: model, families: catalog.families.map(\.name),
                           isNew: !catalog.models.contains { $0.id == model.id }) { saved in
                app.updateMILCatalog { c in
                    if let i = c.models.firstIndex(where: { $0.id == saved.id }) { c.models[i] = saved } else { c.models.append(saved) }
                    if !saved.family.isEmpty, !c.families.contains(where: { $0.name == saved.family }) {
                        c.families.append(MILFamily(name: saved.family, aliases: [saved.family]))
                    }
                }
            } onDelete: { removed in
                app.updateMILCatalog { $0.models.removeAll { $0.id == removed.id } }
            }
        }
        .sheet(isPresented: $showURLImport) {
            MILURLImportSheet { url in Task { await importReport(url) } }
        }
        .fileImporter(isPresented: $importingPDF, allowedContentTypes: [.pdf], allowsMultipleSelection: false) { r in
            if case .success(let urls) = r, let url = urls.first { Task { await importReport(url) } }
        }
    }

    // MARK: 上方工具列

    private func toolbar(_ c: MILCatalog) -> some View {
        Card(padding: 14) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("共 \(c.models.count) 款機種").font(.headline)
                    if app.milNeedsRegenerate {
                        Label("機種資料有變更，按「產生知識庫」才會更新到客服回答", systemImage: "exclamationmark.circle.fill")
                            .font(.caption).foregroundStyle(.orange)
                    } else if let t = c.lastGenerated {
                        Label("知識庫已是最新（\(t.shortDisplay) 產生）", systemImage: "checkmark.circle.fill")
                            .font(.caption).foregroundStyle(.green)
                    }
                    if let result { Text(result).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                Menu {
                    Button("手動新增") { editing = newModel() }
                    Button("從報告 PDF 檔新增…") { importingPDF = true }
                    Button("從報告網址新增…") { showURLImport = true }
                } label: {
                    Label("新增機種", systemImage: "plus")
                }
                .fixedSize()
                Button {
                    generating = true
                    Task {
                        if let r = await app.generateMILKnowledge() {
                            result = "已產生 \(r.faqs) 題 FAQ（取代舊的 \(r.removed) 題）、背景知識 \(r.paragraphs) 段，向量索引已更新"
                        }
                        generating = false
                    }
                } label: {
                    Label(generating ? "產生中…" : "產生知識庫", systemImage: "wand.and.stars")
                }
                .buttonStyle(.borderedProminent)
                .tint(app.milNeedsRegenerate ? .orange : .accentColor)
                .disabled(generating || c.models.isEmpty)
            }
        }
    }

    // MARK: 機種 × 測試項目矩陣

    private func matrix(_ c: MILCatalog) -> some View {
        Card(padding: 0) {
            ScrollView(.horizontal) {
                Grid(alignment: .center, horizontalSpacing: 0, verticalSpacing: 0) {
                    GridRow {
                        Text("機種").font(.caption.bold()).frame(width: 230, alignment: .leading).padding(.leading, 12)
                        ForEach(MILTests.all) { t in
                            VStack(spacing: 1) {
                                Text(t.short).font(.caption2.bold()).lineLimit(2).multilineTextAlignment(.center)
                                Text(t.code).font(.system(size: 9)).foregroundStyle(.secondary)
                            }
                            .frame(width: 58, height: 44)
                        }
                        Text("項目").font(.caption.bold()).frame(width: 44)
                    }
                    .background(Color.primary.opacity(0.04))
                    Divider().gridCellUnsizedAxes(.horizontal)
                    ForEach(c.models) { m in
                        GridRow {
                            Button { editing = m } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(m.code).font(.callout.weight(.semibold))
                                    Text(m.display).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                    if !m.family.isEmpty { Tag(text: m.family, color: .indigo) }
                                }
                                .frame(width: 230, alignment: .leading)
                                .padding(.leading, 12).padding(.vertical, 8)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .help("點一下編輯")
                            ForEach(MILTests.all) { t in
                                cell(m, t).frame(width: 58)
                            }
                            Text("\(m.passedTestCount)").font(.callout.monospacedDigit().bold()).frame(width: 44)
                        }
                        Divider().gridCellUnsizedAxes(.horizontal)
                    }
                }
                .padding(.bottom, 4)
            }
        }
        .overlay {
            if c.models.isEmpty {
                EmptyStateView(icon: "checkmark.shield", title: "還沒有機種", message: "按「新增機種」，可以直接匯入華碩官方測試報告 PDF")
            }
        }
    }

    @ViewBuilder
    private func cell(_ m: MILModel, _ t: MILTestDef) -> some View {
        let p = m.passes(t.id), d = m.described(t.id)
        if !p.isEmpty {
            VStack(spacing: 1) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                if t.procedures.count > 1 {
                    Text("\(p.count)/\(t.procedures.count)").font(.system(size: 9)).foregroundStyle(.secondary)
                }
            }
            .help(p.compactMap { t.procedure($0)?.label }.joined(separator: "\n"))
        } else if !d.isEmpty {
            Image(systemName: "doc.text").foregroundStyle(.orange)
                .help("只在測試說明中列出：" + d.compactMap { t.procedure($0)?.label }.joined(separator: "、"))
        } else {
            Text("—").foregroundStyle(.tertiary)
        }
    }

    private var legend: some View {
        HStack(spacing: 16) {
            Label("通過（數字＝通過的程序數）", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
            Label("只在測試說明中列出", systemImage: "doc.text").foregroundStyle(.orange)
            Label("報告中沒有", systemImage: "minus").foregroundStyle(.secondary)
            Spacer()
            Text("點機種名稱可以編輯").foregroundStyle(.secondary)
        }
        .font(.caption)
    }

    // MARK: 系列

    private func familiesCard(_ c: MILCatalog) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("系列").font(.headline)
                    Text("同一系列有好幾份報告時（例如 B1400／B1500 與 B1400CBA），顧客問「B1 有沒有…」會把各款結果一起列出")
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("新增系列") {
                        app.updateMILCatalog { $0.families.append(MILFamily(name: "新系列", aliases: [])) }
                    }
                }
                ForEach(c.families) { f in
                    HStack(spacing: 10) {
                        TextField("系列名稱", text: Binding(
                            get: { f.name },
                            set: { v in app.updateMILCatalog { c in
                                if let i = c.families.firstIndex(where: { $0.id == f.id }) {
                                    for j in c.models.indices where c.models[j].family == c.families[i].name { c.models[j].family = v }
                                    c.families[i].name = v
                                }
                            } }
                        ))
                        .frame(width: 180)
                        KeywordField(title: "顧客的叫法", keywords: Binding(
                            get: { f.aliases },
                            set: { v in app.updateMILCatalog { c in
                                if let i = c.families.firstIndex(where: { $0.id == f.id }) { c.families[i].aliases = v }
                            } }
                        ))
                        Text("\(c.models.filter { $0.family == f.name }.count) 款").font(.caption).foregroundStyle(.secondary)
                        Button(role: .destructive) {
                            app.updateMILCatalog { c in c.families.removeAll { $0.id == f.id } }
                        } label: { Image(systemName: "trash") }
                        .buttonStyle(.borderless)
                    }
                    .textFieldStyle(.roundedBorder)
                }
            }
        }
    }

    // MARK: 匯入報告

    private func newModel() -> MILModel {
        MILModel(code: "", display: "", aliases: [])
    }

    private func importReport(_ url: URL) async {
        errorText = nil
        do {
            let r = try await MILReportParser.load(from: url)
            let code = r.codeGuess ?? ""
            var m = MILModel(code: code, display: code.isEmpty ? "" : "ExpertBook（\(code)）", aliases: code.isEmpty ? [] : [code])
            m.passed = r.passed
            m.describedOnly = r.describedOnly
            if !url.isFileURL { m.reportURL = url.absoluteString }
            if r.passed.isEmpty { errorText = "這份 PDF 讀不到測試項目，請手動勾選" }
            editing = m
        } catch {
            errorText = "匯入失敗：\(error.localizedDescription)"
        }
    }
}

// MARK: - 編輯機種

struct MILModelEditor: View {
    @State var model: MILModel
    var families: [String]
    var isNew: Bool
    var onSave: (MILModel) -> Void
    var onDelete: (MILModel) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDelete = false

    enum State3: String, CaseIterable, Identifiable {
        case passed = "通過", described = "說明另列", none = "無"
        var id: String { rawValue }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(isNew ? "新增機種" : "編輯 \(model.code)").font(.title3.bold())
                Spacer()
                Text("通過 \(model.passedTestCount) 大類").font(.callout).foregroundStyle(.secondary)
            }
            .padding(20)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Form {
                        TextField("型號代碼", text: $model.code, prompt: Text("例如 B5302C"))
                        TextField("顯示名稱", text: $model.display, prompt: Text("例如 ExpertBook B5（B5302C）"))
                        KeywordField(title: "顧客的叫法", keywords: $model.aliases)
                        Text("例如 B5302C, B5302, ExpertBook B5, B5。留空代表只透過「系列」回答").font(.caption).foregroundStyle(.secondary)
                        HStack {
                            TextField("系列（可留空）", text: $model.family, prompt: Text("例如 ExpertBook B1"))
                            if !families.isEmpty {
                                Menu("選擇") {
                                    ForEach(families, id: \.self) { f in Button(f) { model.family = f } }
                                    Button("不屬於系列") { model.family = "" }
                                }
                                .fixedSize()
                            }
                        }
                        TextField("官方報告網址", text: $model.reportURL)
                    }
                    .formStyle(.grouped)

                    Text("通過的測試程序").font(.headline).padding(.horizontal, 4)
                    Text("「說明另列」＝只出現在報告的測試說明、結果總表沒有列；客服會照實說明").font(.caption).foregroundStyle(.secondary).padding(.horizontal, 4)
                    ForEach(MILTests.all) { t in
                        Card(padding: 12) {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text("\(t.code) \(t.short)").font(.callout.weight(.semibold))
                                    Spacer()
                                    Button("全部通過") { model.passed[t.id] = t.procedures.map(\.id); model.describedOnly[t.id] = nil }
                                        .buttonStyle(.borderless).font(.caption)
                                    Button("清除") { model.passed[t.id] = nil; model.describedOnly[t.id] = nil }
                                        .buttonStyle(.borderless).font(.caption)
                                }
                                ForEach(t.procedures) { p in
                                    HStack {
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(p.label).font(.callout)
                                            Text(p.detail).font(.caption).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Picker("", selection: binding(t.id, p.id)) {
                                            ForEach(State3.allCases) { Text($0.rawValue).tag($0) }
                                        }
                                        .pickerStyle(.segmented)
                                        .labelsHidden()
                                        .frame(width: 200)
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(20)
            }
            Divider()
            HStack {
                if !isNew {
                    Button("刪除機種", role: .destructive) { confirmDelete = true }
                }
                Spacer()
                Button("取消") { dismiss() }
                Button("儲存") {
                    model.code = model.code.trimmingCharacters(in: .whitespaces)
                    if model.display.isEmpty { model.display = model.code }
                    onSave(model)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(model.code.isEmpty)
            }
            .padding(16)
        }
        .frame(width: 720, height: 760)
        .confirmationDialog("確定刪除 \(model.code)？", isPresented: $confirmDelete) {
            Button("刪除", role: .destructive) { onDelete(model); dismiss() }
        } message: {
            Text("刪除後記得按「產生知識庫」，客服回答才會更新。")
        }
    }

    private func binding(_ test: String, _ proc: String) -> Binding<State3> {
        Binding(
            get: {
                if model.passes(test).contains(proc) { return .passed }
                if model.described(test).contains(proc) { return .described }
                return .none
            },
            set: { v in
                var p = model.passes(test).filter { $0 != proc }
                var d = model.described(test).filter { $0 != proc }
                if v == .passed { p.append(proc) }
                if v == .described { d.append(proc) }
                let order = MILTests.test(test)?.procedures.map(\.id) ?? []
                model.passed[test] = p.isEmpty ? nil : order.filter { p.contains($0) }
                model.describedOnly[test] = d.isEmpty ? nil : order.filter { d.contains($0) }
            }
        )
    }
}

struct MILURLImportSheet: View {
    var onImport: (URL) -> Void
    @State private var text = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("從報告網址新增").font(.title3.bold())
            Text("貼上華碩官方 MIL-STD-810H 測試報告 PDF 的網址，會自動讀出型號與通過的測試，存檔前可以再確認。")
                .font(.callout).foregroundStyle(.secondary)
            TextField("https://www.asus.com/event/militarygradereport/….pdf", text: $text)
                .textFieldStyle(.roundedBorder)
            HStack {
                Spacer()
                Button("取消") { dismiss() }
                Button("讀取報告") {
                    if let u = URL(string: text.trimmingCharacters(in: .whitespaces)) { onImport(u) }
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(URL(string: text.trimmingCharacters(in: .whitespaces))?.scheme?.hasPrefix("http") != true)
            }
        }
        .padding(20)
        .frame(width: 560)
    }
}
