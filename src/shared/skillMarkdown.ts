/**
 * SKILL.md 的纯函数层：解析 frontmatter、挑选导入候选、从 DSH 注册表条目生成工作区覆盖记录。
 *
 * 这里不碰文件系统、不依赖 React 或宿主 API，供 host 与 UI 共用。
 */

import type { DshSkillDetail, SkillRecord } from './types'

/** 单个技能正文的硬上限；超过即拒绝导入或编辑。 */
export const MAX_SKILL_TEXT_BYTES = 800_000

export interface ParsedSkillMarkdown {
  name: string
  description: string
  whenToUse?: string
  model: boolean
  user: boolean
  /** frontmatter 之后的正文；没有 frontmatter 时为原始文本。 */
  text: string
  frontmatterPresent: boolean
  warnings: string[]
}

export interface SkillSourceInput {
  path: string
  size: number
}

export interface SkillSourceEntry extends SkillSourceInput {
  fallbackName: string
}

export interface SkillSourceRejection {
  path: string
  reason: string
}

export interface SkillSourceSelection {
  picked: SkillSourceEntry[]
  rejected: SkillSourceRejection[]
}

/** 技能名归一化：小写，非法字符折叠为 '-'，去掉首尾 '-'。 */
export function normalizeSkillName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function byteLengthUtf8(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

function booleanValue(value: string, fallback: boolean): boolean {
  const normalized = unquote(value).toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return fallback
}

function firstParagraph(text: string): string {
  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const trimmed = block.trim()
    if (!trimmed) continue
    const oneLine = trimmed.replace(/\s+/g, ' ')
    return oneLine.length > 200 ? oneLine.slice(0, 200) : oneLine
  }
  return ''
}

/**
 * 解析 SKILL.md。
 *
 * frontmatter 必须是文件开头的 `---` 块；未闭合时按正文处理并记录 warning。
 * 没有 frontmatter 时用 fallbackName 补名字、首段补描述，调用策略默认全开。
 * 解析失败不会回退到文件名以外的猜测。
 */
export function parseSkillMarkdown(raw: string, fallbackName: string): ParsedSkillMarkdown {
  const source = raw.replace(/^\uFEFF/, '')
  const warnings: string[] = []
  const fallback = normalizeSkillName(fallbackName) || 'skill'
  let body = source
  let frontmatterPresent = false
  const fields = new Map<string, string>()

  const lines = source.split(/\r?\n/)
  if (lines.length > 0 && lines[0].trim() === '---') {
    let close = -1
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index].trim() === '---') {
        close = index
        break
      }
    }
    if (close > 0) {
      frontmatterPresent = true
      for (let index = 1; index < close; index += 1) {
        const line = lines[index]
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
        if (!match) {
          warnings.push(`frontmatter 第 ${index + 1} 行无法解析，已忽略`)
          continue
        }
        fields.set(match[1], match[2])
      }
      body = lines.slice(close + 1).join('\n').replace(/^\n/, '')
    } else {
      warnings.push('frontmatter 未闭合，按正文处理')
    }
  }

  // 没有解析到 frontmatter 时 body 仍是原始文本。
  const nameValue = fields.get('name')
  const descriptionValue = fields.get('description')
  const whenValue = fields.get('when-to-use') ?? fields.get('whenToUse')
  const disableModel = fields.get('disable-model-invocation')
  const userInvocable = fields.get('user-invocable')

  const name = normalizeSkillName(nameValue ? unquote(nameValue) : '') || fallback
  const description = descriptionValue ? unquote(descriptionValue) : firstParagraph(body)
  const whenToUse = whenValue ? unquote(whenValue).trim() : ''
  const model = disableModel === undefined ? true : !booleanValue(disableModel, false)
  const user = userInvocable === undefined ? true : booleanValue(userInvocable, true)

  return {
    name,
    description,
    ...(whenToUse ? { whenToUse } : {}),
    model,
    user,
    text: frontmatterPresent ? body : source,
    frontmatterPresent,
    warnings,
  }
}

