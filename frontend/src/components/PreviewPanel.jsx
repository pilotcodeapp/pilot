import { API_URL } from '../utils'

function proxyUrl(url) {
  if (!url) return ''
  if (url.startsWith('/') || url.startsWith(API_URL + '/preview-file')) return url
  return `${API_URL}/preview-proxy?url=${encodeURIComponent(url)}`
}

export default function PreviewPanel({
  previewUrl,
  setPreviewUrl,
  previewInput,
  setPreviewInput,
  iframeRef,
  devServer,
  startDevServer,
  stopDevServer,
}) {
  return (
    <div className="preview-panel">
      <div className="preview-toolbar">
        <input
          className="preview-url-input"
          type="text"
          placeholder="localhost:3000"
          value={previewInput}
          onChange={e => setPreviewInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              const url = (previewInput.startsWith('http') || previewInput.startsWith('/')) ? previewInput : `http://${previewInput}`
              setPreviewUrl(url)
              setPreviewInput(url)
            }
          }}
        />
        <button
          className="preview-refresh-btn"
          onClick={() => {
            if (iframeRef.current) {
              try { iframeRef.current.contentWindow.location.reload() } catch {
                const src = iframeRef.current.src
                iframeRef.current.src = ''
                setTimeout(() => { iframeRef.current.src = src }, 50)
              }
            }
          }}
          title="Refresh"
        >↻</button>
      </div>

      {devServer.available && (
        <div className={`dev-server-bar ${devServer.status}`}>
          <span className={`dev-server-dot ${devServer.status}`} />
          <span className="dev-server-label">
            {devServer.status === 'running' ? `${devServer.command}` :
             devServer.status === 'starting' ? `Starting ${devServer.command}...` :
             devServer.command}
          </span>
          {devServer.status === 'stopped' && (
            <button className="dev-server-btn start" onClick={startDevServer}>Start</button>
          )}
          {(devServer.status === 'starting' || devServer.status === 'running') && (
            <button className="dev-server-btn stop" onClick={stopDevServer}>Stop</button>
          )}
        </div>
      )}

      <div className="preview-iframe-wrap">
        {previewUrl ? (
          <iframe
            ref={iframeRef}
            className="preview-iframe"
            src={proxyUrl(previewUrl)}
            title="Preview"
          />
        ) : (
          <div className="preview-empty">
            <div className="preview-empty-text">No preview URL set</div>
            <div className="preview-empty-hint">
              {devServer.status === 'starting'
                ? 'Waiting for dev server to start...'
                : devServer.available && devServer.status === 'stopped'
                  ? `${devServer.command} is stopped — click Start to preview your app`
                  : 'Pilot auto-detects local URLs from Claude\'s output'
              }
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
