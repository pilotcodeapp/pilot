import { useState, useEffect, useRef } from 'react'
import './App.css'
import Sidebar from './components/Sidebar'
import ChatPanel from './components/ChatPanel'
import RightPanel from './components/RightPanel'
import SetupScreen from './components/SetupScreen'
import LoginScreen from './components/LoginScreen'
import RegisterPage from './components/RegisterPage'
import AdminPanel from './components/AdminPanel'
import AccountScreen from './components/AccountScreen'
import TermsScreen from './components/TermsScreen'
import {
  WS_URL, API_URL, CENTRAL_URL, PREVIEW_EXTS, COMPONENT_EXTS, WELCOME_MSG,
  fetchSessions, saveSession, deleteSessionAPI,
  describeAction, extractFileActivity
} from './utils'

export default function App() {
  // --- Account + Terms check ---
  const [hasAccount, setHasAccount] = useState(() => !!localStorage.getItem('pilot_account'))
  const [termsAccepted, setTermsAccepted] = useState(() => !!localStorage.getItem('pilot_terms_accepted'))

  // --- Auth + Setup check ---
  const [authState, setAuthState] = useState('checking') // 'checking' | 'authenticated' | 'login_required'
  const [setupState, setSetupState] = useState('checking') // 'checking' | 'ready' | 'setup_required'

  // --- State (all hooks must be declared before any conditional returns) ---
  const [messages, setMessages] = useState([WELCOME_MSG])
  const [input, setInput] = useState('')
  const [connected, setConnected] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [projectDir, setProjectDir] = useState('')
  const [projects, setProjects] = useState([])
  const [sessionId, setSessionId] = useState(null)
  const [sessions, setSessions] = useState([])
  const [activeSessionIdx, setActiveSessionIdx] = useState(null)
  const [stepCount, setStepCount] = useState(0)
  const [activityLog, setActivityLog] = useState([])
  const [showLog, setShowLog] = useState(false)
  const [fileActivity, setFileActivity] = useState([])
  const [turnFileActivity, setTurnFileActivity] = useState([])
  const [fileTree, setFileTree] = useState([])
  const [fileTreeTruncated, setFileTreeTruncated] = useState(false)
  const [showFiles, setShowFiles] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(220)
  const [filesWidth, setFilesWidth] = useState(260)
  const [expandedDirs, setExpandedDirs] = useState(new Set())
  const [editingSessionIdx, setEditingSessionIdx] = useState(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [rightTab, setRightTab] = useState('files')
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewInput, setPreviewInput] = useState('')
  const [pendingImage, setPendingImage] = useState(null)
  const [devServer, setDevServer] = useState({ status: 'stopped', available: false, command: null, port: null, url: null })
  const [contextUsage, setContextUsage] = useState({ used: 0, total: 0, pct: 0 })
  const [contextWarning, setContextWarning] = useState(null)
  const [home, setHome] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [lanUrl, setLanUrl] = useState(null)
  const [tunnel, setTunnel] = useState({ status: 'stopped', url: null, persistent: false, loggedIn: false, tunnelUrl: null })

  const iframeRef = useRef(null)
  const wsRef = useRef(null)
  const dragRef = useRef(null)

  // --- Resize drag ---
  function startDrag(setter, direction) {
    return (e) => {
      e.preventDefault()
      const startX = e.clientX
      dragRef.current = { startX, setter, direction }
      const startWidth = direction === 'left'
        ? document.querySelector('.sidebar').offsetWidth
        : document.querySelector('.files-panel').offsetWidth

      const onMove = (e) => {
        const delta = e.clientX - startX
        const newWidth = direction === 'left'
          ? Math.max(140, Math.min(400, startWidth + delta))
          : Math.max(160, Math.min(500, startWidth - delta))
        setter(newWidth)
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        dragRef.current = null
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }
  }

  // --- Custom projects from localStorage ---
  const CUSTOM_PATHS_KEY = 'pilot_custom_project_paths'
  function loadCustomPaths() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_PATHS_KEY)) || [] }
    catch { return [] }
  }
  function saveCustomPath(dirPath) {
    const existing = loadCustomPaths()
    if (!existing.includes(dirPath)) {
      const updated = [...existing, dirPath]
      localStorage.setItem(CUSTOM_PATHS_KEY, JSON.stringify(updated))
    }
  }

  // Merge auto-detected projects with custom paths
  function mergeProjects(detected) {
    const customPaths = loadCustomPaths()
    const seen = new Set(detected.map(p => p.path))
    const merged = [...detected]
    for (const cp of customPaths) {
      if (!seen.has(cp)) {
        merged.push({ path: cp, name: cp.split('/').pop() })
      }
    }
    return merged.sort((a, b) => a.name.localeCompare(b.name))
  }

  // --- Mobile swipe to open/close sidebar ---
  useEffect(() => {
    let startX = 0, startY = 0
    function onTouchStart(e) {
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
    }
    function onTouchEnd(e) {
      const dx = e.changedTouches[0].clientX - startX
      const dy = e.changedTouches[0].clientY - startY
      if (Math.abs(dy) > Math.abs(dx)) return // vertical swipe, ignore
      if (dx > 80 && startX < 40) setMobileMenuOpen(true)
      if (dx < -80 && mobileMenuOpen) setMobileMenuOpen(false)
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [mobileMenuOpen])

  // --- Auth + Health check ---
  useEffect(() => {
    // Check auth first
    fetch(`${API_URL}/auth/status`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.status === 'login_required') {
          setAuthState('login_required')
        } else {
          setAuthState('authenticated')
        }
      })
      .catch(() => setAuthState('authenticated')) // if auth check fails, allow through

    fetch(`${API_URL}/health`).then(r => r.json()).then(data => {
      setSetupState(data.status === 'ok' ? 'ready' : 'setup_required')
    }).catch(() => setSetupState('ready'))
  }, [])

  // --- Fetch config & projects ---
  useEffect(() => {
    fetch(`${API_URL}/config`)
      .then(r => r.json())
      .then(data => setHome(data.home || ''))
      .catch(() => {})
    fetch(`${API_URL}/network-info`)
      .then(r => r.json())
      .then(data => setLanUrl(data.lanUrl || null))
      .catch(() => {})
    fetch(`${API_URL}/tunnel/status`)
      .then(r => r.json())
      .then(data => setTunnel(prev => ({ ...prev, ...data })))
      .catch(() => {})
    fetch(`${API_URL}/projects`)
      .then(r => r.json())
      .then(data => setProjects(mergeProjects(data)))
      .catch(() => {})
    fetchSessions().then(serverSessions => {
      // One-time migration from localStorage to backend
      if (serverSessions.length === 0) {
        try {
          const local = JSON.parse(localStorage.getItem('pilot_sessions')) || []
          if (local.length > 0) {
            local.forEach(s => saveSession(s))
            localStorage.removeItem('pilot_sessions')
            setSessions(local)
            return
          }
        } catch {}
      }
      setSessions(serverSessions)
    })
    // Heartbeat to central server
    try {
      const account = JSON.parse(localStorage.getItem('pilot_account'))
      if (account?.installId) {
        const tunnelConfig = localStorage.getItem('pilot_tunnel_configured')
        fetch(`${CENTRAL_URL}/api/accounts/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            installId: account.installId,
            version: '2.0',
            remoteConfigured: !!tunnelConfig,
          }),
        }).catch(() => {}) // silent fail
      }
    } catch {}
  }, [])

  // --- Native folder picker (Electron only) ---
  const isElectron = !!window.electronAPI
  async function handleBrowseFolder() {
    if (!window.electronAPI) return
    const folderPath = await window.electronAPI.openFolder()
    if (folderPath) {
      saveCustomPath(folderPath)
      // Add to projects list if not already there
      setProjects(prev => {
        if (prev.some(p => p.path === folderPath)) return prev
        const updated = [...prev, { path: folderPath, name: folderPath.split('/').pop() }]
        return updated.sort((a, b) => a.name.localeCompare(b.name))
      })
      setProjectDir(folderPath)
    }
  }

  // --- File tree ---
  const refreshFileTree = useRef(() => {})
  refreshFileTree.current = () => {
    if (!projectDir) { setFileTree([]); return }
    fetch(`${API_URL}/filetree?dir=${encodeURIComponent(projectDir)}`)
      .then(r => r.json())
      .then(data => {
        const tree = data.tree || data
        setFileTree(tree)
        setFileTreeTruncated(data.truncated || false)
        setExpandedDirs(prev => prev.size === 0
          ? new Set(tree.filter(n => n.type === 'dir').map(n => n.path))
          : prev
        )
      })
      .catch(() => setFileTree([]))
  }

  useEffect(() => {
    if (!projectDir) {
      setFileTree([]); setExpandedDirs(new Set())
      setDevServer(prev => ({ ...prev, available: false }))
      return
    }
    setExpandedDirs(new Set())
    refreshFileTree.current()
    // Auto-detect and auto-start dev server
    fetch(`${API_URL}/dev-server/detect?dir=${encodeURIComponent(projectDir)}`)
      .then(r => r.json())
      .then(data => {
        const alreadyRunning = data.running || data.status === 'running' || data.status === 'starting'
        setDevServer(prev => ({
          ...prev,
          available: data.available,
          command: data.command,
          status: data.status || (data.running ? 'running' : 'stopped'),
          port: data.port
        }))
        if (data.available && !alreadyRunning && wsRef.current) {
          setDevServer(prev => ({ ...prev, status: 'starting' }))
          wsRef.current.send(JSON.stringify({ type: 'dev_server_start', projectDir }))
        }
      })
      .catch(() => {})
  }, [projectDir])

  // --- WebSocket ---
  useEffect(() => {
    connectWS()
    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && wsRef.current?.readyState !== WebSocket.OPEN) {
        reconnectDelay.current = 2000
        connectWS()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      wsRef.current?.close()
    }
  }, [])

  const reconnectDelay = useRef(2000)
  const bufferIndex = useRef(0)

  function connectWS() {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      reconnectDelay.current = 2000
      // Request missed messages since last known buffer position
      if (bufferIndex.current > 0) {
        ws.send(JSON.stringify({ type: 'replay', since: bufferIndex.current }))
      }
    }
    ws.onclose = () => {
      setConnected(false)
      setTimeout(connectWS, reconnectDelay.current)
      reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, 30000)
    }

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data)

      if (data.type === 'replay_done') {
        bufferIndex.current = data.bufferSize
        return
      }

      // Track buffer position for replay on reconnect
      if (data.type === 'claude_event' || data.type === 'session_end' || data.type === 'error' || data.type === 'cancelled') {
        bufferIndex.current++
      }

      if (data.type === 'claude_event') {
        const ev = data.event

        if (ev.type === 'assistant' && ev.message?.content) {
          if (ev.message.context_management) {
            setContextWarning('compacted')
          }
          ev.message.content.forEach(block => {
            if (block.type === 'text' && block.text?.trim()) {
              setMessages(prev => {
                const lastIdx = prev.length - 1
                const last = prev[lastIdx]
                if (last && last.role === 'claude' && last.type === 'text' && last.streaming) {
                  const updated = [...prev]
                  updated[lastIdx] = { ...last, content: last.content + block.text }
                  return updated
                }
                for (let j = prev.length - 1; j >= 0; j--) {
                  const msg = prev[j]
                  if (msg.role === 'user') break
                  if (msg.role === 'claude' && msg.type === 'text') {
                    const updated = [...prev]
                    updated[j] = { ...msg, content: msg.content + '\n\n' + block.text, streaming: true }
                    return updated
                  }
                }
                return [...prev, { role: 'claude', content: block.text, type: 'text', streaming: true }]
              })

              // Auto-detect localhost URLs for preview
              const urlMatch = block.text.match(/(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/)
              if (urlMatch) {
                const detected = urlMatch[0].startsWith('http') ? urlMatch[0] : `http://${urlMatch[0]}`
                setPreviewUrl(prev => prev || detected)
                setPreviewInput(prev => prev || detected)
              }
            }

            if (block.type === 'tool_use') {
              setMessages(prev => {
                const lastIdx = prev.length - 1
                const last = prev[lastIdx]
                if (last && last.streaming) {
                  const updated = [...prev]
                  updated[lastIdx] = { ...last, streaming: false }
                  return updated
                }
                return prev
              })
              setStepCount(prev => prev + 1)

              setActivityLog(prev => [...prev, {
                text: describeAction(block.name, block.input),
                tool: block.name,
                ts: Date.now()
              }])

              const activity = extractFileActivity(block.name, block.input, home)
              if (activity) {
                const activityWithTs = { ...activity, ts: Date.now() }
                setFileActivity(prev => {
                  const existing = prev.findIndex(f => f.fullPath === activity.fullPath)
                  if (existing >= 0) {
                    const updated = [...prev]
                    updated[existing] = activityWithTs
                    return updated
                  }
                  return [...prev, activityWithTs]
                })
                setTurnFileActivity(prev => {
                  const existing = prev.findIndex(f => f.fullPath === activity.fullPath)
                  if (existing >= 0) {
                    const updated = [...prev]
                    updated[existing] = activityWithTs
                    return updated
                  }
                  return [...prev, activityWithTs]
                })

                // Auto-preview: only auto-open for newly created previewable files
                const filePath = block.input?.file_path
                if (activity.action === 'created' && filePath) {
                  if (PREVIEW_EXTS.some(ext => filePath.endsWith(ext))) {
                    const previewFileUrl = `${API_URL}/preview-file?path=${encodeURIComponent(filePath)}`
                    setPreviewUrl(previewFileUrl)
                    setPreviewInput(filePath.split('/').pop())
                    setRightTab('preview')
                  } else if (COMPONENT_EXTS.some(ext => filePath.endsWith(ext))) {
                    const previewComponentUrl = `${API_URL}/preview-component?path=${encodeURIComponent(filePath)}`
                    setPreviewUrl(previewComponentUrl)
                    setPreviewInput(filePath.split('/').pop())
                    setRightTab('preview')
                  }
                }
                // For edits, only refresh if preview is already showing
                if (activity.action === 'edited' && iframeRef.current?.src && rightTab === 'preview') {
                  try { iframeRef.current.contentWindow.location.reload() } catch {
                    const src = iframeRef.current.src
                    iframeRef.current.src = ''
                    setTimeout(() => { iframeRef.current.src = src }, 50)
                  }
                }
              }
            }
          })
        }

        if (ev.type === 'system' && ev.session_id) {
          setSessionId(ev.session_id)
          if (ev.subtype === 'init' && ev.model) {
            const match = ev.model.match(/\[(\d+)[kKmM]\]/)
            if (match) {
              const size = match[0].toLowerCase().includes('m')
                ? parseInt(match[1]) * 1000000
                : parseInt(match[1]) * 1000
              setContextUsage(prev => ({ ...prev, total: size }))
            }
          }
          if (activeSessionIdx !== null) {
            setSessions(prev => {
              const updated = [...prev]
              if (updated[activeSessionIdx]) {
                updated[activeSessionIdx] = { ...updated[activeSessionIdx], sessionId: ev.session_id }
                saveSession(updated[activeSessionIdx])
              }
              return updated
            })
          }
        }

        // Update context usage from assistant events
        if (ev.type === 'assistant' && ev.message?.usage) {
          const u = ev.message.usage
          const used = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
          setContextUsage(prev => {
            const total = prev.total || 1000000
            return { used, total, pct: Math.round((used / total) * 100) }
          })
        }

        // Build summary from result events
        if (ev.type === 'result' && ev.subtype === 'success' && ev.result) {
          setMessages(prev => {
            const lastText = [...prev].reverse().find(m => m.role === 'claude' && m.type === 'text')
            const resultTrimmed = ev.result.trim()
            if (lastText) {
              const contentTrimmed = lastText.content.trim()
              if (contentTrimmed === resultTrimmed || contentTrimmed.includes(resultTrimmed) || resultTrimmed.includes(contentTrimmed)) {
                return prev
              }
            }
            return [...prev, {
              role: 'claude', type: 'summary', text: ev.result,
              duration: ev.duration_ms, turns: ev.num_turns
            }]
          })
          setStepCount(0)
        }
      }

      if (data.type === 'dev_server') {
        setDevServer(prev => ({
          ...prev,
          status: data.status || prev.status,
          port: data.port || prev.port,
          url: data.url || prev.url,
          command: data.command || prev.command,
          error: data.error || null,
          warning: data.warning || null
        }))
        if (data.status === 'running' && data.url) {
          setPreviewUrl(data.url)
          setPreviewInput(data.url)
        }
      }

      if (data.type === 'tunnel') {
        setTunnel(prev => ({ ...prev, status: data.status, url: data.url, persistent: data.persistent, configured: data.persistent, mode: data.mode, setupNeeded: null }))
      }

      // Handle error result events (Claude completed but with an error)
      if (data.type === 'claude_event' && data.event?.type === 'result' && data.event?.is_error) {
        const errorText = data.event.result || 'Claude encountered an error.'
        setMessages(prev => [...prev, {
          role: 'claude', type: 'error',
          content: errorText
        }])
        setIsThinking(false)
        setStepCount(0)
      }

      // Backend error (e.g., failed to spawn Claude)
      if (data.type === 'error') {
        setMessages(prev => [...prev, {
          role: 'claude', type: 'error',
          content: data.message || 'Something went wrong.'
        }])
        setIsThinking(false)
        setStepCount(0)
      }

      // User cancelled the request
      if (data.type === 'cancelled') {
        setMessages(prev => {
          const lastIdx = prev.length - 1
          const last = prev[lastIdx]
          if (last && last.streaming) {
            const updated = [...prev]
            updated[lastIdx] = { ...last, streaming: false }
            return updated
          }
          return prev
        })
        setIsThinking(false)
        setStepCount(0)
      }

      if (data.type === 'session_end') {
        setMessages(prev => {
          const lastIdx = prev.length - 1
          const last = prev[lastIdx]
          if (last && last.streaming) {
            const updated = [...prev]
            updated[lastIdx] = { ...last, streaming: false }
            return updated
          }
          return prev
        })
        // Show error for unexpected exits (non-zero, and not from a cancel)
        if (data.code && data.code !== 0) {
          setMessages(prev => {
            const lastMsg = prev[prev.length - 1]
            // Don't double-up if we already showed an error
            if (lastMsg?.type === 'error') return prev
            return [...prev, {
              role: 'claude', type: 'error',
              content: `Claude Code exited unexpectedly (code ${data.code}). Try sending your message again.`
            }]
          })
        }
        setIsThinking(false)
        setStepCount(0)
        notifyDone()
        refreshFileTree.current()
      }
    }
  }

  // --- Persist session ---
  useEffect(() => {
    if (activeSessionIdx !== null && messages.length > 1) {
      setSessions(prev => {
        const updated = [...prev]
        updated[activeSessionIdx] = { ...updated[activeSessionIdx], messages: messages.filter(m => m.type !== 'action'), sessionId, fileActivity }
        saveSession(updated[activeSessionIdx])
        return updated
      })
    }
  }, [messages, sessionId, fileActivity])

  // --- Notifications ---
  function notifyDone() {
    if (document.visibilityState !== 'hidden') return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    new Notification('Pilot', { body: 'Claude has finished working.', icon: '/icon-192.png' })
  }

  // --- Actions ---
  function sendMessage(text) {
    const hasImage = !!pendingImage
    const hasText = text.trim().length > 0
    if (!hasImage && !hasText) return
    if (!wsRef.current) return
    if (navigator.vibrate) navigator.vibrate(15)
    // Request notification permission on first send
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission()

    if (hasImage) {
      setMessages(prev => [...prev, {
        role: 'user', type: 'file', name: pendingImage.name,
        fileType: 'image', previewUrl: pendingImage.previewUrl
      }])
      wsRef.current.send(JSON.stringify({
        type: 'upload_file', fileName: pendingImage.name, fileData: pendingImage.base64
      }))
      setPendingImage(null)
    }

    const prompt = hasImage && !hasText
      ? `I'm sharing a screenshot called "${pendingImage.name}". Please review it and describe what you see.`
      : hasImage
        ? `${text}\n\n(I've attached a screenshot called "${pendingImage.name}" — please read it from disk to view it.)`
        : text

    if (hasText) {
      setMessages(prev => [...prev, { role: 'user', content: text, type: 'text' }])
    } else if (hasImage) {
      setMessages(prev => [...prev, { role: 'user', content: 'Review this screenshot', type: 'text' }])
    }

    setIsThinking(true)
    setStepCount(0)
    setShowLog(false)
    setTurnFileActivity([])
    setInput('')

    const displayText = hasText ? text : 'Screenshot'
    if (activeSessionIdx === null) {
      const newSession = {
        id: Date.now(), title: displayText.slice(0, 50), projectDir,
        messages: [...messages, { role: 'user', content: displayText, type: 'text' }],
        sessionId, createdAt: new Date().toISOString()
      }
      saveSession(newSession)
      setSessions(prev => [newSession, ...prev])
      setActiveSessionIdx(0)
    }

    // If resuming a saved session with no active Claude process, send conversation history for context
    const history = (!sessionId && messages.length > 1)
      ? messages.filter(m => m.type === 'text' && m.content).map(m => ({ role: m.role, content: m.content.slice(0, 500) }))
      : undefined

    wsRef.current.send(JSON.stringify({
      type: 'send_message', prompt, projectDir: projectDir || undefined, sessionId, history
    }))
  }

  function startNewChat() {
    setMessages([WELCOME_MSG])
    setSessionId(null)
    setActiveSessionIdx(null)
    setStepCount(0)
    setIsThinking(false)
    setFileActivity([])
    setActivityLog([])
    setShowLog(false)
    setContextUsage({ used: 0, total: 0, pct: 0 })
    setContextWarning(null)
  }

  function loadSession(idx) {
    const session = sessions[idx]
    setMessages(session.messages.filter(m => m.type !== 'action'))
    setSessionId(session.sessionId)
    setProjectDir(session.projectDir || '')
    setActiveSessionIdx(idx)
    setStepCount(0)
    setFileActivity(session.fileActivity || [])
  }

  function deleteSession(idx, e) {
    e.stopPropagation()
    const session = sessions[idx]
    if (session) deleteSessionAPI(session.id)
    setSessions(prev => prev.filter((_, i) => i !== idx))
    if (activeSessionIdx === idx) startNewChat()
    else if (activeSessionIdx > idx) setActiveSessionIdx(prev => prev - 1)
  }

  function startRename(idx, e) {
    e.stopPropagation()
    setEditingSessionIdx(idx)
    setEditingTitle(sessions[idx].title)
  }

  function commitRename(idx) {
    const trimmed = editingTitle.trim()
    if (trimmed && trimmed !== sessions[idx].title) {
      setSessions(prev => {
        const updated = [...prev]
        updated[idx] = { ...updated[idx], title: trimmed }
        saveSession(updated[idx])
        return updated
      })
    }
    setEditingSessionIdx(null)
  }

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    if (file.type.startsWith('image/')) {
      stageImage(file)
    } else {
      uploadAndSend(file, `I'm attaching a file called "${file.name}". Please read and use it as context.`)
    }
  }

  function stageImage(file) {
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]
      setPendingImage({ name: file.name, base64, previewUrl: reader.result, file })
    }
    reader.readAsDataURL(file)
  }

  function uploadAndSend(file, promptText) {
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]
      setMessages(prev => [...prev, { role: 'user', type: 'file', name: file.name, fileType: file.type }])
      if (wsRef.current) {
        wsRef.current.send(JSON.stringify({ type: 'upload_file', fileName: file.name, fileData: base64 }))
      }
      sendMessage(promptText)
    }
    reader.readAsDataURL(file)
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) {
          const ext = file.type.split('/')[1] || 'png'
          const named = new File([file], `screenshot-${Date.now()}.${ext}`, { type: file.type })
          stageImage(named)
        }
        return
      }
    }
  }

  function startDevServer() {
    if (!wsRef.current || !projectDir) return
    setDevServer(prev => ({ ...prev, status: 'starting' }))
    wsRef.current.send(JSON.stringify({ type: 'dev_server_start', projectDir }))
  }

  function stopDevServer() {
    if (!wsRef.current) return
    wsRef.current.send(JSON.stringify({ type: 'dev_server_stop' }))
    setDevServer(prev => ({ ...prev, status: 'stopped', port: null, url: null }))
  }

  async function handleTunnelToggle() {
    if (tunnel.status === 'running') {
      fetch(`${API_URL}/tunnel/stop`, { method: 'POST' })
      setTunnel(prev => ({ ...prev, status: 'stopped', url: null, setupNeeded: null }))
    } else if (tunnel.status === 'stopped') {
      // If currently showing setup wizard, cancel it
      if (tunnel.setupNeeded) {
        setTunnel(prev => ({ ...prev, setupNeeded: null }))
        return
      }
      setTunnel(prev => ({ ...prev, status: 'starting', url: prev.persistent ? prev.tunnelUrl : null }))
      const res = await fetch(`${API_URL}/tunnel/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const data = await res.json()
      if (data.status === 'setup_needed') {
        setTunnel(prev => ({ ...prev, status: 'stopped', setupNeeded: data.reason }))
      }
    }
  }

  function toggleDir(dirPath) {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }

  // Build activity map for file tree badges
  const activityMap = {}
  fileActivity.forEach(f => {
    const abs = f.fullPath.startsWith('~') ? f.fullPath.replace('~', home) : f.fullPath
    activityMap[abs] = f.action
  })

  // --- Render ---
  // Public/special pages
  if (window.location.pathname === '/register') return <RegisterPage />
  if (window.location.pathname === '/admin') return <AdminPanel />

  // Account registration + terms gate
  if (!hasAccount) return <AccountScreen onComplete={() => setHasAccount(true)} />
  if (!termsAccepted) return <TermsScreen onAccept={() => setTermsAccepted(true)} />

  if (authState === 'checking' || setupState === 'checking') return null
  if (authState === 'login_required') return <LoginScreen onLogin={() => { setAuthState('authenticated'); window.location.reload() }} />
  if (setupState === 'setup_required') return <SetupScreen onComplete={() => setSetupState('ready')} />

  return (
    <div className={`app${isElectron ? ' electron' : ''}`}>
      <div className={`sidebar-overlay ${mobileMenuOpen ? 'visible' : ''}`} onClick={() => setMobileMenuOpen(false)} />
      <Sidebar
        sidebarWidth={sidebarWidth}
        projectDir={projectDir}
        setProjectDir={(dir) => { setProjectDir(dir); setMobileMenuOpen(false) }}
        projects={projects}
        onBrowseFolder={isElectron ? handleBrowseFolder : null}
        sessions={sessions}
        activeSessionIdx={activeSessionIdx}
        loadSession={(idx) => { loadSession(idx); setMobileMenuOpen(false) }}
        deleteSession={deleteSession}
        startNewChat={() => { startNewChat(); setMobileMenuOpen(false) }}
        editingSessionIdx={editingSessionIdx}
        setEditingSessionIdx={setEditingSessionIdx}
        editingTitle={editingTitle}
        setEditingTitle={setEditingTitle}
        commitRename={commitRename}
        startRename={startRename}
        contextUsage={contextUsage}
        contextWarning={contextWarning}
        mobileOpen={mobileMenuOpen}
        lanUrl={lanUrl}
        tunnel={tunnel}
        onTunnelToggle={handleTunnelToggle}
      />
      <div className="resize-handle" onMouseDown={startDrag(setSidebarWidth, 'left')} />

      <ChatPanel
        messages={messages}
        input={input}
        setInput={setInput}
        sendMessage={sendMessage}
        isThinking={isThinking}
        stepCount={stepCount}
        showLog={showLog}
        setShowLog={setShowLog}
        activityLog={activityLog}
        turnFileActivity={turnFileActivity}
        pendingImage={pendingImage}
        setPendingImage={setPendingImage}
        handleFile={handleFile}
        handlePaste={handlePaste}
        connected={connected}
        projectDir={projectDir}
        home={home}
        projects={projects}
        onBrowseFolder={isElectron ? handleBrowseFolder : null}
        onToggleMobileMenu={() => setMobileMenuOpen(prev => !prev)}
        fileTree={fileTree}
        fileTreeTruncated={fileTreeTruncated}
        expandedDirs={expandedDirs}
        toggleDir={toggleDir}
        activityMap={activityMap}
        fileActivity={fileActivity}
        previewUrl={previewUrl}
        setPreviewUrl={setPreviewUrl}
        previewInput={previewInput}
        setPreviewInput={setPreviewInput}
        rightTab={rightTab}
        setRightTab={setRightTab}
        iframeRef={iframeRef}
        devServer={devServer}
        startDevServer={startDevServer}
        stopDevServer={stopDevServer}
      />

      {showFiles && (
        <div className="resize-handle" onMouseDown={startDrag(setFilesWidth, 'right')} />
      )}
      <RightPanel
        showFiles={showFiles}
        setShowFiles={setShowFiles}
        filesWidth={filesWidth}
        rightTab={rightTab}
        setRightTab={setRightTab}
        fileTree={fileTree}
        fileTreeTruncated={fileTreeTruncated}
        projectDir={projectDir}
        expandedDirs={expandedDirs}
        toggleDir={toggleDir}
        activityMap={activityMap}
        fileActivity={fileActivity}
        previewUrl={previewUrl}
        setPreviewUrl={setPreviewUrl}
        previewInput={previewInput}
        setPreviewInput={setPreviewInput}
        iframeRef={iframeRef}
        devServer={devServer}
        startDevServer={startDevServer}
        stopDevServer={stopDevServer}
      />
    </div>
  )
}
