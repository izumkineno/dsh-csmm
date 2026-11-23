/**
 * Scope resolution shared by the host (authoritative) and, later, the UI.
 *
 * Semantics mirror `src/UI/model/selectors.ts`:
 * - global -> workspace; workspace definitions shadow global by name;
 * - an activeGroup key of `""` is an explicit "no group" and blocks inheritance;
 * - a missing key inherits the next layer;
 * - an empty group is still a real winning layer.
 */

import type {
  Bootstrap,
  CopyStrings,
  CustomPromptRecord,
  GroupItemKind,
  GroupRecord,
  McpServerRecord,
  Scope,
  SectionRecord,
  SkillRecord,
  StoreDocument,
  WorkspaceRecord,
} from './types'

export const DEFAULT_COPY: CopyStrings = {
  skillDir: '~/.dsh/skills',
  refreshServers: '已刷新服务器状态。',
  newSkillText: '# 新技能\n\n描述这个技能做什么。',
  newSkillDesc: '新技能',
  oauthOn: 'OAuth 已开启。',
  oauthOff: 'OAuth 已关闭。',
  serverSaved: '服务器已保存。',
  rawSaved: '原文已保存。',
  formTesting: '正在测试连接…',
  restart: '正在重启服务器…',
  configEdit: '配置已更新。',
  toolSaved: '工具清单已保存。',
  appTag: 'CSMM',
  scopeHint: '全局定义可被工作区同名定义覆盖。',
}

export function scopeKey(scope: Scope): string {
  return `${scope.kind}:${scope.id ?? ''}`
}

export function sameScope(a: Scope, b: Scope): boolean {
  return a.kind === b.kind && (a.id ?? '') === (b.id ?? '')
}

export function isTrustedWorkspace(store: StoreDocument, wsId: string | null | undefined): boolean {
  if (!wsId) return false
  const ws = store.workspaces.find((w) => w.id === wsId)
  return ws?.trusted !== false && ws !== undefined
}

export function chainFor(store: StoreDocument, scope: Scope): Scope[] {
  if (scope.kind === 'global') return [{ kind: 'global' }]
  if (!scope.id) return [{ kind: 'global' }]
  const chain: Scope[] = [{ kind: 'global' }]
  if (isTrustedWorkspace(store, scope.id)) chain.push({ kind: 'workspace', id: scope.id })
  return chain
}

export function groupsOf(store: StoreDocument, scope: Scope): GroupRecord[] {
  return store.groups.filter((g) => sameScope(g.scope, scope))
}

export function customsOf(store: StoreDocument, scope: Scope): CustomPromptRecord[] {
  return store.customs.filter((c) => sameScope(c.scope, scope))
}

export function visibleSkills(store: StoreDocument, scope: Scope): SkillRecord[] {
  const chain = chainFor(store, scope)
  const byName = new Map<string, SkillRecord>()
  for (const sc of chain) {
    for (const skill of store.skills) {
      if (sameScope(skillScope(skill), sc)) byName.set(skill.name, skill)
    }
  }
  return [...byName.values()]
}

export function visibleServers(store: StoreDocument, scope: Scope): McpServerRecord[] {
  const chain = chainFor(store, scope)
  const byName = new Map<string, McpServerRecord>()
  for (const sc of chain) {
    for (const server of store.servers) {
      if (sameScope(serverScope(server), sc)) byName.set(server.name, server)
    }
  }
  return [...byName.values()]
}

export function resolvedSkill(
  store: StoreDocument,
  scope: Scope,
  name: string | null | undefined,
): SkillRecord | undefined {
  if (!name) return undefined
  return visibleSkills(store, scope).find((s) => s.name === name)
}

export function resolvedServer(
  store: StoreDocument,
  scope: Scope,
  name: string | null | undefined,
): McpServerRecord | undefined {
  if (!name) return undefined
  return visibleServers(store, scope).find((s) => s.name === name)
}

export interface WinningLayer {
  sc: Scope
  group: GroupRecord | null
  customs: CustomPromptRecord[]
  inherited: boolean
}

export function winningLayer(store: StoreDocument, scope: Scope): WinningLayer {
  const chain = chainFor(store, scope)
  const first = chain[0]
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const sc = chain[i]
    const key = scopeKey(sc)
    if (!Object.prototype.hasOwnProperty.call(store.activeGroup, key)) continue
    const id = store.activeGroup[key]
    if (id === '') {
      return { sc, group: null, customs: [], inherited: i > 0 }
    }
    const group = groupsOf(store, sc).find((g) => g.id === id) ?? null
    return {
      sc,
      group,
      customs: customsOf(store, sc).filter((c) => c.enabled !== false),
      inherited: i > 0,
    }
  }
  return { sc: first, group: null, customs: [], inherited: false }
}

