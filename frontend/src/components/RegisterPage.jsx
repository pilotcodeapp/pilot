import { useState } from 'react'
import { API_URL } from '../utils'

export default function RegisterPage() {
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!username.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim().toLowerCase() }),
      })
      const data = await res.json()
      if (data.ok) {
        setResult(data)
      } else {
        setError(data.error || 'Registration failed')
      }
    } catch {
      setError('Connection failed. Please try again.')
    }
    setLoading(false)
  }

  function copyToken() {
    if (!result?.token) return
    navigator.clipboard.writeText(result.token).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    })
  }

  return (
    <div className="register-page">
      <div className="register-card">
        <img src="/favicon.svg" alt="Pilot" className="login-logo" />
        <div className="login-title">Pilot</div>

        {!result ? (
          <>
            <div className="login-subtitle">Get remote access to Pilot on your phone</div>
            <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="register-field">
                <input
                  type="text"
                  className="login-input"
                  placeholder="Choose a username"
                  value={username}
                  onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  maxLength={32}
                  autoFocus
                  autoComplete="username"
                />
                {username && (
                  <div className="register-preview">
                    Your URL will be <strong>{username}.claudepilot.us</strong>
                  </div>
                )}
              </div>
              {error && <div className="login-error">{error}</div>}
              <button className="login-btn" type="submit" disabled={username.length < 3 || loading}>
                {loading ? 'Setting up...' : 'Get access token'}
              </button>
            </form>
            <div className="register-prereqs">
              <div className="register-prereqs-title">Before you register, make sure you have:</div>
              <div className="register-prereq-item">
                <span className="register-check">1</span>
                <span><strong>Pilot</strong> installed on your Mac</span>
              </div>
              <div className="register-prereq-item">
                <span className="register-check">2</span>
                <span><strong>cloudflared</strong> installed — <code>brew install cloudflared</code></span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="register-success-badge">Account created</div>
            <div className="register-url">
              <span style={{ color: '#888', fontSize: 12 }}>Your permanent URL</span>
              <a href={result.url} className="register-url-link" target="_blank" rel="noopener">{result.url.replace('https://', '')}</a>
            </div>

            <div className="register-token-section">
              <div className="register-token-label">Your access token</div>
              <div className="register-token-box" onClick={copyToken}>
                {result.token.slice(0, 40)}...
              </div>
              <button className="login-btn" onClick={copyToken} style={{ marginTop: 4 }}>
                {copied ? 'Copied!' : 'Copy token'}
              </button>
              <div className="register-warning">
                Save this token — it will only be shown once.
              </div>
            </div>

            <div className="register-steps">
              <div className="register-steps-title">Next steps</div>
              <div className="register-step">
                <span className="register-check">1</span>
                <span>Open <strong>Pilot</strong> on your Mac</span>
              </div>
              <div className="register-step">
                <span className="register-check">2</span>
                <span>In the sidebar, toggle <strong>Remote Access</strong> on</span>
              </div>
              <div className="register-step">
                <span className="register-check">3</span>
                <span>Click <strong>"I have an access token"</strong></span>
              </div>
              <div className="register-step">
                <span className="register-check">4</span>
                <span>Paste your token + choose a password</span>
              </div>
              <div className="register-step">
                <span className="register-check">5</span>
                <span>Access Pilot from your phone at <strong>{result.url.replace('https://', '')}</strong></span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
