import os from 'node:os'
import path from 'node:path'
import type { WorkspaceRecord } from '../shared/types'
import { createRpcHandler } from './http'
import { registerAgentPrompts, registerAgentSkills, type AgentLike, type WorkspaceRegistryLike } from './materialize'
import { globalPaths, workspacePaths, type ScopePaths } from './paths'
import { loadSections } from './sections'
import { CsmmService, type WorkspaceBinding } from './service'
import { loadStore } from './store'

export const name = 'dsh-csmm'
export const inject: string[] = ['webServer', 'workspaceRegistry', 'sessions']

export const RPC_ROUTE = '/dsh-csmm/rpc'

interface HostContext {
  get?: (name: string) => unknown
  effect?: (fn: () => () => void) => void
  on?: (event: string, listener: (payload: { agent: AgentLike }) => unknown) => (() => void) | void
}

interface SessionStoreLike {
  get?: (id: string) => { header?: { cwd?: string } } | undefined
}

interface RouteServer {
  register?: (route: { kind: 'exact'; path: string; handler: unknown }) => (() => void) | void
}

interface WorkspaceRegistryApi extends WorkspaceRegistryLike {
  list?: () => Promise<Array<{ id?: string; title?: string; path?: string }>>
}

export function apply(ctx: HostContext): void {
  const webServer = lookup<RouteServer>(ctx, 'webServer')
  if (!webServer?.register) return

  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const workspaceRegistry = lookup<WorkspaceRegistryApi>(ctx, 'workspaceRegistry')
  const sessions = lookup<SessionStoreLike>(ctx, 'sessions')

  const registerAgentListener = (): (() => void) | void => {
    if (typeof ctx.on !== 'function') return undefined
    return ctx.on('agent/created', ({ agent }) => {
      const cwd = sessions?.get?.(String(agent.id))?.header?.cwd
      const options = { home, cwd, workspaceRegistry }
      return Promise.all([
        registerAgentPrompts(agent, options),
        registerAgentSkills(agent, options),
      ]).then((disposers) => () => {
        for (const dispose of disposers) {
          if (typeof dispose === 'function') dispose()
        }
      })
    })
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const dispose = registerAgentListener()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    })
  } else {
    registerAgentListener()
  }

  const handler = createRpcHandler({
    service: (workspaceRoot) => openService(ctx, workspaceRoot),
  })
  const registerRoute = (): (() => void) | void =>
    webServer.register!({ kind: 'exact', path: RPC_ROUTE, handler })

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const dispose = registerRoute()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    })
  } else {
    registerRoute()
  }
}

async function openService(ctx: HostContext, workspaceRoot?: string): Promise<CsmmService> {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const global: ScopePaths = globalPaths(home)
  let workspace: WorkspaceBinding | undefined
  let workspaces: WorkspaceRecord[] | undefined

  const registry = lookup<WorkspaceRegistryApi>(ctx, 'workspaceRegistry')
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

  const trusted = new Set<string>()
  try {
    for (const record of loadStore(global).workspaces) {
      if (record.trusted) trusted.add(record.id)
    }
  } catch {
    // an unreadable global store is reported by the service on first use
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
        trusted: trusted.has(w.id),
        current: w.id === currentId,
      }))
  } else if (currentId && workspaceRoot) {
    workspaces = [
      {
        id: currentId,
        title: path.basename(workspaceRoot) || currentId,
        path: workspaceRoot,
        trusted: trusted.has(currentId),
        current: true,
      },
    ]
  }

  return new CsmmService({ global, workspace, workspaces, sections: loadSections(home) })
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
