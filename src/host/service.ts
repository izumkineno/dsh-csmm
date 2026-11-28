import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  Bootstrap,
  Command,
  CustomPromptRecord,
  Diagnostic,
  DshSkill,
  DshSkillDetailResult,
  GroupRecord,
  McpServerRecord,
  Scope,
  SectionRecord,
  SecretsDocument,
  ServerSecretsPatch,
  SkillCatalogResult,
  SkillPolicyRecord,
  SkillPolicyState,
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
import { MAX_SKILL_TEXT_BYTES, byteLengthUtf8, normalizeSkillName } from '../shared/skillMarkdown'
import { canDisableSkillSource, resolveSkillPolicy, skillRootLabel, skillRootPriority } from '../shared/skillPolicy'
import type { ScopePaths } from './paths'
import { atomicWrite, loadSecrets, loadStore, saveSecrets, saveStore, withFileLock, withLock } from './store'

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

/** The slice of DSH's skill registry the catalog needs. */
export interface DshSkillSummary {
  name: string
  description: string
  whenToUse?: string
  source: string
  provider: string
  path?: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
}

export interface DshSkillDefinition extends DshSkillSummary {
  /** Markdown body after frontmatter removal. */
  content: string
}

export interface SkillRegistryLike {
  list(options: { cwd?: string; scope?: unknown }): Promise<DshSkillSummary[]>
  get(name: string, options: { cwd?: string; scope?: unknown }): Promise<DshSkillDefinition | undefined>
}

/** One read of an editable SKILL.md; buffer/text/sha256 all come from the same bytes. */
export interface SkillFileRead {
  raw: string
  text: string
  buffer: Buffer
  sha256: string
  mode: number
  bytes: number
}

/** A source file inside a trusted workspace that passed the editability checks. */
export interface SkillSourceTarget extends SkillFileRead {
  path: string
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sanitizeSkillName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  return cleaned || 'skill'
}

async function pruneSkillBackups(dir: string, name: string, keep: number): Promise<void> {
  const prefix = sanitizeSkillName(name) + '-'
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return
  }
  const files: Array<{ name: string; time: number }> = []
  for (const entry of names) {
    if (!entry.startsWith(prefix)) continue
    try {
      const stat = await fs.stat(path.join(dir, entry))
      files.push({ name: entry, time: stat.mtimeMs })
    } catch {
      /* removed concurrently */
    }
  }
  files.sort((a, b) => b.time - a.time)
  await Promise.all(
    files.slice(Math.max(0, keep)).map((file) => fs.unlink(path.join(dir, file.name)).catch(() => undefined)),
  )
}


function toDshSkill(
  summary: DshSkillSummary,
  policy?: { state: SkillPolicyState; from: 'workspace' | 'global' | 'default' },
): DshSkill {
  const effective = policy ?? { state: 'on' as SkillPolicyState, from: 'default' as const }
  const canDisable = canDisableSkillSource(summary.source) && summary.provider !== 'dsh-csmm'
  const skill: DshSkill = {
    name: summary.name,
    description: summary.description,
    source: summary.source,
    provider: summary.provider,
    model: summary.invocation.modelInvocable,
    user: summary.invocation.userInvocable,
    origin: summary.source.startsWith('project-') ? 'workspace' : 'global',
    rootPriority: skillRootPriority(summary.source),
    rootLabel: skillRootLabel(summary.source),
    canDisable,
    policy: effective.state,
    policyFrom: effective.from,
    disabled: canDisable && effective.state === 'off',
  }
  if (summary.whenToUse) skill.whenToUse = summary.whenToUse
  if (summary.path) skill.path = summary.path
  return skill
}

/** One record per name+source whose resolved policy is off in the requested scope. */
function effectiveOffPolicies(
  records: readonly SkillPolicyRecord[],
  scope: Scope,
  cwd: string | undefined,
): SkillPolicyRecord[] {
  const seen = new Set<string>()
  const off: SkillPolicyRecord[] = []
  for (const record of records) {
    const key = record.name + '\u0000' + record.source
    if (seen.has(key)) continue
    seen.add(key)
    const resolution = resolveSkillPolicy(records, scope, cwd, record.name, record.source)
    if (resolution.state === 'off' && canDisableSkillSource(record.source) && record.source !== 'dsh-csmm') {
      off.push(record)
    }
  }
  return off
}

