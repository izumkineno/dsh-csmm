import type {
  Bootstrap,
  Command,
  CustomPromptRecord,
  Diagnostic,
  GroupRecord,
  McpServerRecord,
  Scope,
  SectionRecord,
  SecretsDocument,
  ServerSecretsPatch,
  SkillRecord,
  Snapshot,
  StoreDocument,
  WorkspaceRecord,
} from '../shared/types'
import {
  DEFAULT_COPY,
  chainFor,
  denyCount,
  isTrustedWorkspace,
  sameScope,
  scopeKey,
  shadowCount,
  visibleServers,
  visibleSkills,
} from '../shared/resolve'
import type { ScopePaths } from './paths'
import { loadSecrets, loadStore, saveSecrets, saveStore, withLock } from './store'

export class ServiceError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
  }
}

export interface WorkspaceBinding {
  id: string
  paths: ScopePaths
}

export interface ServiceOptions {
  global: ScopePaths
  workspace?: WorkspaceBinding
  workspaces?: WorkspaceRecord[]
  sections?: SectionRecord[]
}

export class CsmmService {
  private readonly options: ServiceOptions

  constructor(options: ServiceOptions) {
    this.options = options
  }

  snapshot(scope: Scope = { kind: 'global' }): Snapshot {
    const state = this.loadMerged()
    const requested = this.requestedScope(scope)
    const target = this.resolveScope(requested, state)
    const bootstrap = this.buildBootstrap(state.doc, target)
    return { revision: state.doc.revision, bootstrap, diagnostics: this.diagnostics(state.doc, requested) }
  }

  dispatch(command: Command): Snapshot {
    const state = this.loadMerged()
    if (command.type !== 'trust.set') {
      if (command.expectedRevision !== state.doc.revision) {
        throw new ServiceError(
          'E_REVISION',
          `revision conflict: expected ${command.expectedRevision}, current ${state.doc.revision}`,
        )
      }
    }
    return withLock(this.options.global, () => {
      const next = this.loadMerged()
      const globalDoc = next.global
      const workspaceDoc = next.workspace
      const scope =
        command.type === 'skill.copy'
          ? command.to
          : 'scope' in command
            ? command.scope
            : undefined
      if (command.type === 'trust.set') {
        upsertTrust(globalDoc, command.workspaceId, command.trusted)
        saveStore(this.options.global, globalDoc, next.doc.revision)
        return this.snapshot(scope ?? { kind: 'global' })
      }
      const target = this.requireWriteScope(scope!)
      if (target.kind === 'workspace') {
        const binding = this.workspace()
        if (!binding || !workspaceDoc) throw new ServiceError('E_APPLY', 'no workspace binding')
        if (!isTrustedWorkspace(globalDoc, binding.id)) {
          throw new ServiceError('E_TRUST', 'workspace is not trusted')
        }
        this.apply(workspaceDoc, target, command)
        saveStore(binding.paths, workspaceDoc)
        saveStore(this.options.global, globalDoc, next.doc.revision)
      } else {
        this.apply(globalDoc, target, command)
        saveStore(this.options.global, globalDoc, next.doc.revision)
      }
      return this.snapshot(target)
    })
  }

