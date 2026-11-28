/**
 * Host-side domain types for dsh-csmm.
 *
 * These mirror the fixed UI contract in `src/UI/contracts.ts`. The host may not
 * import React/UI code, so the shared fields are declared here; keep them in sync.
 */

export type ScopeKind = 'global' | 'workspace'

export interface Scope {
  kind: ScopeKind
  id?: string | null
}

export interface WorkspaceRecord {
  id: string
  title: string
  path: string
  trusted: boolean
  current?: boolean
}

export type SectionKind = 'section' | 'mcp-section' | 'context'

export interface SectionRecord {
  name: string
  source: string
  tokens: number
  kind: SectionKind
  text: string
  server?: string
}

export interface SkillRecord {
  name: string
  label: string
  scope: 'global' | 'workspace'
  wsId?: string
  bytes: number
  model: boolean
  user: boolean
  desc: string
  /** 何时使用该技能的提示；供 materialize 透传给 DSH 注册表。 */
  whenToUse?: string
  text: string
  enabled?: boolean
  bundled?: boolean
}

/** One skill registered in the DSH skill registry. */
export interface DshSkill {
  name: string
  description: string
  whenToUse?: string
  source: string
  provider: string
  path?: string
  /** Whether the model may invoke the skill. */
  model: boolean
  /** Whether the user may invoke the skill. */
  user: boolean
  /** Global registry layer, or a project layer of the requested workspace. */
  origin: 'global' | 'workspace'
}

/** One DSH skill with its instruction body loaded on demand. */
export interface DshSkillDetail extends DshSkill {
  /** Markdown body after frontmatter removal, as supplied by the registry. */
  content: string
  /** 文件原文；散装注册或不可读文件时为 undefined。 */
  raw?: string
  /** 源文件字节的 SHA-256 十六进制；没有 raw 时为 undefined。 */
  sha256?: string
}

/** 工作区源技能的原文件保存请求。 */
export interface SkillSourceSaveInput {
  skillName: string
  scope: Scope
  /** 用户编辑后的完整 SKILL.md 原文（含 frontmatter）。 */
  text: string
  /** 读取时拿到的源文件 SHA-256；用于检测并发修改。 */
  expectedSha256: string
}

export interface SkillSourceSaveResult {
  path: string
  sha256: string
}

export interface DshSkillDetailResult {
  skill?: DshSkillDetail
  errors: string[]
  /** The requested workspace is untrusted, so only the global layer was read. */
  restricted?: boolean
}

/** Read-only view of the skills DSH itself has registered for a scope. */
export interface SkillCatalogResult {
  scannedAt: string
  skills: DshSkill[]
  errors: string[]
  /** The requested workspace is untrusted, so only the global layer was read. */
  restricted?: boolean
}

export interface ConnectionOutcome {
  status: ServerStatus
  tools: ToolRecord[]
  message: string
  toast: string
}

