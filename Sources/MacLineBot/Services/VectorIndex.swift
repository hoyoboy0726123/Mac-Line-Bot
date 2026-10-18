import Accelerate
import CryptoKit
import Foundation

/// 知識庫段落的 bge-m3 向量快取。以段落文字的 hash 當 key，內容沒變就不用重算；
/// 存在 App 資料夾，重開 App 也不用重算。
actor VectorIndex {
    static let shared = VectorIndex()

    private var model = ""
    private var vectors: [String: [Float]] = [:]
    private var loadedModel: String?

    private var fileURL: URL {
        let safe = model.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
        return Persistence.baseURL.appendingPathComponent("vectors-\(safe).json")
    }

    static func key(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
    }

    private func load(model: String) {
        guard loadedModel != model else { return }
        self.model = model
        loadedModel = model
        if let data = try? Data(contentsOf: fileURL),
           let dict = try? JSONDecoder().decode([String: [Float]].self, from: data) {
            vectors = dict
        } else {
            vectors = [:]
        }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(vectors) {
            try? data.write(to: fileURL, options: .atomic)
        }
    }

    var count: Int { vectors.count }

    /// 取得這些文字的向量，缺的一次批次算好（舊段落的向量留著，重建索引時才清掉）
    func vectors(for texts: [String], client: OllamaClient) async throws -> [[Float]] {
        load(model: client.embedModel)
        let keys = texts.map(Self.key)
        let missing = Array(Set(zip(keys, texts).filter { vectors[$0.0] == nil }.map { $0.1 }))
        if !missing.isEmpty {
            for batch in stride(from: 0, to: missing.count, by: 32).map({ Array(missing[$0..<min($0 + 32, missing.count)]) }) {
                let result = try await client.embed(batch, timeout: 120)
                for (text, v) in zip(batch, result) { vectors[Self.key(text)] = Self.normalized(v) }
            }
            save()
        }
        return keys.map { vectors[$0] ?? [] }
    }

    func rebuild(texts: [String], client: OllamaClient) async throws -> Int {
        load(model: client.embedModel)
        vectors = [:]
        _ = try await vectors(for: texts, client: client)
        return vectors.count
    }

    static func normalized(_ v: [Float]) -> [Float] {
        var norm: Float = 0
        vDSP_svesq(v, 1, &norm, vDSP_Length(v.count))
        norm = sqrt(norm)
        guard norm > 0 else { return v }
        return v.map { $0 / norm }
    }

    /// 兩個已正規化的向量做內積 = cosine 相似度
    static func cosine(_ a: [Float], _ b: [Float]) -> Double {
        guard a.count == b.count, !a.isEmpty else { return 0 }
        var dot: Float = 0
        vDSP_dotpr(a, 1, b, 1, &dot, vDSP_Length(a.count))
        return Double(dot)
    }
}
