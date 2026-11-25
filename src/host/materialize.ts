import os from 'node:os'
import path from 'node:path'
import type { CustomPromptRecord, GroupRecord, McpServerRecord, SectionRecord, SkillRecord, StoreDocument } from '../shared/types'
import { winningLayer } from '../shared/resolve'
import { isAllowed, sectionAllowlist, toolAllowlist } from '../shared/policy'
import { globalPaths, workspacePaths } from './paths'
import { loadSections } from './sections'
import { loadStore } from './store'

/** The subset of the host `systemPrompt` service this plugin needs. */
export interface PromptSectionLike {
  name: string
  order: number
  text: string | ((context: unknown) => string)
  interpolate?: boolean
}

export interface SystemPromptLike {
  section(section: PromptSectionLike): () => void
  getSectionOrder(name: string): number
}

/** The subset of the host `tools` service this plugin needs. */
export interface ToolsLike {
  restrict(filter: { allow?: string[]; deny?: string[] }): () => void
}

/** The subset of a live agent this plugin reads. */
export interface AgentLike {
  id?: string
  session?: { cwd?: string }
  ctx?: {
    systemPrompt?: SystemPromptLike
    skills?: SkillsLike
    tools?: ToolsLike
    on?: (event: string, listener: (...args: any[]) => unknown) => (() => void) | void
    get?: (name: string) => unknown
  }
}

/** The subset of the host `skills` service this plugin needs. */
export interface SkillRegistrationLike {
  name: string
  description: string
  content: string
  invocation?: { modelInvocable: boolean; userInvocable: boolean }
  source?: string
  provider?: string
}

export interface SkillsLike {
  register(skill: SkillRegistrationLike): () => void
}

export interface WorkspaceRegistryLike {
  resolveByPath?: (root: string) => Promise<{ id?: string } | undefined>
}

export interface MaterializeOptions {
  home?: string
  cwd?: string
  workspaceRegistry?: WorkspaceRegistryLike
}

export const SECTION_NAME = 'dsh-csmm:prompts'

/**
 * Register one prompt section in the agent's own scope. The section is
 * re-evaluated at every assembly, so a committed store write is visible on the
 * next turn without any refresh bookkeeping. Registrations made through
 * `agent.ctx` are disposed with the agent by the host.
 */
export async function registerAgentPrompts(
  agent: AgentLike,
  options: MaterializeOptions = {},
): Promise<(() => void) | undefined> {
  const systemPrompt = agent.ctx?.systemPrompt
    ?? (agent.ctx?.get?.('systemPrompt') as SystemPromptLike | undefined)
  const target = await resolveAgentTarget(agent, options)
  if (!target || !systemPrompt) return undefined

  const text = (): string => renderAgentPrompt(target)
  return systemPrompt.section({
    name: SECTION_NAME,
    order: sectionOrder(systemPrompt),
    text,
    interpolate: false,
  })
}

/**
 * Register the effective group's skills in the agent's own scope. Host skills
 * are registered by name; a same-name runtime provider shadows the bundled
 * skill for this agent only.
 */
export async function registerAgentSkills(
  agent: AgentLike,
  options: MaterializeOptions = {},
): Promise<(() => void) | undefined> {
  const skills = agent.ctx?.skills
    ?? (agent.ctx?.get?.('skills') as SkillsLike | undefined)
  const target = await resolveAgentTarget(agent, options)
  if (!target || !skills?.register) return undefined
  const view = effectiveView(target)
  if (!view) return undefined

  const registrations = view.group.items
    .filter((item) => item.kind === 'skill')
    .map((item) => pick<SkillRecord>(view.workspaceDoc.skills, view.globalDoc.skills, item.name))
    .filter((item): item is SkillRecord => item !== undefined && item.enabled !== false)
    .map((item) => skills.register({
      name: item.name,
      description: item.desc.trim() || item.label || item.name,
      content: item.text.trim() || item.desc.trim() || item.label || item.name,
      invocation: { modelInvocable: item.model, userInvocable: item.user },
      source: 'dsh-csmm',
      provider: 'dsh-csmm',
    }))

  return () => {
    for (const dispose of registrations) {
      try {
        dispose()
      } catch {
        // disposal must not throw into the host
      }
    }
  }
}

