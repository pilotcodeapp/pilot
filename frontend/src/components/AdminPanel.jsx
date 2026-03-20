import { useState, useEffect, useCallback } from 'react'
import { API_URL } from '../utils'

export default function AdminPanel() {
  const [tab, setTab] = useState('accounts')
  const [users, setUsers] = useState([])
  const [accounts, setAccounts] = useState([])
  const [domain, setDomain] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const [usersRes, accountsRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/users`),
        fetch(`${API_URL}/api/admin/accounts`),
      ])
      const usersData = await usersRes.json()
      const accountsData = await accountsRes.json()

      if (usersData.error && !usersData.users) {
        setError(usersData.error)
      } else {
        setUsers(usersData.users || [])
        setDomain(usersData.domain || '')
        setError(usersData.error || null)
      }
      setAccounts(Array.isArray(accountsData) ? accountsData : [])
    } catch {
      setError('Failed to connect to server')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleDelete(username) {
    setDeleting(username)
    try {
      const res = await fetch(`${API_URL}/api/admin/users/${username}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.ok) {
        setUsers(prev => prev.filter(u => u.username !== username))
      }
    } catch {}
    setDeleting(null)
    setConfirmDelete(null)
  }

  const activeRemote = users.filter(u => u.active).length
  const recentAccounts = accounts.filter(a => {
    const seen = new Date(a.lastSeen)
    return (Date.now() - seen.getTime()) < 7 * 24 * 60 * 60 * 1000
  }).length

  function timeAgo(dateStr) {
    if (!dateStr) return '—'
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  }

  return (
    <div className="admin-page">
      <div className="admin-container">
        <div className="admin-header">
          <div className="admin-header-left">
            <a href="/" className="admin-back">&larr; Back to Pilot</a>
            <h1 className="admin-title">Admin</h1>
          </div>
        </div>

        <div className="admin-stats">
          <div className="admin-stat">
            <span className="admin-stat-value">{accounts.length}</span>
            <span className="admin-stat-label">Total accounts</span>
          </div>
          <div className="admin-stat">
            <span className="admin-stat-value active">{recentAccounts}</span>
            <span className="admin-stat-label">Active (7d)</span>
          </div>
          <div className="admin-stat">
            <span className="admin-stat-value">{users.length}</span>
            <span className="admin-stat-label">Remote tunnels</span>
          </div>
          <div className="admin-stat">
            <span className="admin-stat-value active">{activeRemote}</span>
            <span className="admin-stat-label">Online now</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="admin-tabs">
          <button className={`admin-tab ${tab === 'accounts' ? 'active' : ''}`} onClick={() => setTab('accounts')}>
            All Users ({accounts.length})
          </button>
          <button className={`admin-tab ${tab === 'remote' ? 'active' : ''}`} onClick={() => setTab('remote')}>
            Remote Access ({users.length})
          </button>
        </div>

        {error && (
          <div className="admin-error">
            {error === 'Admin not configured' ? (
              <>
                <strong>Admin not configured.</strong> Run <code>./scripts/pilot-admin setup</code> in Terminal to connect your Cloudflare account.
              </>
            ) : error}
          </div>
        )}

        {loading ? (
          <div className="admin-loading">Loading...</div>
        ) : tab === 'accounts' ? (
          /* ── All Users tab ── */
          accounts.length === 0 ? (
            <div className="admin-empty">
              <div className="admin-empty-title">No accounts yet</div>
              <div className="admin-empty-text">Accounts are created when users first launch Pilot.</div>
            </div>
          ) : (
            <div className="admin-table">
              <div className="admin-table-header">
                <span className="admin-col-user" style={{ flex: 1.2 }}>Name</span>
                <span className="admin-col-url">Email</span>
                <span className="admin-col-created">Last seen</span>
                <span className="admin-col-status">Remote</span>
                <span className="admin-col-plan">Plan</span>
              </div>
              {accounts.map(a => (
                <div key={a.installId} className="admin-table-row">
                  <span className="admin-col-user" style={{ flex: 1.2 }}>{a.name}</span>
                  <span className="admin-col-url">
                    <a href={`mailto:${a.email}`} className="admin-url-link">{a.email}</a>
                  </span>
                  <span className="admin-col-created">{timeAgo(a.lastSeen)}</span>
                  <span className="admin-col-status">
                    {a.remoteConfigured ? (
                      <span className="admin-status-dot active" title="Remote configured" />
                    ) : (
                      <span className="admin-status-dot inactive" title="Local only" />
                    )}
                  </span>
                  <span className="admin-col-plan">
                    <span className={`admin-plan-badge ${a.plan || 'free'}`}>{a.plan || 'free'}</span>
                  </span>
                </div>
              ))}
            </div>
          )
        ) : (
          /* ── Remote Access tab ── */
          users.length === 0 && !error ? (
            <div className="admin-empty">
              <div className="admin-empty-title">No remote users yet</div>
              <div className="admin-empty-text">
                Share your registration page to get started:
                <a href="/register" className="admin-empty-link">{domain ? `app.${domain}/register` : '/register'}</a>
              </div>
            </div>
          ) : (
            <div className="admin-table">
              <div className="admin-table-header">
                <span className="admin-col-status">Status</span>
                <span className="admin-col-user">User</span>
                <span className="admin-col-url">URL</span>
                <span className="admin-col-created">Created</span>
                <span className="admin-col-actions">Actions</span>
              </div>
              {users.map(u => (
                <div key={u.username} className="admin-table-row">
                  <span className="admin-col-status">
                    <span className={`admin-status-dot ${u.active ? 'active' : 'inactive'}`} />
                  </span>
                  <span className="admin-col-user">{u.username}</span>
                  <span className="admin-col-url">
                    <a href={u.url} target="_blank" rel="noopener" className="admin-url-link">{u.subdomain}</a>
                  </span>
                  <span className="admin-col-created">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                  </span>
                  <span className="admin-col-actions">
                    {confirmDelete === u.username ? (
                      <span className="admin-confirm">
                        <span className="admin-confirm-text">Remove?</span>
                        <button
                          className="admin-btn danger"
                          onClick={() => handleDelete(u.username)}
                          disabled={deleting === u.username}
                        >
                          {deleting === u.username ? '...' : 'Yes'}
                        </button>
                        <button className="admin-btn" onClick={() => setConfirmDelete(null)}>No</button>
                      </span>
                    ) : (
                      <button className="admin-btn danger" onClick={() => setConfirmDelete(u.username)}>
                        Remove
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )
        )}

        <div className="admin-footer">
          <button className="admin-btn refresh" onClick={() => { setLoading(true); fetchData() }}>
            Refresh
          </button>
        </div>
      </div>
    </div>
  )
}
