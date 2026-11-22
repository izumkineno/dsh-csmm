// 纯派生数据层：只读 state，不产生副作用，也不接触任何 Mock 内容。
import type {
  AppState,
  BudgetBreakdown,
  CoveredLayers,
  CustomPrompt,
  EffectiveItems,
  Group,
  GroupItem,
  GroupItemKind,
  McpServer,
  Meta,
  Scope,
  Section,
  Selectors,
  Skill,
  WinningLayer,
} from '../contracts'

export const scopeKey = (scope: Scope): string => scope.kind + ':' + (scope.id || '')
export const sameScope = (a: Scope, b: Scope): boolean => scopeKey(a) === scopeKey(b)
export const draftId = (group: Group): string => scopeKey(group.scope) + '#' + group.id
export const formatKB = (bytes: number): number => Math.round((bytes / 1024) * 10) / 10

export function tokenEstimate(text: string): number {
  if (!text) return 0
  const cjkRe = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff]/g
  const cjk = (text.match(cjkRe) || []).length
  const rest = text.replace(cjkRe, ' ')
  const words = (rest.match(/[A-Za-z0-9_]+/g) || []).length
  const other = rest.replace(/[A-Za-z0-9_]+/g, ' ').replace(/\s+/g, '').length
  return Math.round(cjk + words * 1.3 + other * 0.5)
}

export function currentWsId(scope: Scope, _meta: Meta): string | null {
  return scope.kind === 'workspace' ? scope.id ?? null : null
}

/** 工作区信任：未标记为不可信即视为可信；全局始终可信。 */
export const isTrustedWorkspace = (meta: Meta, wsId: string | null | undefined): boolean => {
  if (!wsId) return true
  const workspace = (meta.workspaces || []).find((w) => w.id === wsId)
  return !workspace || workspace.trusted !== false
}

type ScopedDef = { name: string; scope: 'global' | 'workspace'; wsId?: string }

const defScope = (def: ScopedDef): Scope => ({ kind: def.scope, id: def.wsId ?? null })

export function skillVisible(skill: Skill, scope: Scope, meta: Meta): boolean {
  if (skill.scope === 'global') return true
  const ws = currentWsId(scope, meta)
  return !!ws && skill.wsId === ws && isTrustedWorkspace(meta, ws)
}

export function serverVisible(server: McpServer, scope: Scope, meta: Meta): boolean {
  if (server.scope === 'global') return true
  const ws = currentWsId(scope, meta)
  return !!ws && server.wsId === ws && isTrustedWorkspace(meta, ws)
}

export const isRestricted = (state: AppState): boolean =>
  state.scope.kind === 'workspace' && !isTrustedWorkspace(state.meta, state.scope.id)

export function chainFor(scope: Scope, meta: Meta): Scope[] {
  const out: Scope[] = [{ kind: 'global' }]
  if (scope.kind === 'workspace' && isTrustedWorkspace(meta, scope.id)) out.push(scope)
  return out
}

/** 在同一名称的多个作用域定义里，取当前链上最具体的一层。 */
const resolveInChain = <T extends ScopedDef>(defs: T[], state: AppState, name: string | null | undefined): T | undefined => {
  if (!name) return undefined
  const chain = chainFor(state.scope, state.meta)
  for (let i = chain.length - 1; i >= 0; i--) {
    const hit = defs.find((def) => def.name === name && sameScope(defScope(def), chain[i]))
    if (hit) return hit
  }
  return undefined
}

export const resolvedSkill = (state: AppState, name: string | null | undefined): Skill | undefined =>
  resolveInChain(state.skills, state, name)

export const resolvedServer = (state: AppState, name: string | null | undefined): McpServer | undefined =>
  resolveInChain(state.servers, state, name)

/** 当前作用域可见的定义，同名时工作区覆盖全局，每个名字只保留一条。 */
export const visibleSkills = (state: AppState): Skill[] => {
  const chosen = new Map<string, Skill>()
  for (const skill of state.skills) {
    if (!skillVisible(skill, state.scope, state.meta)) continue
    const current = chosen.get(skill.name)
    if (!current || (current.scope === 'global' && skill.scope === 'workspace')) chosen.set(skill.name, skill)
  }
  return state.skills.filter((skill) => chosen.get(skill.name) === skill)
}

export const visibleServers = (state: AppState): McpServer[] => {
  const chosen = new Map<string, McpServer>()
  for (const server of state.servers) {
    if (!serverVisible(server, state.scope, state.meta)) continue
    const current = chosen.get(server.name)
    if (!current || (current.scope === 'global' && server.scope === 'workspace')) chosen.set(server.name, server)
  }
  return state.servers.filter((server) => chosen.get(server.name) === server)
}