interface DshTarget {
  registry?: SkillRegistryLike
  cwd?: string
  /** Agent-preset scope that carries user/project skill providers. */
  scope?: unknown
  restricted: boolean
  errors: string[]
}

function registryOptions(target: DshTarget): { cwd?: string; scope?: unknown } {
  const options: { cwd?: string; scope?: unknown } = {}
  if (target.cwd) options.cwd = target.cwd
  if (target.scope !== undefined) options.scope = target.scope
  return options
}

export interface ServiceOptions {
  global: ScopePaths
  workspace?: WorkspaceBinding
  workspaces?: WorkspaceRecord[]
  sections?: SectionRecord[]
  /** DSH's live skill registry; the catalog reads it instead of walking directories. */
  registry?: SkillRegistryLike
  /** Viewing scope (the default agent preset); omitted reads the global layer only. */
  skillScope?: unknown
  /** Current workspace root; used when the requested workspace has no registry path. */
  workspaceRoot?: string
  /** Context window of the model used by the last conversation in this scope. */
  contextWindow?: () => number | undefined
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
    const contextWindow = this.options.contextWindow?.()
    if (contextWindow) bootstrap.contextWindow = contextWindow
    return { revision: state.doc.revision, bootstrap, diagnostics: this.diagnostics(state.doc, requested) }
  }

  /**
   * Read-only list of the skills DSH has registered for the requested scope.
   * An untrusted workspace falls back to the global layer, like the rest of the
   * service; no store or DSH file is written.
   */
  async listDshSkills(scope: Scope = { kind: 'global' }): Promise<SkillCatalogResult> {
    const target = this.dshTarget(scope)
    const scannedAt = new Date().toISOString()
    if (!target.registry || target.errors.length) {
      return {
        scannedAt,
        skills: [],
        errors: target.errors,
        ...(target.restricted ? { restricted: true } : {}),
      }
    }

    try {
      const state = this.loadMerged()
      const policyScope = target.restricted ? { kind: 'global' as const } : this.requestedScope(scope)
      const records = state.doc.skillPolicy
      const decorate = (summary: DshSkillSummary): DshSkill =>
        toDshSkill(
          summary,
          resolveSkillPolicy(records, policyScope, target.cwd, summary.name, summary.source),
        )
      const summaries = (await target.registry.list(registryOptions(target)))
        .filter((summary) => !(summary.provider === 'dsh-csmm' && summary.source === 'dsh-csmm:off'))
      const skills = summaries.map(decorate)
      const names = new Set(skills.map((skill) => skill.name))
      for (const record of effectiveOffPolicies(records, policyScope, target.cwd)) {
        if (names.has(record.name) || record.source === 'dsh-csmm') continue
        names.add(record.name)
        skills.push(decorate({
          name: record.name,
          description: '在当前作用域已停用',
          source: record.source,
          provider: 'dsh-csmm:policy',
          invocation: { modelInvocable: false, userInvocable: false },
        }))
      }
      return {
        scannedAt,
        skills,
        errors: [],
        ...(target.restricted ? { restricted: true } : {}),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        scannedAt,
        skills: [],
        errors: ['读取 DSH 技能失败：' + message],
        ...(target.restricted ? { restricted: true } : {}),
      }
    }
  }

  /**
   * Read one skill's instruction body on demand. Only the selected skill is
   * loaded, so the catalog stays small; no store or DSH file is written.
   */
  async getDshSkill(
    name: string,
    scope: Scope = { kind: 'global' },
  ): Promise<DshSkillDetailResult> {
    const target = this.dshTarget(scope)
    const restricted = target.restricted ? { restricted: true } : {}
    if (!target.registry || target.errors.length) {
      return { errors: target.errors, ...restricted }
    }

    try {
      const state = this.loadMerged()
      const policyScope = target.restricted ? { kind: 'global' as const } : this.requestedScope(scope)
      const found = await target.registry.get(name, registryOptions(target))
      const shadowed = found?.provider === 'dsh-csmm' && found.source === 'dsh-csmm:off'
      if (!found || shadowed) {
        const off = effectiveOffPolicies(state.doc.skillPolicy, policyScope, target.cwd)
          .find((record) => record.name === name)
        if (!off) return { errors: ['技能不存在或当前作用域不可见'], ...restricted }
        const body = '该技能在当前作用域已停用。重新启用后重开会话生效。'
        return {
          skill: {
            ...toDshSkill(
              {
                name: off.name,
                description: '在当前作用域已停用',
                source: off.source,
                provider: 'dsh-csmm:policy',
                invocation: { modelInvocable: false, userInvocable: false },
              },
              resolveSkillPolicy(state.doc.skillPolicy, policyScope, target.cwd, off.name, off.source),
            ),
            content: body,
            sha256: sha256Hex(Buffer.from(body, 'utf8')),
          },
          errors: [],
          ...restricted,
        }
      }
      const policy = resolveSkillPolicy(
        state.doc.skillPolicy,
        policyScope,
        target.cwd,
        found.name,
        found.source,
      )
      if (canDisableSkillSource(found.source) && found.provider !== 'dsh-csmm' && policy.state === 'off') {
        const body = '该技能在当前作用域已停用。重新启用后重开会话生效。'
        return {
          skill: {
            ...toDshSkill(found, policy),
            content: body,
            sha256: sha256Hex(Buffer.from(body, 'utf8')),
          },
          errors: [],
          ...restricted,
        }
      }
      const errors: string[] = []
      let raw: string | undefined
      let sha256 = sha256Hex(Buffer.from(found.content, 'utf8'))
      if (!target.restricted && found.source !== 'project-agents' && typeof found.path === 'string' && found.path) {
        try {
          const read = await this.readSkillFile(found.path)
          raw = read.raw
          sha256 = read.sha256
        } catch (error) {
          errors.push('读取技能源文件失败：' + errorMessage(error))
        }
      }
      const skill = {
        ...toDshSkill(found, policy),
        content: found.content,
        ...(raw === undefined ? {} : { raw }),
        sha256,
      }
      return { skill, errors, ...restricted }
    } catch (error) {
      return { errors: ['读取 DSH 技能失败：' + errorMessage(error)], ...restricted }
    }
  }

  /** Read one SKILL.md with an 800k cap and strict UTF-8 decoding. */
  private async readSkillFile(file: string): Promise<SkillFileRead> {
    let stat
    try {
      stat = await fs.stat(file)
    } catch {
      throw new ServiceError('E_SOURCE_MISSING', '源文件不存在或不可读')
    }
    if (!stat.isFile()) throw new ServiceError('E_SOURCE_MISSING', '源路径不是文件')
    if (stat.size > MAX_SKILL_TEXT_BYTES) {
      throw new ServiceError(
        'E_SKILL_TOO_LARGE',
        `技能文件超过 ${MAX_SKILL_TEXT_BYTES} 字节`,
      )
    }
    const buffer = await fs.readFile(file)
    if (buffer.byteLength > MAX_SKILL_TEXT_BYTES) {
      throw new ServiceError(
        'E_SKILL_TOO_LARGE',
        `技能文件超过 ${MAX_SKILL_TEXT_BYTES} 字节`,
      )
    }
    let raw: string
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch {
      throw new ServiceError('E_SKILL_ENCODING', '技能文件不是合法的 UTF-8')
    }
    return {
      raw,
      text: raw,
      buffer,
      sha256: sha256Hex(buffer),
      mode: stat.mode,
      bytes: buffer.byteLength,
    }
  }

  /**
   * Resolve one workspace-origin SKILL.md to an editable file inside the
   * current workspace root. Global/user/bundled sources are read-only.
   */
  private async resolveEditableSource(name: string, scope: Scope): Promise<SkillSourceTarget> {
    const requested = this.requestedScope(scope)
    if (requested.kind !== 'workspace' || !requested.id) {
      throw new ServiceError('E_WORKSPACE_UNTRUSTED', '只能编辑工作区技能源文件')
    }
    if (!this.options.workspace || this.options.workspace.id !== requested.id) {
      throw new ServiceError('E_WORKSPACE_UNTRUSTED', '技能不属于当前工作区绑定')
    }
    const target = this.dshTarget(scope)
    if (!target.registry) throw new ServiceError('E_SOURCE_MISSING', '宿主未提供技能注册表')
    if (target.restricted || !target.cwd) {
      throw new ServiceError('E_WORKSPACE_UNTRUSTED', '工作区未受信任，不能编辑源文件')
    }

    let workspaceReal: string
    try {
      workspaceReal = await fs.realpath(target.cwd)
    } catch {
      throw new ServiceError('E_WORKSPACE_UNTRUSTED', '工作区根路径不可用')
    }

    let found: DshSkillDefinition | undefined
    try {
      found = await target.registry.get(name, registryOptions(target))
    } catch (error) {
      throw new ServiceError('E_NOT_FOUND', '读取技能失败：' + errorMessage(error))
    }
    if (!found) throw new ServiceError('E_NOT_FOUND', `技能不存在：${name}`)
    if (toDshSkill(found).origin !== 'workspace') {
      throw new ServiceError('E_SOURCE_READONLY', '全局、用户或内置技能不能直接编辑')
    }

    const file = found.path
    if (!file || !path.isAbsolute(file) || path.basename(file).toLowerCase() !== 'skill.md') {
      throw new ServiceError('E_SOURCE_MISSING', '技能没有可编辑的 SKILL.md 源文件')
    }

    let stat
    try {
      stat = await fs.lstat(file)
    } catch {
      throw new ServiceError('E_SOURCE_MISSING', '源文件不存在或不可读')
    }
    if (stat.isSymbolicLink()) {
      throw new ServiceError('E_PATH_ESCAPE', '源文件是符号链接')
    }
    if (!stat.isFile()) throw new ServiceError('E_SOURCE_MISSING', '源路径不是文件')

    let fileReal: string
    try {
      fileReal = await fs.realpath(file)
    } catch {
      throw new ServiceError('E_SOURCE_MISSING', '源文件不存在或不可读')
    }
    const relative = path.relative(workspaceReal, fileReal)
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith('..' + path.sep) ||
      path.isAbsolute(relative)
    ) {
      throw new ServiceError('E_PATH_ESCAPE', '源文件不在当前工作区内')
    }
    if (relative.split(path.sep)[0] !== '.dsh') {
      throw new ServiceError('E_SOURCE_READONLY', '只允许编辑工作区 .dsh 下的项目技能源文件')
    }

    return { path: fileReal, ...(await this.readSkillFile(fileReal)) }
  }


  /**
   * Replace a workspace-origin SKILL.md after an in-lock SHA-256 CAS check.
   * A backup of the previous bytes is written under the plugin's workspace
   * directory; the store, revision and secrets are untouched.
   */
  async saveDshSkillSource(
    name: string,
    scope: Scope,
    text: string,
    expectedSha256: string,
  ): Promise<{ path: string; sha256: string }> {
    if (scope.kind !== 'workspace' || !scope.id) {
      throw new ServiceError('E_WORKSPACE_UNTRUSTED', '只能编辑工作区技能源文件')
    }
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new ServiceError('E_PAYLOAD', 'text is required')
    }
    if (typeof expectedSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(expectedSha256)) {
      throw new ServiceError('E_PAYLOAD', 'expectedSha256 must be a 64-character hex string')
    }
    if (byteLengthUtf8(text) > MAX_SKILL_TEXT_BYTES) {
      throw new ServiceError('E_SKILL_TOO_LARGE', `技能文件超过 ${MAX_SKILL_TEXT_BYTES} 字节`)
    }
    const binding = this.workspace()
    if (!binding || binding.id !== scope.id) {
      throw new ServiceError('E_WORKSPACE_UNTRUSTED', '技能不属于当前工作区绑定')
    }

    // Fast-fail outside the lock; the authoritative CAS check re-reads inside.
    await this.resolveEditableSource(name, scope)
    const lockFile = path.join(binding.paths.root, 'skill-source.lock')
    const backupDir = path.join(binding.paths.root, 'skill-backups')
    const expected = expectedSha256.toLowerCase()

    try {
      return await withFileLock(lockFile, async () => {
        const fresh = await this.resolveEditableSource(name, scope)
        if (fresh.sha256 !== expected) {
          throw new ServiceError(
            'E_SKILL_CONFLICT',
            `源文件已变更（当前 ${fresh.sha256}），请重新载入后再保存`,
          )
        }
        if (text === fresh.text) return { path: fresh.path, sha256: fresh.sha256 }

        await fs.mkdir(backupDir, { recursive: true })
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const backup = path.join(
          backupDir,
          `${sanitizeSkillName(name)}-${fresh.sha256.slice(0, 8)}-${stamp}.md`,
        )
        await fs.writeFile(backup, fresh.buffer, { mode: 0o600 })
        await pruneSkillBackups(backupDir, name, 20)
        atomicWrite(fresh.path, text, fresh.mode & 0o777)
        return { path: fresh.path, sha256: sha256Hex(Buffer.from(text, 'utf8')) }
      })
    } catch (error) {
      if ((error as { code?: string }).code === 'E_LOCKED') {
        throw new ServiceError('E_LOCKED', errorMessage(error))
      }
      throw error
    }
  }

  private dshTarget(scope: Scope): DshTarget {
    const state = this.loadMerged()
    const requested = this.requestedScope(scope)
    const target = this.resolveScope(requested, state)
    const restricted = requested.kind === 'workspace' && target.kind === 'global'
    const registry = this.options.registry
    if (!registry) {
      return { restricted, errors: ['宿主未提供技能注册表'] }
    }
    const viewScope = this.options.skillScope
    if (target.kind === 'workspace') {
      const cwd = this.options.workspaces?.find((w) => w.id === target.id)?.path
        ?? this.options.workspaceRoot
      if (!cwd) {
        return { registry, scope: viewScope, restricted, errors: ['工作区根路径不可用，未读取项目技能'] }
      }
      return { registry, cwd, scope: viewScope, restricted, errors: [] }
    }
    return { registry, scope: viewScope, restricted, errors: [] }
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
      case 'skill.policy': {
        const name = typeof command.name === 'string' ? command.name.trim() : ''
        const source = typeof command.source === 'string' ? command.source.trim() : ''
        if (!name || !source) throw new ServiceError('E_PAYLOAD', 'name and source are required')
        if (command.state !== 'on' && command.state !== 'off' && command.state !== 'inherit') {
          throw new ServiceError('E_PAYLOAD', 'state must be on, off, or inherit')
        }
        if (command.state !== 'inherit' && !canDisableSkillSource(source)) {
          throw new ServiceError('E_PAYLOAD', 'project/runtime skills cannot be toggled')
        }
        const cwd = scope.kind === 'workspace' ? command.cwd?.trim() || undefined : undefined
        doc.skillPolicy = (doc.skillPolicy ?? []).filter(
          (record) =>
            !(
              record.name === name &&
              record.source === source &&
              sameScope(record.scope, scope) &&
              (record.cwd ?? undefined) === cwd
            ),
        )
        if (command.state !== 'inherit') {
          doc.skillPolicy.push({
            name,
            source,
            scope: cloneScope(scope),
            ...(cwd ? { cwd } : {}),
            state: command.state,
          })
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
      skillPolicy: [...(workspace?.skillPolicy ?? []), ...global.skillPolicy],
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
    const text = typeof skill.text === 'string' ? skill.text : ''
    const next: SkillRecord = {
      ...skill,
      name: normalizeSkillName(skill.name) || skill.name,
      scope: scope.kind,
      wsId: scope.kind === 'workspace' ? scope.id ?? undefined : undefined,
      bytes: Buffer.byteLength(text, 'utf8'),
      model: Boolean(skill.model),
      user: Boolean(skill.user),
    }
    if (typeof skill.whenToUse === 'string' && skill.whenToUse.trim()) {
      next.whenToUse = skill.whenToUse.trim()
    } else {
      delete next.whenToUse
    }
    return next
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
