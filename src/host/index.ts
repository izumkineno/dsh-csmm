import os from 'node:os'
import path from 'node:path'
import type { WorkspaceRecord } from '../shared/types'
import { createRpcHandler } from './http'
import { registerAgentPromptFilter, registerAgentPrompts, registerAgentSkills, type AgentLike, type WorkspaceRegistryLike } from './materialize'
import { globalPaths, workspacePaths, type ScopePaths } from './paths'
import { loadSections } from './sections'
import { CsmmService, type WorkspaceBinding } from './service'
import { loadStore } from './store'
import { listRegisteredPrompts, type SystemPromptAssembler } from './prompts'

export const name = 'dsh-csmm'
export const inject: string[] = ['webServer', 'workspaceRegistry', 'sessions', 'systemPrompt']

export const RPC_ROUTE = '/dsh-csmm/rpc'

interface HostContext {
  get?: (name: string) => unknown
  effect?: (fn: () => () => void) => void
  on?: (event: string, listener: (payload: { agent: AgentLike }) => unknown) => (() => void) | void
}

interface SessionStoreLike {
  get?: (id: string) => { header?: { cwd?: string } } | undefined
}

interface AgentRowLike {
  id?: string
  session?: { id?: string }
  model?: { current?: () => unknown }
}

interface AgentsApi {
  list?: () => AgentRowLike[]
}

interface AgentPresetsApi {
  remoteExportList?: () => Promise<{ presets: Array<{ id: string; isDefault?: boolean }> }>
  acquireScope?: (id: string) => Promise<{ key: unknown; [Symbol.asyncDispose]?: () => Promise<void> }>
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
      void (async () => {
        try {
          const cwd = sessions?.get?.(String(agent.id))?.header?.cwd
          const options = { home, cwd, workspaceRegistry }
          const disposers = await Promise.all([
            registerAgentPrompts(agent, options).catch(() => undefined),
            registerAgentSkills(agent, options).catch(() => undefined),
            registerAgentPromptFilter(agent, options).catch(() => undefined),
          ])
          return () => {
            for (const dispose of disposers) {
              if (typeof dispose === 'function') dispose()
            }
          }
        } catch (error) {
          process.stderr.write(`[csmm] agent/created failed: ${String(error)}\n`)
          return undefined
        }
      })()
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
    promptList: async (sessionId, presetId) => {
      const systemPrompt = lookup<SystemPromptAssembler>(ctx, 'systemPrompt')
      if (!systemPrompt) return []
      const agents = lookup<AgentsApi>(ctx, 'agents')
      let agent: AgentRowLike | undefined
      try {
        const rows = agents?.list?.() ?? []
        agent = sessionId
          ? rows.find((row) => row.id === sessionId || row.session?.id === sessionId)
          : undefined
      } catch {
        agent = undefined
      }
      if (agent) {
        const context: Record<string, unknown> = {
          agent,
          scope: agent,
          modelSelection: agent.model?.current?.(),
        }
        return listRegisteredPrompts(systemPrompt, context)
      }
      // No live agent: assemble the default preset scope, which is what a new
      // session would receive (tool instruction sections live there).
      const presets = lookup<AgentPresetsApi>(ctx, 'agentPresets')
      const scope = await (async () => {
        try {
          const listed = await presets?.remoteExportList?.()
          const id =
            presetId ??
            listed?.presets.find((row) => row.isDefault)?.id ??
            listed?.presets[0]?.id
          if (!id) return undefined
          return await presets?.acquireScope?.(id)
        } catch {
          return undefined
        }
      })()
      try {
        return await listRegisteredPrompts(
          systemPrompt,
          scope ? { scope: scope.key } : {},
        )
      } finally {
        try {
          await scope?.[Symbol.asyncDispose]?.()
        } catch {
          // releasing a read-only scope must not fail the read
        }
      }
    },
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
