import SwiftUI

struct ContentView: View {
    @EnvironmentObject var serverStore: ServerStore
    @StateObject private var notifications = NotificationManager()
    @State private var showSettings = false

    var body: some View {
        Group {
            if let url = serverStore.serverURL {
                PilotWebView(
                    url: url,
                    serverStore: serverStore,
                    showSettings: $showSettings
                )
                .sheet(isPresented: $showSettings) {
                    ConnectionView()
                }
                .onAppear {
                    notifications.requestPermission()
                    notifications.connectToServer(url: url)
                }
                .onDisappear {
                    notifications.disconnect()
                }
            } else {
                ConnectionView()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: serverStore.serverURL != nil)
        .onChange(of: serverStore.serverURL) { newURL in
            if let url = newURL {
                notifications.connectToServer(url: url)
            } else {
                notifications.disconnect()
            }
        }
    }
}
