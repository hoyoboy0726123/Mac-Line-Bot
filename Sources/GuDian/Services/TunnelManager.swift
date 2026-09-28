import Foundation
import Observation

/// 管理 cloudflared：Quick Tunnel（xxx.trycloudflare.com）或自訂網域的 named tunnel。
@Observable
@MainActor
final class TunnelManager {
    enum State: Equatable {
        case stopped
        case starting
        case running
        case failed(String)

        var label: String {
            switch self {
            case .stopped: "已停止"
            case .starting: "連線中"
            case .running: "已連線"
            case .failed: "連線失敗"
            }
        }
    }

    private(set) var state: State = .stopped
    private(set) var publicURL: String?
    private(set) var connectionCount = 0
    private(set) var pid: Int32?

    /// 取得/變更公開網址時呼叫（Quick Tunnel 每次重啟網址都會變）
    var onURLChange: ((String) -> Void)?
    var onDisconnect: ((String) -> Void)?
    var log: ((LogLevel, String) -> Void)?

    private var process: Process?
    private var shouldRun = false
    private var restartDelay: Double = 3
    private var lastConfig: (port: UInt16, mode: TunnelMode, token: String, hostname: String, customPath: String)?

    // MARK: cloudflared 位置

    nonisolated static var bundledPath: String { Persistence.binDir.appendingPathComponent("cloudflared").path }

    nonisolated static func locate(custom: String = "") -> String? {
        let candidates = [custom, bundledPath, "/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared", "/usr/bin/cloudflared"]
        return candidates.first { !$0.isEmpty && FileManager.default.isExecutableFile(atPath: $0) }
    }

    /// 直接從 Cloudflare 官方 GitHub 下載 cloudflared 放到 App 資料夾
    nonisolated static func install() async throws -> String {
        #if arch(arm64)
        let asset = "cloudflared-darwin-arm64.tgz"
        #else
        let asset = "cloudflared-darwin-amd64.tgz"
        #endif
        let url = URL(string: "https://github.com/cloudflare/cloudflared/releases/latest/download/\(asset)")!
        let (tmp, response) = try await URLSession.shared.download(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw NSError(domain: "GuDian", code: 2, userInfo: [NSLocalizedDescriptionKey: "下載 cloudflared 失敗"])
        }
        let dir = Persistence.binDir
        let tar = Process()
        tar.executableURL = URL(fileURLWithPath: "/usr/bin/tar")
        tar.arguments = ["-xzf", tmp.path, "-C", dir.path]
        try tar.run()
        tar.waitUntilExit()
        let path = bundledPath
        guard FileManager.default.fileExists(atPath: path) else {
            throw NSError(domain: "GuDian", code: 3, userInfo: [NSLocalizedDescriptionKey: "解壓縮 cloudflared 失敗"])
        }
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: path)
        let xattr = Process()
        xattr.executableURL = URL(fileURLWithPath: "/usr/bin/xattr")
        xattr.arguments = ["-d", "com.apple.quarantine", path]
        try? xattr.run()
        xattr.waitUntilExit()
        return path
    }

    // MARK: 啟動 / 停止

    func start(port: UInt16, mode: TunnelMode, token: String, hostname: String, customPath: String) {
        stopProcess()
        shouldRun = true
        lastConfig = (port, mode, token, hostname, customPath)
        guard let binary = Self.locate(custom: customPath) else {
            state = .failed("找不到 cloudflared，請到「LINE 連線」頁面一鍵安裝")
            log?(.error, "找不到 cloudflared")
            return
        }

        let p = Process()
        p.executableURL = URL(fileURLWithPath: binary)
        switch mode {
        case .quick:
            p.arguments = ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:\(port)"]
        case .named:
            guard !token.isEmpty, !hostname.isEmpty else {
                state = .failed("自訂網域模式需要 Tunnel Token 與網域")
                return
            }
            p.arguments = ["tunnel", "--no-autoupdate", "run", "--token", token]
            publicURL = "https://" + Self.cleanHost(hostname)
        }

        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            Task { @MainActor in self?.consume(text) }
        }
        p.terminationHandler = { [weak self] proc in
            let code = proc.terminationStatus
            Task { @MainActor in self?.handleExit(proc, code: code) }
        }

        state = .starting
        connectionCount = 0
        do {
            try p.run()
            process = p
            pid = p.processIdentifier
            log?(.info, "cloudflared 已啟動 pid \(p.processIdentifier)")
        } catch {
            state = .failed(error.localizedDescription)
            log?(.error, "cloudflared 啟動失敗：\(error.localizedDescription)")
        }
    }

    func restart() {
        guard let c = lastConfig else { return }
        start(port: c.port, mode: c.mode, token: c.token, hostname: c.hostname, customPath: c.customPath)
    }

    func stop() {
        shouldRun = false
        stopProcess()
        state = .stopped
        if lastConfig?.mode == .quick { publicURL = nil }
    }

    private func stopProcess() {
        if let p = process {
            p.terminationHandler = nil
            (p.standardOutput as? Pipe)?.fileHandleForReading.readabilityHandler = nil
            if p.isRunning { p.terminate() }
        }
        process = nil
        pid = nil
    }

    // MARK: 輸出解析

    private static let quickURLRegex = try! NSRegularExpression(pattern: "https://[a-z0-9-]+\\.trycloudflare\\.com")

    private func consume(_ text: String) {
        for line in text.split(whereSeparator: \.isNewline) {
            let line = String(line)
            let range = NSRange(line.startIndex..., in: line)
            if let m = Self.quickURLRegex.firstMatch(in: line, range: range),
               let r = Range(m.range, in: line) {
                let url = String(line[r])
                if url != publicURL, !url.contains("api.trycloudflare.com") {
                    publicURL = url
                    log?(.info, "Quick Tunnel 網址：\(url)，等待 DNS 生效")
                    onURLChange?(url)
                }
            }
            if line.contains("Registered tunnel connection") {
                connectionCount += 1
                state = .running
                restartDelay = 3
                log?(.info, Self.shorten(line))
                if lastConfig?.mode == .named, connectionCount == 1, let url = publicURL {
                    onURLChange?(url)
                }
            } else if line.contains(" ERR ") {
                log?(.warning, Self.shorten(line))
            }
        }
    }

    private func handleExit(_ proc: Process, code: Int32) {
        guard proc === process else { return }
        process = nil
        pid = nil
        let message = "cloudflared 已結束（代碼 \(code)）"
        log?(.warning, message)
        guard shouldRun else { state = .stopped; return }
        state = .failed(message)
        onDisconnect?(message)
        let delay = restartDelay
        restartDelay = min(restartDelay * 2, 60)
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard let self, self.shouldRun, self.process == nil else { return }
            self.log?(.info, "嘗試重新連線 Tunnel…")
            self.restart()
        }
    }

    // MARK: 工具

    static func cleanHost(_ host: String) -> String {
        var h = host.trimmingCharacters(in: .whitespacesAndNewlines)
        for prefix in ["https://", "http://"] where h.hasPrefix(prefix) {
            h.removeFirst(prefix.count)
        }
        while h.hasSuffix("/") { h.removeLast() }
        return h
    }

    private static func shorten(_ line: String) -> String {
        // cloudflared 格式：2024-01-01T00:00:00Z INF xxx
        let parts = line.split(separator: " ", maxSplits: 2)
        return parts.count == 3 ? String(parts[2]) : line
    }
}
