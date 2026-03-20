import Foundation
import UserNotifications
import UIKit
import Combine

class NotificationManager: ObservableObject {
    @Published var isRegistered = false
    private var deviceToken: String?
    private var cancellable: AnyCancellable?
    private var webSocketTask: URLSessionWebSocketTask?
    private var serverURL: URL?

    init() {
        // Listen for device token from AppDelegate
        cancellable = NotificationCenter.default.publisher(for: .didReceiveDeviceToken)
            .compactMap { $0.object as? String }
            .sink { [weak self] token in
                self?.deviceToken = token
                self?.registerWithServer()
            }
    }

    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            DispatchQueue.main.async {
                self.isRegistered = granted
                if granted {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        }
    }

    func connectToServer(url: URL) {
        self.serverURL = url
        registerWithServer()
        connectWebSocket(url: url)
    }

    func disconnect() {
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
    }

    private func registerWithServer() {
        guard let serverURL = serverURL, let token = deviceToken else { return }
        var request = URLRequest(url: serverURL.appendingPathComponent("push/register"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(["token": token, "platform": "ios"])
        URLSession.shared.dataTask(with: request).resume()
    }

    /// Listens on the WebSocket for task_complete events and fires local notifications
    /// This works immediately without any APNS configuration
    private func connectWebSocket(url: URL) {
        webSocketTask?.cancel(with: .normalClosure, reason: nil)

        var wsURL = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        wsURL.scheme = url.scheme == "https" ? "wss" : "ws"
        guard let resolvedURL = wsURL.url else { return }

        let task = URLSession.shared.webSocketTask(with: resolvedURL)
        self.webSocketTask = task
        task.resume()
        receiveMessage()
    }

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            switch result {
            case .success(let message):
                if case .string(let text) = message {
                    self?.handleMessage(text)
                }
                self?.receiveMessage() // Continue listening
            case .failure:
                // Reconnect after a delay
                DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                    if let url = self?.serverURL {
                        self?.connectWebSocket(url: url)
                    }
                }
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }

        // Listen for session_end events (task completion)
        if json["type"] as? String == "session_end" {
            let code = json["code"] as? Int ?? 0
            let title = code == 0 ? "Task Complete" : "Task Ended"
            let body = code == 0 ? "Claude finished working on your request." : "Claude stopped (exit code \(code))."
            sendLocalNotification(title: title, body: body)
        }
    }

    private func sendLocalNotification(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil // Fire immediately
        )
        UNUserNotificationCenter.current().add(request)
    }
}
