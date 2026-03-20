import SwiftUI
import Combine

class ServerStore: ObservableObject {
    @Published var serverURL: URL?
    @Published var connectionStatus: ConnectionStatus = .disconnected
    @Published var savedServers: [SavedServer] = []

    private let urlKey = "pilot_server_url"
    private let serversKey = "pilot_saved_servers"

    enum ConnectionStatus: Equatable {
        case disconnected
        case connecting
        case connected
        case error(String)
    }

    struct SavedServer: Codable, Identifiable, Equatable {
        var id: String { url }
        let url: String
        let name: String
        let lastUsed: Date
    }

    init() {
        if let saved = UserDefaults.standard.string(forKey: urlKey),
           let url = URL(string: saved) {
            self.serverURL = url
        }
        loadSavedServers()
    }

    func connect(to urlString: String) {
        var normalized = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        if !normalized.hasPrefix("http://") && !normalized.hasPrefix("https://") {
            normalized = "http://\(normalized)"
        }
        // Ensure trailing slash is removed for clean URLs
        if normalized.hasSuffix("/") {
            normalized = String(normalized.dropLast())
        }

        guard let url = URL(string: normalized) else {
            connectionStatus = .error("Invalid URL")
            return
        }

        connectionStatus = .connecting

        // Test the connection by hitting /network-info
        let testURL = url.appendingPathComponent("network-info")
        URLSession.shared.dataTask(with: testURL) { [weak self] data, response, error in
            DispatchQueue.main.async {
                if let error = error {
                    self?.connectionStatus = .error(error.localizedDescription)
                    return
                }
                guard let httpResponse = response as? HTTPURLResponse,
                      httpResponse.statusCode == 200 else {
                    self?.connectionStatus = .error("Server not responding")
                    return
                }

                self?.serverURL = url
                self?.connectionStatus = .connected
                UserDefaults.standard.set(normalized, forKey: self?.urlKey ?? "")
                self?.addSavedServer(url: normalized, name: url.host ?? normalized)
            }
        }.resume()
    }

    func disconnect() {
        serverURL = nil
        connectionStatus = .disconnected
        UserDefaults.standard.removeObject(forKey: urlKey)
    }

    private func loadSavedServers() {
        guard let data = UserDefaults.standard.data(forKey: serversKey),
              let servers = try? JSONDecoder().decode([SavedServer].self, from: data) else { return }
        savedServers = servers.sorted { $0.lastUsed > $1.lastUsed }
    }

    private func addSavedServer(url: String, name: String) {
        savedServers.removeAll { $0.url == url }
        savedServers.insert(SavedServer(url: url, name: name, lastUsed: Date()), at: 0)
        if savedServers.count > 10 { savedServers = Array(savedServers.prefix(10)) }
        if let data = try? JSONEncoder().encode(savedServers) {
            UserDefaults.standard.set(data, forKey: serversKey)
        }
    }
}
