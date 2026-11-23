// 唯一的跨层耦合面：模型 / 视图模型 / 视图之间共享的全部类型与接口。
// 任何一层新增对外能力，先在这里定义契约，再到各自实现里落地。

import type { PromptSectionView } from '../shared/types'

export type { PromptSectionView }

// ---------- 作用域与标签 ----------
export type ScopeKind = 'global' | 'workspace'

export interface Scope {
  kind: ScopeKind
  id?: string | null
}

export const SCOPE_LABEL: Record<ScopeKind, string> = {
  global: '全局',
  workspace: '工作区',
}

export type PageTab = 'prompt' | 'skill' | 'mcp'

export const PAGE_TABS: ReadonlyArray<{ id: PageTab; label: string }> = [
  { id: 'prompt', label: '提示词' },
  { id: 'skill', label: '技能' },
  { id: 'mcp', label: 'MCP' },
]

export const KIND_LABEL: Record<GroupItemKind, string> = {
  section: '提示词段',
  mcp: 'MCP 服务器',
  skill: '技能',
}

// ---------- 领域模型 ----------
export interface Workspace {
  id: string
  title: string
  path: string
  /** 陌生工作区在用户确认前处于受限状态；与 VS Code 的工作区信任提示对应。 */
  trusted: boolean
  /** 是否对应当前打开的工作区（用于左栏定位）。 */
  current?: boolean
}

export type SectionKind = 'section' | 'mcp-section' | 'context'

export interface Section {
  name: string
  source: string
  tokens: number
  kind: SectionKind
  text: string
  server?: string
}

export interface Skill {
  name: string
  label: string
  scope: 'global' | 'workspace'
  wsId?: string
  bytes: number
  model: boolean
  user: boolean
  desc: string
  text: string
  enabled?: boolean
  bundled?: boolean
}

export interface Tool {
  name: string
  on: boolean
}

export type Transport = 'stdio' | 'http'
export type AuthMode = 'none' | 'bearer' | 'oauth'
export type ServerStatus = 'connected' | 'disconnected' | 'error'

export interface ReconnectOptions {
  enabled: boolean
  initialDelayMs: number
  maxDelayMs: number
  maxAttempts: number
}

export interface McpServer {
  name: string
  label: string
  /** MCP 服务器按作用域定义：工作区同名定义覆盖全局定义。 */
  scope: 'global' | 'workspace'
  wsId?: string
  status: ServerStatus
  transport: Transport
  tokens: number
  auth: AuthMode
  oauth?: boolean
  enabled?: boolean
  tools: Tool[]
  instructions: string
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  env?: Record<string, string>
  envKeys?: string[]
  headers?: Record<string, string>
  headerKeys?: string[]
  toolCallTimeoutMs?: number
  failOnStartupError?: boolean
  reconnect?: ReconnectOptions
  toolQ?: string
  filterDirty?: boolean
  testMsg?: string
  testing?: boolean
}

/** 添加 / 编辑 MCP 服务器窗口提交给视图模型的结构化表单。 */
export interface ServerFormInput {
  serverName: string
  transport: Transport
  command?: string
  args: string[]
  cwd?: string
  url?: string
  env: Record<string, string | null>
  headers: Record<string, string | null>
  authMode: AuthMode
  toolCallTimeoutMs: number
  failOnStartupError: boolean
  reconnect: ReconnectOptions
}

export type GroupItemKind = 'section' | 'mcp' | 'skill'

export interface GroupItem {
  kind: GroupItemKind
  name: string
}

export interface Group {
  id: string
  name: string
  scope: Scope
  enabled: boolean
  items: GroupItem[]
}

export interface CustomPrompt {
  id: string
  title: string
  scope: Scope
  text: string
  /** 默认启用；false 时不进入生效内容与预算。 */
  enabled?: boolean
}

export interface Meta {
  workspaces: Workspace[]
  sections: Section[]
}

// ---------- 视图状态 ----------
export interface Active {
  kind: 'group' | 'custom'
  id: string | null
}

export interface Detail {
  kind: 'skill' | 'mcp'
  name: string
}

export interface Selection {
  skill: string | null
  mcp: string | null
}

export interface CustomDraft {
  name: string
  text: string
}

export interface ToolOverride {
  [tool: string]: boolean
}

export interface Overrides {
  skill: Record<string, Record<string, boolean>>
  mcp: Record<string, Record<string, boolean>>
  tool: Record<string, Record<string, ToolOverride>>
}

export interface ToastItem {
  id: number
  msg: string
  undoLabel?: string
  undo?: () => void
}

export interface SkillAddModal {
  type: 'skillAdd'
}

