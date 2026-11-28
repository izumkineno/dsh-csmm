// 唯一的跨层耦合面：模型 / 视图模型 / 视图之间共享的全部类型与接口。
// 任何一层新增对外能力，先在这里定义契约，再到各自实现里落地。

import type {
  DshSkill,
  DshSkillDetail,
  DshSkillDetailResult,
  PromptSectionView,
  SkillCatalogResult,
} from '../shared/types'

export type { DshSkill, DshSkillDetail, DshSkillDetailResult, PromptSectionView, SkillCatalogResult }

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

export const DSH_SOURCE_LABEL: Record<string, string> = {
  'user-dsh': '用户级 DSH',
  'user-agents': '用户级 agents',
  'project-dsh': '项目 .dsh',
  'project-agents': '项目 .agents',
  bundled: 'DSH 内置',
  runtime: '运行时注册',
  custom: '插件注册',
}

export type PageTab = 'prompt' | 'skill' | 'mcp' | 'manage'

export const PAGE_TABS: ReadonlyArray<{ id: PageTab; label: string }> = [
  { id: 'prompt', label: '提示词' },
  { id: 'skill', label: '技能' },
  { id: 'mcp', label: 'MCP' },
  { id: 'manage', label: '配置集与生效' },
]

export const KIND_LABEL: Record<GroupItemKind, string> = {
  section: '提示词段',
  mcp: 'MCP 服务器',
  skill: '技能',
  tool: '工具定义',
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

export type GroupItemKind = 'section' | 'mcp' | 'skill' | 'tool'

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
  kind: 'group'
  id: string | null
}

/** 资源页各自保存一份选中项：切 tab 再回来仍停在原处。 */
export type PromptResourceKind = 'section' | 'context' | 'tool'

export type ResourceRef =
  | { kind: PromptResourceKind; name: string }
  | { kind: 'skill' | 'mcp'; name: string }
  | { kind: 'custom'; id: string }

export type ResourceTab = 'prompt' | 'skill' | 'mcp'

export interface ResourceSelections {
  prompt: ResourceRef | null
  skill: ResourceRef | null
  mcp: ResourceRef | null
}

export type PromptDetailKind = 'section' | 'context' | 'tool'

/** 只读预览的解析结果；文本直接来自宿主装配结果，不再重新请求。 */
export interface PromptDetailView {
  name: string
  kind: PromptDetailKind
  source: string
  tokens: number
  text: string
}

export interface PromptCatalogEntry {
  name: string
  source: string
  tokens: number
}

/** 提示词页的只读目录：段 / 运行上下文 / 工具定义。 */
export interface PromptCatalog {
  sections: PromptCatalogEntry[]
  contexts: PromptCatalogEntry[]
  tools: PromptCatalogEntry[]
}

export type Detail =
  | { kind: 'skill' | 'mcp'; name: string }
  | { kind: 'prompt'; name: string; promptKind: PromptDetailKind }

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

/** 从编辑器直接设为生效时携带的未保存名称。 */
export interface GroupActivationInput {
  name?: string
}

export interface GroupActivateModal {
  type: 'groupActivate'
  groupId: string
  name?: string
}

export type ModalState = SkillAddModal | MigrateModal | ServerFormModal | RawModal | WorkspaceTrustModal | GroupActivateModal

/** 宿主技能注册表的只读目录。 */
export interface SkillCatalogState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  result?: SkillCatalogResult
  error?: string | null
}

/** 按来源（具体 source 优先；通用 source 回退 provider）分组的 DSH 技能。 */
export interface DshSkillGroup {
  key: string
  label: string
  skills: DshSkill[]
}

/** 选中 DSH 技能后按需加载的正文。 */
export interface SkillDocState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  name?: string
  detail?: DshSkillDetail
  error?: string | null
}

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
  selected: ResourceSelections
  /** 从资源页跳转到配置集编辑器后，一次性定位到某个成员。 */
  groupFocus: { kind: GroupItemKind; name: string; nonce: number } | null
  saved: Record<string, string>
  activeGroup: Record<string, string>
  overrides: Overrides
  groups: Group[]
  customs: CustomPrompt[]
  skills: Skill[]
  servers: McpServer[]
  catalog: SkillCatalogState
  dshDoc: SkillDocState
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
  disabledPrompts: string[]
  contextWindow: number
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
  disabledPrompts: string[]
  /** Model context window of the last conversation, when known. */
  contextWindow?: number
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
  /** 读取宿主当前注册并组装出的提示词段/运行上下文（只读）。 */
  listPrompts?(sessionId?: string, presetId?: string): Promise<PromptSectionView[]>
  /** 只读读取 DSH 技能注册表；不导入、不写文件。 */
  listDshSkills?(scope?: Scope): Promise<SkillCatalogResult>
  /** 按需读取一个 DSH 技能的正文；只读。 */
  getDshSkill?(name: string, scope?: Scope): Promise<DshSkillDetailResult>
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
  tool: Set<string>
}