  private apply(doc: StoreDocument, scope: Scope, command: Command): void {
    switch (command.type) {
      case 'group.save':
      case 'group.activate': {
        const group: GroupRecord = { ...command.group, scope: cloneScope(scope), name: command.name }
        const index = doc.groups.findIndex((g) => g.id === group.id && sameScope(g.scope, scope))
        if (index >= 0) doc.groups[index] = group
        else doc.groups.push(group)
        if (command.type === 'group.activate') doc.activeGroup[scopeKey(scope)] = group.id
        return
      }
      case 'group.effective':
        doc.activeGroup[scopeKey(scope)] = command.groupId
        return
      case 'group.inherit':
        delete doc.activeGroup[scopeKey(scope)]
        return
      case 'group.none':
        doc.activeGroup[scopeKey(scope)] = ''
        return
      case 'group.delete': {
        doc.groups = doc.groups.filter((g) => !(g.id === command.id && sameScope(g.scope, scope)))
        const key = scopeKey(scope)
        if (doc.activeGroup[key] === command.id) delete doc.activeGroup[key]
        return
      }
      case 'custom.save': {
        const custom: CustomPromptRecord = { ...command.custom, scope: cloneScope(scope) }
        const index = doc.customs.findIndex((c) => c.id === custom.id && sameScope(c.scope, scope))
        if (index >= 0) doc.customs[index] = custom
        else doc.customs.push(custom)
        return
      }
      case 'custom.toggle': {
        const custom = this.localCustom(doc, scope, command.id)
        custom.enabled = custom.enabled === false
        return
      }
      case 'custom.delete':
        doc.customs = doc.customs.filter((c) => !(c.id === command.id && sameScope(c.scope, scope)))
        return
      case 'skill.save': {
        const skill = this.normalizeSkill(command.skill, scope)
        const index = doc.skills.findIndex((s) => s.name === skill.name && sameScope(skillScope(s), scope))
        if (index >= 0) doc.skills[index] = skill
        else doc.skills.push(skill)
        return
      }
      case 'skill.toggle': {
        const skill = this.localSkill(doc, scope, command.name)
        skill.enabled = skill.enabled === false
        return
      }
      case 'skill.delete':
        doc.skills = doc.skills.filter(
          (s) => !(s.name === command.name && sameScope(skillScope(s), scope)),
        )
        return
      case 'skill.copy': {
        const source = this.loadMerged().doc
        for (const name of command.names) {
          const skill = visibleSkills(source, command.from).find((s) => s.name === name)
          if (!skill) continue
          const copy = this.normalizeSkill({ ...skill, scope: scope.kind, wsId: scope.id ?? undefined }, scope)
          const index = doc.skills.findIndex((s) => s.name === copy.name && sameScope(skillScope(s), scope))
          if (index >= 0) doc.skills[index] = copy
          else doc.skills.push(copy)
        }
        return
      }
      case 'mcp.save': {
        const incoming = command.server as McpServerRecord & {
          env?: Record<string, string>
          headers?: Record<string, string>
        }
        const { env, headers, ...record } = incoming
        const server = this.normalizeServer(
          {
            ...(record as McpServerRecord),
            envKeys: uniqueKeys(record.envKeys, Object.keys(env ?? {})),
            headerKeys: uniqueKeys(record.headerKeys, Object.keys(headers ?? {})),
          },
          scope,
        )
        const index = doc.servers.findIndex(
          (s) => s.name === server.name && sameScope(serverScope(s), scope),
        )
        if (index >= 0) doc.servers[index] = server
        else doc.servers.push(server)
        this.writeSecrets(scope, server.name, {
          env: { ...(command.secrets?.env ?? {}), ...(env ?? {}) },
          headers: { ...(command.secrets?.headers ?? {}), ...(headers ?? {}) },
        })
        return
      }
      case 'mcp.toggle': {
        const server = this.localServer(doc, scope, command.name)
        server.enabled = server.enabled === false
        return
      }
      case 'mcp.delete':
        doc.servers = doc.servers.filter(
          (s) => !(s.name === command.name && sameScope(serverScope(s), scope)),
        )
        this.deleteSecrets(scope, command.name)
        return
      case 'mcp.tools': {
        const server = this.localServer(doc, scope, command.name)
        server.tools = command.tools
        return
      }
      case 'prompt.toggle': {
        const next = new Set(doc.disabledPrompts ?? [])
        if (command.disabled) next.add(command.name)
        else next.delete(command.name)
        doc.disabledPrompts = [...next].sort()
        return
      }
      case 'trust.set':
        return
      default:
        throw new ServiceError('E_KIND', `unsupported command ${(command as { type: string }).type}`)
    }
  }

  private writeSecrets(scope: Scope, serverName: string, patch?: ServerSecretsPatch): void {
    const { paths, doc } = this.secretsFor(scope)
    const current = doc.servers[serverName] ?? { env: {}, headers: {} }
    const next = {
      env: mergeSecrets(current.env, patch?.env),
      headers: mergeSecrets(current.headers, patch?.headers),
    }
    doc.servers[serverName] = next
    saveSecrets(paths, doc)
  }

  private deleteSecrets(scope: Scope, serverName: string): void {
    const { paths, doc } = this.secretsFor(scope)
    if (!(serverName in doc.servers)) return
    delete doc.servers[serverName]
    saveSecrets(paths, doc)
  }

