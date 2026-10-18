import AppKit
import Foundation
import Observation
import ServiceManagement

enum SidebarSection: String, CaseIterable, Identifiable, Hashable {
    case overview, conversations, reservations, usage
    case milModels, knowledge, store, rules
    case line
    case accounts, system

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: "總覽"
        case .conversations: "客服對話"
        case .reservations: "預約"
        case .usage: "使用量"
        case .milModels: "軍規機種"
        case .knowledge: "知識庫"
        case .store: "店家資訊"
        case .rules: "回覆規則"
        case .line: "LINE 連線"
        case .accounts: "帳號管理"
        case .system: "系統"
        }
    }

    var icon: String {
        switch self {
        case .overview: "gauge.with.dots.needle.33percent"
        case .conversations: "bubble.left.and.bubble.right.fill"
        case .reservations: "calendar"
        case .usage: "chart.bar.fill"
        case .milModels: "checkmark.shield.fill"
        case .knowledge: "books.vertical.fill"
        case .store: "storefront.fill"
        case .rules: "text.bubble.fill"
        case .line: "link"
        case .accounts: "person.2.fill"
        case .system: "gearshape.fill"
        }
    }

    var tint: String {
        switch self {
        case .overview: "blue"
        case .conversations: "green"
        case .reservations: "red"
        case .usage: "indigo"
        case .milModels: "teal"
        case .knowledge: "orange"
        case .store: "pink"
        case .rules: "purple"
        case .line: "teal"
        case .accounts: "indigo"
        case .system: "gray"
        }
    }

    struct SidebarGroup: Identifiable {
        var title: String
        var items: [SidebarSection]
        var id: String { title }
    }

    static let groups: [SidebarGroup] = [
        SidebarGroup(title: "營運", items: [.overview, .conversations, .reservations, .usage]),
        SidebarGroup(title: "內容", items: [.milModels, .knowledge, .store, .rules]),
        SidebarGroup(title: "設定", items: [.line]),
        SidebarGroup(title: "這台 Mac", items: [.accounts, .system]),
    ]
}

enum OllamaState: Equatable {
    case checking, disabled, ready, notRunning
    case missingModels([String])

    var isReady: Bool { self == .ready }
    var label: String {
        switch self {
        case .checking: "檢查中"
        case .disabled: "已關閉"
        case .ready: "已連線"
        case .notRunning: "沒有在執行"
        case .missingModels(let m): "缺少模型：" + m.joined(separator: "、")
        }
    }
}

struct WebhookStatus: Equatable {
    var endpoint: String = ""
    var synced = false
    var lastCheck: Date?
    var reachable: Bool?
    var message: String = ""
}

enum HealthLevel {
    case ok, warning, error
}

@Observable
@MainActor
final class AppState {
    static let shared = AppState()

    var settings: AppSettings {
        didSet {
            Persistence.saveSettings(settings)
            let o = oldValue, n = settings
            if o.useOllama != n.useOllama || o.ollamaURL != n.ollamaURL || o.chatModel != n.chatModel
                || o.embedModel != n.embedModel || o.appleFallback != n.appleFallback || o.agentMode != n.agentMode {
                ollamaState = .checking
                applyAIConfig()
                Task { await refreshOllama() }
            }
        }
    }
    var accounts: [BotAccount] = []
    var data: [UUID: AccountData] = [:]
    var logs: [LogEntry] = []

    var serverRunning = false
    var serverError: String?
    var aiStatus: AIStatus = .unavailable("檢查中…")
    var ollamaState: OllamaState = .checking
    /// 軍規機種資料（每個帳號一份）
    var milCatalogs: [UUID: MILCatalog] = [:]
    var vectorCount = 0
    var webhookStatus: [UUID: WebhookStatus] = [:]
    var lastEventAt: Date?
    var section: SidebarSection = .overview
    var focusedConversation: String?
    var showSetupWizard = false
    var namedTunnelToken: String {
        didSet { Keychain.set(namedTunnelToken, for: "tunnel-token") }
    }