export interface MigrateModal {
  type: 'migrate'
  target: string
  checked: string[]
}

export interface ServerFormModal {
  type: 'serverForm'
  /** 正在编辑的服务器名；空串 = 新建。 */
  editing: string
  error?: string | null
}

export interface RawModal {
  type: 'raw'
  serverName: string
  text: string
}

/** 打开陌生工作区时的一次性信任提示。 */
export interface WorkspaceTrustModal {
  type: 'workspaceTrust'
  wsId: string
}

export type ModalState = SkillAddModal | MigrateModal | ServerFormModal | RawModal | WorkspaceTrustModal

export type ModalPatch = Partial<
  Omit<MigrateModal, 'type'> & Omit<ServerFormModal, 'type'> & Omit<RawModal, 'type'>
>

export interface CopyStrings {
  skillDir: string
  refreshServers: string
  newSkillText: string
  newSkillDesc: string
  oauthOn: string
  oauthOff: string
  serverSaved: string
  rawSaved: string
  formTesting: string
  restart: string
  configEdit: string
  toolSaved: string
  appTag: string
  scopeHint: string
}

export interface AppState {
  scope: Scope
  active: Active
  detail: Detail | null
  tab: PageTab
  sel: Selection
  saved: Record<string, string>
  activeGroup: Record<string, string>
  overrides: Overrides
  groups: Group[]
  customs: CustomPrompt[]
  skills: Skill[]
  servers: McpServer[]
  skillSel: string[]
  q: { skill?: string; mcp?: string }
  showPlugin: boolean
  skDelConfirm: string | null
  mcpDelConfirm: string | null
  drafts: Record<string, GroupItem[] | CustomDraft>
  /** 用户选择「暂不信任」的工作区；本次会话不再重复弹窗。 */
  trustDeclined: string[]
  modal: ModalState | null
  toasts: ToastItem[]
  /** DSH 宿主实际组装出的提示词段（只读，来自 systemPrompt.assemble）。 */
  dshPrompts: PromptSectionView[]
  dshPromptsState: 'idle' | 'loading' | 'ready' | 'error'
  dshPromptsError: string | null
  meta: Meta
  copy: CopyStrings
}

// ---------- 数据来源（Mock / 真实宿主）----------
export interface Bootstrap {
  workspaces: Workspace[]
  sections: Section[]
  skills: Skill[]
  servers: McpServer[]
  groups: Group[]
  customs: CustomPrompt[]
  activeGroup: Record<string, string>
  copy: CopyStrings
}

export interface ConnectionOutcome {
  status: ServerStatus
  tools: Tool[]
  message: string
  toast: string
}

/** 视图模型只依赖此端口；真实宿主或测试替身都实现它。 */
export interface HostPort {
  bootstrap(): Bootstrap
  testConnection(server: McpServer): Promise<ConnectionOutcome>
  /** 读取指定作用域的读模型；工作区需要提供落盘根目录。 */
  load?(scope: Scope, workspaceRoot?: string): Promise<Bootstrap>
  /** 提交一条写命令；完成后视图模型会重新拉取读模型。 */
  send?(command: Record<string, unknown>, workspaceRoot?: string): Promise<void>
  /** 读取宿主当前注册并组装出的提示词段（只读）。 */
  listPrompts?(): Promise<PromptSectionView[]>
}

// ---------- 派生数据 ----------
export interface WinningLayer {
  sc: Scope
  group: Group | null
  customs: CustomPrompt[]
  inherited: boolean
  depth: number
}

export interface CoveredLayers {
  winner: WinningLayer
  covered: Array<{ sc: Scope; group: Group }>
}

export interface EffectiveItems {
  section: Set<string>
  mcp: Set<string>
  skill: Set<string>
}

export interface BudgetBreakdown {
  context: number
  section: number
  skill: number
  mcp: number
  custom: number
  total: number
  counts: Record<GroupItemKind, number>
}

