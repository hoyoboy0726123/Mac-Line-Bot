import CryptoKit
import Foundation

struct LineAPIError: LocalizedError {
    var status: Int
    var message: String
    var errorDescription: String? { "LINE API \(status)：\(message)" }
}

/// LINE Messaging API 呼叫。訊息用字典組，方便組 template / quick reply。
struct LineAPI {
    typealias Message = [String: Any]

    let token: String
    private static let base = "https://api.line.me"

    // MARK: 共用

    @discardableResult
    private func call(_ method: String, _ path: String, body: Any? = nil) async throws -> Data {
        var req = URLRequest(url: URL(string: Self.base + path)!)
        req.httpMethod = method
        req.timeoutInterval = 20
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            var message = String(data: data, encoding: .utf8) ?? ""
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let m = obj["message"] as? String {
                message = m
                if let details = obj["details"] as? [[String: Any]] {
                    let d = details.compactMap { $0["message"] as? String }.joined(separator: "; ")
                    if !d.isEmpty { message += "（\(d)）" }
                }
            }
            throw LineAPIError(status: status, message: message)
        }
        return data
    }

    private func json(_ data: Data) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    // MARK: 訊息

    func reply(_ replyToken: String, _ messages: [Message]) async throws {
        try await call("POST", "/v2/bot/message/reply", body: ["replyToken": replyToken, "messages": Array(messages.prefix(5))] as [String: Any])
    }

    func push(to: String, _ messages: [Message]) async throws {
        try await call("POST", "/v2/bot/message/push", body: ["to": to, "messages": Array(messages.prefix(5))] as [String: Any])
    }

    /// 顯示「輸入中」動畫，讓顧客知道 AI 在想
    func startLoading(chatId: String, seconds: Int = 20) async {
        _ = try? await call("POST", "/v2/bot/chat/loading/start", body: ["chatId": chatId, "loadingSeconds": seconds] as [String: Any])
    }

    // MARK: 帳號資訊

    struct BotInfo {
        var userId: String
        var basicId: String
        var displayName: String
        var pictureUrl: String?
    }

    func botInfo() async throws -> BotInfo {
        let o = json(try await call("GET", "/v2/bot/info"))
        return BotInfo(
            userId: o["userId"] as? String ?? "",
            basicId: o["basicId"] as? String ?? "",
            displayName: o["displayName"] as? String ?? "",
            pictureUrl: o["pictureUrl"] as? String
        )
    }

    struct Profile {
        var displayName: String
        var pictureUrl: String?
    }

    func profile(userId: String) async throws -> Profile {
        let o = json(try await call("GET", "/v2/bot/profile/\(userId)"))
        return Profile(displayName: o["displayName"] as? String ?? "LINE 使用者", pictureUrl: o["pictureUrl"] as? String)
    }

    // MARK: Webhook

    func setWebhook(_ endpoint: String) async throws {
        try await call("PUT", "/v2/bot/channel/webhook/endpoint", body: ["endpoint": endpoint])
    }

    func webhookInfo() async throws -> (endpoint: String, active: Bool) {
        let o = json(try await call("GET", "/v2/bot/channel/webhook/endpoint"))
        return (o["endpoint"] as? String ?? "", (o["active"] as? Bool) ?? false)
    }

    struct WebhookTest {
        var success: Bool
        var statusCode: Int
        var reason: String
        var detail: String
    }

    func testWebhook(_ endpoint: String? = nil) async throws -> WebhookTest {
        var body: [String: Any] = [:]
        if let endpoint { body["endpoint"] = endpoint }
        let o = json(try await call("POST", "/v2/bot/channel/webhook/test", body: body))
        return WebhookTest(
            success: (o["success"] as? Bool) ?? false,
            statusCode: (o["statusCode"] as? Int) ?? 0,
            reason: o["reason"] as? String ?? "",
            detail: o["detail"] as? String ?? ""
        )
    }

    // MARK: 用量

    func quota() async throws -> (type: String, value: Int?) {
        let o = json(try await call("GET", "/v2/bot/message/quota"))
        return (o["type"] as? String ?? "none", o["value"] as? Int)
    }

    func consumption() async throws -> Int {
        let o = json(try await call("GET", "/v2/bot/message/quota/consumption"))
        return (o["totalUsage"] as? Int) ?? 0
    }

    // MARK: 簽章

    static func verify(signature: String?, body: Data, secret: String) -> Bool {
        guard let signature, !secret.isEmpty else { return false }
        let key = SymmetricKey(data: Data(secret.utf8))
        let mac = HMAC<SHA256>.authenticationCode(for: body, using: key)
        let expected = Data(mac).base64EncodedString()
        // 固定時間比較
        let a = Array(expected.utf8), b = Array(signature.utf8)
        guard a.count == b.count else { return false }
        var diff: UInt8 = 0
        for i in 0..<a.count { diff |= a[i] ^ b[i] }
        return diff == 0
    }
}

// MARK: - 訊息組裝

enum LineMessage {
    static func text(_ text: String, quickReplies: [String] = []) -> LineAPI.Message {
        var m: LineAPI.Message = ["type": "text", "text": String(text.prefix(5000))]
        if !quickReplies.isEmpty {
            let items: [[String: Any]] = quickReplies.prefix(13).map { label in
                let action: [String: Any] = ["type": "message", "label": String(label.prefix(20)), "text": label]
                return ["type": "action", "action": action]
            }
            m["quickReply"] = ["items": items] as [String: Any]
        }
        return m
    }

    /// 按鈕範本：店家一鍵接受 / 婉拒（無標題時內文上限 160 字）
    static func buttons(text: String, actions: [(label: String, data: String)], altText: String) -> LineAPI.Message {
        let actionList: [[String: Any]] = actions.prefix(4).map { a in
            ["type": "postback", "label": String(a.label.prefix(20)), "data": a.data, "displayText": a.label]
        }
        let template: [String: Any] = [
            "type": "buttons",
            "text": String(text.prefix(160)),
            "actions": actionList,
        ]
        return [
            "type": "template",
            "altText": String(altText.prefix(400)),
            "template": template,
        ]
    }
}