    let tunnel = TunnelManager()

    @ObservationIgnored private var server: HTTPServer?
    @ObservationIgnored private var saveTasks: [UUID: Task<Void, Never>] = [:]
    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored private var tickCount = 0
    @ObservationIgnored private var healthFailures = 0
    @ObservationIgnored private var disconnectNotified = false
    @ObservationIgnored private var started = false

    private init() {
        settings = Persistence.loadSettings()
        namedTunnelToken = Keychain.get("tunnel-token") ?? ""
        accounts = Persistence.loadAccounts()
        for a in accounts {
            data[a.id] = Persistence.loadData(for: a.id) ?? AccountData()
            milCatalogs[a.id] = Persistence.loadMILCatalog(for: a.id) ?? MILCatalog.seed
        }
        if settings.selectedAccountId == nil || !accounts.contains(where: { $0.id == settings.selectedAccountId }) {
            settings.selectedAccountId = accounts.first?.id
        }
        showSetupWizard = !settings.onboardingCompleted || accounts.isEmpty
    }

    // MARK: - 選取中的帳號

    var selectedAccount: BotAccount? {
        accounts.first { $0.id == settings.selectedAccountId } ?? accounts.first
    }

    var selectedData: AccountData {
        guard let id = selectedAccount?.id else { return AccountData() }
        return data[id] ?? AccountData()
    }

    func account(_ id: UUID) -> BotAccount? { accounts.first { $0.id == id } }

    func updateAccount(_ id: UUID, _ body: (inout BotAccount) -> Void) {
        guard let i = accounts.firstIndex(where: { $0.id == id }) else { return }
        body(&accounts[i])
        Persistence.saveAccounts(accounts)
    }

    /// 修改某個帳號的資料並延遲存檔
    func update(_ id: UUID, _ body: (inout AccountData) -> Void) {
        var d = data[id] ?? AccountData()
        body(&d)
        data[id] = d
        scheduleSave(id)
    }

    func updateSelected(_ body: (inout AccountData) -> Void) {
        guard let id = selectedAccount?.id else { return }
        update(id, body)
    }

