import { useState, useEffect } from 'react'
import { API_URL } from '../utils'

export default function SetupScreen({ onComplete }) {
  const [installing, setInstalling] = useState(false)
  const [status, setStatus] = useState(null) // null | 'installing' | 'auth_needed' | 'no_node' | 'error'
  const [error, setError] = useState('')
  const [health, setHealth] = useState(null)

  async function checkHealth() {
    try {
      const res = await fetch(`${API_URL}/health`)
      const data = await res.json()
      setHealth(data)
      return data
    } catch {
      return null
    }
  }

  useEffect(() => { checkHealth() }, [])

  async function handleInstall() {
    // Check if Node.js is available first
    const h = health || await checkHealth()
    if (h && !h.node?.installed) {
      setStatus('no_node')
      return
    }

    setInstalling(true)
    setStatus('installing')
    setError('')
    try {
      const res = await fetch(`${API_URL}/setup/install-claude`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        const updated = await checkHealth()
        if (updated?.claude?.authenticated) {
          onComplete()
        } else {
          setStatus('auth_needed')
        }
      } else {
        setError(data.error || 'Installation failed')
        setStatus('error')
      }
    } catch (e) {
      setError(e.message)
      setStatus('error')
    }
    setInstalling(false)
  }

  async function handleRetry() {
    setStatus(null)
    setError('')
    const h = await checkHealth()
    if (h?.claude?.installed && h?.claude?.authenticated) {
      onComplete()
    } else if (h?.claude?.installed) {
      setStatus('auth_needed')
    }
  }

  const nodeInstalled = health?.node?.installed
  const nodeVersion = health?.node?.version
  const nodeVersionWarning = health?.node?.versionWarning

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-logo">Pilot</div>
        <p className="setup-subtitle">A conversational desktop app for Claude Code</p>

        {!status && (
          <>
            <div className="setup-section">
              <h3>Get started</h3>
              <p>Pilot needs Claude Code to be installed and authenticated on your machine.</p>
              <div className="setup-prereqs">
                <div className="setup-prereq">
                  <span className="setup-prereq-icon">1</span>
                  <div>
                    <strong>Claude Pro or Max subscription</strong>
                    <p>Claude Code runs on your existing Anthropic subscription — no API key needed.</p>
                  </div>
                </div>
                <div className={`setup-prereq ${nodeInstalled && !nodeVersionWarning ? 'setup-prereq-ok' : 'setup-prereq-warn'}`}>
                  <span className="setup-prereq-icon">{nodeInstalled && !nodeVersionWarning ? '\u2713' : '2'}</span>
                  <div>
                    <strong>Node.js (v20+)</strong>
                    {nodeInstalled && !nodeVersionWarning
                      ? <p>Installed — {nodeVersion}</p>
                      : nodeVersionWarning
                        ? <p style={{ color: '#ffa726' }}>{nodeVersionWarning}. <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="setup-link">Download Node.js v20+</a> or upgrade via Terminal:</p>
                        : <p>Not detected. <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="setup-link">Download Node.js</a> or install via Terminal:</p>
                    }
                    {!nodeInstalled && (
                      <>
                        <div className="setup-code" style={{ marginTop: 6, marginBottom: 4 }}>
                          <div style={{ marginBottom: 4, color: '#888', fontSize: 11 }}>macOS (Homebrew):</div>
                          brew install node
                        </div>
                        <div className="setup-code" style={{ marginTop: 4 }}>
                          <div style={{ marginBottom: 4, color: '#888', fontSize: 11 }}>Or with nvm:</div>
                          curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash<br />
                          nvm install 20
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <button className="setup-btn" onClick={handleInstall} disabled={installing}>
              Install Claude Code
            </button>
            <button className="setup-btn-secondary" onClick={handleRetry}>
              I already have it — check again
            </button>
          </>
        )}

        {status === 'no_node' && (
          <div className="setup-section">
            <h3>Node.js required</h3>
            <p>Claude Code needs Node.js to install and run. Choose one of these options:</p>
            <div className="setup-prereq" style={{ marginTop: 12, marginBottom: 12 }}>
              <span className="setup-prereq-icon">A</span>
              <div>
                <strong>Download from nodejs.org</strong>
                <p>The easiest option. Download the LTS installer for Mac:</p>
                <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="setup-link">nodejs.org</a>
              </div>
            </div>
            <div className="setup-prereq" style={{ marginBottom: 12 }}>
              <span className="setup-prereq-icon">B</span>
              <div>
                <strong>Install via Homebrew</strong>
                <p>If you have Homebrew, run this in Terminal:</p>
                <div className="setup-code">brew install node</div>
              </div>
            </div>
            <div className="setup-prereq" style={{ marginBottom: 12 }}>
              <span className="setup-prereq-icon">C</span>
              <div>
                <strong>Install via nvm (version manager)</strong>
                <p>Recommended if you work with multiple Node versions:</p>
                <div className="setup-code">
                  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash<br />
                  nvm install 20
                </div>
              </div>
            </div>
            <p className="setup-hint">After installing Node.js, quit and reopen Pilot, or click below:</p>
            <button className="setup-btn" onClick={handleRetry}>
              I've installed Node — check again
            </button>
          </div>
        )}

        {status === 'installing' && (
          <div className="setup-section">
            <div className="setup-spinner" />
            <p>Installing Claude Code...</p>
            <p className="setup-hint">This may take a minute.</p>
          </div>
        )}

        {status === 'auth_needed' && (
          <div className="setup-section">
            <h3>Almost there — sign in to Claude</h3>
            <p>Claude Code is installed but needs to be authenticated. Open Terminal and run:</p>
            <div className="setup-code">claude</div>
            <p className="setup-hint">This will open your browser to sign in with your Anthropic account. Once authenticated, come back here.</p>
            <button className="setup-btn" onClick={handleRetry}>
              I've signed in — check again
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="setup-section">
            <h3>Something went wrong</h3>
            <p className="setup-error">{error}</p>
            <p className="setup-hint">You can also install manually by running this in Terminal:</p>
            <div className="setup-code">npm install -g @anthropic-ai/claude-code</div>
            <button className="setup-btn" onClick={handleRetry}>
              Check again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
