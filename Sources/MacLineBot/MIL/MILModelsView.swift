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
    @State private var editingTest: MILTestDef?
    @State private var newTestDraft = false
    @State private var confirmReset = false
    @State private var importingExcel = false
    @State private var excel: ExcelImport?

    struct ExcelImport: Identifiable {
        let id = UUID()
        var result: MILScheduleImport.Result
        var file: String
    }

    var body: some View {
        let catalog = app.milCatalog
        Page(section: .milModels, subtitle: "華碩商用筆電 MIL-STD-810H 機種與測試項目，改完按「產生」就會更新 FAQ 與背景知識", maxWidth: 1180) {
            toolbar(catalog)
            if let errorText { Text(errorText).font(.callout).foregroundStyle(.red) }
            matrix(catalog)
            legend
            testsCard(catalog)
            familiesCard(catalog)
        }
        .sheet(item: $editingTest) { t in
            MILTestEditor(test: t, isNew: !catalog.allTests.contains { $0.id == t.id },
                          used: catalog.models.filter { !$0.passes(t.id).isEmpty || !$0.described(t.id).isEmpty }.count) { saved in
                app.updateMILCatalog { c in
                    c.editTests { list in
                        if let i = list.firstIndex(where: { $0.id == saved.id }) { list[i] = saved } else { list.append(saved) }
                    }
                }
            } onDelete: { removed in
                app.updateMILCatalog { c in c.editTests { $0.removeAll { $0.id == removed.id } } }
            }
        }
        .confirmationDialog("把測試項目還原成內建的 13 項？", isPresented: $confirmReset) {
            Button("還原（自己新增的項目會刪除）", role: .destructive) {
                app.updateMILCatalog { c in c.tests = nil; c.pruneModels() }
            }
        } message: {
            Text("機種上對應的勾選也會清掉，記得再按「產生知識庫」。")
        }
        .sheet(item: $editing) { model in
            MILModelEditor(model: model, tests: catalog.allTests, families: catalog.families.map(\.name),
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
                    Divider()
                    Button("從測試排程表 Excel 匯入…") { importingExcel = true }
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
        // 跟 PDF 的檔案選擇分開掛（同一層掛兩個 fileImporter 只有一個會動）
        .fileImporter(isPresented: $importingExcel, allowedContentTypes: [UTType(filenameExtension: "xlsx") ?? .data], allowsMultipleSelection: false) { r in
            if case .success(let urls) = r, let url = urls.first { importExcel(url) }
        }
        .sheet(item: $excel) { x in
            MILExcelImportSheet(result: x.result, file: x.file, tests: c.allTests) { items in
                var counts = (added: 0, updated: 0)
                app.updateMILCatalog { counts = MILScheduleImport.apply(&$0, items) }
                if let id = app.selectedAccount?.id { app.accountLog(id, "從測試排程表 Excel 匯入：新增 \(counts.added) 款、更新 \(counts.updated) 款") }
                result = "已從 Excel 匯入：新增 \(counts.added) 款、更新 \(counts.updated) 款，按「產生知識庫」就會更新客服回答"
            }
        }
    }

    private func importExcel(_ url: URL) {
        errorText = nil
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
            let r = try MILScheduleImport.parse(try Data(contentsOf: url), catalog: app.milCatalog)
            if r.projects.isEmpty {
                errorText = "這份 Excel 沒有讀到任何專案：請確認是測試排程表格式（D 欄有「Project」與「Method …」）"
            } else {
                excel = ExcelImport(result: r, file: url.lastPathComponent)
            }
        } catch {
            errorText = "讀取 Excel 失敗：\(error.localizedDescription)"
        }
    }

    // MARK: 機種 × 測試項目矩陣

    private func matrix(_ c: MILCatalog) -> some View {
        Card(padding: 0) {
            ScrollView(.horizontal) {
                Grid(alignment: .center, horizontalSpacing: 0, verticalSpacing: 0) {
                    GridRow {
                        Text("機種").font(.caption.bold()).frame(width: 230, alignment: .leading).padding(.leading, 12)
                        ForEach(c.allTests) { t in
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
                            ForEach(c.allTests) { t in
                                cell(m, t).frame(width: 58)
                            }
                            Text("\(c.passedTestCount(m))").font(.callout.monospacedDigit().bold()).frame(width: 44)
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

    // MARK: 測試項目

    private func testsCard(_ c: MILCatalog) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("測試項目").font(.headline)
                    Text("表格的每一欄。可以新增報告裡的新測試，或修改條件文字與顧客的說法；改完按「產生知識庫」就會更新回答")
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    if c.tests != nil { Button("還原預設") { confirmReset = true } }
                    Button {
                        editingTest = MILTestDef(id: "custom-" + UUID().uuidString.prefix(8).lowercased(), code: "", name: "", short: "",
                                                 procedures: [MILProcedure(id: "I", label: "", detail: "")], aliases: [])
                    } label: { Label("新增測試項目", systemImage: "plus") }
                    .buttonStyle(.borderedProminent)
                }
                ForEach(Array(c.allTests.enumerated()), id: \.element.id) { i, t in
                    HStack(spacing: 10) {
                        Text(t.code).font(.caption.monospacedDigit()).frame(width: 52)
                            .padding(.vertical, 2).background(RoundedRectangle(cornerRadius: 5).fill(Color.primary.opacity(0.06)))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(t.short).font(.callout.weight(.semibold))
                            Text(t.procedures.map(\.label).joined(separator: "、")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer()
                        Text("\(c.models.filter { !$0.passes(t.id).isEmpty }.count) 款").font(.caption).foregroundStyle(.secondary)
                        Button { move(t, -1) } label: { Image(systemName: "arrow.up") }.buttonStyle(.borderless).disabled(i == 0)
                        Button { move(t, 1) } label: { Image(systemName: "arrow.down") }.buttonStyle(.borderless).disabled(i == c.allTests.count - 1)
                        Button("編輯") { editingTest = t }
                    }
                    Divider()
                }
            }
        }
    }

    private func move(_ t: MILTestDef, _ d: Int) {
        app.updateMILCatalog { c in
            c.editTests { list in
                guard let i = list.firstIndex(where: { $0.id == t.id }), list.indices.contains(i + d) else { return }
                list.swapAt(i, i + d)
            }
        }
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
            let r = try await MILReportParser.load(from: url, tests: app.milCatalog.allTests)
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
    var tests: [MILTestDef]
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
                Text("通過 \(tests.filter { !model.passes($0.id).isEmpty }.count) 大類").font(.callout).foregroundStyle(.secondary)
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
                    ForEach(tests) { t in
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
                let order = tests.first { $0.id == test }?.procedures.map(\.id) ?? []
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


// MARK: - 編輯測試項目

struct MILTestEditor: View {
    @State var test: MILTestDef
    var isNew: Bool
    var used: Int
    var onSave: (MILTestDef) -> Void
    var onDelete: (MILTestDef) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDelete = false
    @State private var autoName = false

    private var composed: String { test.short.isEmpty || test.code.isEmpty ? "" : "\(test.short)測試（Method \(test.code)）" }
    private var valid: Bool {
        let ids = test.procedures.map { $0.id.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return !test.short.trimmingCharacters(in: .whitespaces).isEmpty && !test.code.trimmingCharacters(in: .whitespaces).isEmpty
            && !ids.isEmpty && Set(ids).count == ids.count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(isNew ? "新增測試項目" : "編輯「\(test.short)」").font(.title3.bold()).padding(20)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Form {
                        TextField("簡稱", text: $test.short, prompt: Text("例如 淋雨（顧客看到的名稱）"))
                        TextField("Method 編號", text: $test.code, prompt: Text("例如 506.6（PDF 匯入時用這個編號自動勾選）"))
                        TextField("完整名稱", text: Binding(get: { test.name }, set: { test.name = $0; autoName = false }),
                                  prompt: Text("例如 淋雨測試（Method 506.6）"))
                        KeywordField(title: "顧客的說法", keywords: $test.aliases)
                        Text("例如 淋雨, 下雨, 防水。顧客的問題裡出現這些字，就會對到這個測試").font(.caption).foregroundStyle(.secondary)
                    }
                    .formStyle(.grouped)
                    HStack {
                        Text("測試程序與條件").font(.headline)
                        Spacer()
                        Button { addProc() } label: { Label("新增程序", systemImage: "plus") }
                    }
                    Text("程序代號對應報告裡的「Procedure I／II…」，PDF 匯入時會自動勾選。條件會原文出現在客服回答裡，數字請照報告填寫。")
                        .font(.caption).foregroundStyle(.secondary)
                    ForEach(test.procedures.indices, id: \.self) { i in
                        Card(padding: 10) {
                            VStack(spacing: 6) {
                                HStack {
                                    TextField("代號", text: $test.procedures[i].id).frame(width: 70)
                                    TextField("程序名稱，例如 降雨（程序 I）", text: $test.procedures[i].label)
                                    Button { test.procedures.swapAt(i, i - 1) } label: { Image(systemName: "arrow.up") }
                                        .buttonStyle(.borderless).disabled(i == 0)
                                    Button { test.procedures.swapAt(i, i + 1) } label: { Image(systemName: "arrow.down") }
                                        .buttonStyle(.borderless).disabled(i == test.procedures.count - 1)
                                    Button(role: .destructive) { test.procedures.remove(at: i) } label: { Image(systemName: "trash") }
                                        .buttonStyle(.borderless).disabled(test.procedures.count == 1)
                                }
                                TextField("條件，例如 降雨率 1.7 mm/min、風速 18 m/s，30 分鐘", text: $test.procedures[i].detail)
                            }
                            .textFieldStyle(.roundedBorder)
                        }
                    }
                }
                .padding(20)
            }
            Divider()
            HStack {
                if !isNew { Button("刪除測試項目", role: .destructive) { confirmDelete = true } }
                Spacer()
                Button("取消") { dismiss() }
                Button("儲存") {
                    var t = test
                    t.short = t.short.trimmingCharacters(in: .whitespaces)
                    t.code = t.code.trimmingCharacters(in: .whitespaces)
                    if t.name.trimmingCharacters(in: .whitespaces).isEmpty { t.name = "\(t.short)測試（Method \(t.code)）" }
                    t.procedures = t.procedures.compactMap { p in
                        let id = p.id.trimmingCharacters(in: .whitespaces)
                        guard !id.isEmpty else { return nil }
                        return MILProcedure(id: id, label: p.label.isEmpty ? "程序 \(id)" : p.label, detail: p.detail)
                    }
                    onSave(t)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(!valid)
            }
            .padding(16)
        }
        .frame(width: 720, height: 700)
        .onAppear { autoName = isNew }
        .onChange(of: test.short) { _, _ in if autoName { test.name = composed } }
        .onChange(of: test.code) { _, _ in if autoName { test.name = composed } }
        .confirmationDialog("刪除「\(test.short)」？", isPresented: $confirmDelete) {
            Button("刪除", role: .destructive) { onDelete(test); dismiss() }
        } message: {
            Text((used > 0 ? "有 \(used) 款機種勾選了這項，勾選紀錄會一起清掉。" : "") + "刪除後記得按「產生知識庫」。")
        }
    }

    private func addProc() {
        let romans = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]
        let next = romans.first { r in !test.procedures.contains { $0.id == r } } ?? "P\(test.procedures.count + 1)"
        test.procedures.append(MILProcedure(id: next, label: "", detail: ""))
    }
}

// MARK: - 測試排程表 Excel 識別結果

/// 勾選要匯入的專案，確認後才存（對照 Windows 版 mil.js 的 ExcelImport）
struct MILExcelImportSheet: View {
    @State var items: [MILScheduleImport.Project]
    let result: MILScheduleImport.Result
    let file: String
    let tests: [MILTestDef]
    let onApply: ([MILScheduleImport.Project]) -> Void
    @State private var filter = 0
    @Environment(\.dismiss) private var dismiss

    init(result: MILScheduleImport.Result, file: String, tests: [MILTestDef], onApply: @escaping ([MILScheduleImport.Project]) -> Void) {
        _items = State(initialValue: result.projects)
        self.result = result
        self.file = file
        self.tests = tests
        self.onApply = onApply
    }

    private func needsCare(_ p: MILScheduleImport.Project) -> Bool { !p.warnings.isEmpty || !p.unmapped.isEmpty }
    private var shown: [Int] {
        items.indices.filter { i in
            switch filter {
            case 1: return items[i].action != .same
            case 2: return needsCare(items[i])
            default: return true
            }
        }
    }
    private var chosen: [MILScheduleImport.Project] { items.filter(\.include) }
    private var sheetNote: String {
        result.sheets.map { $0.projects > 0 ? "\($0.name)：\($0.projects) 個專案" : "\($0.name)：\($0.note)" }.joined(separator: "；")
    }

    private func testsOf(_ p: MILScheduleImport.Project) -> String {
        let s = tests.filter { p.passed[$0.id] != nil }.map { t -> String in
            let n = p.passed[t.id]?.count ?? 0
            return t.short + (t.procedures.count > 1 && n < t.procedures.count ? " \(n)/\(t.procedures.count)" : "")
        }
        return s.isEmpty ? "沒有可對應的通過項目" : s.joined(separator: "、")
    }

    private func stat(_ n: Int, _ label: String, _ color: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("\(n)").font(.title2.bold()).foregroundStyle(color)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "tablecells").foregroundStyle(.green).font(.title3)
                Text("測試排程表識別結果").font(.title3.bold())
                Spacer()
                Text(file).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Text(sheetNote).font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 18) {
                stat(items.count, "個專案", .primary)
                stat(items.filter { $0.action == .new }.count, "新增", .green)
                stat(items.filter { $0.action == .update }.count, "更新（通過項目有變）", .orange)
                stat(items.filter { $0.action == .same }.count, "已是最新", .secondary)
                let care = items.filter(needsCare).count
                if care > 0 { stat(care, "需要留意", .red) }
            }
            if !result.unmapped.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Label("這些測試目前沒有對應的測試項目，不會匯入", systemImage: "exclamationmark.triangle.fill").font(.caption.bold()).foregroundStyle(.orange)
                    ForEach(result.unmapped, id: \.label) { u in
                        Text("・\(u.label)（\(u.code)）— \(u.projects) 個專案通過").font(.caption)
                    }
                    Text("可以先到「測試項目」新增同一個 Method 編號的項目，再重新上傳一次。").font(.caption2).foregroundStyle(.secondary)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            }
            HStack {
                Picker("", selection: $filter) {
                    Text("全部").tag(0)
                    Text("只看有變更").tag(1)
                    Text("只看需要留意").tag(2)
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
                Spacer()
                Toggle("全選", isOn: Binding(
                    get: { !shown.isEmpty && shown.allSatisfy { items[$0].include } },
                    set: { v in for i in shown { items[i].include = v } }
                ))
                .toggleStyle(.checkbox)
                Text("「通過」＝標示 1 的項目數／測試總數").font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: 10) {
                Color.clear.frame(width: 16, height: 1)
                Text("型號（專案）").frame(width: 260, alignment: .leading)
                Text("工作表").frame(width: 130, alignment: .leading)
                Text("系列").frame(width: 44)
                Text("類別").frame(width: 60)
                Text("通過").frame(width: 80)
                Text("結果").frame(width: 34)
                Text("提醒").frame(maxWidth: .infinity, alignment: .leading)
            }
            .font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.horizontal, 10).padding(.bottom, -6)
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(shown, id: \.self) { i in
                        row($items[i])
                        Divider()
                    }
                }
            }
            .frame(minHeight: 320)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.25)))
            Text("匯入只會更新型號的「通過項目」；已經有的型號，名稱、別名、系列等資料不會變。匯入後按「產生知識庫」才會更新客服回答。")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Text("已選 \(chosen.count) 款").font(.callout).foregroundStyle(.secondary)
                Spacer()
                Button("取消") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("確認匯入 \(chosen.count) 款") { onApply(chosen); dismiss() }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(chosen.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 900, height: 680)
    }

    private func row(_ p: Binding<MILScheduleImport.Project>) -> some View {
        let v = p.wrappedValue
        let tag: (String, Color) = switch v.action {
        case .new: ("新增", .green)
        case .update: ("更新", .orange)
        case .same: ("相同", .gray)
        }
        return HStack(alignment: .top, spacing: 10) {
            Toggle("", isOn: p.include).toggleStyle(.checkbox).labelsHidden()
            VStack(alignment: .leading, spacing: 2) {
                Text(v.code).font(.callout.bold())
                Text(testsOf(v)).font(.caption).foregroundStyle(.secondary)
                if let d = v.existingDisplay { Text("目前資料：\(d)").font(.caption2).foregroundStyle(.tertiary) }
            }
            .frame(width: 260, alignment: .leading)
            Text("\(v.sheet) \(v.column)").font(.caption).foregroundStyle(.secondary).frame(width: 130, alignment: .leading)
            Text(v.series.isEmpty ? "—" : v.series).frame(width: 44)
            VStack(spacing: 0) {
                Text(v.status).font(.caption)
                Text(v.year).font(.caption2).foregroundStyle(.secondary)
            }
            .frame(width: 60)
            HStack(spacing: 3) {
                Text("\(v.ones)").bold()
                Text("/ \(v.total.map(String.init) ?? "?")").foregroundStyle(.secondary)
                Image(systemName: v.total == v.ones ? "checkmark.circle" : "exclamationmark.circle")
                    .foregroundStyle(v.total == v.ones ? .green : .red).font(.caption)
            }
            .frame(width: 80)
            Tag(text: tag.0, color: tag.1)
            VStack(alignment: .leading, spacing: 2) {
                ForEach(v.warnings, id: \.self) { Text($0).font(.caption).foregroundStyle(.orange) }
                if !v.unmapped.isEmpty { Text("未對應：\(v.unmapped.joined(separator: "、"))").font(.caption).foregroundStyle(.orange) }
                if v.warnings.isEmpty && v.unmapped.isEmpty { Text("—").foregroundStyle(.tertiary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 8).padding(.horizontal, 10)
        .opacity(v.include ? 1 : 0.55)
    }
}
