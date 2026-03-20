import { PREVIEW_EXTS, COMPONENT_EXTS, API_URL } from '../utils'

const INTEGRATION_META = {
  git: { label: 'Git', icon: '⑂' },
  github: { label: 'GitHub', icon: '⬡' },
  node: { label: 'Node / npm', icon: '⬢' },
  vercel: { label: 'Vercel', icon: '▲' },
  vscode: { label: 'VS Code', icon: '◆' },
  docker: { label: 'Docker', icon: '▣' }
}

export default function FileTree({
  fileTree,
  fileTreeTruncated,
  projectDir,
  expandedDirs,
  toggleDir,
  activityMap,
  fileActivity,
  setPreviewUrl,
  setPreviewInput,
  setRightTab,
}) {

  const ACTION_PRIORITY = { created: 3, edited: 2, read: 1 }

  function getDirAction(nodes) {
    let best = null
    let bestPri = 0
    function walk(list) {
      if (!list) return
      for (const n of list) {
        const a = activityMap[n.path]
        if (a && (ACTION_PRIORITY[a] || 0) > bestPri) {
          best = a
          bestPri = ACTION_PRIORITY[a] || 0
        }
        if (n.children) walk(n.children)
      }
    }
    walk(nodes)
    return best
  }

  function renderTree(nodes, depth) {
    if (!nodes || nodes.length === 0) return null
    return nodes.map(node => {
      if (node.type === 'dir') {
        const isOpen = expandedDirs.has(node.path)
        const dirAction = getDirAction(node.children)
        return (
          <div key={node.path}>
            <div
              className={`tree-dir ${dirAction ? 'has-activity' : ''} ${dirAction ? 'dir-' + dirAction : ''}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => toggleDir(node.path)}
            >
              <span className="tree-folder-icon">{isOpen ? '📂' : '📁'}</span>
              <span className="tree-dir-name">{node.name}</span>
            </div>
            {isOpen && renderTree(node.children, depth + 1)}
          </div>
        )
      }
      const action = activityMap[node.path]
      const canPreview = PREVIEW_EXTS.some(ext => node.name.endsWith(ext))
      const canSandbox = COMPONENT_EXTS.some(ext => node.name.endsWith(ext))
      return (
        <div
          key={node.path}
          className={`tree-file ${action ? 'tree-file-active' : ''} tree-file-clickable`}
          style={{ paddingLeft: 22 + depth * 14 }}
          title={canPreview ? `Click to preview ${node.path}` : canSandbox ? `Preview component` : `Open in VS Code`}
          onClick={() => {
            if (canPreview) {
              const url = `/preview-file?path=${encodeURIComponent(node.path)}`
              setPreviewUrl(url)
              setPreviewInput(node.name)
              setRightTab('preview')
            } else if (canSandbox) {
              const url = `/preview-component?path=${encodeURIComponent(node.path)}`
              setPreviewUrl(url)
              setPreviewInput(node.name)
              setRightTab('preview')
            } else {
              fetch(`${API_URL}/open`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'vscode', target: node.path })
              })
            }
          }}
        >
          <span className="tree-file-name">{node.name}</span>
          {action && <span className={`files-entry-badge ${action}`}>{action}</span>}
        </div>
      )
    })
  }

  // Build integrations from file activity
  const integrations = {}
  fileActivity.forEach(f => {
    if (f.integration) {
      if (!integrations[f.integration]) integrations[f.integration] = []
      integrations[f.integration].push(f)
    }
  })
  const integrationKeys = Object.keys(integrations)

  return (
    <div className="files-panel-body">
      {fileTree.length === 0 && !projectDir && (
        <div className="files-panel-empty">Select a project to view files</div>
      )}
      {fileTree.length === 0 && projectDir && (
        <div className="files-panel-empty">No files found</div>
      )}
      {renderTree(fileTree, 0)}
      {fileTreeTruncated && (
        <div className="files-panel-truncated">Some files not shown (large project)</div>
      )}
      {integrationKeys.length > 0 && (
        <div className="integrations-section">
          <div className="files-group-label">Integrations</div>
          {integrationKeys.map(key => {
            const meta = INTEGRATION_META[key] || { label: key, icon: '●' }
            const items = integrations[key]
            const latest = items[items.length - 1]
            return (
              <div key={key} className="integration-row" title={latest.fullPath}>
                <span className="integration-icon">{meta.icon}</span>
                <span className="integration-label">{meta.label}</span>
                <span className={`files-entry-badge ${latest.action}`}>{latest.action}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
