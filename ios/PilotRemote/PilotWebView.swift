import SwiftUI
import WebKit

struct PilotWebView: View {
    let url: URL
    @ObservedObject var serverStore: ServerStore
    @Binding var showSettings: Bool
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var webViewKey = UUID()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            WebViewWrapper(
                url: url,
                isLoading: $isLoading,
                loadError: $loadError,
                serverStore: serverStore
            )
            .id(webViewKey)
            .ignoresSafeArea(.container, edges: .bottom)

            // Floating action buttons — bottom-right to avoid overlapping web topbar
            VStack {
                Spacer()

                HStack {
                    Spacer()

                    VStack(spacing: 10) {
                        if isLoading {
                            ProgressView()
                                .tint(.white)
                                .scaleEffect(0.8)
                                .frame(width: 40, height: 40)
                                .background(.ultraThinMaterial)
                                .clipShape(Circle())
                        }

                        Button {
                            webViewKey = UUID()
                            loadError = nil
                        } label: {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(.white.opacity(0.7))
                                .frame(width: 40, height: 40)
                                .background(.ultraThinMaterial)
                                .clipShape(Circle())
                        }

                        Button {
                            showSettings = true
                        } label: {
                            Image(systemName: "gear")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(.white.opacity(0.7))
                                .frame(width: 40, height: 40)
                                .background(.ultraThinMaterial)
                                .clipShape(Circle())
                        }
                    }
                }
                .padding(.trailing, 16)
                .padding(.bottom, 80)
            }

            // Error overlay
            if let error = loadError {
                VStack(spacing: 16) {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.system(size: 40))
                        .foregroundColor(.red)

                    Text("Connection Lost")
                        .font(.headline)

                    Text(error)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)

                    Button("Retry") {
                        loadError = nil
                        webViewKey = UUID()
                    }
                    .buttonStyle(.borderedProminent)

                    Button("Change Server") {
                        serverStore.disconnect()
                    }
                    .buttonStyle(.bordered)
                }
                .padding(32)
                .background(.ultraThinMaterial)
                .cornerRadius(20)
                .padding(24)
            }
        }
    }
}

struct WebViewWrapper: UIViewRepresentable {
    let url: URL
    @Binding var isLoading: Bool
    @Binding var loadError: String?
    let serverStore: ServerStore

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true

        // Allow WebSocket connections
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.bounces = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black

        // Enable pull-to-refresh
        let refreshControl = UIRefreshControl()
        refreshControl.addTarget(context.coordinator, action: #selector(Coordinator.handleRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl

        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // No updates needed — view is created once
    }

    class Coordinator: NSObject, WKNavigationDelegate {
        var parent: WebViewWrapper

        init(_ parent: WebViewWrapper) {
            self.parent = parent
        }

        @objc func handleRefresh(_ sender: UIRefreshControl) {
            guard let webView = sender.superview?.superview as? WKWebView else {
                sender.endRefreshing()
                return
            }
            webView.reload()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                sender.endRefreshing()
            }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            DispatchQueue.main.async { self.parent.isLoading = true }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.async {
                self.parent.isLoading = false
                self.parent.loadError = nil
                self.parent.serverStore.connectionStatus = .connected
            }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            DispatchQueue.main.async {
                self.parent.isLoading = false
                self.parent.loadError = error.localizedDescription
                self.parent.serverStore.connectionStatus = .error(error.localizedDescription)
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            DispatchQueue.main.async {
                self.parent.isLoading = false
                self.parent.loadError = error.localizedDescription
            }
        }

        // Allow navigation to localhost/LAN addresses
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            .allow
        }
    }
}