export const groupsOf = (groups: Group[], scope: Scope, meta: Meta): Group[] => {
  if (scope.kind === 'workspace' && !isTrustedWorkspace(meta, scope.id)) return []
  return groups.filter((g) => sameScope(g.scope, scope))
}
export const customsOf = (customs: CustomPrompt[], scope: Scope, meta: Meta): CustomPrompt[] => {
  if (scope.kind === 'workspace' && !isTrustedWorkspace(meta, scope.id)) return []
  return customs.filter((c) => sameScope(c.scope, scope))
}
export const hasItem = (list: GroupItem[], kind: GroupItemKind, name: string): boolean =>
  list.some((it) => it.kind === kind && it.name === name)

export const scopeTitle = (scope: Scope | null | undefined, meta: Meta): string => {
  if (!scope || scope.kind === 'global') return '全局'
  return (meta.workspaces || []).find((w) => w.id === scope.id)?.title || '工作区'
}

export const scopeCrumb = (scope: Scope, meta: Meta): string =>
  scope.kind === 'global' ? '全局' : (SCOPE_LABEL_MAP[scope.kind] ?? scope.kind) + ' · ' + scopeTitle(scope, meta)

// 避免运行时循环依赖：这里只镜像 contracts 里的标签字面量。
const SCOPE_LABEL_MAP: Record<Scope['kind'], string> = {
  global: '全局',
  workspace: '工作区',
}

export const groupCounts = (group: Group): Record<GroupItemKind, number> => {
  const counts: Record<GroupItemKind, number> = { section: 0, mcp: 0, skill: 0 }
  for (const item of group.items) counts[item.kind] += 1
  return counts
}

const sectionTokens = (state: AppState, name: string): number => {
  const section = state.meta.sections.find((x) => x.name === name)
  return section ? section.tokens : 0
}

const serverTokens = (state: AppState, name: string): number => {
  const server = resolvedServer(state, name)
  return server ? server.tokens : 0
}

const skillTokens = (state: AppState, name: string): number => {
  const skill = resolvedSkill(state, name)
  return skill ? tokenEstimate(skill.text) : 0
}

export const groupTokens = (group: Pick<Group, 'items'>, state: AppState): number => {
  let total = 0
  for (const item of group.items) {
    if (item.kind === 'section') total += sectionTokens(state, item.name)
    if (item.kind === 'mcp') total += serverTokens(state, item.name)
    if (item.kind === 'skill') total += skillTokens(state, item.name)
  }
  return total
}

// 最近一层有映射的层通吃：组内容 + 本层自定义。
// 键缺席 = 继承上层；值为空串 = 显式不用任何分组（阻断继承）。
export const winningLayer = (state: AppState): WinningLayer => {
  const chain = chainFor(state.scope, state.meta)
  for (let i = chain.length - 1; i >= 0; i--) {
    const sc = chain[i]
    const key = scopeKey(sc)
    if (!(key in state.activeGroup)) continue
    const groupId = state.activeGroup[key]
    if (!groupId) {
      return { sc, group: null, customs: [], inherited: i < chain.length - 1, depth: i }
    }
    const group = state.groups.find((x) => x.id === groupId) ?? null
    if (group) {
      return {
        sc,
        group,
        customs: customsOf(state.customs, sc, state.meta),
        inherited: i < chain.length - 1,
        depth: i,
      }
    }
  }
  return { sc: chain[0], group: null, customs: [], inherited: false, depth: -1 }
}

export const coveredLayers = (state: AppState): CoveredLayers => {
  const winner = winningLayer(state)
  if (winner.depth < 0) return { winner, covered: [] }
  const chain = chainFor(state.scope, state.meta)
  const covered: Array<{ sc: Scope; group: Group }> = []
  for (let i = 0; i < winner.depth; i++) {
    const groupId = state.activeGroup[scopeKey(chain[i])]
    const group = groupId ? state.groups.find((x) => x.id === groupId) : null
    if (group) covered.push({ sc: chain[i], group })
  }
  return { winner, covered }
}

export const effectiveItems = (state: AppState): EffectiveItems | null => {
  const winner = winningLayer(state)
  if (!winner.group) return null
  const used: EffectiveItems = { section: new Set(), mcp: new Set(), skill: new Set() }
  for (const item of winner.group.items) used[item.kind].add(item.name)
  return used
}

export const effSkillEnabled = (state: AppState, name: string, _skipKey?: string): boolean => {
  const skill = resolvedSkill(state, name)
  return skill ? skill.enabled !== false : true
}

export const effServerEnabled = (state: AppState, name: string, _skipKey?: string): boolean => {
  const server = resolvedServer(state, name)
  return server ? server.enabled !== false : true
}

