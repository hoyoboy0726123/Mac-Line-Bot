import Foundation
import FoundationModels
@Generable enum CustomerIntent { case question, reservation, humanAgent, greeting, thanks, complaint, other }
@Generable struct KnowledgeAnswer {
    @Guide(description: "顧客這則訊息的意圖。想訂位/預約是 reservation；要求找真人、專人、老闆是 humanAgent；打招呼是 greeting；道謝是 thanks；抱怨是 complaint；詢問店家、產品或服務的資訊是 question")
    var intent: CustomerIntent
    @Guide(description: "從參考資料中原文摘錄跟顧客問題有關的句子（可以多句）。只要資料有提到相關內容就要摘錄；參考資料完全沒有相關內容時才留空字串")
    var evidence: String
    @Guide(description: "要回覆給顧客的訊息，使用繁體中文，簡短自然。有摘錄到資料時，用摘錄的內容具體回答（數字、條件、型號照抄）；沒有摘錄到資料時，誠實說目前沒有這項資訊")
    var reply: String
}
let dir = CommandLine.arguments[1]
let sys = try! String(contentsOfFile: dir + "/sys.txt", encoding: .utf8)
let ctx = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: dir + "/contexts.json"))) as! [String: String]
let qs = ["溫度衝擊測試怎麼做","摔到地上會壞嗎","B1400 有做沙塵測試嗎","P5 可以耐多低溫","筆電可以淋雨嗎","坐飛機帶著沒問題吧","L1400 有沒有做溫度衝擊","摔壞了保固有賠嗎","放在車上曬太陽會怎樣","開車載著一直震動可以嗎"]
print("availability:", SystemLanguageModel.default.availability)
var out: [[String: Any]] = []
for q in qs {
    let s = LanguageModelSession(instructions: sys)
    let p = "參考資料：\n\(ctx[q]!)\n\n顧客最新訊息：\(q)"
    let t = Date()
    do {
        let r = try await s.respond(to: p, generating: KnowledgeAnswer.self, options: GenerationOptions(temperature: 0.2))
        let dt = Date().timeIntervalSince(t)
        print(String(format: "[%.1fs] %@\n  → %@\n", dt, q, r.content.reply))
        out.append(["q": q, "wall": dt, "reply": r.content.reply, "evidence": r.content.evidence])
    } catch { print("ERR", q, error) ; out.append(["q": q, "error": "\(error)"]) }
}
try! JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted]).write(to: URL(fileURLWithPath: dir + "/qa_apple_fm.json"))
