import CodeBlock from './CodeBlock'
import { formatInline } from '../utils'

export default function Markdown({ text }) {
  const lines = text.split('\n')
  const elements = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i++
      continue
    }

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      i++
      const codeLines = []
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      if (i < lines.length) i++
      elements.push(
        <CodeBlock key={`code-${i}`} lang={lang} code={codeLines.join('\n')} />
      )
      continue
    }

    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      const items = []
      const startNum = parseInt(line.match(/^(\d+)\./)[1], 10)
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ''))
        i++
      }
      elements.push(
        <ol key={`ol-${i}`} className="md-ol" start={startNum}>
          {items.map((item, j) => (
            <li key={j} dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
          ))}
        </ol>
      )
      continue
    }

    // Bullet list
    if (/^[-*]\s/.test(line)) {
      const items = []
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s/, ''))
        i++
      }
      elements.push(
        <ul key={`ul-${i}`} className="md-ul">
          {items.map((item, j) => (
            <li key={j} dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
          ))}
        </ul>
      )
      continue
    }

    if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="md-h4">{line.replace('### ', '')}</h4>)
      i++
      continue
    }

    if (line.startsWith('## ')) {
      elements.push(<h3 key={i} className="md-h3">{line.replace('## ', '')}</h3>)
      i++
      continue
    }

    if (line.startsWith('# ')) {
      elements.push(<h2 key={i} className="md-h2">{line.replace('# ', '')}</h2>)
      i++
      continue
    }

    elements.push(
      <p key={i} style={{ marginBottom: '8px' }}
        dangerouslySetInnerHTML={{ __html: formatInline(line) }} />
    )
    i++
  }

  return <>{elements}</>
}
