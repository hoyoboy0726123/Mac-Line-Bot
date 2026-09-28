import Foundation

/// 規則式抽取日期 / 時間 / 人數 / 電話。模型不可用時也能收單，模型抽到的字串也會再經過這裡正規化。
enum ReservationParser {
    static let weekdayNames = ["日", "一", "二", "三", "四", "五", "六"]
    private static let chineseDigits: [Character: Int] = ["零": 0, "〇": 0, "一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9]

    static func chineseNumber(_ s: String) -> Int? {
        if let n = Int(s) { return n }
        if s == "十" { return 10 }
        if s.hasPrefix("十"), let last = s.last, let d = chineseDigits[last] { return 10 + d }
        if s.count == 2, s.hasSuffix("十"), let d = chineseDigits[s.first!] { return d * 10 }
        if s.count == 3, Array(s)[1] == "十", let a = chineseDigits[Array(s)[0]], let b = chineseDigits[Array(s)[2]] { return a * 10 + b }
        if s.count == 1, let d = chineseDigits[s.first!] { return d }
        return nil
    }

    private static func match(_ pattern: String, _ text: String) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        guard let m = re.firstMatch(in: text, range: range) else { return nil }
        return (0..<m.numberOfRanges).map { i in
            guard let r = Range(m.range(at: i), in: text) else { return "" }
            return String(text[r])
        }
    }

    static func display(_ date: Date) -> String {
        let cal = Calendar(identifier: .gregorian)
        let c = cal.dateComponents([.month, .day, .weekday], from: date)
        return "\(c.month ?? 0)/\(c.day ?? 0)（週\(weekdayNames[(c.weekday ?? 1) - 1])）"
    }

    // MARK: 日期

    static func date(in text: String, now: Date = Date()) -> String? {
        let cal = Calendar(identifier: .gregorian)
        let today = cal.startOfDay(for: now)

        if let m = match("(\\d{1,2})\\s*[/／月]\\s*(\\d{1,2})", text),
           let month = Int(m[1]), let day = Int(m[2]), (1...12).contains(month), (1...31).contains(day) {
            var comps = cal.dateComponents([.year], from: now)
            comps.month = month
            comps.day = day
            if var d = cal.date(from: comps) {
                if d < today, let next = cal.date(byAdding: .year, value: 1, to: d) { d = next }
                return display(d)
            }
            return "\(month)/\(day)"
        }
        let relative: [(String, Int)] = [("大後天", 3), ("後天", 2), ("明天", 1), ("明日", 1), ("今天", 0), ("今晚", 0), ("今日", 0)]
        for (word, offset) in relative where text.contains(word) {
            if let d = cal.date(byAdding: .day, value: offset, to: today) { return display(d) }
        }
        if let m = match("(下下|下個?|這個?|本)?\\s*(週|周|星期|禮拜)\\s*([一二三四五六日天])", text) {
            let prefix = m[1]
            let target = m[3] == "天" ? 0 : (weekdayNames.firstIndex(of: m[3]) ?? 0)
            let current = cal.component(.weekday, from: today) - 1
            var diff = (target - current + 7) % 7
            if prefix.hasPrefix("下下") { diff += 14 }
            else if prefix.hasPrefix("下") { diff += 7 }
            if let d = cal.date(byAdding: .day, value: diff, to: today) { return display(d) }
        }
        return nil
    }

    // MARK: 時間

    static func time(in text: String) -> String? {
        let pattern = "(凌晨|早上|上午|中午|下午|傍晚|晚上|晚間)?\\s*(\\d{1,2}|[一二兩三四五六七八九十]{1,3})\\s*(?:[:：]\\s*(\\d{2})|點\\s*(半|\\d{1,2}\\s*分|\\d{2}(?![位人名]))?)"
        guard let m = match(pattern, text), var hour = chineseNumber(m[2]) else { return nil }
        var minute = 0
        if !m[3].isEmpty { minute = Int(m[3]) ?? 0 }
        else if m[4] == "半" { minute = 30 }
        else if !m[4].isEmpty { minute = Int(m[4].replacingOccurrences(of: "分", with: "").trimmingCharacters(in: .whitespaces)) ?? 0 }
        switch m[1] {
        case "下午", "傍晚", "晚上", "晚間": if hour < 12 { hour += 12 }
        case "中午": if hour < 6 { hour += 12 }
        default: break
        }
        guard (0...23).contains(hour), (0...59).contains(minute) else { return nil }
        return String(format: "%02d:%02d", hour, minute)
    }

    // MARK: 人數 / 電話

    static func people(in text: String) -> Int? {
        if let m = match("(\\d{1,3}|[一二兩三四五六七八九十]{1,3})\\s*(?:位|個人|人|大人|名)", text) {
            return chineseNumber(m[1])
        }
        return nil
    }

    static func phone(in text: String) -> String? {
        guard let m = match("(09\\d{2})[- ]?(\\d{3})[- ]?(\\d{3})", text) else { return nil }
        return m[1] + m[2] + m[3]
    }

    /// 顧客回的是不是單純名字（沒有數字、夠短）
    static func looksLikeName(_ text: String) -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return (1...12).contains(t.count) && t.rangeOfCharacter(from: .decimalDigits) == nil
    }

    static func fill(_ draft: inout ReservationDraft, from text: String) {
        if let d = date(in: text) { draft.date = d }
        if let t = time(in: text) { draft.time = t }
        if let p = people(in: text) { draft.people = p }
        if let ph = phone(in: text) { draft.phone = ph }
    }
}
