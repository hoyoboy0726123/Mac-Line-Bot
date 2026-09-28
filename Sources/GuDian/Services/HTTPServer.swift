import Foundation
import Network

struct HTTPRequest {
    var method: String
    var path: String
    var query: String
    var headers: [String: String]   // key 一律小寫
    var body: Data
}

struct HTTPResponse {
    var status: Int
    var body: Data
    var contentType: String = "text/plain; charset=utf-8"

    static func text(_ s: String, status: Int = 200) -> HTTPResponse {
        HTTPResponse(status: status, body: Data(s.utf8))
    }

    static func json(_ object: Any, status: Int = 200) -> HTTPResponse {
        let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
        return HTTPResponse(status: status, body: data, contentType: "application/json")
    }
}

/// 只綁在 127.0.0.1 的極簡 HTTP 伺服器，Cloudflare Tunnel 會把外部流量轉進來。
final class HTTPServer {
    typealias Handler = (HTTPRequest) async -> HTTPResponse

    private var listener: NWListener?
    private let queue = DispatchQueue(label: "tw.gudian.http")
    private let handler: Handler
    private(set) var port: UInt16 = 0

    var onStateChange: ((Bool, String?) -> Void)?

    init(handler: @escaping Handler) {
        self.handler = handler
    }

    var isRunning: Bool { listener != nil }

    func start(port: UInt16) throws {
        stop()
        guard let nwPort = NWEndpoint.Port(rawValue: port) else {
            throw NSError(domain: "GuDian", code: 1, userInfo: [NSLocalizedDescriptionKey: "連接埠不正確"])
        }
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: nwPort)
        let listener = try NWListener(using: params)
        listener.newConnectionHandler = { [weak self] conn in
            self?.accept(conn)
        }
        listener.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                self?.onStateChange?(true, nil)
            case .failed(let error):
                self?.onStateChange?(false, error.localizedDescription)
                self?.listener?.cancel()
                self?.listener = nil
            case .cancelled:
                self?.onStateChange?(false, nil)
            default:
                break
            }
        }
        self.port = port
        self.listener = listener
        listener.start(queue: queue)
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    // MARK: - 連線處理

    private func accept(_ conn: NWConnection) {
        conn.start(queue: queue)
        receive(conn, buffer: Data())
    }

    private func receive(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { conn.cancel(); return }
            var buf = buffer
            if let data { buf.append(data) }
            switch Self.parse(buf) {
            case .complete(let request):
                self.respond(conn, to: request)
            case .invalid:
                self.send(conn, HTTPResponse.text("Bad Request", status: 400))
            case .incomplete:
                if isComplete || error != nil || buf.count > 10_000_000 {
                    conn.cancel()
                } else {
                    self.receive(conn, buffer: buf)
                }
            }
        }
    }

    private func respond(_ conn: NWConnection, to request: HTTPRequest) {
        let handler = self.handler
        Task {
            let response = await handler(request)
            self.queue.async { self.send(conn, response) }
        }
    }

    private func send(_ conn: NWConnection, _ response: HTTPResponse) {
        var head = "HTTP/1.1 \(response.status) \(Self.reason(response.status))\r\n"
        head += "Content-Type: \(response.contentType)\r\n"
        head += "Content-Length: \(response.body.count)\r\n"
        head += "Connection: close\r\n\r\n"
        var data = Data(head.utf8)
        data.append(response.body)
        conn.send(content: data, completion: .contentProcessed { _ in conn.cancel() })
    }

    // MARK: - 解析

    enum ParseResult {
        case complete(HTTPRequest), incomplete, invalid
    }

    static func parse(_ data: Data) -> ParseResult {
        let separator = Data("\r\n\r\n".utf8)
        guard let range = data.range(of: separator) else { return .incomplete }
        guard let headString = String(data: data[data.startIndex..<range.lowerBound], encoding: .utf8) else { return .invalid }
        var lines = headString.components(separatedBy: "\r\n")
        guard !lines.isEmpty else { return .invalid }
        let requestLine = lines.removeFirst().split(separator: " ")
        guard requestLine.count >= 2 else { return .invalid }

        var headers: [String: String] = [:]
        for line in lines {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            headers[key] = value
        }
        let length = max(0, Int(headers["content-length"] ?? "0") ?? 0)
        let bodyStart = range.upperBound
        guard data.count - (bodyStart - data.startIndex) >= length else { return .incomplete }
        let body = data.subdata(in: bodyStart..<(bodyStart + length))

        let target = String(requestLine[1])
        let parts = target.split(separator: "?", maxSplits: 1).map(String.init)
        return .complete(HTTPRequest(
            method: String(requestLine[0]).uppercased(),
            path: parts.first ?? "/",
            query: parts.count > 1 ? parts[1] : "",
            headers: headers,
            body: body
        ))
    }

    static func reason(_ status: Int) -> String {
        switch status {
        case 200: "OK"
        case 400: "Bad Request"
        case 401: "Unauthorized"
        case 404: "Not Found"
        case 405: "Method Not Allowed"
        default: "Error"
        }
    }
}
