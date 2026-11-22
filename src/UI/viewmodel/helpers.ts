// 视图模型内部纯工具：作用域解析、草稿与定义复制。
import type { AppState, Group, GroupItem, GroupItemKind, McpServer, Scope, Skill } from '../contracts'
import { resolvedServer, resolvedSkill, sameScope, scopeKey, selectors } from '../model/selectors'

export type ScopedDef = { name: string; scope: 'global' | 'workspace'; wsId?: string }

export const copyGroups = (groups: Group[]): Group[] =>
  groups.map((g) => ({ ...g, scope: { ...g.scope }, items: g.items.map((it) => ({ ...it })) }))

export const copyServer = (server: McpServer): McpServer => ({ ...server, tools: server.tools.map((t) => ({ ...t })) })

export const findGroup = (s: AppState, id: string | undefined): Group | null =>
  id ? s.groups.find((g) => g.id === id) ?? null : null

export const groupInScope = (s: AppState, id: string | undefined): Group | null => {
  const group = findGroup(s, id)
  return group && sameScope(group.scope, s.scope) ? group : null
}

/** 当前作用域自己的定义；工作区作用域只认 wsId 匹配的工作区定义。 */
export const currentDef = <T extends ScopedDef>(list: T[], s: AppState, name: string): T | null => {
  const ws = s.scope.kind === 'workspace' ? s.scope.id ?? null : null
  return list.find((x) => x.name === name && (ws
    ? x.scope === 'workspace' && x.wsId === ws
    : x.scope === 'global')) ?? null
}

/** 解析当前作用域链上最终生效的定义（工作区同名覆盖全局）。 */
export const resolveSkill = (s: AppState, name: string): Skill | null => resolvedSkill(s, name) ?? null
export const resolveServer = (s: AppState, name: string): McpServer | null => resolvedServer(s, name) ?? null

/** 写操作先落到当前作用域：工作区没有同名定义时，从全局定义复制一份覆盖。 */
export const ensureSkill = (s: AppState, name: string): Skill | null => {
  const local = currentDef(s.skills, s, name)
  if (local) return local
  const base = resolveSkill(s, name)
  if (!base) return null
  if (s.scope.kind === 'global') return base
  const copy: Skill = { ...base, scope: 'workspace', wsId: s.scope.id ?? undefined }
  s.skills.push(copy)
  return copy
}

export const ensureServer = (s: AppState, name: string): McpServer | null => {
  const local = currentDef(s.servers, s, name)
  if (local) return local
  const base = resolveServer(s, name)
  if (!base) return null
  if (s.scope.kind === 'global') return base
  const copy: McpServer = { ...copyServer(base), scope: 'workspace', wsId: s.scope.id ?? undefined }
  s.servers.push(copy)
  return copy
}

export const mergeSecrets = (
  base: Record<string, string> | undefined,
  patch: Record<string, string | null>,
): Record<string, string> => {
  const out = { ...(base || {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key]
    else out[key] = value
  }
  return out
}

export const currentGroupOf = (s: AppState): Group | null => groupInScope(s, s.activeGroup[scopeKey(s.scope)])

export const removeGroupRefs = (s: AppState, kind: GroupItemKind, name: string, scope: Scope | null): void => {
  for (const group of s.groups) {
    if (scope && !sameScope(group.scope, scope)) continue
    group.items = group.items.filter((it) => !(it.kind === kind && it.name === name))
  }
}

export const uniqueGroupName = (s: AppState): string => {
  let n = selectors.groupsOf(s.groups, s.scope, s.meta).length + 1
  const names = new Set(selectors.groupsOf(s.groups, s.scope, s.meta).map((g) => g.name))
  while (names.has('分组 ' + n)) n += 1
  return '分组 ' + n
}

export const mergeIntoGroup = (s: AppState, group: Group, kind: GroupItemKind, name: string, add: boolean): void => {
  const draftKey = selectors.draftId(group)
  const draft = Array.isArray(s.drafts[draftKey]) ? (s.drafts[draftKey] as GroupItem[]) : null
  const target = draft || group.items
  const exists = selectors.hasItem(target, kind, name)
  if (add && !exists) target.push({ kind, name })
  if (!add && exists) {
    const next = target.filter((it) => !(it.kind === kind && it.name === name))
    if (draft) s.drafts[draftKey] = next
    else group.items = next
  }
  if (!draft) s.saved[group.id] = JSON.stringify(group.items)
}

export const ensureDraftItems = (s: AppState, group: Group): GroupItem[] => {
  const key = selectors.draftId(group)
  if (!s.drafts[key] || !Array.isArray(s.drafts[key])) {
    const target = findGroup(s, group.id)
    const source = target ? target.items : group.items
    s.drafts[key] = source.map((it) => ({ kind: it.kind, name: it.name }))
  }
  return s.drafts[key] as GroupItem[]
}
