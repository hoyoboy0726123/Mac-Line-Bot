import Foundation

struct WebhookBody: Decodable {
    var destination: String?
    var events: [WebhookEvent]
}

struct WebhookEvent: Decodable {
    var type: String
    var replyToken: String?
    var timestamp: Double?
    var webhookEventId: String?
    var source: Source?
    var message: Message?
    var postback: Postback?
    var deliveryContext: DeliveryContext?

    struct Source: Decodable {
        var type: String
        var userId: String?
        var groupId: String?
        var roomId: String?
    }

    struct Message: Decodable {
        var id: String?
        var type: String
        var text: String?
        var packageId: String?
        var stickerId: String?
    }

    struct Postback: Decodable {
        var data: String
    }

    struct DeliveryContext: Decodable {
        var isRedelivery: Bool
    }

    var userId: String? { source?.userId }
}

/// 解析 postback data：action=rsv_accept&id=xxx
func parsePostback(_ data: String) -> [String: String] {
    var result: [String: String] = [:]
    for pair in data.split(separator: "&") {
        let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
        if kv.count == 2 { result[kv[0]] = kv[1].removingPercentEncoding ?? kv[1] }
    }
    return result
}
