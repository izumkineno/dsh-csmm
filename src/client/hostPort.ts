import type { HostPort } from '../UI/contracts'
import type {
  Bootstrap,
  Command,
  ConnectionOutcome,
  PromptSectionView,
  RpcRequest,
  Scope,
  SkillCatalogResult,
  DshSkillDetailResult,
  SkillSourceSaveResult,
  Snapshot,
} from '../shared/types'

const ROUTE = '/dsh-csmm/rpc'

/** A failed host RPC with the host error code and HTTP status preserved. */
export class HostError extends Error {
  readonly code: string
  readonly status: number | undefined

  constructor(code: string, status: number | undefined, message: string) {
    super(message)
    this.name = 'HostError'
    this.code = code
    this.status = status
  }
}

export interface RemoteHost extends HostPort {
  snapshot(scope?: Scope): Promise<Snapshot>
  dispatch(command: Command): Promise<Snapshot>
  revision(): number
  listPrompts(sessionId?: string): Promise<PromptSectionView[]>
  listDshSkills(scope?: Scope): Promise<SkillCatalogResult>
  getDshSkill(name: string, scope?: Scope): Promise<DshSkillDetailResult>
  saveDshSkillSource(name: string, text: string, expectedSha256: string, scope: Scope): Promise<SkillSourceSaveResult>
}

export async function requestRpc(
  body: RpcRequest & { workspaceRoot?: string },
): Promise<{
  snapshot?: Snapshot
  outcome?: ConnectionOutcome
  prompts?: PromptSectionView[]
  catalog?: SkillCatalogResult
  detail?: DshSkillDetailResult
  saved?: SkillSourceSaveResult
}> {
  const response = await fetch(ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw = await response.text()
  let payload: {
    ok?: boolean
    snapshot?: Snapshot
    outcome?: ConnectionOutcome
    prompts?: PromptSectionView[]
    catalog?: SkillCatalogResult
    detail?: DshSkillDetailResult
    saved?: SkillSourceSaveResult
    error?: { code?: string; message?: string }
  } = {}
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    payload = {}
  }
  if (!response.ok || payload.ok === false) {
    if (payload.error?.code) {
      throw new HostError(payload.error.code, response.status, payload.error.message ?? 'RPC failed')
    }
    throw new HostError(
      'E_HTTP',
      response.status,
      payload.error?.message ?? (raw || `RPC failed: ${response.status}`),
    )
  }
  return payload
}

export function createRemoteHost(snapshot: Snapshot, workspaceRoot?: string): RemoteHost {
  let current = snapshot
  let root = workspaceRoot

  const load = async (scope: Scope, nextRoot?: string): Promise<Bootstrap> => {
    if (nextRoot !== undefined) root = nextRoot || undefined
    const result = await requestRpc({ method: 'snapshot', scope, workspaceRoot: root })
    if (!result.snapshot) throw new Error('snapshot missing from response')
    current = result.snapshot
    return result.snapshot.bootstrap
  }

  const send = async (command: Record<string, unknown>, nextRoot?: string): Promise<void> => {
    if (nextRoot !== undefined) root = nextRoot || undefined
    const typed = { ...command, expectedRevision: current.revision } as Command
    const result = await requestRpc({
      method: 'dispatch',
      command: typed,
      scope: commandScope(typed),
      workspaceRoot: root,
    })
    if (!result.snapshot) throw new Error('snapshot missing from response')
    current = result.snapshot
  }

  return {
    bootstrap(): Bootstrap {
      return current.bootstrap
    },
    async snapshot(scope?: Scope) {
      if (!scope) return current
      const result = await requestRpc({ method: 'snapshot', scope, workspaceRoot: root })
      if (!result.snapshot) throw new Error('snapshot missing from response')
      current = result.snapshot
      return result.snapshot
    },
    async dispatch(command: Command) {
      const typed = { ...command, expectedRevision: current.revision } as Command
      const result = await requestRpc({
        method: 'dispatch',
        command: typed,
        scope: commandScope(typed),
        workspaceRoot: root,
      })
      if (!result.snapshot) throw new Error('snapshot missing from response')
      current = result.snapshot
      return result.snapshot
    },
    revision() {
      return current.revision
    },
    load,
    send,
    async testConnection(server) {
      const result = await requestRpc({ method: 'testConnection', server, workspaceRoot: root })
      if (!result.outcome) throw new Error('outcome missing from response')
      return result.outcome
    },
    async listPrompts(sessionId?: string, presetId?: string) {
      const result = await requestRpc({ method: 'promptList', sessionId, presetId, workspaceRoot: root })
      return result.prompts ?? []
    },
    async listDshSkills(scope?: Scope) {
      const result = await requestRpc({ method: 'skillCatalog', scope, workspaceRoot: root })
      if (!result.catalog) throw new Error('catalog missing from response')
      return result.catalog
    },
    async getDshSkill(name: string, scope?: Scope) {
      const result = await requestRpc({ method: 'skillDetail', skillName: name, scope, workspaceRoot: root })
      if (!result.detail) throw new Error('detail missing from response')
      return result.detail
    },
    async saveDshSkillSource(name: string, text: string, expectedSha256: string, scope: Scope) {
      if (!scope || scope.kind !== 'workspace' || !scope.id) {
        throw new HostError('E_PAYLOAD', undefined, '工作区技能源保存必须带 scope.id')
      }
      const result = await requestRpc({
        method: 'skillSourceSave',
        skillName: name,
        scope,
        workspaceRoot: root,
        text,
        expectedSha256,
      })
      if (!result.saved) throw new HostError('E_PROTOCOL', undefined, 'saved missing from response')
      return result.saved
    },
  }
}

function commandScope(command: Command) {
  if (command.type === 'skill.copy') return command.to
  return 'scope' in command ? command.scope : undefined
}