  private secretsFor(scope: Scope): { paths: ScopePaths; doc: SecretsDocument } {
    const binding = this.scopePaths(scope)
    return { paths: binding, doc: loadSecrets(binding) }
  }

  private scopePaths(scope: Scope): ScopePaths {
    if (scope.kind === 'workspace') {
      const binding = this.workspace()
      if (!binding) throw new ServiceError('E_APPLY', 'no workspace binding')
      return binding.paths
    }
    return this.options.global
  }

  private loadMerged(): {
    doc: StoreDocument
    global: StoreDocument
    workspace?: StoreDocument
  } {
    const global = loadStore(this.options.global)
    const workspace = this.options.workspace ? loadStore(this.options.workspace.paths) : undefined
    const doc: StoreDocument = {
      ...global,
      activeGroup: { ...(workspace?.activeGroup ?? {}), ...global.activeGroup },
      groups: [...global.groups, ...(workspace?.groups ?? [])],
      customs: [...global.customs, ...(workspace?.customs ?? [])],
      skills: [...global.skills, ...(workspace?.skills ?? [])],
      servers: [...global.servers, ...(workspace?.servers ?? [])],
      disabledPrompts: [
        ...new Set([
          ...(global.disabledPrompts ?? []),
          ...(workspace?.disabledPrompts ?? []),
        ]),
      ].sort(),
    }
    return { doc, global, workspace }
  }

  private buildBootstrap(doc: StoreDocument, scope: Scope): Bootstrap {
    const sectionList = this.options.sections ?? []
    const workspaces = this.workspaceViews(doc)
    return {
      workspaces,
      sections: sectionList,
      skills: visibleSkills(doc, scope),
      servers: visibleServers(doc, scope).map(redactServer),
      groups: chainFor(doc, scope).flatMap((sc) => doc.groups.filter((g) => sameScope(g.scope, sc))),
      customs: chainFor(doc, scope).flatMap((sc) => doc.customs.filter((c) => sameScope(c.scope, sc))),
      activeGroup: { ...doc.activeGroup },
      disabledPrompts: [...(doc.disabledPrompts ?? [])].sort(),
      copy: DEFAULT_COPY,
    }
  }

  private diagnostics(doc: StoreDocument, scope: Scope): Diagnostic[] {
    const result: Diagnostic[] = []
    if (scope.kind === 'workspace' && scope.id && !isTrustedWorkspace(doc, scope.id)) {
      result.push({
        code: 'W_TRUST',
        severity: 'warning',
        message: 'workspace is restricted until trusted',
        scope: cloneScope(scope),
      })
    }
    const denied = denyCount(doc, scope)
    if (denied > 0) {
      result.push({
        code: 'W_TOOL',
        severity: 'info',
        message: `${denied} tool(s) disabled by the effective group`,
        scope: cloneScope(scope),
      })
    }
    const shadowed = shadowCount(doc, scope)
    if (shadowed > 0) {
      result.push({
        code: 'W_TOOL',
        severity: 'info',
        message: `${shadowed} skill(s) shadowed by the effective group`,
        scope: cloneScope(scope),
      })
    }
    return result
  }

  private workspaceViews(doc: StoreDocument): WorkspaceRecord[] {
    const provided = this.options.workspaces ?? []
    if (provided.length) {
      return provided.map((w) => ({ ...w, trusted: isTrustedWorkspace(doc, w.id) }))
    }
    return doc.workspaces.map((w) => ({
      id: w.id,
      title: w.id,
      path: '',
      trusted: w.trusted,
    }))
  }

  private resolveScope(scope: Scope, state: { doc: StoreDocument }): Scope {
    if (scope.kind === 'global') return scope
    const id = scope.id ?? this.options.workspace?.id
    if (!id) return { kind: 'global' }
    const trusted = isTrustedWorkspace(state.doc, id)
    return trusted ? { kind: 'workspace', id } : { kind: 'global' }
  }

  private requestedScope(scope: Scope): Scope {
    if (scope.kind === 'global') return scope
    return { kind: 'workspace', id: scope.id ?? this.options.workspace?.id ?? null }
  }