export interface BudgetBreakdown {
  context: number
  section: number
  skill: number
  mcp: number
  tool: number
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
  /** 宿主注册的 DSH 技能；排除已由本插件管理，并遵守插件开关。 */
  visibleDshSkills(state: AppState): DshSkill[]
  /** 在 visibleDshSkills 基础上按搜索词过滤。 */
  filteredDshSkills(state: AppState): DshSkill[]
  groupDshSkills(skills: DshSkill[]): DshSkillGroup[]
  /** 技能页可见的 DSH 技能，按来源分组。 */
  dshSkillGroups(state: AppState): DshSkillGroup[]
  filteredServers(state: AppState): McpServer[]
  /** 按名字读取一条 DSH 技能，不受搜索与插件开关影响。 */
  dshSkill(state: AppState, name: string): DshSkill | undefined
  /** 当前作用域链里可用的技能 / MCP 定义；工作区同名定义覆盖全局。 */
  resolvedSkill(state: AppState, name: string | null | undefined): Skill | undefined
  resolvedServer(state: AppState, name: string | null | undefined): McpServer | undefined
  /** 提示词段 / 运行上下文 / 工具定义的只读全文；宿主未返回时 undefined。 */
  resolvePromptDetail(state: AppState, name: string, kind: PromptDetailKind): PromptDetailView | undefined
  /** 提示词页的只读目录；自有段优先于同名 DSH 注册段。 */
  promptCatalog(state: AppState): PromptCatalog
  /** 当前 tab 对应的资源选中项；分组与生效页为 null。 */
  currentResource(state: AppState): ResourceRef | null
  visibleSkills(state: AppState): Skill[]
  visibleServers(state: AppState): McpServer[]
  isTrustedWorkspace(meta: Meta, wsId: string | null | undefined): boolean
  groupSources(meta: Meta): string[]
  currentGroup(state: AppState): Group | null
  effSkillEnabled(state: AppState, name: string, skipKey?: string): boolean
  effServerEnabled(state: AppState, name: string, skipKey?: string): boolean
  effToolOn(state: AppState, server: string, tool: string, skipKey?: string): boolean
  itemsTokens(items: GroupItem[], state: AppState): number
  budgetBreakdown(state: AppState, groupOverride?: Group | null): BudgetBreakdown
  mergedTotal(state: AppState): number
}

// ---------- 视图模型对视图暴露的命令 ----------
export interface Actions {
  setScope(scope: Scope): void
  setTab(tab: PageTab): void
  setActive(kind: 'group', id: string | null): void
  setEffectiveGroup(id: string, input?: GroupActivationInput): void
  /** 确认空配置集 / 空工具名单的启用。 */
  confirmActivateGroup(id: string): void
  /** 从资源页跳到配置集编辑器，定位到某个成员。 */
  editInGroup(kind: GroupItemKind, name: string): void
  clearGroupFocus(): void
  /** 删除本层映射，回到「继承上层」。 */
  inheritGroup(): void
  /** 显式声明本层不使用任何分组，阻断继承。 */
  setNone(): void
  openDetail(detail: Detail): void
  closeDetail(): void
  selectResource(ref: ResourceRef): void
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
  toggleSkill(name: string): void
  setSkDelConfirm(name: string | null): void
  deleteSkill(name: string): void
  moveSkill(name: string, target: 'global' | 'workspace'): void
  openSkillDir(): void
  addSkillsFromFiles(files: FileList | File[] | null, fromFolder: boolean): void
  /** 读取 DSH 技能注册表；扫描结果在技能页内联显示。 */
  loadDshSkills(): void
  /** 按需读取一个 DSH 技能的正文。 */
  loadDshSkill(name: string): void
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
  toggleDshPrompt(name: string, disabled: boolean): void
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
