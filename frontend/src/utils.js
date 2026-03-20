export const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
export const API_URL = ''
export const CENTRAL_URL = 'https://claudepilot.us'
export const PREVIEW_EXTS = ['.html', '.htm', '.svg', '.md', '.markdown', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf']
export const COMPONENT_EXTS = ['.jsx', '.tsx']

export async function fetchSessions() {
  try {
    const res = await fetch(`${API_URL}/sessions`, { credentials: 'include' })
    return await res.json()
  } catch { return [] }
}

export function saveSession(session) {
  fetch(`${API_URL}/sessions/${session.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
    credentials: 'include',
  }).catch(() => {})
}

export function deleteSessionAPI(id) {
  fetch(`${API_URL}/sessions/${id}`, { method: 'DELETE', credentials: 'include' }).catch(() => {})
}

export function describeAction(tool, input) {
  if (tool === 'Read') return `Reading ${input?.file_path?.split('/').pop() || 'file'}`
  if (tool === 'Write') return `Creating ${input?.file_path?.split('/').pop() || 'file'}`
  if (tool === 'Edit') return `Editing ${input?.file_path?.split('/').pop() || 'file'}`
  if (tool === 'Glob') return `Searching for files`
  if (tool === 'Grep') return `Searching file contents`
  if (tool === 'Bash') {
    const cmd = input?.command || ''
    if (cmd.startsWith('ls')) return 'Looking at project files'
    if (cmd.startsWith('cat')) return 'Reading a file'
    if (cmd.startsWith('npm install')) return `Installing ${cmd.replace('npm install', '').trim()}`
    if (cmd.startsWith('npm run')) return `Running ${cmd.replace('npm run', '').trim()}`
    if (cmd.startsWith('mkdir')) return `Creating folder ${cmd.replace('mkdir', '').trim()}`
    if (cmd.startsWith('git')) return `Git: ${cmd.replace('git', '').trim()}`
    if (cmd.startsWith('npx')) return `Running ${cmd.split(' ').slice(0,2).join(' ')}`
    return input?.description || cmd
  }
  return input?.description || tool
}

export function extractFileActivity(tool, input, home) {
  home = home || '/tmp'
  const shorten = (p) => p.startsWith(home) ? '~' + p.slice(home.length) : p

  if ((tool === 'Read' || tool === 'Write' || tool === 'Edit') && input?.file_path) {
    const fp = input.file_path
    const action = tool === 'Read' ? 'read' : tool === 'Write' ? 'created' : 'edited'
    const parts = fp.split('/')
    return { file: parts.pop(), dir: shorten(parts.join('/')), fullPath: shorten(fp), action }
  }

  if (tool === 'Bash') {
    const cmd = input?.command || ''

    const pushMatch = cmd.match(/git\s+push\s+(\S+)?\s*(\S+)?/)
    if (pushMatch) {
      const remote = pushMatch[1] || 'origin'
      const branch = pushMatch[2] || ''
      return { file: `push ${remote}${branch ? ' ' + branch : ''}`, dir: 'remote', fullPath: `Pushed to ${remote}${branch ? '/' + branch : ''}`, action: 'pushed', integration: 'github' }
    }

    if (cmd.match(/git\s+commit/)) {
      return { file: 'commit', dir: 'local', fullPath: cmd, action: 'committed', integration: 'git' }
    }

    if (cmd.match(/git\s+(branch|checkout|switch|merge|rebase|stash|pull|fetch|log|diff|status|add|init|remote|clone|tag|reset|restore|cherry-pick|bisect|config|clean|rm|mv|show|blame|shortlog|describe|archive|worktree)/)) {
      return { file: cmd.split('&&')[0].trim().slice(0, 40), dir: 'local', fullPath: cmd, action: 'ran', integration: 'git' }
    }

    if (cmd.startsWith('gh ')) {
      return { file: cmd.split('&&')[0].trim().slice(0, 40), dir: 'remote', fullPath: cmd, action: 'ran', integration: 'github' }
    }

    if (cmd.startsWith('npm ') || cmd.startsWith('npx ')) {
      return { file: cmd.split('&&')[0].trim().slice(0, 40), dir: 'terminal', fullPath: cmd, action: 'ran', integration: 'node' }
    }

    if (cmd.startsWith('vercel') || cmd.includes('vercel deploy')) {
      return { file: 'deploy', dir: 'production', fullPath: cmd, action: 'deployed', integration: 'vercel' }
    }

    if (cmd.match(/\bcode\b/)) {
      return { file: cmd.split('&&')[0].trim().slice(0, 40), dir: 'local', fullPath: cmd, action: 'ran', integration: 'vscode' }
    }

    if (cmd.startsWith('docker ') || cmd.startsWith('docker-compose ')) {
      return { file: cmd.split('&&')[0].trim().slice(0, 40), dir: 'local', fullPath: cmd, action: 'ran', integration: 'docker' }
    }
  }

  return null
}

export function extractQuickActions(messages, turnFileActivity, home) {
  const actions = []
  const seen = new Set()

  let lastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIdx = i; break }
  }
  const recentMessages = lastUserIdx >= 0 ? messages.slice(lastUserIdx + 1) : messages

  recentMessages.forEach(msg => {
    if (msg.role === 'claude' && (msg.type === 'text' || msg.type === 'summary')) {
      const text = msg.content || msg.text || ''
      const urlMatches = text.match(/(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+[^\s)']*/g)
      if (urlMatches) {
        urlMatches.forEach(url => {
          const full = url.startsWith('http') ? url : `http://${url}`
          if (!seen.has(full)) {
            seen.add(full)
            actions.push({ type: 'browser', label: url, target: full })
          }
        })
      }
    }
  })

  turnFileActivity.forEach(f => {
    if ((f.action === 'edited' || f.action === 'created') && !seen.has(f.fullPath)) {
      seen.add(f.fullPath)
      const absPath = f.fullPath.startsWith('~')
        ? f.fullPath.replace('~', home || '')
        : f.fullPath
      actions.push({ type: 'vscode', label: f.file, target: absPath })
    }
  })

  return actions
}

export function formatInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff;font-weight:600">$1</strong>')
    .replace(/`(.+?)`/g, '<code style="background:#1e1e1e;padding:1px 5px;border-radius:4px;font-family:monospace;font-size:12px">$1</code>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
}

export function isSafeAction(tool, input) {
  if (tool === 'Bash') {
    const cmd = input?.command || ''
    const dangerous = [
      'rm ', 'rm -', 'rmdir',
      'sudo', 'chmod', 'chown',
      'curl', 'wget',
      'kill', 'pkill'
    ]
    return !dangerous.some(d => cmd.includes(d))
  }
  return true
}

export const WELCOME_MSG = {
  role: 'claude',
  content: "Hey! I'm Pilot — connected to Claude Code on your machine. Pick a project from the sidebar and start building.",
  type: 'text'
}
