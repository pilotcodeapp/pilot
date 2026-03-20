import { useState, useCallback } from 'react'
import { API_URL } from '../utils'

export default function Sidebar({
  sidebarWidth,
  projectDir,
  setProjectDir,
  projects,
  onBrowseFolder,
  sessions,
  activeSessionIdx,
  loadSession,
  deleteSession,
  startNewChat,
  editingSessionIdx,
  setEditingSessionIdx,
  editingTitle,
  setEditingTitle,
  commitRename,
  startRename,
  contextUsage,
  contextWarning,
  mobileOpen,
  lanUrl,
  tunnel,
  onTunnelToggle,
}) {
  const [copied, setCopied] = useState(false)
  const [setupStep, setSetupStep] = useState(null) // null | 'login' | 'waiting' | 'creating' | 'done' | 'token'
  const [authUrl, setAuthUrl] = useState(null)
  const [tokenInput, setTokenInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [tokenSaving, setTokenSaving] = useState(false)
  const [showPwChange, setShowPwChange] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [pwChangeStatus, setPwChangeStatus] = useState(null)

  function copyUrl(url) {
    if (!url) return
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const startSetup = useCallback(async () => {
    setSetupStep('login')
    const res = await fetch(`${API_URL}/tunnel/setup/login`, { method: 'POST' })
    const data = await res.json()
    if (data.status === 'already_logged_in') {
      // Skip to create
      setSetupStep('creating')
      createTunnel()
    } else if (data.authUrl) {
      setAuthUrl(data.authUrl)
      setSetupStep('waiting')
      window.open(data.authUrl, '_blank')
      // Poll for login completion
      const poll = setInterval(async () => {
        const r = await fetch(`${API_URL}/tunnel/setup/login-status`)
        const d = await r.json()
        if (d.loggedIn) {
          clearInterval(poll)
          setSetupStep('creating')
          createTunnel()
        }
      }, 2000)
      // Stop polling after 5 minutes
      setTimeout(() => clearInterval(poll), 300000)
    } else {
      setSetupStep(null)
    }
  }, [])

  async function createTunnel() {
    const res = await fetch(`${API_URL}/tunnel/setup/create`, { method: 'POST' })
    const data = await res.json()
    if (data.status === 'created' || data.status === 'exists') {
      setSetupStep('done')
      const r = await fetch(`${API_URL}/tunnel/status`)
      const t = await r.json()
      setTimeout(() => setSetupStep(null), 2000)
    } else {
      setSetupStep(null)
    }
  }

  async function saveToken() {
    if (!tokenInput.trim() || !passwordInput.trim()) return
    if (passwordInput.length < 4) return
    setTokenSaving(true)
    // Set password first
    await fetch(`${API_URL}/auth/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passwordInput })
    })
    // Then save token
    const res = await fetch(`${API_URL}/tunnel/setup/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokenInput.trim() })
    })
    const data = await res.json()
    setTokenSaving(false)
    if (data.status === 'ok') {
      setSetupStep('done')
      setTokenInput('')
      setPasswordInput('')
      setTimeout(() => setSetupStep(null), 2000)
    } else {
      setSetupStep(null)
    }
  }

  async function changePassword() {
    if (newPassword.length < 4) return
    const res = await fetch(`${API_URL}/auth/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
      credentials: 'include',
    })
    const data = await res.json()
    if (data.ok) {
      setPwChangeStatus('saved')
      setNewPassword('')
      setTimeout(() => { setPwChangeStatus(null); setShowPwChange(false) }, 2000)
    } else {
      setPwChangeStatus('error')
    }
  }

  return (
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`} style={{ width: sidebarWidth }}>
      <div className="sidebar-top">
        <div className="sidebar-title">
          <img src="/favicon.svg" alt="Pilot" className="sidebar-logo" />
          Pilot
        </div>
        <button className="new-chat-btn" onClick={startNewChat}>
          + New chat
        </button>
      </div>

      <div className="sidebar-section-label">Project</div>
      <div className="project-selector">
        <select
          className="dir-select"
          value={projectDir}
          onChange={e => setProjectDir(e.target.value)}
        >
          <option value="">Home (~)</option>
          {projects.map(p => (
            <option key={p.path} value={p.path}>{p.name}</option>
          ))}
        </select>
        {onBrowseFolder && (
          <button className="browse-btn" onClick={onBrowseFolder} title="Browse for folder...">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 3.5C1 2.67 1.67 2 2.5 2h3.88a1 1 0 0 1 .7.29L8.5 3.71a1 1 0 0 0 .7.29H13.5c.83 0 1.5.67 1.5 1.5V12.5c0 .83-.67 1.5-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
          </button>
        )}
      </div>

      <div className="sidebar-section-label" style={{ marginTop: 16 }}>Sessions</div>
      <div className="session-list">
        {sessions.map((s, idx) => ({ session: s, idx })).filter(({ session }) => session.projectDir === projectDir).map(({ session: s, idx }) => (
          <div
            key={s.id}
            className={`sidebar-item ${activeSessionIdx === idx ? 'active' : ''}`}
            onClick={() => loadSession(idx)}
          >
            <div className="session-content">
              {editingSessionIdx === idx ? (
                <input
                  className="session-rename-input"
                  value={editingTitle}
                  onChange={e => setEditingTitle(e.target.value)}
                  onBlur={() => commitRename(idx)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename(idx)
                    if (e.key === 'Escape') setEditingSessionIdx(null)
                  }}
                  onClick={e => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <span className="session-title" onDoubleClick={(e) => startRename(idx, e)}>{s.title}</span>
              )}
            </div>
            <button className="session-delete" onClick={(e) => deleteSession(idx, e)}>x</button>
          </div>
        ))}
        {sessions.filter(s => s.projectDir === projectDir).length === 0 && (
          <div className="sidebar-empty">No saved sessions</div>
        )}
      </div>

      <div className="remote-section">
        <div className="remote-header">
          <span className="remote-label">Remote Access</span>
          <button
            className={`remote-toggle ${tunnel.status === 'running' ? 'on' : ''} ${tunnel.status === 'starting' ? 'starting' : ''}`}
            onClick={onTunnelToggle}
            disabled={tunnel.status === 'starting' || !!setupStep}
          >
            <span className="remote-toggle-knob" />
          </button>
        </div>

        {/* ── Guided setup wizard (triggered by toggle when not configured) ── */}
        {tunnel.setupNeeded === 'no_cloudflared' && !setupStep && (
          <div className="remote-wizard">
            <div className="remote-wizard-title">Install Cloudflare Tunnel</div>
            <div className="remote-wizard-text">
              Remote access requires a small utility called <strong>cloudflared</strong>.
            </div>
            <div className="remote-wizard-step">
              <span className="remote-wizard-num">1</span>
              <div>
                <div className="remote-wizard-cmd">brew install cloudflared</div>
                <div className="remote-hint">Run this in Terminal, then come back here.</div>
              </div>
            </div>
            <button className="remote-setup-btn" onClick={onTunnelToggle}>
              I've installed it — continue
            </button>
            <button className="remote-setup-btn cancel" onClick={() => onTunnelToggle()}>
              Cancel
            </button>
          </div>
        )}

        {tunnel.setupNeeded === 'no_config' && !setupStep && (
          <div className="remote-wizard">
            <div className="remote-wizard-title">Set up remote access</div>
            <div className="remote-wizard-text">
              How would you like to connect?
            </div>
            <button className="remote-setup-btn" onClick={() => setSetupStep('token')} style={{ marginBottom: 6 }}>
              I have an access token
            </button>
            <div className="remote-hint" style={{ textAlign: 'center', marginBottom: 6 }}>
              An admin can generate tokens with <code style={{ fontSize: 10, background: '#222', padding: '1px 4px', borderRadius: 3 }}>pilot-admin add-user</code>
            </div>
            <div className="remote-wizard-divider"><span>or</span></div>
            <button className="remote-setup-btn secondary" onClick={startSetup}>
              Set up with my own Cloudflare account
            </button>
            <div className="remote-hint" style={{ fontSize: 9 }}>
              Requires a Cloudflare account + domain
            </div>
          </div>
        )}

        {/* ── Setup flow states ── */}
        {setupStep === 'login' && (
          <div className="remote-status starting">Starting Cloudflare login...</div>
        )}
        {setupStep === 'waiting' && (
          <div className="remote-setup-waiting">
            <div className="remote-status starting">Complete sign-in in your browser</div>
            <div className="remote-hint">Waiting for authorization...</div>
          </div>
        )}
        {setupStep === 'creating' && (
          <div className="remote-status starting">Creating persistent tunnel...</div>
        )}
        {setupStep === 'done' && (
          <div className="remote-status" style={{ color: '#4caf50' }}>Connected!</div>
        )}

        {/* ── Token input ── */}
        {setupStep === 'token' && (
          <div className="remote-token-setup">
            <div className="remote-wizard-text">Paste the token from your admin:</div>
            <textarea
              className="remote-token-input"
              placeholder="Paste your access token here..."
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              rows={3}
              autoFocus
            />
            <div className="remote-wizard-text" style={{ marginTop: 4 }}>Choose a password for remote access:</div>
            <input
              type="password"
              className="remote-token-input"
              style={{ fontFamily: 'inherit', resize: 'none' }}
              placeholder="Password (4+ characters)"
              value={passwordInput}
              onChange={e => setPasswordInput(e.target.value)}
            />
            <div className="remote-hint">Required when accessing Pilot from your phone or another device.</div>
            <div className="remote-token-actions">
              <button className="remote-setup-btn" onClick={saveToken} disabled={!tokenInput.trim() || passwordInput.length < 4 || tokenSaving}>
                {tokenSaving ? 'Connecting...' : 'Connect'}
              </button>
              <button className="remote-setup-btn cancel" onClick={() => { setSetupStep(null); setTokenInput(''); setPasswordInput('') }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Active tunnel display ── */}
        {!setupStep && !tunnel.setupNeeded && tunnel.status === 'starting' && (
          <div className="remote-status starting">Connecting...</div>
        )}
        {!setupStep && tunnel.status === 'running' && tunnel.url && (
          <>
            <span className="remote-url" onClick={() => copyUrl(tunnel.url)} title="Click to copy">
              {tunnel.url.replace('https://', '')}
            </span>
            {copied && <div className="remote-copied">Copied!</div>}
            {tunnel.persistent && <div className="remote-persistent-badge">Persistent URL</div>}
            <img
              className="remote-qr"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(tunnel.url)}&bgcolor=161616&color=cccccc`}
              alt="QR Code"
            />
            <div className="remote-hint">Scan with your phone camera</div>
          </>
        )}

        {/* ── Change password ── */}
        {tunnel.configured && !setupStep && (
          showPwChange ? (
            <div className="remote-token-setup">
              <input
                type="password"
                className="remote-token-input"
                style={{ fontFamily: 'inherit' }}
                placeholder="New password (4+ characters)"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                autoFocus
              />
              {pwChangeStatus === 'saved' && <div className="remote-status" style={{ color: '#4caf50', fontSize: 11 }}>Password updated!</div>}
              {pwChangeStatus === 'error' && <div className="remote-status" style={{ color: '#e57373', fontSize: 11 }}>Failed to update</div>}
              <div className="remote-token-actions">
                <button className="remote-setup-btn" onClick={changePassword} disabled={newPassword.length < 4}>Save</button>
                <button className="remote-setup-btn cancel" onClick={() => { setShowPwChange(false); setNewPassword(''); setPwChangeStatus(null) }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="remote-pw-change" onClick={() => setShowPwChange(true)}>Change password</button>
          )
        )}

        {/* ── Stopped (configured, just off) ── */}
        {!setupStep && !tunnel.setupNeeded && tunnel.status === 'stopped' && (
          <>
            {tunnel.configured && tunnel.tunnelUrl && (
              <div className="remote-hint" style={{ color: '#888' }}>
                Persistent URL configured
              </div>
            )}
            {lanUrl && (
              <span className="remote-url lan" onClick={() => copyUrl(lanUrl)} title="Click to copy — same WiFi only">
                LAN: {lanUrl.replace('http://', '')}
              </span>
            )}
          </>
        )}
      </div>

      {contextUsage.total > 0 && (
        <div className={`context-meter ${contextUsage.pct >= 80 ? 'warning' : ''} ${contextWarning === 'compacted' ? 'compacted' : ''}`}
          title={contextWarning === 'compacted'
            ? `Context compacted — earlier messages were summarized to free space. ${Math.round(contextUsage.used / 1000)}k / ${Math.round(contextUsage.total / 1000)}k tokens`
            : `${Math.round(contextUsage.used / 1000)}k / ${Math.round(contextUsage.total / 1000)}k tokens used`}>
          <div className="context-bar-row">
            <div className="context-bar">
              <div className="context-bar-fill" style={{ width: `${Math.min(contextUsage.pct, 100)}%` }} />
            </div>
            {contextWarning === 'compacted'
              ? <span className="context-compacted-label">compacted</span>
              : <span className="context-label">{contextUsage.pct}%</span>
            }
          </div>
          <span className="context-title">context</span>
        </div>
      )}
    </aside>
  )
}