    private func scheduleSave(_ id: UUID) {
        saveTasks[id]?.cancel()
        saveTasks[id] = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, let self, let d = self.data[id] else { return }
            Persistence.saveData(d, for: id)
        }
    }

    func flushSaves() {
        for (id, d) in data { Persistence.saveData(d, for: id) }
        Persistence.saveAccounts(accounts)
        Persistence.saveSettings(settings)
    }

    // MARK: - 日誌

    func log(_ level: LogLevel, _ message: String) {
        let entry = LogEntry(level: level, message: message)
        logs.insert(entry, at: 0)
        if logs.count > 800 { logs.removeLast(logs.count - 800) }
        let f = ISO8601DateFormatter()
        Persistence.appendLog("\(f.string(from: entry.date)) [\(level.rawValue.uppercased())] \(message)")
    }

    func accountLog(_ id: UUID, _ message: String) {
        accountLog(id, .info, message)
    }

    func accountLog(_ id: UUID, _ level: LogLevel, _ message: String) {
        let name = account(id)?.displayName ?? "?"
        log(level, "[\(name)] \(message)")
    }

    // MARK: - 啟動

    func start() {
        guard !started else { return }
        started = true
        log(.info, "Mac-Line-Bot MIL 啟動")
        refreshAIStatus()
        startServer()
        tunnel.log = { [weak self] level, msg in self?.log(level, msg) }
        tunnel.onURLChange = { [weak self] url in
            Task { @MainActor in await self?.handlePublicURL(url) }
        }
        tunnel.onDisconnect = { [weak self] reason in
            self?.notifyDisconnect(reason)
        }
        if settings.autoStart, accounts.contains(where: \.hasCredentials) {
            startTunnel()
        }
        Task {
            // 一次性升級：舊的軍規 FAQ 沒有卡片，自動重新產生一次
            if !UserDefaults.standard.bool(forKey: "flexUpgradeDone") {
                for acc in accounts where milCatalogs[acc.id] != nil {
                    settings.selectedAccountId = acc.id
                    if milNeedsRegenerate { await generateMILKnowledge() }
                }
                UserDefaults.standard.set(true, forKey: "flexUpgradeDone")
            }
            await ensureRichMenus()
        }
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    func refreshAIStatus() {
        aiStatus = AIEngine.status()
        Task { await refreshOllama() }
    }

    /// 有任何模型可以回答（Qwen 或 Apple）
    var aiReady: Bool { ollamaState.isReady && settings.useOllama || aiStatus.isAvailable }

    /// 檢查 Ollama 是否在跑、模型是否已下載，並同步給 AIEngine
    func refreshOllama(warmUp: Bool = true) async {
        let s = settings
        let client = OllamaClient(baseURL: s.ollamaURL, chatModel: s.chatModel, embedModel: s.embedModel)
        guard s.useOllama else {
            ollamaState = .disabled
            applyAIConfig()
            return
        }
        let wasReady = ollamaState.isReady
        do {
            let installed = try await client.installedModels()
            let missing = [s.chatModel, s.embedModel].filter { !OllamaClient.has($0, in: installed) }
            ollamaState = missing.isEmpty ? .ready : .missingModels(missing)
        } catch {
            ollamaState = .notRunning
        }
        applyAIConfig()
        if ollamaState.isReady, !wasReady {
            log(.info, "Ollama 已連線：\(s.chatModel) + \(s.embedModel)")
            if warmUp {
                await client.warmUp()
                await buildVectorIndex()
            }
        } else if wasReady, !ollamaState.isReady {
            log(.warning, "Ollama 無法使用（\(ollamaState.label)），\(s.appleFallback ? "改用 Apple 本機模型" : "AI 暫停")")
        }
    }

    func applyAIConfig() {
        var c = AIEngine.Config()
        c.useOllama = settings.useOllama
        c.ollamaReady = ollamaState.isReady
        c.appleFallback = settings.appleFallback
        c.agentMode = settings.agentMode
        c.client = OllamaClient(baseURL: settings.ollamaURL, chatModel: settings.chatModel, embedModel: settings.embedModel)
        AIEngine.config = c
    }

    /// 把所有帳號的知識庫段落算好向量（只算新增或修改過的）
    func buildVectorIndex(force: Bool = false) async {
        guard AIEngine.config.usingOllama else { return }
        let client = AIEngine.config.client
        let texts = accounts.flatMap { KnowledgeRetriever.pieces(of: data[$0.id] ?? AccountData()) }
        let started = Date()
        do {
            if force {
                vectorCount = try await VectorIndex.shared.rebuild(texts: texts, client: client)
            } else {
                _ = try await VectorIndex.shared.vectors(for: texts, client: client)
                vectorCount = await VectorIndex.shared.count
            }
            log(.info, String(format: "向量索引完成：%d 段（%.1f 秒）", vectorCount, Date().timeIntervalSince(started)))
        } catch {
            log(.warning, "向量索引失敗：\(error.localizedDescription)")
        }
    }

    /// Agent 模式：Qwen 用工具反覆查詢，查齊後才回覆。不能用時回傳 nil，改走一般流程
    func runAgent(question: String, history: [ChatMessage], data d: AccountData, accountId: UUID) async -> AgentEngine.Result? {
        let cfg = AIEngine.config
        guard cfg.usingOllama, cfg.agentMode else { return nil }
        let pieces = KnowledgeRetriever.pieces(of: d)
        guard !pieces.isEmpty else { return nil }
        do {
            return try await AIEngine.withTimeout(80) {
                let vectors = try await VectorIndex.shared.vectors(for: pieces, client: cfg.client)
                let agent = AgentEngine(client: cfg.client, pieces: pieces, vectors: vectors)
                return try await agent.run(question: question, history: history, store: d.store, rules: d.rules)
            }
        } catch {
            accountLog(accountId, .warning, "Agent 未完成，改用一般回答：\(error.localizedDescription)")
            return nil
        }
    }

    /// 問題跟每個知識段落的語意相似度；沒有 Ollama 時回傳 nil（改用關鍵詞擴充）
    func semanticScores(for question: String, data d: AccountData) async -> [Double]? {
        let cfg = AIEngine.config
        guard cfg.usingOllama else { return nil }
        let pieces = KnowledgeRetriever.pieces(of: d)
        guard !pieces.isEmpty else { return nil }
        do {
            return try await AIEngine.withTimeout(15) {
                let vectors = try await VectorIndex.shared.vectors(for: pieces, client: cfg.client)
                guard let q = try await cfg.client.embed([question]).first.map(VectorIndex.normalized) else { return [] }
                return vectors.map { VectorIndex.cosine(q, $0) }
            }
        } catch {
            log(.warning, "語意檢索失敗，改用關鍵詞：\(error.localizedDescription)")
            return nil
        }
    }

    func startServer() {
        let server = HTTPServer { request in
            await AppState.shared.handleHTTP(request)
        }
        server.onStateChange = { [weak server] running, error in
            Task { @MainActor in
                let state = AppState.shared
                guard let server, state.server === server else { return }
                state.serverRunning = running
                state.serverError = error
                if running {
                    state.log(.info, "HTTP 服務啟動 127.0.0.1:\(state.settings.port)")
                    state.log(.info, "服務已啟動（\(state.accounts.count) 個帳號）")
                } else if let error {
                    state.log(.error, "HTTP 服務錯誤：\(error)")
                }
            }
        }
        do {
            try server.start(port: settings.port)
            self.server = server
        } catch {
            serverError = error.localizedDescription
            log(.error, "HTTP 服務無法啟動：\(error.localizedDescription)")
        }
    }

    func restartServer() {
        server?.stop()
        serverRunning = false
        startServer()
    }

    func startTunnel() {
        tunnel.start(
            port: settings.port,
            mode: settings.tunnelMode,
            token: namedTunnelToken,
            hostname: settings.namedHostname,
            customPath: settings.cloudflaredPath
        )
    }

    func stopAll() {
        tunnel.stop()
        log(.warning, "已停止 Tunnel，暫停接收 LINE 訊息")
    }

    func shutdown() {
        tunnel.stop()
        server?.stop()
        flushSaves()
    }

    // MARK: - 公開網址

    func webhookURL(for account: BotAccount) -> String? {
        guard let base = tunnel.publicURL else { return nil }
        return base + "/webhook/" + account.slug
    }

    private func handlePublicURL(_ url: String) async {
        for a in accounts { update(a.id) { $0.today.urlChanges += 1 } }
        // Quick Tunnel 剛拿到網址時 DNS 還沒生效，等一下再設定 LINE
        var ready = false
        for _ in 0..<30 {
            if await Self.probe(url + "/health") { ready = true; break }
            try? await Task.sleep(for: .seconds(2))
        }
        guard tunnel.publicURL == url else { return }
        if ready {
            log(.info, "DNS 已生效，Tunnel 運作中：\(url.replacingOccurrences(of: "https://", with: ""))")
        } else {
            log(.warning, "公開網址暫時連不到，仍嘗試更新 LINE webhook")
        }
        if disconnectNotified {
            disconnectNotified = false
            for a in accounts where a.hasCredentials {
                await notifyOwners(a.id, [LineMessage.text("✅ Mac-Line-Bot 已恢復連線，AI 客服重新上線。")])
            }
        }
        for a in accounts where a.hasCredentials {
            await syncWebhook(a.id)
        }
    }

    nonisolated static func probe(_ url: String) async -> Bool {
        guard let u = URL(string: url) else { return false }
        var req = URLRequest(url: u)
        req.timeoutInterval = 6
        req.cachePolicy = .reloadIgnoringLocalCacheData
        guard let result = try? await URLSession.shared.data(for: req) else { return false }
        return (result.1 as? HTTPURLResponse)?.statusCode == 200
    }

    /// 把 LINE 後台的 webhook 網址改成目前的 Tunnel 網址並測試
    @discardableResult
    func syncWebhook(_ id: UUID) async -> Bool {
        guard let a = account(id), a.hasCredentials, let endpoint = webhookURL(for: a) else { return false }
        let api = LineAPI(token: a.channelAccessToken)
        var status = webhookStatus[id] ?? WebhookStatus()
        status.endpoint = endpoint
        do {
            try await api.setWebhook(endpoint)
            accountLog(id, "已更新 LINE webhook 網址：\(endpoint)")
            let test = try await api.testWebhook(endpoint)
            status.synced = test.success
            status.reachable = test.success
            status.lastCheck = Date()
            status.message = test.success ? "外部可連線" : "\(test.statusCode) \(test.reason)"
            accountLog(id, test.success ? .info : .warning, test.success ? "webhook 測試通過" : "webhook 測試失敗：\(test.reason) \(test.detail)")
        } catch {
            status.synced = false
            status.message = error.localizedDescription
            accountLog(id, .error, "更新 webhook 失敗：\(error.localizedDescription)")
        }
        webhookStatus[id] = status
        return status.synced
    }

    /// 「檢查」按鈕：從外部打一次 /health，再請 LINE 測試 webhook
    func checkWebhook(_ id: UUID) async {
        guard let a = account(id), let endpoint = webhookURL(for: a) else { return }
        var status = webhookStatus[id] ?? WebhookStatus()
        status.endpoint = endpoint
        let external = await Self.probe((tunnel.publicURL ?? "") + "/health")
        status.reachable = external
        status.lastCheck = Date()
        if a.hasCredentials, let test = try? await LineAPI(token: a.channelAccessToken).testWebhook(endpoint) {
            status.synced = test.success
            status.message = test.success ? "外部可連線" : "\(test.statusCode) \(test.reason)"
        } else {
            status.message = external ? "外部可連線" : "外部無法連線"
        }
        webhookStatus[id] = status
        accountLog(id, external ? .info : .warning, external ? "webhook 檢查通過" : "webhook 從外部無法連線")
    }

    // MARK: - 整體狀態

    var health: (level: HealthLevel, title: String, detail: String) {
        if !serverRunning { return (.error, "本機服務未啟動", serverError ?? "HTTP 服務沒有在執行") }
        if accounts.isEmpty { return (.warning, "還沒設定帳號", "完成設定精靈就能開始自動回覆") }
        switch tunnel.state {
        case .stopped: return (.warning, "已暫停", "Tunnel 已停止，LINE 訊息暫時收不到")
        case .starting: return (.warning, "連線中", "正在建立 Cloudflare Tunnel…")
        case .failed(let m): return (.error, "連線中斷", m)
        case .running: break
        }
        if let a = selectedAccount, webhookStatus[a.id]?.synced != true {
            return (.warning, "Webhook 尚未同步", "按「重設 Tunnel」或到 LINE 連線頁面檢查")
        }
        if !settings.aiAutoReply { return (.warning, "AI 自動回覆已關閉", "訊息會留給你手動回覆") }
        if !aiReady { return (.warning, "本機模型不可用", "Ollama：\(ollamaState.label)；Apple：\(aiStatus.label)。目前只用 FAQ 回答") }
        if settings.useOllama, !ollamaState.isReady { return (.warning, "Qwen 未連線", "Ollama \(ollamaState.label)，暫時用 Apple 本機模型回答") }
        return (.ok, "一切正常", "正在接收 LINE 訊息並由本機模型自動回覆。")
    }

    // MARK: - 帳號管理

    func addAccount(name: String, secret: String, token: String) -> BotAccount {
        var slug = accounts.isEmpty ? "default" : "shop\(accounts.count + 1)"
        while accounts.contains(where: { $0.slug == slug }) { slug += "x" }
        var a = BotAccount(slug: slug, displayName: name.isEmpty ? "我的官方帳號" : name)
        a.channelSecret = secret
        a.channelAccessToken = token
        accounts.append(a)
        var d = AccountData.sample
        d.store.name = a.displayName
        data[a.id] = d
        Persistence.saveAccounts(accounts)
        Persistence.saveData(d, for: a.id)
        settings.selectedAccountId = a.id
        log(.info, "新增帳號：\(a.displayName)")
        return a
    }

    func deleteAccount(_ id: UUID) {
        accounts.removeAll { $0.id == id }
        data[id] = nil
        webhookStatus[id] = nil
        Persistence.deleteAccountFiles(id)
        Persistence.saveAccounts(accounts)
        if settings.selectedAccountId == id { settings.selectedAccountId = accounts.first?.id }
    }

    /// 用 token 讀取官方帳號名稱、basic ID、頭像
    func refreshBotInfo(_ id: UUID) async throws {
        guard let a = account(id) else { return }
        let info = try await LineAPI(token: a.channelAccessToken).botInfo()
        updateAccount(id) {
            $0.botUserId = info.userId
            $0.basicId = info.basicId
            if !info.displayName.isEmpty { $0.displayName = info.displayName }
            $0.pictureURL = info.pictureUrl
        }
    }

    // MARK: - 開機自動啟動

    var launchAtLogin: Bool {
        get { SMAppService.mainApp.status == .enabled }
        set {
            do {
                if newValue { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            } catch {
                log(.error, "設定開機啟動失敗：\(error.localizedDescription)")
            }
        }
    }

    // MARK: - 排程

    private func tick() {
        tickCount += 1
        let now = Date()
        // 每 2 分鐘確認 Ollama 還在（關掉或重開都會自動切換）
        if tickCount % 4 == 0 { Task { await refreshOllama() } }
        for a in accounts {
            runConversationTimers(a.id, now: now)
            sendDailySummaryIfNeeded(a.id, now: now)
        }
        // 每 5 分鐘從外部檢查一次公開網址
        if tickCount % 10 == 0, tunnel.state == .running, let url = tunnel.publicURL {
            Task { @MainActor in
                let ok = await Self.probe(url + "/health")
                if ok {
                    self.healthFailures = 0
                } else {
                    self.healthFailures += 1
                    self.log(.warning, "外部健康檢查失敗（第 \(self.healthFailures) 次）")
                    if self.healthFailures >= 2 {
                        self.healthFailures = 0
                        self.notifyDisconnect("外部連不到 webhook，正在重新建立 Tunnel")
                        self.tunnel.restart()
                    }
                }
            }
        }
    }

    private func notifyDisconnect(_ reason: String) {
        guard !disconnectNotified else { return }
        disconnectNotified = true
        for a in accounts where a.hasCredentials && (data[a.id]?.rules.disconnectNotifyEnabled ?? true) {
            Task { @MainActor in
                await self.notifyOwners(a.id, [LineMessage.text("⚠️ Mac-Line-Bot 斷線通知\n\(reason)\nMac-Line-Bot 會自動重新連線，恢復後會再通知你。")])
            }
        }
    }

    // MARK: - 通知店家

    func notifyOwners(_ id: UUID, _ messages: [LineAPI.Message]) async {
        guard let a = account(id), a.hasCredentials else { return }
        guard !a.ownerUserIds.isEmpty else {
            accountLog(id, .warning, "尚未綁定店家 LINE，無法推播通知")
            return
        }
        let api = LineAPI(token: a.channelAccessToken)
        for owner in a.ownerUserIds {
            do {
                try await api.push(to: owner, messages)
                accountLog(id, "已推播通知給 ...\(owner.suffix(6))")
            } catch {
                accountLog(id, .error, "推播失敗：\(error.localizedDescription)")
            }
        }
    }
}
