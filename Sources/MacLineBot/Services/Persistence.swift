import Foundation

/// 所有資料都存在這台 Mac：~/Library/Application Support/MacLineBot
enum Persistence {
    static var baseURL: URL {
        let url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MacLineBot", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    static var accountsDir: URL {
        let url = baseURL.appendingPathComponent("accounts", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    static var binDir: URL {
        let url = baseURL.appendingPathComponent("bin", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    static var logFile: URL { baseURL.appendingPathComponent("maclinebot.log") }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    static func load<T: Decodable>(_ type: T.Type, from url: URL) -> T? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            // 解不開就先備份，避免被新格式覆蓋掉
            let backup = url.appendingPathExtension("bak-\(Int(Date().timeIntervalSince1970))")
            try? FileManager.default.copyItem(at: url, to: backup)
            return nil
        }
    }

    static func save<T: Encodable>(_ value: T, to url: URL) {
        do {
            let data = try encoder.encode(value)
            try data.write(to: url, options: .atomic)
        } catch {
            NSLog("MacLineBot save failed: \(error)")
        }
    }

    // MARK: 設定 / 帳號

    static func loadSettings() -> AppSettings {
        load(AppSettings.self, from: baseURL.appendingPathComponent("settings.json")) ?? AppSettings()
    }

    static func saveSettings(_ s: AppSettings) {
        save(s, to: baseURL.appendingPathComponent("settings.json"))
    }

    static func loadAccounts() -> [BotAccount] {
        var accounts = load([BotAccount].self, from: baseURL.appendingPathComponent("accounts.json")) ?? []
        for i in accounts.indices {
            accounts[i].channelSecret = Keychain.get("secret-\(accounts[i].id.uuidString)") ?? ""
            accounts[i].channelAccessToken = Keychain.get("token-\(accounts[i].id.uuidString)") ?? ""
        }
        return accounts
    }

    static func saveAccounts(_ accounts: [BotAccount]) {
        save(accounts, to: baseURL.appendingPathComponent("accounts.json"))
        for a in accounts {
            Keychain.set(a.channelSecret, for: "secret-\(a.id.uuidString)")
            Keychain.set(a.channelAccessToken, for: "token-\(a.id.uuidString)")
        }
    }

    static func deleteAccountFiles(_ id: UUID) {
        try? FileManager.default.removeItem(at: accountsDir.appendingPathComponent("\(id.uuidString).json"))
        Keychain.delete("secret-\(id.uuidString)")
        Keychain.delete("token-\(id.uuidString)")
    }

    static func loadData(for id: UUID) -> AccountData? {
        load(AccountData.self, from: accountsDir.appendingPathComponent("\(id.uuidString).json"))
    }

    static func saveData(_ data: AccountData, for id: UUID) {
        save(data, to: accountsDir.appendingPathComponent("\(id.uuidString).json"))
    }

    static func appendLog(_ line: String) {
        let data = Data((line + "\n").utf8)
        if let handle = try? FileHandle(forWritingTo: logFile) {
            handle.seekToEndOfFile()
            handle.write(data)
            try? handle.close()
        } else {
            try? data.write(to: logFile)
        }
    }
}

/// 機密資料（Channel secret / token / tunnel token）另存一個只有自己可讀（0600）的檔案。
/// 不用 Keychain 是因為自行編譯的 App 每次重編簽章都會變，Keychain 會一直跳授權視窗。
enum Keychain {
    private static var url: URL { Persistence.baseURL.appendingPathComponent("secrets.json") }
    private static let lock = NSLock()

    private static func readAll() -> [String: String] {
        guard let data = try? Data(contentsOf: url),
              let dict = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        return dict
    }

    private static func writeAll(_ dict: [String: String]) {
        guard let data = try? JSONEncoder().encode(dict) else { return }
        try? data.write(to: url, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    static func set(_ value: String, for key: String) {
        lock.lock(); defer { lock.unlock() }
        var dict = readAll()
        if value.isEmpty { dict.removeValue(forKey: key) } else { dict[key] = value }
        writeAll(dict)
    }

    static func get(_ key: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        return readAll()[key]
    }

    static func delete(_ key: String) {
        set("", for: key)
    }
}
