import Foundation

struct OllamaError: LocalizedError {
    var message: String
    var errorDescription: String? { "Ollama：\(message)" }
}

/// 呼叫本機 Ollama（qwen3.5:9b 回答、bge-m3 向量）。
/// 用原生 /api/chat：/v1 相容端點不會帶 think 參數，Qwen 會開始「思考」而慢到不能用。
struct OllamaClient {
    var baseURL: String
    var chatModel: String
    var embedModel: String

    private func post(_ path: String, _ body: [String: Any], timeout: TimeInterval) async throws -> [String: Any] {
        guard let url = URL(string: baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/ ")) + path) else {
            throw OllamaError(message: "網址不正確")
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = timeout
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        let obj = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        guard status == 200 else {
            throw OllamaError(message: obj["error"] as? String ?? "HTTP \(status)")
        }
        return obj
    }

    // MARK: 狀態

    /// 已安裝的模型名稱；Ollama 沒在跑就丟錯
    func installedModels() async throws -> [String] {
        guard let url = URL(string: baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/ ")) + "/api/tags") else {
            throw OllamaError(message: "網址不正確")
        }
        var req = URLRequest(url: url)
        req.timeoutInterval = 3
        let (data, _) = try await URLSession.shared.data(for: req)
        let obj = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        return ((obj["models"] as? [[String: Any]]) ?? []).compactMap { $0["name"] as? String }
    }

    static func has(_ model: String, in installed: [String]) -> Bool {
        installed.contains(model) || installed.contains(model + ":latest")
    }

    /// 先把模型載入記憶體並常駐，第一位顧客就不用等冷啟動
    func warmUp() async {
        _ = try? await post("/api/chat", [
            "model": chatModel,
            "messages": [["role": "user", "content": "hi"]],
            "think": false, "stream": false, "keep_alive": -1,
            "options": ["num_predict": 1],
        ] as [String: Any], timeout: 120)
        _ = try? await embed(["暖機"])
    }

    // MARK: 對話

    /// 結構化輸出：format 傳 JSON Schema，Ollama 會用 grammar 限制成合法 JSON
    func chatJSON(system: String, user: String, schema: [String: Any],
                  temperature: Double = 0.2, maxTokens: Int = 450, timeout: TimeInterval = 20) async throws -> [String: Any] {
        let r = try await post("/api/chat", [
            "model": chatModel,
            "messages": [["role": "system", "content": system], ["role": "user", "content": user]],
            "stream": false, "think": false, "keep_alive": -1,
            "format": schema,
            "options": ["temperature": temperature, "num_predict": maxTokens, "num_ctx": 8192],
        ] as [String: Any], timeout: timeout)
        guard let content = (r["message"] as? [String: Any])?["content"] as? String,
              let data = content.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw OllamaError(message: "回傳的 JSON 格式不正確")
        }
        return json
    }

    func chat(_ prompt: String, timeout: TimeInterval = 60) async throws -> String {
        let r = try await post("/api/chat", [
            "model": chatModel,
            "messages": [["role": "user", "content": prompt]],
            "stream": false, "think": false, "keep_alive": -1,
            "options": ["num_predict": 600],
        ] as [String: Any], timeout: timeout)
        return ((r["message"] as? [String: Any])?["content"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: 向量

    func embed(_ texts: [String], timeout: TimeInterval = 60) async throws -> [[Float]] {
        guard !texts.isEmpty else { return [] }
        let r = try await post("/api/embed", ["model": embedModel, "input": texts, "keep_alive": -1] as [String: Any], timeout: timeout)
        guard let vectors = r["embeddings"] as? [[Double]], vectors.count == texts.count else {
            throw OllamaError(message: "向量回傳數量不符")
        }
        return vectors.map { $0.map(Float.init) }
    }
}
