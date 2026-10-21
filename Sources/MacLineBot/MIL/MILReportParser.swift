import Foundation
import PDFKit

/// 讀華碩官方 MIL-STD-810H 測試報告 PDF，找出「Method 5xx.x - Procedure …」自動勾選。
/// 報告排版各版本不同，結果請使用者在畫面上確認後再存。
enum MILReportParser {
    struct Result {
        var codeGuess: String?
        var passed: [String: [String]]
        var describedOnly: [String: [String]]
        var text: String
    }

    static func load(from url: URL, tests: [MILTestDef] = MILTests.all) async throws -> Result {
        let data: Data
        if url.isFileURL {
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            data = try Data(contentsOf: url)
        } else {
            let (d, resp) = try await URLSession.shared.data(from: url)
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
                throw NSError(domain: "MIL", code: 1, userInfo: [NSLocalizedDescriptionKey: "下載報告失敗"])
            }
            data = d
        }
        guard let pdf = PDFDocument(data: data) else {
            throw NSError(domain: "MIL", code: 2, userInfo: [NSLocalizedDescriptionKey: "不是可以讀取的 PDF"])
        }
        let pages = (0..<pdf.pageCount).compactMap { pdf.page(at: $0)?.string }
        return parse(pages: pages, tests: tests)
    }

    /// 有「Pass」的頁面是結果總表；沒有的是測試說明（只出現在說明裡的程序另外標示）
    static func parse(pages: [String], tests: [MILTestDef] = MILTests.all) -> Result {
        let resultPages = pages.filter { $0.contains("Pass") }
        let descPages = pages.filter { !$0.contains("Pass") }
        let passed = section(resultPages.joined(separator: "\n"), tests: tests)
        var described = section(descPages.joined(separator: "\n"), tests: tests)
        for (test, procs) in described {
            let rest = procs.filter { !(passed[test] ?? []).contains($0) }
            described[test] = rest.isEmpty ? nil : rest
        }
        let all = pages.joined(separator: "\n")
        return Result(codeGuess: guessCode(all), passed: passed, describedOnly: described, text: all)
    }

    private static func regexMatches(_ pattern: String, in text: String) -> [(groups: [String], location: Int)] {
        guard let re = try? NSRegularExpression(pattern: pattern) else { return [] }
        let ns = text as NSString
        return re.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { m in
            ((0..<m.numberOfRanges).map { m.range(at: $0).location == NSNotFound ? "" : ns.substring(with: m.range(at: $0)) }, m.range.location)
        }
    }

    static func section(_ raw: String, tests: [MILTestDef]) -> [String: [String]] {
        let text = raw.replacingOccurrences(of: "\u{2010}", with: "-").replacingOccurrences(of: "\u{2013}", with: "-")
            .replacingOccurrences(of: "Procedure1", with: "Procedure 1")
        let ns = text as NSString
        var passed: [String: [String]] = [:]
        func add(_ test: String, _ proc: String) {
            if !(passed[test] ?? []).contains(proc) { passed[test, default: []].append(proc) }
        }
        /// 程序前面 80 個字的說明（例如「Cold Climatic Storage」），用來判斷 A1/A2、C1/C2
        func context(_ location: Int) -> String {
            let start = max(0, location - 80)
            // PDF 常把「Cold Climatic」斷成兩行，換行統一成空白
            return ns.substring(with: NSRange(location: start, length: location - start)).lowercased()
                .components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
        }

        for (m, loc) in regexMatches("Method\\s*(\\d{3}\\.\\d)\\s*-?\\s*Procedure\\s*([IVX]+(?:-[ABC])?|\\d)\\b\\s*(?:\\((A1|A2|C1|C2)\\))?", in: text) {
            let method = m[1], proc = m[2], explicit = m[3]
            let ctx = context(loc)
            switch method {
            case "500.6": add("altitude", proc)
            case "501.7":
                var cats = explicit.isEmpty ? [] : [explicit]
                if cats.isEmpty {
                    let dry = ctx.range(of: "hot dry", options: .backwards)?.lowerBound
                    let basic = ctx.range(of: "basic hot", options: .backwards)?.lowerBound
                    if let dry, basic == nil || dry > basic! { cats = ["A1"] } else if basic != nil { cats = ["A2"] }
                }
                if cats.isEmpty { cats = ["A1", "A2"] }   // 判斷不出來就兩種都勾，請使用者確認
                for c in cats { add("hot", c + (proc == "II" ? "op" : "st")) }
            case "502.7":
                var cat = explicit
                if cat.isEmpty {
                    // 前文裡最靠近的說明決定類別
                    let cold = ctx.range(of: "cold climatic", options: .backwards)?.lowerBound
                    let basic = ctx.range(of: "basic climatic", options: .backwards)?.lowerBound
                    cat = (cold != nil && (basic == nil || cold! > basic!)) ? "C2" : "C1"
                }
                add("cold", cat + (proc == "II" ? "op" : "st"))
            case "503.7": add("tshock", proc.replacingOccurrences(of: "-", with: ""))
            case "505.7": add("solar", "I")
            case "507.6": add("humidity", "II")
            case "510.7": add("dust", proc)
            case "511.7": add("explosive", "I")
            case "516.8":
                switch proc {
                case "IV", "VI": add("drop", proc)
                case "I", "II", "III", "V": add("shock", proc)
                default: break
                }
            case "524.1": add("freeze", "III")
            case "528.1": add("ship", "1")
            default:
                // 使用者自己新增的測試項目：Method 編號相同就勾選；程序代號對得上就勾那一個，只有一個程序就勾它
                for t in tests where t.code == method && MILTests.test(t.id) == nil {
                    let id = proc.replacingOccurrences(of: "-", with: "")
                    if let p = t.procedures.first(where: { $0.id == proc || $0.id == id }) ?? (t.procedures.count == 1 ? t.procedures.first : nil) {
                        add(t.id, p.id)
                    }
                }
            }
        }
        // 振動用表號：Table 514.8C-I / C-IV / C-VI / C-VII、Figure 514.8E-1
        for (m, _) in regexMatches("514\\.8C-(VII|VI|IV|I)\\b", in: text) { add("vibration", "C" + m[1]) }
        if text.contains("514.8E-1") { add("vibration", "E1") }

        // 依測試定義的順序排好
        for (test, procs) in passed {
            let ordered = tests.first { $0.id == test }.map { def in def.procedures.map(\.id).filter { procs.contains($0) } } ?? []
            passed[test] = ordered.isEmpty ? nil : ordered
        }
        return passed
    }

    /// 型號：「Test Report - B5302C」或報告中的大寫英數型號
    private static func guessCode(_ text: String) -> String? {
        if let m = regexMatches("Test Report\\s*-\\s*([A-Z0-9／/]{4,}(?:\\s*/\\s*[A-Z0-9]{4,})?)", in: text).first {
            return m.groups[1].trimmingCharacters(in: .whitespaces)
        }
        if let m = regexMatches("\\b([A-Z]\\d{4}[A-Z]{1,4})\\b", in: text).first { return m.groups[1] }
        return nil
    }
}
