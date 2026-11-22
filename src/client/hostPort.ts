import type { HostPort } from '../UI/contracts'
import type {
  Bootstrap,
  Command,
  ConnectionOutcome,
  RpcRequest,
  Snapshot,
} from '../shared/types'

const ROUTE = '/dsh-csmm/rpc'

export interface RemoteHost extends HostPort {
  snapshot(scope?: { kind: 'global' | 'workspace'; id?: string | null }): Promise<Snapshot>
  dispatch(command: Command): Promise<Snapshot>
}

export async function requestRpc(
  body: RpcRequest & { workspaceRoot?: string },
): Promise<{ snapshot?: Snapshot; outcome?: ConnectionOutcome }> {
  const response = await fetch(ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as {
    ok?: boolean
    snapshot?: Snapshot
    outcome?: ConnectionOutcome
    error?: { code?: string; message?: string }
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error?.message ?? `RPC failed: ${response.status}`)
  }
  return payload
}

export function createRemoteHost(snapshot: Snapshot, workspaceRoot?: string): RemoteHost {
  let current = snapshot
  return {
    bootstrap(): Bootstrap {
      return current.bootstrap
    },
    async snapshot(scope) {
      const result = await requestRpc({ method: 'snapshot', scope, workspaceRoot })
      if (!result.snapshot) throw new Error('snapshot missing from response')
      current = result.snapshot
      return result.snapshot
    },
    async dispatch(command) {
      const result = await requestRpc({ method: 'dispatch', command, scope: commandScope(command), workspaceRoot })
      if (!result.snapshot) throw new Error('snapshot missing from response')
      current = result.snapshot
      return result.snapshot
    },
    async testConnection(server) {
      const result = await requestRpc({ method: 'testConnection', server, workspaceRoot })
      if (!result.outcome) throw new Error('outcome missing from response')
      return result.outcome
    },
  }
}

function commandScope(command: Command) {
  if (command.type === 'skill.copy') return command.to
  return 'scope' in command ? command.scope : undefined
}
