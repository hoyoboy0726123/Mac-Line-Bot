import Foundation

/// 讀 QTR 的「MIL-STD-810H 測試排程表」Excel（對照 Windows 版 src/core/mil/excel.js）
///
/// 格式（每個工作表都一樣，專案會一直往右加）：
///   D 欄是標籤：「測試類別」「年分」「系列」「Project」…「Method 500.6-Procedure I」…「測試總數」
///   每個專案佔 3 欄：專案欄（1＝通過）、Result 欄、Appendix 欄
/// 用標籤找位置、不寫死行號，排程、人員等其他資訊都略過。
enum MILScheduleImport {
    struct SheetInfo: Codable, Hashable {
        var name: String
        var projects: Int
        var tests: Int?
        var note: String
    }

    enum Action: String, Codable { case new, update, same }

    struct Project: Identifiable, Codable, Hashable {
        var id: String { sheet + "|" + column }
        var sheet: String
        var column: String
        var code: String
        var series: String
        var year: String
        var status: String
        var passed: [String: [String]]
        var passedTests: Int
        var procedures: Int
        var ones: Int
        var total: Int?
        var unmapped: [String]
        var warnings: [String]
        var duplicate: Bool
        var action: Action
        var existingDisplay: String?
        var include: Bool
    }

    struct Unmapped: Codable, Hashable {
        var label: String
        var code: String
        var rows: [Int]
        var projects: Int
    }

    struct Result: Codable {
        var sheets: [SheetInfo]
        var projects: [Project]
        var unmapped: [Unmapped]
    }

