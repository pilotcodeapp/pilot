import FileTree from './FileTree'
import PreviewPanel from './PreviewPanel'

export default function RightPanel({
  showFiles,
  setShowFiles,
  filesWidth,
  rightTab,
  setRightTab,
  // FileTree props
  fileTree,
  fileTreeTruncated,
  projectDir,
  expandedDirs,
  toggleDir,
  activityMap,
  fileActivity,
  // PreviewPanel props
  previewUrl,
  setPreviewUrl,
  previewInput,
  setPreviewInput,
  iframeRef,
  devServer,
  startDevServer,
  stopDevServer,
}) {
  if (!showFiles) {
    return <button className="files-panel-toggle" onClick={() => setShowFiles(true)}>Files</button>
  }

  return (
    <aside className="files-panel" style={{ width: rightTab === 'preview' ? Math.max(filesWidth, 420) : filesWidth }}>
      <div className="files-panel-header">
        <div className="right-panel-tabs">
          <button
            className={`right-panel-tab ${rightTab === 'files' ? 'active' : ''}`}
            onClick={() => setRightTab('files')}
          >Files</button>
          <button
            className={`right-panel-tab ${rightTab === 'preview' ? 'active' : ''}`}
            onClick={() => setRightTab('preview')}
          >Preview</button>
        </div>
        <button className="files-panel-close" onClick={() => setShowFiles(false)}>x</button>
      </div>

      {rightTab === 'files' && (
        <FileTree
          fileTree={fileTree}
          fileTreeTruncated={fileTreeTruncated}
          projectDir={projectDir}
          expandedDirs={expandedDirs}
          toggleDir={toggleDir}
          activityMap={activityMap}
          fileActivity={fileActivity}
          setPreviewUrl={setPreviewUrl}
          setPreviewInput={setPreviewInput}
          setRightTab={setRightTab}
        />
      )}

      {rightTab === 'preview' && (
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
    </aside>
  )
}
