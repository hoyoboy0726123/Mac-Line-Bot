import Foundation
import Compression

/// 讀 .xlsx 的最小實作（對照 Windows 版 src/core/mil/xlsx.js）：只取每個工作表的儲存格文字。
/// .xlsx 是 zip 壓縮檔，裡面是 XML：sharedStrings.xml（共用字串）＋ worksheets/sheetN.xml（儲存格）。
enum XLSXReader {
    struct Sheet {
        var name: String
        var cells: [String: String]
    }

    static func fail(_ message: String) -> NSError {
        NSError(domain: "XLSX", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    /// 解開 zip（只支援不壓縮與 deflate，Excel 只會用這兩種）
    static func unzip(_ data: Data) throws -> [String: Data] {
        let b = [UInt8](data)
        func u16(_ i: Int) -> Int { i + 1 < b.count ? Int(b[i]) | Int(b[i + 1]) << 8 : 0 }
        func u32(_ i: Int) -> Int { i + 3 < b.count ? u16(i) | u16(i + 2) << 16 : 0 }
        guard b.count >= 22 else { throw fail("不是 Excel（.xlsx）檔案") }
        var eocd = -1
        var i = b.count - 22
        while i >= max(0, b.count - 65557) {
            if u32(i) == 0x06054b50 { eocd = i; break }
            i -= 1
        }
        guard eocd >= 0 else { throw fail("不是 Excel（.xlsx）檔案") }
        let count = u16(eocd + 10)
        var p = u32(eocd + 16)
        var files: [String: Data] = [:]
        for _ in 0..<count {
            guard u32(p) == 0x02014b50 else { throw fail("Excel 檔案損毀") }
            let method = u16(p + 10), size = u32(p + 20), fullSize = u32(p + 24)
            let nameLen = u16(p + 28), extraLen = u16(p + 30), commentLen = u16(p + 32)
            let local = u32(p + 42)
            let name = String(decoding: b[(p + 46)..<min(b.count, p + 46 + nameLen)], as: UTF8.self)
            p += 46 + nameLen + extraLen + commentLen
            let start = local + 30 + u16(local + 26) + u16(local + 28)
            guard start >= 0, start + size <= b.count else { throw fail("Excel 檔案損毀") }
            let raw = Array(b[start..<(start + size)])
            if method == 0 {
                files[name] = Data(raw)
            } else if method == 8 {
                if fullSize == 0 { files[name] = Data(); continue }
                var out = [UInt8](repeating: 0, count: fullSize)
                let n = raw.withUnsafeBufferPointer { src in
                    compression_decode_buffer(&out, fullSize, src.baseAddress!, raw.count, nil, COMPRESSION_ZLIB)
                }
                guard n == fullSize else { throw fail("Excel 檔案損毀（解壓縮失敗）") }
                files[name] = Data(out)
            }
        }
        return files
    }

    static func groups(_ pattern: String, _ text: String) -> [[String]] {
        guard let re = try? NSRegularExpression(pattern: pattern) else { return [] }
        let ns = text as NSString
        return re.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { m in
            (0..<m.numberOfRanges).map { m.range(at: $0).location == NSNotFound ? "" : ns.substring(with: m.range(at: $0)) }
        }
    }

    static func first(_ pattern: String, _ text: String) -> String? {
        groups(pattern, text).first.flatMap { $0.count > 1 ? $0[1] : nil }
    }

    static func unescape(_ s: String) -> String {
        guard s.contains("&") else { return s }
        var out = ""
        var rest = Substring(s)
        while let amp = rest.firstIndex(of: "&") {
            out += rest[..<amp]
            let after = rest[rest.index(after: amp)...]
            if let semi = after.firstIndex(of: ";"), after.distance(from: after.startIndex, to: semi) <= 10 {
                let e = String(after[..<semi])
                var r: String?
                switch e {
                case "lt": r = "<"
                case "gt": r = ">"
                case "quot": r = "\""
                case "apos": r = "'"
                case "amp": r = "&"
                default:
                    if e.hasPrefix("#x"), let v = UInt32(e.dropFirst(2), radix: 16), let u = Unicode.Scalar(v) { r = String(u) }
                    else if e.hasPrefix("#"), let v = UInt32(e.dropFirst()), let u = Unicode.Scalar(v) { r = String(u) }
                }
                if let r {
                    out += r
                    rest = after[after.index(after: semi)...]
                    continue
                }
            }
            out += "&"
            rest = after
        }
        return out + rest
    }

    /// <si> 或 <is> 裡所有 <t> 的文字接起來（含格式化文字 <r><t>…）
    static func textOf(_ xml: String) -> String {
        groups(#"<t(?:\s[^>]*)?>([^<]*)</t>"#, xml).map { unescape($0[1]) }.joined()
    }

    /// 依活頁簿裡的順序回傳每個工作表的儲存格
    static func read(_ data: Data) throws -> [Sheet] {
        let files = try unzip(data)
        func str(_ n: String) -> String { files[n].map { String(decoding: $0, as: UTF8.self) } ?? "" }
        let workbook = str("xl/workbook.xml")
        guard !workbook.isEmpty else { throw fail("不是 Excel（.xlsx）檔案") }
        let shared = groups(#"<si>([\s\S]*?)</si>"#, str("xl/sharedStrings.xml")).map { textOf($0[1]) }
        var rels: [String: String] = [:]
        for m in groups(#"<Relationship\b[^>]*>"#, str("xl/_rels/workbook.xml.rels")) {
            if let id = first(#"\bId="([^"]+)""#, m[0]), let target = first(#"\bTarget="([^"]+)""#, m[0]) {
                var t = target
                if t.hasPrefix("/") { t.removeFirst() }
                if t.hasPrefix("xl/") { t.removeFirst(3) }
                rels[id] = t
            }
        }
        var sheets: [Sheet] = []
        for m in groups(#"<sheet\b[^>]*>"#, workbook) {
            guard let name = first(#"\bname="([^"]*)""#, m[0]), let rid = first(#"\br:id="([^"]+)""#, m[0]), let target = rels[rid] else { continue }
            let xml = str("xl/" + target)
            var cells: [String: String] = [:]
            for c in groups(#"<c\b([^>]*?)(?:/>|>([\s\S]*?)</c>)"#, xml) {
                guard let ref = first(#"\br="([A-Z]+\d+)""#, c[1]), !c[2].isEmpty else { continue }
                let type = first(#"\bt="([^"]+)""#, c[1])
                var value: String?
                if type == "inlineStr" {
                    value = textOf(c[2])
                } else if let v = first(#"<v>([^<]*)</v>"#, c[2]) {
                    value = type == "s" ? Int(v).flatMap { $0 < shared.count ? shared[$0] : nil } : unescape(v)
                }
                if let value, !value.isEmpty { cells[ref] = value }
            }
            sheets.append(Sheet(name: unescape(name), cells: cells))
        }
        return sheets
    }

    // MARK: 欄位代號

    static func colIndex(_ col: String) -> Int {
        col.unicodeScalars.reduce(0) { $0 * 26 + Int($1.value) - 64 }
    }

    static func colName(_ n: Int) -> String {
        var n = n, s = ""
        while n > 0 {
            let r = (n - 1) % 26
            s = String(Character(Unicode.Scalar(UInt8(65 + r)))) + s
            n = (n - 1) / 26
        }
        return s
    }

    static func splitRef(_ ref: String) -> (col: String, row: Int) {
        let col = String(ref.prefix { $0.isLetter })
        return (col, Int(ref.dropFirst(col.count)) ?? 0)
    }
}
