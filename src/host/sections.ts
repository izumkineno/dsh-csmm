import fs from 'node:fs'
import path from 'node:path'
import type { SectionRecord } from '../shared/types'
import { tokenEstimate } from '../shared/resolve'
import { globalPaths } from './paths'

/**
 * Load prompt fragments owned by this plugin. Each Markdown file under
 * `<DSH_HOME>/dsh-csmm/sections` becomes one `section` record; the file's
 * relative path (without `.md`) is the section name. Nothing is written by this
 * module — the directory is the user-owned input surface.
 */
export function loadSections(home: string): SectionRecord[] {
  const root = path.join(globalPaths(home).root, 'sections')
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }

  const records: SectionRecord[] = []
  const walk = (dir: string, prefix: string): void => {
    let children: fs.Dirent[]
    try {
      children = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const child of children) {
      if (child.name.startsWith('.')) continue
      const full = path.join(dir, child.name)
      const name = prefix ? `${prefix}/${child.name}` : child.name
      if (child.isDirectory()) {
        walk(full, name)
        continue
      }
      if (!child.name.toLowerCase().endsWith('.md')) continue
      const sectionName = name.slice(0, -3)
      if (!sectionName) continue
      let text = ''
      try {
        text = fs.readFileSync(full, 'utf8').trim()
      } catch {
        continue
      }
      if (!text) continue
      records.push({
        name: sectionName,
        source: 'csmm',
        tokens: tokenEstimate(text),
        kind: 'section',
        text,
      })
    }
  }
  walk(root, '')
  return records.sort((a, b) => a.name.localeCompare(b.name))
}
