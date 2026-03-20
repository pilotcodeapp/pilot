import Foundation
import Network

class BonjourDiscovery: ObservableObject {
    @Published var servers: [DiscoveredServer] = []

    private var browser: NWBrowser?

    struct DiscoveredServer: Identifiable, Equatable {
        let id = UUID()
        let name: String
        let url: String
    }

    func startSearching() {
        let params = NWParameters()
        params.includePeerToPeer = true

        let browser = NWBrowser(for: .bonjour(type: "_pilot._tcp", domain: nil), using: params)
        self.browser = browser

        browser.browseResultsChangedHandler = { [weak self] results, changes in
            DispatchQueue.main.async {
                self?.handleResults(results)
            }
        }

        browser.stateUpdateHandler = { state in
            // Browser state changes (ready, failed, etc.)
        }

        browser.start(queue: .main)
    }

    func stopSearching() {
        browser?.cancel()
        browser = nil
    }

    private func handleResults(_ results: Set<NWBrowser.Result>) {
        var discovered: [DiscoveredServer] = []

        for result in results {
            if case .service(let name, _, _, _) = result.endpoint {
                // Resolve the service to get host and port
                resolveService(result: result, name: name) { [weak self] server in
                    if let server = server {
                        DispatchQueue.main.async {
                            if !(self?.servers.contains(where: { $0.url == server.url }) ?? true) {
                                self?.servers.append(server)
                            }
                        }
                    }
                }
                // Also add with name immediately (will be updated with resolved URL)
                discovered.append(DiscoveredServer(name: name, url: ""))
            }
        }
    }

    private func resolveService(result: NWBrowser.Result, name: String, completion: @escaping (DiscoveredServer?) -> Void) {
        let connection = NWConnection(to: result.endpoint, using: .tcp)
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                if let endpoint = connection.currentPath?.remoteEndpoint,
                   case .hostPort(let host, let port) = endpoint {
                    var hostStr: String
                    switch host {
                    case .ipv4(let addr):
                        hostStr = "\(addr)"
                    case .ipv6(let addr):
                        hostStr = "\(addr)"
                    default:
                        hostStr = "\(host)"
                    }
                    // Strip interface name suffix (e.g. "%en0")
                    if let pctIdx = hostStr.firstIndex(of: "%") {
                        hostStr = String(hostStr[hostStr.startIndex..<pctIdx])
                    }
                    let url = "http://\(hostStr):\(port)"
                    completion(DiscoveredServer(name: name, url: url))
                }
                connection.cancel()
            case .failed:
                completion(nil)
                connection.cancel()
            default:
                break
            }
        }
        connection.start(queue: .global())
    }
}
