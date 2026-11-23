import os from 'node:os'
import path from 'node:path'
import type { WorkspaceRecord } from '../shared/types'
import { createRpcHandler } from './http'
import { PromptMaterializer, type SystemPromptLike } from './materialize'
import { globalPaths, workspacePaths, type ScopePaths } from './paths'
import { CsmmService, type WorkspaceBinding } from './service'

export const name = 'dsh-csmm'
export const inject: string[] = ['webServer', 'systemPrompt']

export const RPC_ROUTE = '/dsh-csmm/rpc'

interface HostContext {
  get?: (name: string) => unknown
  effect?: (fn: () => () => void) => void
}

interface RouteServer {
  register?: (route: { kind: 'exact'; path: string; handler: unknown }) => (() => void) | void
}

interface WorkspaceRegistryLike {
  resolveByPath?: (root: string) => Promise<{ id?: string; title?: string; path?: string } | undefined>
  list?: () => Promise<Array<{ id?: string; title?: string; path?: string }>>
}

export function apply(ctx: HostContext): void {
  const webServer = lookup<RouteServer>(ctx, 'webServer')
  if (!webServer?.register) return

  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const systemPrompt = lookup<SystemPromptLike>(ctx, 'systemPrompt')
  const materializer = systemPrompt ? new PromptMaterializer(systemPrompt, home) : undefined
  if (materializer) {
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => {
        materializer.refresh()
        return () => materializer.disposeNow()
      })
    } else {
      materializer.refresh()
    }
  }

  const handler = createRpcHandler({
    service: (workspaceRoot) => openService(ctx, workspaceRoot),
    onChanged: () => materializer?.refresh(),
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

  const registry = lookup<WorkspaceRegistryLike>(ctx, 'workspaceRegistry')
  let currentId: string | undefined
  if (workspaceRoot) {
    try {
      currentId = (await registry?.resolveByPath?.(workspaceRoot))?.id
    } catch {
      currentId = undefined
    }
    if (currentId) {
      workspace = { id: currentId, paths: workspacePaths(workspaceRoot, currentId) }
    }
  }

  let listed: Array<{ id?: string; title?: string; path?: string }> = []
  try {
    listed = (await registry?.list?.()) ?? []
  } catch {
    listed = []
  }
  if (listed.length) {
    workspaces = listed
      .filter((w): w is { id: string; title?: string; path: string } => Boolean(w.id && w.path))
      .map((w) => ({
        id: w.id,
        title: w.title || path.basename(w.path) || w.id,
        path: w.path,
        trusted: false,
        current: w.id === currentId,
      }))
  } else if (currentId && workspaceRoot) {
    workspaces = [
      {
        id: currentId,
        title: path.basename(workspaceRoot) || currentId,
        path: workspaceRoot,
        trusted: false,
        current: true,
      },
    ]
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
