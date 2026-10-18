import Foundation

/// 軍規機種的存取與「一鍵產生知識庫」
extension AppState {
    var milCatalog: MILCatalog {
        guard let id = selectedAccount?.id else { return MILCatalog() }
        return milCatalogs[id] ?? MILCatalog.seed
    }

    func updateMILCatalog(_ body: (inout MILCatalog) -> Void) {
        guard let id = selectedAccount?.id else { return }
        var c = milCatalogs[id] ?? MILCatalog.seed
        body(&c)
        milCatalogs[id] = c
        Persistence.saveMILCatalog(c, for: id)
    }

    /// 機種資料改過、還沒重新產生
    var milNeedsRegenerate: Bool {
        guard let id = selectedAccount?.id, let c = milCatalogs[id] else { return false }
        guard c.lastGenerated != nil else { return true }
        let sig: (FAQItem) -> String = { [$0.question, $0.answer, $0.flex ?? "", ($0.quickReplies ?? []).joined(separator: "|")].joined(separator: "\u{1}") }
        let generated = Set(MILGenerator.faqs(c).map(sig))
        let current = Set((data[id]?.faqs ?? []).filter { $0.keywords.contains(MILGenerator.tag) }.map(sig))
        return generated != current
    }

    struct MILGenerateResult {
        var faqs: Int
        var removed: Int
        var paragraphs: Int
    }

    /// 由機種資料重新產生 FAQ 與背景知識：只替換自動產生的部分，手動新增的 FAQ 不會動
    @discardableResult
    func generateMILKnowledge() async -> MILGenerateResult? {
        guard let id = selectedAccount?.id else { return nil }
        let c = milCatalogs[id] ?? MILCatalog.seed
        let out = MILGenerator.generate(c)
        let newQuestions = Set(out.faqs.map(\.question))
        var removed = 0
        update(id) { d in
            let before = d.faqs.count
            // 舊的自動產生題目，以及以前用 CSV 匯入的同名題目
            d.faqs.removeAll { $0.keywords.contains(MILGenerator.tag) || newQuestions.contains($0.question) }
            removed = before - d.faqs.count
            d.faqs.append(contentsOf: out.faqs)
            // 背景知識：自動產生的文件取代舊版（也取代以前手寫匯入的軍規文件）
            d.docs.removeAll { $0.title == MILGenerator.docTitle || $0.title == "ASUS商用筆電-MIL-STD-810H軍規測試" }
            d.docs.insert(out.doc, at: 0)
        }
        updateMILCatalog { $0.lastGenerated = Date() }
        accountLog(id, "軍規知識庫已重新產生：\(out.faqs.count) 題 FAQ、背景知識 \(out.doc.content.components(separatedBy: "\n\n").count) 段（\(c.models.count) 款機種）")
        Task { await validateFlex(id) }
        await buildVectorIndex()
        return MILGenerateResult(faqs: out.faqs.count, removed: removed, paragraphs: out.doc.content.components(separatedBy: "\n\n").count)
    }
}
