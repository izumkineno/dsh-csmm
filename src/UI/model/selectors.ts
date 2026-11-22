// 纯派生数据层：只读 state，不产生副作用，也不接触任何 Mock 内容。
import type {
  AppState,
  CoveredLayers,
  CustomPrompt,
  EffectiveItems,
  Group,
  GroupItem,
  GroupItemKind,
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

export function skillVisible(skill: Skill, scope: Scope, meta: Meta): boolean {
  if (skill.scope === 'global') return true
  const ws = currentWsId(scope, meta)
  return !!ws && skill.wsId === ws
}

export function chainFor(scope: Scope, _meta: Meta): Scope[] {
  const out: Scope[] = [{ kind: 'global' }]
  if (scope.kind === 'workspace') out.push(scope)
  return out
}

export const groupsOf = (groups: Group[], scope: Scope): Group[] =>
  groups.filter((g) => sameScope(g.scope, scope))
export const customsOf = (customs: CustomPrompt[], scope: Scope): CustomPrompt[] =>
  customs.filter((c) => sameScope(c.scope, scope))
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
  const server = state.servers.find((x) => x.name === name)
  return server ? server.tokens : 0
}

export const groupTokens = (group: Pick<Group, 'items'>, state: AppState): number => {
  let total = 0
  for (const item of group.items) {
    if (item.kind === 'section') total += sectionTokens(state, item.name)
    if (item.kind === 'mcp') total += serverTokens(state, item.name)
  }
  return total
}

// 最近含有效分组的层通吃：组内容 + 本层自定义；缺席 = 向上继承，null = 显式不用。
export const winningLayer = (state: AppState): WinningLayer => {
  const chain = chainFor(state.scope, state.meta)
  for (let i = chain.length - 1; i >= 0; i--) {
    const sc = chain[i]
    const key = scopeKey(sc)
    if (!(key in state.activeGroup)) continue
    const groupId = state.activeGroup[key]
    const group = groupId ? state.groups.find((x) => x.id === groupId) ?? null : null
    if (group && group.items.length) {
      return {
        sc,
        group,
        customs: customsOf(state.customs, sc),
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
    if (group && group.items.length) covered.push({ sc: chain[i], group })
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

export const effSkillEnabled = (state: AppState, name: string, skipKey?: string): boolean => {
  const value = walkLayers(state, skipKey, (key) => state.overrides.skill[key]?.[name])
  if (value !== undefined) return value
  const skill = state.skills.find((s) => s.name === name)
  return skill ? skill.enabled !== false : true
}

export const effServerEnabled = (state: AppState, name: string, skipKey?: string): boolean => {
  const value = walkLayers(state, skipKey, (key) => state.overrides.mcp[key]?.[name])
  if (value !== undefined) return value
  const server = state.servers.find((s) => s.name === name)
  return server ? server.enabled !== false : true
}

export const effToolOn = (state: AppState, server: string, tool: string, skipKey?: string): boolean => {
  const value = walkLayers(state, skipKey, (key) => state.overrides.tool[key]?.[server]?.[tool])
  if (value !== undefined) return value
  const target = state.servers.find((s) => s.name === server)
  const entry = target?.tools.find((t) => t.name === tool)
  return entry ? entry.on !== false : true
}

const walkLayers = (
  state: AppState,
  skipKey: string | undefined,
  read: (key: string) => boolean | undefined,
): boolean | undefined => {
  const chain = chainFor(state.scope, state.meta)
  for (let i = chain.length - 1; i >= 0; i--) {
    const key = scopeKey(chain[i])
    if (key === skipKey) continue
    const value = read(key)
    if (value !== undefined) return value
  }
  return undefined
}

export const denyCountFor = (state: AppState): number => {
  const used = effectiveItems(state)
  let count = 0
  for (const server of state.servers) {
    const allowed = used ? used.mcp.has(server.name) : true
    for (const tool of server.tools) {
      const on = effToolOn(state, server.name, tool.name)
      if (!on) count++
      else if (!allowed) count++
    }
  }
  return count
}

export const shadowCountFor = (state: AppState): number => {
  const used = effectiveItems(state)
  if (!used) return 0
  return state.skills.filter((s) => skillVisible(s, state.scope, state.meta) && !used.skill.has(s.name)).length
}

export const filteredSkills = (state: AppState): Skill[] => {
  const base = state.skills.filter(
    (s) => (state.showPlugin !== false || !s.bundled) && skillVisible(s, state.scope, state.meta),
  )
  const query = (state.q.skill || '').trim().toLowerCase()
  if (!query) return base
  return base.filter((s) => (s.name + ' ' + s.label + ' ' + s.desc).toLowerCase().indexOf(query) >= 0)
}

export const filteredServers = (state: AppState): AppState['servers'] => {
  const query = (state.q.mcp || '').trim().toLowerCase()
  if (!query) return state.servers
  return state.servers.filter(
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
  }
  return total
}

export const mergedTotal = (state: AppState): number => {
  const winner = winningLayer(state)
  let total = winner.group ? itemsTokens(winner.group.items, state) : 0
  for (const custom of winner.customs) total += tokenEstimate(custom.text)
  return total
}

export const selectors: Selectors = {
  scopeKey,
  sameScope,
  draftId,
  formatKB,
  tokenEstimate,
  currentWsId,
  skillVisible,
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
  groupSources,
  currentGroup,
  effSkillEnabled,
  effServerEnabled,
  effToolOn,
  itemsTokens,
  mergedTotal,
}
