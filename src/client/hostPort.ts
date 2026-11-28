import type { HostPort } from '../UI/contracts'
import type {
  Bootstrap,
  Command,
  ConnectionOutcome,
  PromptSectionView,
  RpcRequest,
  Scope,
  SkillCatalogResult,
  Snapshot,
} from '../shared/types'

const ROUTE = '/dsh-csmm/rpc'

export interface RemoteHost extends HostPort {
  snapshot(scope?: Scope): Promise<Snapshot>
  dispatch(command: Command): Promise<Snapshot>
  revision(): number
  listPrompts(sessionId?: string): Promise<PromptSectionView[]>
  listDshSkills(scope?: Scope): Promise<SkillCatalogResult>
}

export async function requestRpc(
  body: RpcRequest & { workspaceRoot?: string },
): Promise<{
  snapshot?: Snapshot
  outcome?: ConnectionOutcome
  prompts?: PromptSectionView[]
  catalog?: SkillCatalogResult
}> {
  const response = await fetch(ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as {
    ok?: boolean
    snapshot?: Snapshot
    outcome?: ConnectionOutcome
    prompts?: PromptSectionView[]
    catalog?: SkillCatalogResult
    error?: { code?: string; message?: string }
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error?.message ?? `RPC failed: ${response.status}`)
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
  }
}

function commandScope(command: Command) {
  if (command.type === 'skill.copy') return command.to
  return 'scope' in command ? command.scope : undefined
}
