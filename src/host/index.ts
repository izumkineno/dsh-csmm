import os from 'node:os'
import path from 'node:path'
import type { WorkspaceRecord } from '../shared/types'
import { createRpcHandler } from './http'
import { globalPaths, workspacePaths, type ScopePaths } from './paths'
import { CsmmService, type WorkspaceBinding } from './service'

export const name = 'dsh-csmm'
export const inject: string[] = ['webServer']

export const RPC_ROUTE = '/dsh-csmm/rpc'

interface HostContext {
  get?: (name: string) => unknown
  effect?: (fn: () => () => void) => void
}

interface RouteServer {
  register?: (route: { kind: 'exact'; path: string; handler: unknown }) => (() => void) | void
}

interface WorkspaceRegistryLike {
  resolveByPath?: (root: string) => Promise<{ id?: string; title?: string } | undefined>
}

export function apply(ctx: HostContext): void {
  const webServer = lookup<RouteServer>(ctx, 'webServer')
  if (!webServer?.register) return

  const handler = createRpcHandler({
    service: (workspaceRoot) => openService(ctx, workspaceRoot),
  })
  const register = (): (() => void) | void =>
    webServer.register!({ kind: 'exact', path: RPC_ROUTE, handler })

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const dispose = register()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    })
  } else {
    register()
  }
}

async function openService(ctx: HostContext, workspaceRoot?: string): Promise<CsmmService> {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const global: ScopePaths = globalPaths(home)
  let workspace: WorkspaceBinding | undefined
  let workspaces: WorkspaceRecord[] | undefined

  if (workspaceRoot) {
    const registry = lookup<WorkspaceRegistryLike>(ctx, 'workspaceRegistry')
    let id: string | undefined
    try {
      const resolved = await registry?.resolveByPath?.(workspaceRoot)
      id = resolved?.id
    } catch {
      id = undefined
    }
    if (id) {
      workspace = { id, paths: workspacePaths(workspaceRoot, id) }
      workspaces = [
        {
          id,
          title: path.basename(workspaceRoot) || id,
          path: workspaceRoot,
          trusted: false,
        },
      ]
    }
  }

  return new CsmmService({ global, workspace, workspaces, sections: [] })
}

function lookup<T>(ctx: HostContext, name: string): T | undefined {
  if (typeof ctx.get === 'function') {
    try {
      return ctx.get(name) as T | undefined
    } catch {
      return undefined
    }
  }
  return undefined
}