/**
 * Register a per-agent `system-prompt/assemble` waterfall that applies the
 * effective group's section allowlist and the persisted disabled list.
 *
 * The policy is rebuilt on every assembly so a committed group toggle is
 * visible on the next turn. `active` (not the number of selected names)
 * decides whether the allowlist runs; contexts and this plugin's own section
 * are always protected, and `complete: true` sections cannot be removed here.
 */
export async function registerAgentPromptFilter(
  agent: AgentLike,
  options: MaterializeOptions = {},
): Promise<(() => void) | undefined> {
  const target = await resolveAgentTarget(agent, options)
  if (!target || typeof agent.ctx?.on !== 'function') return undefined
  const listener = async (
    _assembly: unknown,
    _context: unknown,
    next: () => Promise<unknown>,
  ): Promise<unknown> => {
    const current = await next()
    try {
      const disabled = disabledPrompts(target)
      const value = current as {
        sections?: Array<{ name?: string }>
        contexts?: Array<{ name?: string }>
      }
      if (!Array.isArray(value.sections)) return current
      const protectedNames = new Set<string>(
        (value.contexts ?? [])
          .map((entry) => entry.name)
          .filter((name): name is string => typeof name === 'string'),
      )
      const view = effectiveView(target)
      const allow = sectionAllowlist(view?.group)
      const sections = value.sections.filter((section) => {
        const name = section?.name
        if (typeof name !== 'string' || name.length === 0) return true
        if (protectedNames.has(name) || name.startsWith('dsh-csmm:')) return true
        if (disabled.has(name)) return false
        return isAllowed(allow, name)
      })
      if (sections.length === value.sections.length) return current
      return { ...(current as object), sections }
    } catch {
      return current
    }
  }
  const off = agent.ctx.on('system-prompt/assemble', listener)
  return typeof off === 'function' ? off : undefined
}

/**
 * Restrict an agent's tool definitions to the effective group's `tool` items.
 *
 * `toolsMode: 'allow'` is the explicit takeover flag: an empty selection still
 * calls `restrict({ allow: [] })` and denies every tool. A group without the
 * flag is left untouched. `run_code` is reserved by the host, so it is removed
 * defensively.
 */
export async function registerAgentTools(
  agent: AgentLike,
  options: MaterializeOptions = {},
): Promise<(() => void) | undefined> {
  const target = await resolveAgentTarget(agent, options)
  if (!target) return undefined
  const tools = agent.ctx?.tools
  if (!tools || typeof tools.restrict !== 'function') return undefined
  try {
    const view = effectiveView(target)
    const allow = toolAllowlist(view?.group)
    if (!allow.active) return undefined
    try {
      return tools.restrict({ allow: allow.names })
    } catch {
      // A stale name in the allowlist must not silently restore every tool.
      // Fall back to the fail-closed empty allowlist.
      try {
        return tools.restrict({ allow: [] })
      } catch {
        return undefined
      }
    }
  } catch {
    return undefined
  }
}

/** Union of the global and current-workspace disabled section names. */
export function disabledPrompts(target: AgentTarget): Set<string> {
  const names = new Set<string>(loadStore(globalPaths(target.home)).disabledPrompts ?? [])
  if (target.workspaceId && target.cwd) {
    try {
      const workspace = loadStore(workspacePaths(target.cwd, target.workspaceId))
      for (const name of workspace.disabledPrompts ?? []) names.add(name)
    } catch {
      // missing workspace store is simply an empty disabled set
    }
  }
  return names
}

interface AgentTarget {
  home: string
  cwd: string
  workspaceId?: string
}

async function resolveAgentTarget(
  agent: AgentLike,
  options: MaterializeOptions,
): Promise<AgentTarget | undefined> {
  const cwd = options.cwd ?? agent.session?.cwd
  if (!cwd) return undefined
  const home = options.home ?? defaultHome()
  let workspaceId: string | undefined
  try {
    workspaceId = (await options.workspaceRegistry?.resolveByPath?.(cwd))?.id
  } catch {
    workspaceId = undefined
  }
  return { home, cwd, workspaceId }
}

interface EffectiveView {
  group: GroupRecord
  customs: readonly CustomPromptRecord[]
  globalDoc: StoreDocument
  workspaceDoc: StoreDocument
}

