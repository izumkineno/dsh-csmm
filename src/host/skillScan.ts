import fs from 'node:fs'
import path from 'node:path'
import type { ScannedSkill, SkillScanRoot } from '../shared/types'

const ENABLED_FILE = 'SKILL.md'
const DISABLED_FILE = 'SKILL.md.disabled'

export interface SkillRootScan {
  root: SkillScanRoot
  skills: ScannedSkill[]
  errors: string[]
}

/** Scan the direct child directories of a DSH skills root. Read-only. */
export function scanSkillRoot(input: {
  root: string
  scope: 'global' | 'workspace'
  wsId?: string
}): SkillRootScan {
  const root = path.resolve(input.root)
  const rootView: SkillScanRoot = {
    scope: input.scope,
    ...(input.wsId ? { wsId: input.wsId } : {}),
    path: root,
    exists: false,
    count: 0,
  }
  const skills: ScannedSkill[] = []
  const errors: string[] = []

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
    rootView.exists = true
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') errors.push(`${root}: ${messageOf(error)}`)
    return { root: rootView, skills, errors }
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const dir = path.join(root, entry.name)
    let stat: fs.Stats
    try {
      stat = fs.statSync(dir)
    } catch (error) {
      errors.push(`${entry.name}: ${messageOf(error)}`)
      continue
    }
    if (!stat.isDirectory()) continue

    const picked = pickSkillFile(dir)
    if (!picked) continue
    const skill = readSkill({
      dir,
      name: entry.name,
      file: picked.file,
      duplicateDisabled: picked.duplicateDisabled,
      scope: input.scope,
      wsId: input.wsId,
      root,
    })
    skills.push(skill)
  }

  rootView.count = skills.length
  return { root: rootView, skills, errors }
}

/**
 * Parse the small YAML subset DSH uses in SKILL.md frontmatter. Supports quoted
 * scalars, folded/literal blocks, CRLF and a UTF-8 BOM; unknown fields are kept.
 */
export function parseSkillFrontmatter(text: string): { data: Record<string, string>; error?: string } {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  if (lines[0]?.trim() !== '---') return { data: {}, error: '缺少 frontmatter（首行不是 ---）' }

  let end = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (/^---\s*$/.test(lines[i]) || /^\.\.\.\s*$/.test(lines[i])) {
      end = i
      break
    }
  }
  if (end < 0) return { data: {}, error: 'frontmatter 未闭合（缺少结束 ---）' }

  const data: Record<string, string> = {}
  let currentKey: string | null = null
  let blockKey: string | null = null
  let blockStyle: 'literal' | 'folded' | null = null
  let blockLines: string[] = []

  const flushBlock = (): void => {
    if (!blockKey || !blockStyle) return
    const nonEmpty = blockLines.filter((line) => line.trim() !== '')
    const indent = nonEmpty.length
      ? Math.min(...nonEmpty.map((line) => (line.match(/^[ \t]*/) as RegExpMatchArray)[0].length))
      : 0
    const dedented = blockLines.map((line) => line.slice(Math.min(indent, line.length)))
    data[blockKey] = blockStyle === 'literal'
      ? dedented.join('\n').replace(/\n$/, '')
      : dedented.join('\n').replace(/\n+/g, ' ').trim()
    blockKey = null
    blockStyle = null
    blockLines = []
  }

  for (let i = 1; i < end; i += 1) {
    const line = lines[i]
    if (blockStyle) {
      if (line.trim() === '' || /^[ \t]/.test(line)) {
        blockLines.push(line)
        continue
      }
      flushBlock()
    }
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const match = /^([A-Za-z0-9_-]+):(?:[ \t]*(.*))?$/.exec(line)
    if (!match) {
      if (currentKey && /^[ \t]+/.test(line)) {
        data[currentKey] = `${data[currentKey] ?? ''} ${trimmed}`.trim()
      }
      continue
    }

    const key = match[1]
    const raw = (match[2] ?? '').trim()
    currentKey = key
    if (/^[|>][+-]?$/.test(raw)) {
      blockKey = key
      blockStyle = raw[0] === '|' ? 'literal' : 'folded'
      blockLines = []
      continue
    }
    data[key] = decodeScalar(raw)
  }
  flushBlock()
  return { data }
}

function readSkill(input: {
  dir: string
  name: string
  file: string
  duplicateDisabled: boolean
  scope: 'global' | 'workspace'
  wsId?: string
  root: string
}): ScannedSkill {
  const filePath = path.join(input.dir, input.file)
  const rel = path.relative(input.root, filePath).split(path.sep).join('/')
  let bytes = 0
  let text = ''
  try {
    bytes = fs.statSync(filePath).size
    text = fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    return baseSkill(input, rel, {
      bytes,
      notes: [`读取失败：${messageOf(error)}`],
    })
  }

  const parsed = parseSkillFrontmatter(text)
  const notes: string[] = []
  if (parsed.error) notes.push(parsed.error)
  const frontmatterName = (parsed.data.name ?? '').trim()
  if (!frontmatterName) notes.push('frontmatter 缺少 name；按目录名识别')
  else if (frontmatterName !== input.name) {
    notes.push(`frontmatter name=${frontmatterName}，与目录名不一致；DSH 可能不会加载`)
  }
  if (!(parsed.data.description ?? '').trim()) notes.push('frontmatter 缺少 description')
  if (input.duplicateDisabled) notes.push('同时存在 SKILL.md.disabled；按 SKILL.md 扫描')

  return baseSkill(input, rel, {
    bytes,
    label: frontmatterName || input.name,
    desc: (parsed.data.description ?? '').trim(),
    whenToUse: (parsed.data['when-to-use'] ?? parsed.data.when_to_use ?? '').trim(),
    model: !booleanValue(parsed.data['disable-model-invocation'], false),
    user: booleanValue(parsed.data['user-invocable'], true),
    notes,
  })
}

function baseSkill(
  input: { dir: string; name: string; file: string; scope: 'global' | 'workspace'; wsId?: string },
  rel: string,
  extra: Partial<Pick<ScannedSkill, 'bytes' | 'label' | 'desc' | 'whenToUse' | 'model' | 'user' | 'notes'>>,
): ScannedSkill {
  return {
    name: input.name,
    label: extra.label ?? input.name,
    scope: input.scope,
    ...(input.wsId ? { wsId: input.wsId } : {}),
    bytes: extra.bytes ?? 0,
    model: extra.model ?? true,
    user: extra.user ?? true,
    desc: extra.desc ?? '',
    whenToUse: extra.whenToUse ?? '',
    dir: input.dir,
    rel,
    file: input.file,
    enabled: input.file === ENABLED_FILE,
    notes: extra.notes ?? [],
  }
}

function pickSkillFile(dir: string): { file: string; duplicateDisabled: boolean } | null {
  const enabled = path.join(dir, ENABLED_FILE)
  const disabled = path.join(dir, DISABLED_FILE)
  const hasEnabled = isFile(enabled)
  const hasDisabled = isFile(disabled)
  if (hasEnabled) return { file: ENABLED_FILE, duplicateDisabled: hasDisabled }
  if (hasDisabled) return { file: DISABLED_FILE, duplicateDisabled: false }
  return null
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

function decodeScalar(raw: string): string {
  const value = raw.trim()
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  return value
}

function booleanValue(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = raw.trim().toLowerCase()
  if (value === 'true' || value === 'yes' || value === 'on' || value === '1') return true
  if (value === 'false' || value === 'no' || value === 'off' || value === '0') return false
  return fallback
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