export const effToolOn = (state: AppState, server: string, tool: string, _skipKey?: string): boolean => {
  const target = resolvedServer(state, server)
  const entry = target?.tools.find((t) => t.name === tool)
  return entry ? entry.on !== false : true
}

/** 只统计生效分组内、且当前可用的服务器上的被关工具。 */
export const denyCountFor = (state: AppState): number => {
  const used = effectiveItems(state)
  const names = used ? Array.from(used.mcp) : visibleServers(state).map((server) => server.name)
  let count = 0
  for (const name of names) {
    const server = resolvedServer(state, name)
    if (!server || !effServerEnabled(state, name)) continue
    for (const tool of server.tools) {
      if (!effToolOn(state, server.name, tool.name)) count++
    }
  }
  return count
}

export const shadowCountFor = (state: AppState): number => {
  const used = effectiveItems(state)
  if (!used) return 0
  return visibleSkills(state).filter((skill) => !used.skill.has(skill.name)).length
}

export const filteredSkills = (state: AppState): Skill[] => {
  const base = visibleSkills(state).filter((skill) => state.showPlugin !== false || !skill.bundled)
  const query = (state.q.skill || '').trim().toLowerCase()
  if (!query) return base
  return base.filter((s) => (s.name + ' ' + s.label + ' ' + s.desc).toLowerCase().indexOf(query) >= 0)
}

export const filteredServers = (state: AppState): McpServer[] => {
  const base = visibleServers(state)
  const query = (state.q.mcp || '').trim().toLowerCase()
  if (!query) return base
  return base.filter(
    (s) => (s.name + ' ' + (s.label || '') + ' ' + (s.url || '') + ' ' + (s.command || '')).toLowerCase().indexOf(query) >= 0,
  )
}

export const groupSources = (meta: Meta): string[] => {
  const out: string[] = []
  for (const section of meta.sections as Section[]) {
    if (section.kind !== 'section') continue
    if (!out.includes(section.source)) out.push(section.source)
  }
  return out
}

export const currentGroup = (state: AppState): Group | null => {
  const id = state.activeGroup[scopeKey(state.scope)]
  return id ? state.groups.find((g) => g.id === id) ?? null : null
}

export const itemsTokens = (items: GroupItem[], state: AppState): number => {
  let total = 0
  for (const item of items) {
    if (item.kind === 'section') total += sectionTokens(state, item.name)
    if (item.kind === 'mcp') total += serverTokens(state, item.name)
    if (item.kind === 'skill') total += skillTokens(state, item.name)
  }
  return total
}

/** 预算只统计真正会进入上下文的项：停用的技能 / MCP 服务器不计入。 */
export const budgetBreakdown = (state: AppState): BudgetBreakdown => {
  const winner = winningLayer(state)
  const out: BudgetBreakdown = {
    context: 0,
    section: 0,
    skill: 0,
    mcp: 0,
    custom: 0,
    total: 0,
    counts: { section: 0, mcp: 0, skill: 0 },
  }
  for (const section of state.meta.sections) {
    if (section.kind === 'context') out.context += section.tokens
  }
  if (winner.group) {
    for (const item of winner.group.items) {
      out.counts[item.kind] += 1
      if (item.kind === 'section') out.section += sectionTokens(state, item.name)
      if (item.kind === 'mcp' && effServerEnabled(state, item.name)) out.mcp += serverTokens(state, item.name)
      if (item.kind === 'skill' && effSkillEnabled(state, item.name)) out.skill += skillTokens(state, item.name)
    }
  }
  for (const custom of winner.customs) out.custom += tokenEstimate(custom.text)
  out.total = out.context + out.section + out.skill + out.mcp + out.custom
  return out
}

export const mergedTotal = (state: AppState): number => budgetBreakdown(state).total

export const selectors: Selectors = {
  scopeKey,
  sameScope,
  draftId,
  formatKB,
  tokenEstimate,
  currentWsId,
  skillVisible,
  isRestricted,
  chainFor,
  groupsOf,
  customsOf,
  hasItem,
  scopeTitle,
  scopeCrumb,
  groupCounts,
  groupTokens,
  winningLayer,
  coveredLayers,
  effectiveItems,
  denyCountFor,
  shadowCountFor,
  filteredSkills,
  filteredServers,
  resolvedSkill,
  resolvedServer,
  visibleSkills,
  visibleServers,
  isTrustedWorkspace,
  groupSources,
  currentGroup,
  effSkillEnabled,
  effServerEnabled,
  effToolOn,
  itemsTokens,
  budgetBreakdown,
  mergedTotal,
}
