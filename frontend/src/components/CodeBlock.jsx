import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import markdown from 'highlight.js/lib/languages/markdown'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'
import 'highlight.js/styles/github-dark.css'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('jsx', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('tsx', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('zsh', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('rs', rust)
hljs.registerLanguage('go', go)

export default function CodeBlock({ lang, code }) {
  const [copied, setCopied] = useState(false)
  const highlighted = useMemo(() => {
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value
      }
      return hljs.highlightAuto(code).value
    } catch {
      return null
    }
  }, [lang, code])
  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    if (navigator.vibrate) navigator.vibrate(15)
    setTimeout(() => setCopied(false), 2000)
  }

  // Long-press to copy on mobile
  const longPressTimer = useRef(null)
  const onTouchStart = useCallback(() => {
    longPressTimer.current = setTimeout(copy, 500)
  }, [code])
  const onTouchEndCancel = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
  }, [])

  const preRef = useRef(null)
  const [overflowClass, setOverflowClass] = useState('')

  const checkOverflow = useCallback(() => {
    const el = preRef.current
    if (!el) return
    const hasOverflow = el.scrollWidth > el.clientWidth + 2
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2
    setOverflowClass(hasOverflow ? (atEnd ? 'has-overflow scrolled-end' : 'has-overflow') : '')
  }, [])

  useEffect(() => { checkOverflow() }, [code, checkOverflow])

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{lang || 'code'}</span>
        <button className="code-block-copy" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className={`code-block-pre-wrap ${overflowClass}`}>
        <pre className="code-block-pre" ref={preRef} onScroll={checkOverflow}
          onTouchStart={onTouchStart} onTouchEnd={onTouchEndCancel} onTouchMove={onTouchEndCancel}><code
          className={lang ? `hljs language-${lang}` : 'hljs'}
          {...(highlighted ? { dangerouslySetInnerHTML: { __html: highlighted } } : { children: code })}
        /></pre>
      </div>
    </div>
  )
}