    static func clean(_ s: String?) -> String {
        (s ?? "").replacingOccurrences(of: "\u{3000}", with: " ").replacingOccurrences(of: "\u{00a0}", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func isOne(_ s: String?) -> Bool {
        let v = clean(s)
        return !v.isEmpty && Double(v) == 1
    }

    /// 照測試項目的順序排好通過的程序
    static func ordered(_ passed: [String: [String]], _ tests: [MILTestDef]) -> [String: [String]] {
        var out: [String: [String]] = [:]
        for t in tests {
            let procs = t.procedures.map(\.id).filter { (passed[t.id] ?? []).contains($0) }
            if !procs.isEmpty { out[t.id] = procs }
        }
        return out
    }

    static func procCount(_ p: [String: [String]]) -> Int { p.values.reduce(0) { $0 + $1.count } }

    /// 一行測試對到哪些測試項目＋程序：用跟 PDF 一樣的規則讀「Method 501.7-Procedure II」，B 欄代碼（A1_3、C2_7…）決定氣候類別
    static func mapRow(_ label: String, code: String, tests: [MILTestDef]) -> [String: [String]] {
        let cat = XLSXReader.first(#"(?i)^(A1|A2|C1|C2)"#, clean(code))?.uppercased()
        var text = clean(label).replacingOccurrences(of: #"\s*\n\s*"#, with: " ", options: .regularExpression)
        if let cat, let r = text.range(of: #"(?i)Procedure\s*[IVX]+(?:-[ABC])?"#, options: .regularExpression) {
            text.replaceSubrange(r, with: text[r] + " (\(cat))")
        }
        var found = MILReportParser.section(text, tests: tests)
        if found.isEmpty {
            // 沒有寫 Procedure 的（例如「Method 508.8」）：自己新增的同編號測試只有一個程序就勾它
            if let method = XLSXReader.first(#"(?i)Method\s*(\d{3}\.\d)"#, text),
               let t = tests.first(where: { $0.code == method && $0.procedures.count == 1 }) {
                found[t.id] = [t.procedures[0].id]
            }
        }
        return found
    }

    /// 解析整份 Excel，回傳識別結果總覽（還沒存）
    static func parse(_ data: Data, catalog: MILCatalog) throws -> Result {
        let tests = catalog.allTests
        let sheets = try XLSXReader.read(data)
        var out = Result(sheets: [], projects: [], unmapped: [])
        var unmapped: [Unmapped] = []
        var seen: [String: String] = [:]

        for sh in sheets {
            var rows: [Int: [String: String]] = [:]
            for (ref, v) in sh.cells {
                let (col, row) = XLSXReader.splitRef(ref)
                rows[row, default: [:]][col] = v
            }
            let sortedRows = rows.keys.sorted()
            // 找標籤欄：有「Project」的那一格
            var labelCol: String?, projectRow: Int?
            for r in sortedRows {
                if let hit = rows[r]!.filter({ clean($0.value) == "Project" }).keys.sorted(by: { XLSXReader.colIndex($0) < XLSXReader.colIndex($1) }).first {
                    labelCol = hit; projectRow = r; break
                }
            }
            guard let labelCol, let projectRow else {
                out.sheets.append(SheetInfo(name: sh.name, projects: 0, tests: nil, note: "不是排程表格式，略過"))
                continue
            }
            let lc = XLSXReader.colIndex(labelCol)
            func labelRow(_ text: String) -> Int? { sortedRows.first { clean(rows[$0]?[labelCol]) == text } }
            let testRows = sortedRows.filter { clean(rows[$0]?[labelCol]).range(of: #"(?i)^Method\s*\d{3}\.\d"#, options: .regularExpression) != nil }
            let totalRow = labelRow("測試總數")
            let headerRow = testRows.first.map { $0 - 1 }
            let statusRow = labelRow("測試類別"), yearRow = labelRow("年分"), seriesRow = labelRow("系列")
            func cell(_ r: Int?, _ col: String) -> String { r.map { clean(rows[$0]?[col]) } ?? "" }

            // 每一行測試對到的項目（同一行所有專案共用）
            var rowMap: [Int: (label: String, code: String, mapped: [String: [String]])] = [:]
            for r in testRows {
                let label = clean(rows[r]?[labelCol])
                let code = cell(r, XLSXReader.colName(lc - 2))
                rowMap[r] = (label.components(separatedBy: "\n")[0], code, mapRow(rows[r]?[labelCol] ?? "", code: code, tests: tests))
            }

            // 專案欄：Project 那一行、標籤欄右邊有寫專案名稱的
            let projectCols = (rows[projectRow] ?? [:])
                .filter { XLSXReader.colIndex($0.key) > lc && !clean($0.value).isEmpty && clean($0.value).lowercased() != "projectname" }
                .sorted { XLSXReader.colIndex($0.key) < XLSXReader.colIndex($1.key) }
            out.sheets.append(SheetInfo(name: sh.name, projects: projectCols.count, tests: testRows.count, note: projectCols.isEmpty ? "還沒有專案（都是範本）" : ""))

            for (col, rawName) in projectCols {
                let code = clean(rawName)
                let resultCol = XLSXReader.colName(XLSXReader.colIndex(col) + 1)
                let hasResult = cell(headerRow, resultCol).range(of: #"(?i)^Result"#, options: .regularExpression) != nil
                var passed: [String: [String]] = [:]
                var warnings: [String] = []
                var notMapped: [String] = []
                var ones = 0
                for r in testRows where isOne(cell(r, col)) {
                    ones += 1
                    let row = rowMap[r]!
                    if hasResult && !isOne(cell(r, resultCol)) {
                        warnings.append("第 \(r) 行「\(row.code.isEmpty ? row.label : row.code)」專案欄是 1，但 Result 欄沒有 1")
                    }
                    if row.mapped.isEmpty {
                        notMapped.append(row.label)
                        if let i = unmapped.firstIndex(where: { $0.label == row.label }) {
                            if !unmapped[i].rows.contains(r) { unmapped[i].rows.append(r) }
                            unmapped[i].projects += 1
                        } else {
                            unmapped.append(Unmapped(label: row.label, code: row.code, rows: [r], projects: 1))
                        }
                        continue
                    }
                    for (t, procs) in row.mapped {
                        passed[t] = (passed[t] ?? []) + procs.filter { !(passed[t] ?? []).contains($0) }
                    }
                }
                let totalText = cell(totalRow, col)
                let total = Double(totalText).map { Int($0) }
                if let total, total != ones { warnings.append("標示 1 的有 \(ones) 項，但「測試總數」寫 \(total)") }
                if code.range(of: #"[^A-Za-z0-9\-／/]"#, options: .regularExpression) != nil { warnings.append("專案名稱含有備註文字，會照原樣當作型號") }
                let key = code.uppercased()
                var duplicate = false
                if let where_ = seen[key] {
                    warnings.append("跟 \(where_) 的專案名稱重複，預設不匯入")
                    duplicate = true
                } else {
                    seen[key] = "\(sh.name) \(col) 欄"
                }
                let result = ordered(passed, tests)
                let existing = catalog.models.first { $0.code.uppercased() == key || $0.aliases.contains { $0.uppercased() == key } }
                var action = Action.new
                if let existing { action = ordered(existing.passed, tests) == result ? .same : .update }
                out.projects.append(Project(
                    sheet: sh.name, column: col, code: code,
                    series: cell(seriesRow, col), year: cell(yearRow, col), status: cell(statusRow, col),
                    passed: result, passedTests: result.count, procedures: procCount(result),
                    ones: ones, total: total, unmapped: notMapped, warnings: warnings, duplicate: duplicate,
                    action: action, existingDisplay: existing?.display,
                    include: !duplicate && action != .same && procCount(result) > 0
                ))
            }
        }
        out.unmapped = unmapped
        return out
    }

    /// 匯入選好的專案：已有的型號更新通過項目（其他資料不動），沒有的新增
    @discardableResult
    static func apply(_ catalog: inout MILCatalog, _ items: [Project]) -> (added: Int, updated: Int) {
        let tests = catalog.allTests
        var added = 0, updated = 0
        for it in items {
            let code = clean(it.code)
            guard !code.isEmpty else { continue }
            let passed = ordered(it.passed, tests)
            let key = code.uppercased()
            if let i = catalog.models.firstIndex(where: { $0.code.uppercased() == key || $0.aliases.contains { $0.uppercased() == key } }) {
                catalog.models[i].passed = passed
                updated += 1
            } else {
                let series = clean(it.series)
                var m = MILModel(code: code, display: series.isEmpty ? code : "\(code)（\(series) 系列）")
                m.aliases = [code]
                m.passed = passed
                catalog.models.append(m)
                added += 1
            }
        }
        return (added, updated)
    }
}