export interface ToolRecord {
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

export interface McpServerRecord {
  name: string
  label: string
  scope: 'global' | 'workspace'
  wsId?: string
  status: ServerStatus
  transport: Transport
  tokens: number
  auth: AuthMode
  oauth?: boolean
  enabled?: boolean
  tools: ToolRecord[]
  instructions: string
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  envKeys?: string[]
  headerKeys?: string[]
  toolCallTimeoutMs?: number
  failOnStartupError?: boolean
  reconnect?: ReconnectOptions
}

export type GroupItemKind = 'section' | 'mcp' | 'skill' | 'tool'

export interface GroupItemRecord {
  kind: GroupItemKind
  name: string
}

export interface GroupRecord {
  id: string
  name: string
  scope: Scope
  enabled: boolean
  items: GroupItemRecord[]
}

export interface CustomPromptRecord {
  id: string
  title: string
  scope: Scope
  text: string
  enabled?: boolean
}

export interface StoredWorkspace {
  id: string
  trusted: boolean
}

export interface StoreDocument {
  schemaVersion: 1
  revision: number
  workspaces: StoredWorkspace[]
  activeGroup: Record<string, string>
  groups: GroupRecord[]
  customs: CustomPromptRecord[]
  skills: SkillRecord[]
  servers: McpServerRecord[]
  disabledPrompts?: string[]
}

export interface ServerSecrets {
  env: Record<string, string>
  headers: Record<string, string>
}

export interface SecretsDocument {
  schemaVersion: 1
  servers: Record<string, ServerSecrets>
}

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

export interface Bootstrap {
  workspaces: WorkspaceRecord[]
  sections: SectionRecord[]
  skills: SkillRecord[]
  servers: McpServerRecord[]
  groups: GroupRecord[]
  customs: CustomPromptRecord[]
  activeGroup: Record<string, string>
  disabledPrompts: string[]
  /** Model context window of the last conversation, when known. */
  contextWindow?: number
  copy: CopyStrings
}

export type DiagnosticCode =
  | 'E_SCHEMA'
  | 'E_PARSE'
  | 'E_DUP'
  | 'E_KIND'
  | 'E_PAYLOAD'
  | 'E_LOCKED'
  | 'E_APPLY'
  | 'E_PROFILE'
  | 'W_TRUST'
  | 'W_TOOL'

export interface Diagnostic {
  code: DiagnosticCode
  severity: 'error' | 'warning' | 'info'
  message: string
  scope?: Scope
  entity?: string
}

export interface Snapshot {
  revision: number
  bootstrap: Bootstrap
  diagnostics: Diagnostic[]
}

export interface ServerSecretsPatch {
  env?: Record<string, string | null>
  headers?: Record<string, string | null>
}

interface WriteBase {
  expectedRevision: number
}

export type Command =
  | (WriteBase & { type: 'group.save'; scope: Scope; group: GroupRecord; name: string })
  | (WriteBase & { type: 'group.activate'; scope: Scope; group: GroupRecord; name: string })
  | (WriteBase & { type: 'group.effective'; scope: Scope; groupId: string })
  | (WriteBase & { type: 'group.inherit'; scope: Scope })
  | (WriteBase & { type: 'group.none'; scope: Scope })
  | (WriteBase & { type: 'group.delete'; scope: Scope; id: string })
  | (WriteBase & { type: 'custom.save'; scope: Scope; custom: CustomPromptRecord })
  | (WriteBase & { type: 'custom.toggle'; scope: Scope; id: string })
  | (WriteBase & { type: 'custom.delete'; scope: Scope; id: string })
  | (WriteBase & { type: 'skill.save'; scope: Scope; skill: SkillRecord })
  | (WriteBase & { type: 'skill.toggle'; scope: Scope; name: string })
  | (WriteBase & { type: 'skill.delete'; scope: Scope; name: string })
  | (WriteBase & { type: 'skill.copy'; from: Scope; to: Scope; names: string[] })
  | (WriteBase & { type: 'mcp.save'; scope: Scope; server: McpServerRecord; secrets?: ServerSecretsPatch })
  | (WriteBase & { type: 'mcp.toggle'; scope: Scope; name: string })
  | (WriteBase & { type: 'mcp.delete'; scope: Scope; name: string })
  | (WriteBase & { type: 'mcp.tools'; scope: Scope; name: string; tools: ToolRecord[] })
  | (WriteBase & { type: 'prompt.toggle'; scope: Scope; name: string; disabled: boolean })
  | { type: 'trust.set'; workspaceId: string; trusted: boolean; expectedRevision?: number }

/** One prompt section/context returned by the host's live `systemPrompt.assemble()` read. */
export interface PromptSectionView {
  name: string
  text: string
  tokens: number
  kind: 'section' | 'context' | 'tool'
}

export interface RpcRequest {
  method:
    | 'snapshot'
    | 'dispatch'
    | 'testConnection'
    | 'promptList'
    | 'skillCatalog'
    | 'skillDetail'
    | 'skillSourceSave'
  scope?: Scope
  command?: Command
  server?: McpServerRecord
  /** Skill name for skillDetail / skillSourceSave. */
  skillName?: string
  /** Full SKILL.md text for skillSourceSave. */
  text?: string
  /** Source file SHA-256 observed before editing. */
  expectedSha256?: string
  /** Known absolute source path for skillSourceSave. */
  path?: string
  sessionId?: string
  presetId?: string
}

export interface RpcError {
  code: string
  message: string
  details?: unknown
}