export interface EffectiveItems {
  section: Set<string>
  mcp: Set<string>
  skill: Set<string>
}

export function effectiveItems(store: StoreDocument, scope: Scope): EffectiveItems {
  const layer = winningLayer(store, scope)
  const items: EffectiveItems = { section: new Set(), mcp: new Set(), skill: new Set() }
  for (const item of layer.group?.items ?? []) items[item.kind].add(item.name)
  return items
}

export interface Budget {
  context: number
  section: number
  skill: number
  mcp: number
  custom: number
  total: number
  counts: Record<GroupItemKind, number>
}

export function tokenEstimate(text: string): number {
  if (!text) return 0
  const cjkRe = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff]/g
  const cjk = (text.match(cjkRe) || []).length
  const rest = text.replace(cjkRe, ' ')
  const words = (rest.match(/[A-Za-z0-9_]+/g) || []).length
  const other = rest.replace(/[A-Za-z0-9_]+/g, ' ').replace(/\s+/g, '').length
  return Math.round(cjk + words * 1.3 + other * 0.5)
}

export function skillTokens(skill: SkillRecord): number {
  return tokenEstimate(skill.text)
}

export function budget(
  store: StoreDocument,
  scope: Scope,
  sections: SectionRecord[] = [],
): Budget {
  const layer = winningLayer(store, scope)
  const result: Budget = {
    context: 0,
    section: 0,
    skill: 0,
    mcp: 0,
    custom: 0,
    total: 0,
    counts: { section: 0, mcp: 0, skill: 0 },
  }

  result.context = sections
    .filter((s) => s.kind === 'context')
    .reduce((sum, s) => sum + s.tokens, 0)

  for (const item of layer.group?.items ?? []) {
    result.counts[item.kind] += 1
    if (item.kind === 'section') {
      const section = sections.find((s) => s.name === item.name && s.kind === 'section')
      result.section += section?.tokens ?? 0
    } else if (item.kind === 'skill') {
      const skill = resolvedSkill(store, scope, item.name)
      if (skill && skill.enabled !== false) result.skill += skillTokens(skill)
    } else {
      const server = resolvedServer(store, scope, item.name)
      if (server && server.enabled !== false) result.mcp += server.tokens
    }
  }

  result.custom = layer.customs.reduce((sum, c) => sum + tokenEstimate(c.text), 0)
  result.total =
    result.context + result.section + result.skill + result.mcp + result.custom
  return result
}

export function denyCount(store: StoreDocument, scope: Scope): number {
  const effective = effectiveItems(store, scope)
  let count = 0
  for (const server of visibleServers(store, scope)) {
    if (server.enabled === false) continue
    const inGroup = effective.mcp.has(server.name)
    if (!inGroup) {
      count += server.tools.length
      continue
    }
    count += server.tools.filter((t) => !t.on).length
  }
  return count
}

export function shadowCount(store: StoreDocument, scope: Scope): number {
  const layer = winningLayer(store, scope)
  if (!layer.group) return 0
  const effective = effectiveItems(store, scope)
  return visibleSkills(store, scope).filter((s) => !effective.skill.has(s.name)).length
}

export function buildBootstrap(
  store: StoreDocument,
  scope: Scope,
  workspaces: WorkspaceRecord[],
  sections: SectionRecord[],
): Bootstrap {
  return {
    workspaces,
    sections,
    skills: visibleSkills(store, scope),
    servers: visibleServers(store, scope),
    groups: groupsOf(store, scope),
    customs: customsOf(store, scope),
    activeGroup: { ...store.activeGroup },
    disabledPrompts: [...(store.disabledPrompts ?? [])].sort(),
    copy: DEFAULT_COPY,
  }
}

function skillScope(skill: SkillRecord): Scope {
  return skill.scope === 'workspace'
    ? { kind: 'workspace', id: skill.wsId ?? null }
    : { kind: 'global' }
}

function serverScope(server: McpServerRecord): Scope {
  return server.scope === 'workspace'
    ? { kind: 'workspace', id: server.wsId ?? null }
    : { kind: 'global' }
}
