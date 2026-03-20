import { useState } from 'react'
import { CENTRAL_URL } from '../utils'

export default function AccountScreen({ onComplete }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return
    setLoading(true)
    setError(null)

    // Generate a unique install ID
    let installId = localStorage.getItem('pilot_install_id')
    if (!installId) {
      installId = crypto.randomUUID()
      localStorage.setItem('pilot_install_id', installId)
    }

    try {
      const res = await fetch(`${CENTRAL_URL}/api/accounts/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), installId }),
      })
      const data = await res.json()
      if (data.ok) {
        localStorage.setItem('pilot_account', JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          installId,
          plan: data.plan || 'free',
          registeredAt: new Date().toISOString(),
        }))
        onComplete()
      } else {
        setError(data.error || 'Registration failed')
      }
    } catch {
      // If central server is unreachable, allow through (offline mode)
      localStorage.setItem('pilot_account', JSON.stringify({
        name: name.trim(),
        email: email.trim(),
        installId,
        plan: 'free',
        registeredAt: new Date().toISOString(),
        pendingSync: true,
      }))
      onComplete()
    }
    setLoading(false)
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <img src="/favicon.svg" alt="Pilot" className="login-logo" />
        <div className="login-title">Welcome to Pilot</div>
        <div className="login-subtitle">Create your account to get started</div>
        <input
          type="text"
          className="login-input"
          placeholder="Your name"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
          autoComplete="name"
        />
        <input
          type="email"
          className="login-input"
          placeholder="Email address"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
        />
        {error && <div className="login-error">{error}</div>}
        <button className="login-btn" type="submit" disabled={!name.trim() || !email.trim() || loading}>
          {loading ? 'Creating account...' : 'Continue'}
        </button>
        <div className="account-fine-print">
          Your email is used for account recovery and important updates only.
        </div>
      </form>
    </div>
  )
}
