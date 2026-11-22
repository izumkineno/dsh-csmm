import type { ReactNode } from 'react'

/** 轻量 Markdown 渲染：只支持 SKILL.md 常用的块级与行内语法，全部构建为 React 节点，不注入 HTML。 */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-i${i++}`
    if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={key}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('*')) out.push(<em key={key}>{tok.slice(1, -1)}</em>)
    else {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)
      const href = mm ? mm[2] : '#'
      const ok = /^(https?:|mailto:)/i.test(href)
      out.push(ok
        ? <a key={key} href={href} target="_blank" rel="noreferrer">{mm ? mm[1] : tok}</a>
        : <span key={key}>{mm ? mm[1] : tok}</span>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function frontmatter(lines: string[]): { meta: [string, string][]; rest: string[] } | null {
  if (lines[0]?.trim() !== '---') return null
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end < 0) return null
  const meta: [string, string][] = []
  for (const line of lines.slice(1, end)) {
    const i = line.indexOf(':')
    if (i > 0) meta.push([line.slice(0, i).trim(), line.slice(i + 1).trim()])
  }
  return { meta, rest: lines.slice(end + 1) }
}

type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'code'; lang: string; code: string }
  | { t: 'quote'; text: string }
  | { t: 'hr' }

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let i = 0
  const isBlockStart = (l: string) =>
    /^(#{1,6}\s|```|>\s?|[-*+]\s+|\d+\.\s+)/.test(l) || /^(-{3,}|\*{3,})$/.test(l.trim())
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    const fence = /^```(\w*)/.exec(line)
    if (fence) {
      const code: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++ }
      i++
      blocks.push({ t: 'code', lang: fence[1], code: code.join('\n') })
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) { blocks.push({ t: 'h', level: h[1].length, text: h[2] }); i++; continue }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { blocks.push({ t: 'hr' }); i++; continue }
    if (/^>\s?/.test(line)) {
      const q: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++ }
      blocks.push({ t: 'quote', text: q.join(' ') })
      continue
    }
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*+]\s+/, '')); i++ }
      blocks.push({ t: 'ul', items })
      continue
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, '')); i++ }
      blocks.push({ t: 'ol', items })
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) { para.push(lines[i].trim()); i++ }
    if (para.length) blocks.push({ t: 'p', text: para.join(' ') })
    else i++
  }
  return blocks
}

export default function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const fm = frontmatter(lines)
  const blocks = parseBlocks(fm ? fm.rest : lines)
  return (
    <div className="md">
      {fm && fm.meta.length > 0 && (
        <dl className="md-meta">
          {fm.meta.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
      )}
      {blocks.map((b, i) => {
        const key = `b${i}`
        if (b.t === 'h') {
          const Tag = (`h${Math.min(b.level, 4)}`) as 'h1' | 'h2' | 'h3' | 'h4'
          return <Tag key={key}>{inline(b.text, key)}</Tag>
        }
        if (b.t === 'code') return <pre key={key}><code>{b.code}</code></pre>
        if (b.t === 'hr') return <hr key={key} />
        if (b.t === 'quote') return <blockquote key={key}>{inline(b.text, key)}</blockquote>
        if (b.t === 'ul') return <ul key={key}>{b.items.map((x, j) => <li key={`${key}-${j}`}>{inline(x, `${key}-${j}`)}</li>)}</ul>
        if (b.t === 'ol') return <ol key={key}>{b.items.map((x, j) => <li key={`${key}-${j}`}>{inline(x, `${key}-${j}`)}</li>)}</ol>
        return <p key={key}>{inline(b.text, key)}</p>
      })}
    </div>
  )
}