export interface Selectors {
  scopeKey(scope: Scope): string
  sameScope(a: Scope, b: Scope): boolean
  draftId(group: Group): string
  formatKB(bytes: number): number
  tokenEstimate(text: string): number
  currentWsId(scope: Scope, meta: Meta): string | null
  skillVisible(skill: Skill, scope: Scope, meta: Meta): boolean
  isRestricted(state: AppState): boolean
  chainFor(scope: Scope, meta: Meta): Scope[]
  groupsOf(groups: Group[], scope: Scope, meta: Meta): Group[]
  customsOf(customs: CustomPrompt[], scope: Scope, meta: Meta): CustomPrompt[]
  hasItem(list: GroupItem[], kind: GroupItemKind, name: string): boolean
  scopeTitle(scope: Scope | null | undefined, meta: Meta): string
  scopeCrumb(scope: Scope, meta: Meta): string
  groupCounts(group: Group): Record<GroupItemKind, number>
  groupTokens(group: Pick<Group, 'items'>, state: AppState): number
  winningLayer(state: AppState): WinningLayer
  coveredLayers(state: AppState): CoveredLayers
  effectiveItems(state: AppState): EffectiveItems | null
  denyCountFor(state: AppState): number
  shadowCountFor(state: AppState): number
  filteredSkills(state: AppState): Skill[]
  filteredServers(state: AppState): McpServer[]
  /** 当前作用域链里可用的技能 / MCP 定义；工作区同名定义覆盖全局。 */
  resolvedSkill(state: AppState, name: string | null | undefined): Skill | undefined
  resolvedServer(state: AppState, name: string | null | undefined): McpServer | undefined
  visibleSkills(state: AppState): Skill[]
  visibleServers(state: AppState): McpServer[]
  isTrustedWorkspace(meta: Meta, wsId: string | null | undefined): boolean
  groupSources(meta: Meta): string[]
  currentGroup(state: AppState): Group | null
  effSkillEnabled(state: AppState, name: string, skipKey?: string): boolean
  effServerEnabled(state: AppState, name: string, skipKey?: string): boolean
  effToolOn(state: AppState, server: string, tool: string, skipKey?: string): boolean
  itemsTokens(items: GroupItem[], state: AppState): number
  budgetBreakdown(state: AppState): BudgetBreakdown
  mergedTotal(state: AppState): number
}

// ---------- 视图模型对视图暴露的命令 ----------
export interface Actions {
  setScope(scope: Scope): void
  setTab(tab: PageTab): void
  setActive(kind: 'group' | 'custom', id: string | null): void
  setEffectiveGroup(id: string): void
  /** 删除本层映射，回到「继承上层」。 */
  inheritGroup(): void
  /** 显式声明本层不使用任何分组，阻断继承。 */
  setNone(): void
  openDetail(detail: Detail): void
  closeDetail(): void
  selectSkill(name: string): void
  selectMcp(name: string): void
  newGroup(): void
  newCustom(): void
  setQuery(field: 'skill' | 'mcp', value: string): void
  setToolQuery(name: string, value: string): void
  toggleSkillCheck(name: string): void
  setSkillSel(names: string[]): void
  setShowPlugin(value: boolean): void
  ensureDraft(group: Group): void
  toggleDraftCheck(group: Group, kind: GroupItemKind, name: string): void
  addDraftItem(group: Group, kind: GroupItemKind, name: string): void
  saveGroup(group: Group, name: string): void
  revertGroup(group: Group): void
  setCustomDraft(id: string, name: string, text: string): void
  saveCustom(custom: CustomPrompt, name: string, text: string): void
  revertCustom(custom: CustomPrompt): void
  toggleCustom(id: string): void
  deleteItem(item: Group | CustomPrompt, kind: 'group' | 'custom'): void
  setGroupItem(kind: GroupItemKind, name: string): void
  addSkillsToGroup(names: string[]): void
  toggleSkill(name: string): void
  setSkDelConfirm(name: string | null): void
  deleteSkill(name: string): void
  moveSkill(name: string, target: 'global' | 'workspace'): void
  openSkillDir(): void
  addSkillsFromFiles(files: FileList | File[] | null, fromFolder: boolean): void
  refreshServers(): void
  toggleTool(serverName: string, toolName: string, on: boolean): void
  setAllTools(serverName: string, on: boolean, names: string[]): void
  saveToolList(serverName: string): void
  testConnection(name: string): void
  toggleMcp(name: string): void
  oauthToggle(name: string): void
  deleteMcp(name: string): void
  setMcpDelConfirm(name: string | null): void
  restartConnection(): void
  openModal(modal: ModalState): void
  closeModal(): void
  updateModal(patch: ModalPatch): void
  openSkillAdd(): void
  openMigrate(preselect: string[]): void
  runMigrate(): void
  openServerForm(server: McpServer | null, isNew: boolean): void
  saveServer(input: ServerFormInput, editing: string): void
  openRaw(server: McpServer): void
  rawSave(): void
  /** 读取 DSH 宿主实际注册并组装的提示词段（只读）。 */
  loadDshPrompts(): void
  trustWorkspace(wsId: string): void
  declineTrust(wsId: string): void
  removeToast(id: number): void
  runToastUndo(toast: ToastItem): void
  toast(message: string): void
}

export interface AppViewModel {
  state: AppState
  actions: Actions
  selectors: Selectors
}
