import { useRef, useEffect, useState, useCallback } from 'react'
import Markdown from './Markdown'
import FileTree from './FileTree'
import PreviewPanel from './PreviewPanel'
import { extractQuickActions, API_URL } from '../utils'

export default function ChatPanel({
  messages,
  input,
  setInput,
  sendMessage,
  isThinking,
  stepCount,
  showLog,
  setShowLog,
  activityLog,
  turnFileActivity,
  pendingImage,
  setPendingImage,
  handleFile,
  handlePaste,
  connected,
  projectDir,
  home,
  projects,
  onBrowseFolder,
  onToggleMobileMenu,
  fileTree,
  fileTreeTruncated,
  expandedDirs,
  toggleDir,
  activityMap,
  fileActivity,
  previewUrl,
  setPreviewUrl,
  previewInput,
  setPreviewInput,
  rightTab,
  setRightTab,
  iframeRef,
  devServer,
  startDevServer,
  stopDevServer,
}) {
  const messagesContainerRef = useRef(null)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)
  const userScrolledUp = useRef(false)

  // Smart auto-scroll
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const handleScroll = () => {
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      userScrolledUp.current = distFromBottom > 150
    }
    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  // Keep input bar above iOS virtual keyboard
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    function onResize() {
      const offset = window.innerHeight - vv.height - vv.offsetTop
      const main = messagesContainerRef.current?.closest('.main')
      if (main) main.style.setProperty('--kb-offset', `${Math.max(0, offset)}px`)
    }
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onResize)
    }
  }, [])

  useEffect(() => {
    if (!userScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Pull-to-refresh on mobile
  const [pullDistance, setPullDistance] = useState(0)
  const pullStartY = useRef(0)
  const isPulling = useRef(false)

  const onPullTouchStart = useCallback((e) => {
    const container = messagesContainerRef.current
    if (container && container.scrollTop <= 0) {
      pullStartY.current = e.touches[0].clientY
      isPulling.current = true
    }
  }, [])

  const onPullTouchMove = useCallback((e) => {
    if (!isPulling.current) return
    const dy = e.touches[0].clientY - pullStartY.current
    if (dy > 0) setPullDistance(Math.min(dy * 0.4, 80))
    else { isPulling.current = false; setPullDistance(0) }
  }, [])

  const onPullTouchEnd = useCallback(() => {
    if (pullDistance > 60) window.location.reload()
    isPulling.current = false
    setPullDistance(0)
  }, [pullDistance])

  // Mobile bottom sheet (files + preview)
  const [fileSheetOpen, setFileSheetOpen] = useState(false)
  const [sheetTab, setSheetTab] = useState('files')

  const [sharedIdx, setSharedIdx] = useState(null)

  async function shareMessage(text, idx) {
    if (navigator.share) {
      try {
        await navigator.share({ text })
        return
      } catch {}
    }
    // Fallback: copy to clipboard
    await navigator.clipboard.writeText(text)
    setSharedIdx(idx)
    setTimeout(() => setSharedIdx(null), 2000)
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const actions = extractQuickActions(messages, turnFileActivity, home)

  return (
    <main className="main">
      <header className="topbar">
        <button className="mobile-menu-btn" onClick={onToggleMobileMenu}>&#9776;</button>
        <span className="topbar-title">{projectDir || '~'}</span>
        <div className="topbar-right">
          <span className={`status-badge ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? 'connected' : 'reconnecting...'}
          </span>
        </div>
      </header>

      {!connected && (
        <div className="connection-overlay">
          <div className="connection-overlay-content">
            <div className="connection-overlay-dot" />
            <span>Connection lost — reconnecting...</span>
          </div>
        </div>
      )}

      <div
        className="messages"
        ref={messagesContainerRef}
        onTouchStart={onPullTouchStart}
        onTouchMove={onPullTouchMove}
        onTouchEnd={onPullTouchEnd}
      >
        {pullDistance > 0 && (
          <div className="pull-indicator" style={{ height: pullDistance, opacity: pullDistance / 80 }}>
            <span style={{ transform: `rotate(${pullDistance * 4}deg)` }}>{pullDistance > 60 ? '\u21BB' : '\u2193'}</span>
          </div>
        )}
        {messages.length <= 1 && !projectDir && projects.length === 0 && (
          <div className="welcome-empty">
            <div className="welcome-icon">&#9992;</div>
            <div className="welcome-heading">Welcome to Pilot</div>
            <div className="welcome-text">
              Get started by selecting a project folder. Pilot will connect Claude Code to your codebase so you can build, debug, and explore — all from this window.
            </div>
            {onBrowseFolder ? (
              <button className="welcome-browse-btn" onClick={onBrowseFolder}>
                Open a project folder
              </button>
            ) : (
              <div className="welcome-hint">
                Create a project with <code>npm init</code> or <code>git init</code> in any folder, then it will appear in the sidebar dropdown.
              </div>
            )}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`turn ${msg.role}`}>

            {msg.type !== 'status' && (
              <div className="turn-header">
                <div className={`avatar ${msg.role}`}>{msg.role === 'claude' ? 'C' : 'A'}</div>
                <span className="turn-name">{msg.role === 'claude' ? 'Claude' : 'You'}</span>
              </div>
            )}

            {msg.type === 'summary' && (
              <div className="turn-body claude">
                <Markdown text={msg.text} />
                {msg.duration && (
                  <div className="summary-meta">
                    {Math.round(msg.duration / 1000)}s &middot; {msg.turns} {msg.turns === 1 ? 'turn' : 'turns'}
                  </div>
                )}
              </div>
            )}

            {msg.type === 'text' && msg.role === 'claude' && (
              <div className="turn-body claude">
                <Markdown text={msg.content} />
                <button
                  className="share-btn"
                  onClick={() => shareMessage(msg.content, i)}
                  title="Share"
                >
                  {sharedIdx === i ? 'Copied' : '\u21E7'}
                </button>
              </div>
            )}

            {msg.type === 'text' && msg.role === 'user' && (
              <div className="turn-body user">
                {msg.content}
              </div>
            )}

            {msg.type === 'file' && (
              <div className="turn-body user">
                {msg.previewUrl ? (
                  <div className="file-image-wrap">
                    <img src={msg.previewUrl} alt={msg.name} className="file-image-preview" />
                    <div className="file-chip">📎 {msg.name}</div>
                  </div>
                ) : (
                  <div className="file-chip">📎 {msg.name}</div>
                )}
              </div>
            )}

            {msg.type === 'error' && (
              <div className="turn-body claude error-message">
                <span className="error-icon">!</span>
                <span>{msg.content}</span>
              </div>
            )}

            {msg.type === 'action' && (
              <div className="action-card">
                <div className="action-header">
                  <span className="action-icon">⏱</span>
                  <span className="action-title">{msg.description || 'Proposed action'}</span>
                </div>
                <div className="action-footer">
                  <button className="btn-proceed" onClick={() => sendMessage('yes, proceed')}>Proceed</button>
                  <button className="btn-cancel" onClick={() => sendMessage('stop, do not do that')}>Cancel</button>
                </div>
              </div>
            )}

          </div>
        ))}

        {isThinking && (
          <div className="turn claude">
            <div className="turn-header">
              <div className="avatar claude">C</div>
              <span className="turn-name">Claude</span>
            </div>
            <div className="turn-body claude">
              <div className="thinking-row">
                <div className="typing">
                  <span /><span /><span />
                </div>
                {stepCount > 0 && (
                  <>
                    <button className="activity-toggle" onClick={() => setShowLog(prev => !prev)}>
                      {showLog ? 'Hide' : 'Show'} {stepCount} {stepCount === 1 ? 'step' : 'steps'}
                    </button>
                    {!showLog && activityLog.length > 0 && (
                      <span className="activity-current-step">{activityLog[activityLog.length - 1].text}</span>
                    )}
                  </>
                )}
              </div>
              {showLog && activityLog.length > 0 && (
                <div className="activity-log">
                  {activityLog.map((entry, idx) => (
                    <div key={idx} className="activity-log-entry">
                      <span className="activity-log-check">{idx < activityLog.length - 1 ? '\u2713' : '\u21BB'}</span>
                      <span className="activity-log-text">{entry.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {actions.length > 0 && (
        <div className="quick-actions">
          {actions.map((a, i) => (
            <button
              key={i}
              className={`quick-action-btn ${a.type}`}
              onClick={() => {
                fetch(`${API_URL}/open`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ type: a.type, target: a.target })
                })
              }}
            >
              <span className="quick-action-icon">{a.type === 'browser' ? '\u2197' : '\u2756'}</span>
              {a.type === 'browser' ? `Open ${a.label}` : `${a.label} in VS Code`}
            </button>
          ))}
        </div>
      )}

      <div className="inputbar">
        {pendingImage && (
          <div className="pending-image-bar">
            <img src={pendingImage.previewUrl} alt="Pending" className="pending-image-thumb" />
            <span className="pending-image-name">{pendingImage.name}</span>
            <button className="pending-image-remove" onClick={() => setPendingImage(null)}>✕</button>
          </div>
        )}
        <div className="input-wrap">
          <button className="attach-btn" onClick={() => fileInputRef.current.click()}>📎</button>
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFile} accept="image/*,*/*" />
          <textarea
            ref={inputRef}
            className="input"
            rows={1}
            placeholder={pendingImage ? "Add a message about this image, or just hit send..." : "Message Pilot..."}
            value={input}
            onChange={e => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'
            }}
            onKeyDown={handleKey}
            onPaste={handlePaste}
          />
          <button
            className="send-btn"
            onClick={() => sendMessage(input)}
            disabled={(!input.trim() && !pendingImage) || isThinking}
          >
            ↑
          </button>
        </div>
      </div>
      {/* Mobile bottom sheet FAB */}
      <button className="mobile-files-fab" onClick={() => { setFileSheetOpen(true); setSheetTab('files') }}>
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M1 3.5C1 2.67 1.67 2 2.5 2h3.88a1 1 0 0 1 .7.29L8.5 3.71a1 1 0 0 0 .7.29H13.5c.83 0 1.5.67 1.5 1.5V12.5c0 .83-.67 1.5-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
      </button>
      {previewUrl && !fileSheetOpen && (
        <button className="mobile-preview-fab" onClick={() => { setFileSheetOpen(true); setSheetTab('preview') }}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M2 3h12v9H2z" stroke="currentColor" strokeWidth="1.3" fill="none" rx="1"/><path d="M5 14h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
        </button>
      )}
      {fileSheetOpen && (
        <>
          <div className="bottom-sheet-overlay" onClick={() => setFileSheetOpen(false)} />
          <div className={`bottom-sheet ${sheetTab === 'preview' ? 'bottom-sheet-tall' : ''}`}>
            <div className="bottom-sheet-handle" />
            <div className="bottom-sheet-header">
              <div className="bottom-sheet-tabs">
                <button
                  className={`bottom-sheet-tab ${sheetTab === 'files' ? 'active' : ''}`}
                  onClick={() => setSheetTab('files')}
                >Files</button>
                <button
                  className={`bottom-sheet-tab ${sheetTab === 'preview' ? 'active' : ''}`}
                  onClick={() => setSheetTab('preview')}
                >Preview</button>
              </div>
              <button className="bottom-sheet-close" onClick={() => setFileSheetOpen(false)}>&times;</button>
            </div>
            <div className="bottom-sheet-body">
              {sheetTab === 'files' && (
                <FileTree
                  fileTree={fileTree}
                  fileTreeTruncated={fileTreeTruncated}
                  projectDir={projectDir}
                  expandedDirs={expandedDirs}
                  toggleDir={toggleDir}
                  activityMap={activityMap}
                  fileActivity={fileActivity}
                  setPreviewUrl={(url) => { setPreviewUrl(url); setSheetTab('preview') }}
                  setPreviewInput={setPreviewInput}
                  setRightTab={setRightTab}
                />
              )}
              {sheetTab === 'preview' && (
                <PreviewPanel
                  previewUrl={previewUrl}
                  setPreviewUrl={setPreviewUrl}
                  previewInput={previewInput}
                  setPreviewInput={setPreviewInput}
                  iframeRef={iframeRef}
                  devServer={devServer}
                  startDevServer={startDevServer}
                  stopDevServer={stopDevServer}
                />
              )}
            </div>
          </div>
        </>
      )}
    </main>
  )
}
