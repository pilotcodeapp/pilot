import SwiftUI

struct ConnectionView: View {
    @EnvironmentObject var serverStore: ServerStore
    @StateObject private var discovery = BonjourDiscovery()
    @State private var urlInput = ""
    @State private var isEditing = false
    @Environment(\.dismiss) private var dismiss

    private var isSheet: Bool {
        serverStore.serverURL != nil
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 32) {
                    // Header
                    VStack(spacing: 8) {
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 48))
                            .foregroundStyle(
                                LinearGradient(
                                    colors: [.orange, .pink],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .padding(.bottom, 8)

                        Text("Pilot Remote")
                            .font(.title.bold())

                        Text("Connect to your Mac running Pilot")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .padding(.top, isSheet ? 8 : 40)

                    // Manual URL entry
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Server Address")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .textCase(.uppercase)
                            .tracking(0.5)

                        HStack(spacing: 10) {
                            TextField("192.168.1.100:3001", text: $urlInput)
                                .textFieldStyle(.plain)
                                .keyboardType(.URL)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .padding(12)
                                .background(Color(.systemGray6))
                                .cornerRadius(10)
                                .onSubmit { connect() }

                            Button(action: connect) {
                                Group {
                                    if case .connecting = serverStore.connectionStatus {
                                        ProgressView()
                                            .tint(.white)
                                    } else {
                                        Image(systemName: "arrow.right")
                                            .fontWeight(.semibold)
                                    }
                                }
                                .frame(width: 44, height: 44)
                                .background(urlInput.isEmpty ? Color.gray : Color.blue)
                                .foregroundColor(.white)
                                .cornerRadius(10)
                            }
                            .disabled(urlInput.isEmpty)
                        }

                        if case .error(let message) = serverStore.connectionStatus {
                            Label(message, systemImage: "exclamationmark.triangle.fill")
                                .font(.caption)
                                .foregroundColor(.red)
                        }
                    }

                    // Discovered servers
                    if !discovery.servers.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text("Discovered on Network")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                    .textCase(.uppercase)
                                    .tracking(0.5)

                                Spacer()

                                ProgressView()
                                    .scaleEffect(0.7)
                            }

                            ForEach(discovery.servers) { server in
                                Button {
                                    urlInput = server.url
                                    connect()
                                } label: {
                                    HStack {
                                        Image(systemName: "desktopcomputer")
                                            .foregroundColor(.blue)
                                            .frame(width: 32)

                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(server.name)
                                                .font(.body)
                                                .foregroundColor(.primary)
                                            Text(server.url)
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        }

                                        Spacer()

                                        Image(systemName: "chevron.right")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                    .padding(12)
                                    .background(Color(.systemGray6))
                                    .cornerRadius(10)
                                }
                            }
                        }
                    }

                    // Saved servers
                    if !serverStore.savedServers.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Recent Servers")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .textCase(.uppercase)
                                .tracking(0.5)

                            ForEach(serverStore.savedServers) { server in
                                Button {
                                    urlInput = server.url
                                    connect()
                                } label: {
                                    HStack {
                                        Image(systemName: "clock")
                                            .foregroundColor(.secondary)
                                            .frame(width: 32)

                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(server.name)
                                                .font(.body)
                                                .foregroundColor(.primary)
                                            Text(server.url)
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        }

                                        Spacer()

                                        Image(systemName: "chevron.right")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                    .padding(12)
                                    .background(Color(.systemGray6))
                                    .cornerRadius(10)
                                }
                            }
                        }
                    }

                    // Help text
                    VStack(spacing: 8) {
                        Text("Make sure Pilot is running on your Mac")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Text("Your Mac and iPhone must be on the same network, or connected via Tailscale")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 8)
                }
                .padding(24)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if isSheet {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button("Done") { dismiss() }
                    }
                }
            }
        }
        .onAppear {
            discovery.startSearching()
        }
        .onDisappear {
            discovery.stopSearching()
        }
    }

    private func connect() {
        serverStore.connect(to: urlInput)
    }
}