  private requireWriteScope(scope: Scope | undefined): Scope {
    if (!scope) throw new ServiceError('E_PAYLOAD', 'command requires a scope')
    if (scope.kind === 'workspace') {
      const id = scope.id ?? this.options.workspace?.id
      if (!id) throw new ServiceError('E_PAYLOAD', 'workspace scope requires an id')
      return { kind: 'workspace', id }
    }
    return { kind: 'global' }
  }

  private workspace(): WorkspaceBinding | undefined {
    return this.options.workspace
  }

  private normalizeSkill(skill: SkillRecord, scope: Scope): SkillRecord {
    return { ...skill, scope: scope.kind, wsId: scope.kind === 'workspace' ? scope.id ?? undefined : undefined }
  }

  private normalizeServer(server: McpServerRecord, scope: Scope): McpServerRecord {
    const { env, headers, ...record } = server as McpServerRecord & {
      env?: Record<string, string>
      headers?: Record<string, string>
    }
    return {
      ...(record as McpServerRecord),
      scope: scope.kind,
      wsId: scope.kind === 'workspace' ? scope.id ?? undefined : undefined,
      envKeys: uniqueKeys(record.envKeys, Object.keys(env ?? {})),
      headerKeys: uniqueKeys(record.headerKeys, Object.keys(headers ?? {})),
    }
  }

  private localCustom(doc: StoreDocument, scope: Scope, id: string): CustomPromptRecord {
    const found = doc.customs.find((c) => c.id === id && sameScope(c.scope, scope))
    if (!found) throw new ServiceError('E_PAYLOAD', `custom not found: ${id}`)
    return found
  }

  private localSkill(doc: StoreDocument, scope: Scope, name: string): SkillRecord {
    const found = doc.skills.find((s) => s.name === name && sameScope(skillScope(s), scope))
    if (found) return found
    const visible = visibleSkills(doc, scope).find((s) => s.name === name)
    if (!visible) throw new ServiceError('E_PAYLOAD', `skill not found: ${name}`)
    const copy: SkillRecord = {
      ...visible,
      scope: scope.kind,
      wsId: scope.kind === 'workspace' ? scope.id ?? undefined : undefined,
    }
    doc.skills.push(copy)
    return copy
  }

  private localServer(doc: StoreDocument, scope: Scope, name: string): McpServerRecord {
    const found = doc.servers.find((s) => s.name === name && sameScope(serverScope(s), scope))
    if (found) return found
    const visible = visibleServers(doc, scope).find((s) => s.name === name)
    if (!visible) throw new ServiceError('E_PAYLOAD', `server not found: ${name}`)
    const copy: McpServerRecord = {
      ...visible,
      scope: scope.kind,
      wsId: scope.kind === 'workspace' ? scope.id ?? undefined : undefined,
    }
    doc.servers.push(copy)
    return copy
  }
}

function cloneScope(scope: Scope): Scope {
  return { kind: scope.kind, id: scope.kind === 'workspace' ? scope.id ?? null : undefined }
}

function skillScope(skill: SkillRecord): Scope {
  return skill.scope === 'workspace'
    ? { kind: 'workspace', id: skill.wsId ?? null }
    : { kind: 'global' }
}

function serverScope(server: McpServerRecord): Scope {
  return server.scope === 'workspace'
    ? { kind: 'workspace', id: server.wsId ?? null }
    : { kind: 'global' }
}

function uniqueKeys(current: string[] | undefined, extra: string[]): string[] {
  return [...new Set([...(current ?? []), ...extra])]
}

function redactServer(server: McpServerRecord): McpServerRecord {
  const { env, headers, ...rest } = server as McpServerRecord & {
    env?: Record<string, string>
    headers?: Record<string, string>
  }
  return rest as McpServerRecord
}

function upsertTrust(doc: StoreDocument, workspaceId: string, trusted: boolean): void {
  const entry = doc.workspaces.find((w) => w.id === workspaceId)
  if (entry) entry.trusted = trusted
  else doc.workspaces.push({ id: workspaceId, trusted })
}

function mergeSecrets(
  current: Record<string, string>,
  patch?: Record<string, string | null>,
): Record<string, string> {
  const next = { ...current }
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) delete next[key]
    else if (value !== '') next[key] = value
  }
  return next
}