function pathBasename(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  return slash < 0 ? normalized : normalized.slice(slash + 1)
}

function fallbackNameFor(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\/+/, '')
  const base = pathBasename(normalized)
  const withoutExt = base.replace(/\.(md|markdown)$/i, '')
  if (withoutExt.toLowerCase() !== 'skill') return withoutExt
  const slash = normalized.lastIndexOf('/')
  if (slash < 0) return 'skill'
  const parent = normalized.slice(0, slash)
  const parentBase = pathBasename(parent)
  return parentBase || 'skill'
}

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

/**
 * 从一组候选文件里挑出可导入的技能。
 *
 * - zip 直接拒绝（不做解压）。
 * - 目录按顶层目录分组：优先该目录顶层的 SKILL.md；否则要求组内只有一个 Markdown；
 *   0 个或多个都拒绝，避免静默挑错。
 * - 平铺的 .md 逐个接收；超过 800000 字节的拒绝。
 */
export function selectSkillSources(entries: SkillSourceInput[]): SkillSourceSelection {
  const picked: SkillSourceEntry[] = []
  const rejected: SkillSourceRejection[] = []
  const seen = new Set<string>()
  const groups = new Map<string, SkillSourceInput[]>()

  for (const entry of entries) {
    const path = entry.path.replace(/\\/g, '/').replace(/^\.\/+/, '')
    if (!path || seen.has(path)) continue
    seen.add(path)

    if (/\.zip$/i.test(path)) {
      rejected.push({ path, reason: 'zip 暂不支持，请解压后导入' })
      continue
    }
    if (!isMarkdown(path)) continue

    const slash = path.indexOf('/')
    if (slash < 0) {
      if (entry.size > MAX_SKILL_TEXT_BYTES) {
        rejected.push({ path, reason: `技能文件超过 ${MAX_SKILL_TEXT_BYTES} 字节` })
        continue
      }
      picked.push({ path, size: entry.size, fallbackName: fallbackNameFor(path) })
      continue
    }

    const top = path.slice(0, slash)
    const list = groups.get(top) ?? []
    list.push({ path, size: entry.size })
    groups.set(top, list)
  }

  for (const [top, list] of groups) {
    const topSkill = list.find((entry) => entry.path === `${top}/SKILL.md`)
    let chosen: SkillSourceInput | undefined
    if (topSkill) {
      chosen = topSkill
    } else {
      const markdown = list.filter((entry) => isMarkdown(entry.path))
      if (markdown.length === 1) {
        chosen = markdown[0]
      } else {
        const reason =
          markdown.length === 0
            ? '目录中没有 Markdown 技能文件'
            : '目录下有多个 Markdown 候选，请保留一个 SKILL.md'
        for (const entry of list) rejected.push({ path: entry.path, reason })
        continue
      }
    }

    if (chosen.size > MAX_SKILL_TEXT_BYTES) {
      rejected.push({ path: chosen.path, reason: `技能文件超过 ${MAX_SKILL_TEXT_BYTES} 字节` })
      continue
    }
    picked.push({
      path: chosen.path,
      size: chosen.size,
      fallbackName: chosen.path === `${top}/SKILL.md` ? top : fallbackNameFor(chosen.path),
    })
  }

  return { picked, rejected }
}

/** 把 DSH 注册表条目转成当前工作区的同名覆盖记录。 */
export function buildWorkspaceSkillFromDsh(detail: DshSkillDetail, wsId: string): SkillRecord {
  const text = detail.content
  return {
    name: detail.name,
    label: detail.name,
    scope: 'workspace',
    wsId,
    bytes: byteLengthUtf8(text),
    model: detail.model,
    user: detail.user,
    desc: detail.description,
    text,
    enabled: true,
    ...(detail.whenToUse ? { whenToUse: detail.whenToUse } : {}),
  }
}