/** Resolve the effective group for an agent cwd; never throws. */
export function effectiveView(input: {
  home: string
  cwd?: string
  workspaceId?: string
}): EffectiveView | undefined {
  try {
    const globalDoc = loadStore(globalPaths(input.home))
    const trusted = input.workspaceId === undefined
      || globalDoc.workspaces.find((w) => w.id === input.workspaceId)?.trusted !== false
    if (!trusted || !input.cwd || !input.workspaceId) {
      const layer = winningLayer(globalDoc, { kind: 'global' })
      if (!layer.group) return undefined
      return { group: layer.group, customs: layer.customs, globalDoc, workspaceDoc: globalDoc }
    }
    const workspaceDoc = loadStore(workspacePaths(input.cwd, input.workspaceId))
    const key = `workspace:${input.workspaceId}`
    const active = workspaceDoc.activeGroup[key] ?? globalDoc.activeGroup['global:']
    if (active === '' || active === undefined) return undefined
    const group = workspaceDoc.groups.find((g) => g.id === active)
      ?? globalDoc.groups.find((g) => g.id === active)
    if (!group) return undefined
    const owner = group.scope.kind === 'workspace' ? workspaceDoc : globalDoc
    return { group, customs: owner.customs, globalDoc, workspaceDoc }
  } catch {
    return undefined
  }
}

/** Render the effective configuration for one agent. Never throws to the host. */
export function renderAgentPrompt(input: {
  home: string
  cwd?: string
  workspaceId?: string
}): string {
  const view = effectiveView(input)
  if (!view) return ''
  try {
    return compose(view.group, view.customs, view.globalDoc, view.workspaceDoc, loadSections(input.home))
  } catch {
    return ''
  }
}

/** Resolve a definition by name with the workspace copy winning over global. */
function pick<T extends { name: string; enabled?: boolean }>(workspace: T[], global: T[], name: string): T | undefined {
  return workspace.find((item) => item.name === name) ?? global.find((item) => item.name === name)
}

function compose(
  group: GroupRecord,
  customs: readonly CustomPromptRecord[],
  globalDoc: StoreDocument,
  workspaceDoc: StoreDocument,
  sectionRecords: readonly SectionRecord[],
): string {
  const blocks: string[] = []
  const sectionItems = group.items.filter((item) => item.kind === 'section').map((item) => item.name)
  if (sectionItems.length > 0) {
    const rendered = sectionItems.map((name) => {
      const record = sectionRecords.find((section) => section.name === name)
      return record ? `#### ${name}\n\n${record.text}` : `- ${name}`
    })
    blocks.push(`### 启用的提示词段\n${rendered.join('\n\n')}`)
  }

  const renderedCustoms = customs
    .filter((item) => item.enabled !== false && item.text.trim() !== '')
    .map((item) => `## ${item.title.trim() || item.id}\n\n${item.text.trim()}`)
  if (renderedCustoms.length > 0) blocks.push(renderedCustoms.join('\n\n'))

  const skills = group.items
    .filter((item) => item.kind === 'skill')
    .map((item) => pick<SkillRecord>(workspaceDoc.skills, globalDoc.skills, item.name))
    .filter((item): item is SkillRecord => item !== undefined && item.enabled !== false)
  if (skills.length > 0) {
    blocks.push(`### 技能\n${skills.map((s) => `- **${s.label || s.name}**（${s.name}）：${s.desc.trim() || '无说明'}`).join('\n')}`)
  }

  const servers = group.items
    .filter((item) => item.kind === 'mcp')
    .map((item) => pick<McpServerRecord>(workspaceDoc.servers, globalDoc.servers, item.name))
    .filter((item): item is McpServerRecord => item !== undefined && item.enabled !== false)
  if (servers.length > 0) {
    blocks.push(`### MCP 服务器\n${servers.map((s) => {
      const tools = s.tools.filter((t) => t.on !== false).map((t) => t.name).join(', ')
      const note = s.instructions.trim() || '无说明'
      return `- **${s.label || s.name}**（${s.name}）：${note}${tools ? `；工具：${tools}` : ''}`
    }).join('\n')}`)
  }

  if (blocks.length === 0) return ''
  return `## dsh-csmm 生效配置：${group.name}\n\n${blocks.join('\n\n')}`
}

function sectionOrder(systemPrompt: SystemPromptLike): number {
  try {
    return systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') + 100
  } catch {
    return 9000
  }
}

function defaultHome(): string {
  return process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
}
