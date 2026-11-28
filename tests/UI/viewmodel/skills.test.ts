import test from 'node:test'
import assert from 'node:assert/strict'
import type {
  AppState,
  Bootstrap,
  CopyStrings,
  DshSkill,
  DshSkillDetail,
  Group,
  HostPort,
  Scope,
  Skill,
} from '../../../src/UI/contracts'
import { createResourceActions } from '../../../src/UI/viewmodel/actions/resources'
import type { ActionContext, SyncResult } from '../../../src/UI/viewmodel/action-context'
import { cloneState, makeInitialState } from '../../../src/UI/viewmodel/state'
import { selectors } from '../../../src/UI/model/selectors'

const GLOBAL: Scope = { kind: 'global', id: null }
const WORKSPACE: Scope = { kind: 'workspace', id: 'ws-1' }
const HASH_OLD = 'a'.repeat(64)
const HASH_NEW = 'b'.repeat(64)

const globalSkill = (overrides: Partial<Skill> = {}): Skill => ({
  name: 'alpha',
  label: 'Alpha',
  scope: 'global',
  bytes: 10,
  model: true,
  user: true,
  desc: 'desc',
  text: 'BODY',
  enabled: true,
  ...overrides,
})

const workspaceGroup = (): Group => ({
  id: 'g1',
  name: '本地组',
  scope: WORKSPACE,
  enabled: true,
  items: [],
})

const globalGroup = (): Group => ({
  id: 'gg',
  name: '全局组',
  scope: GLOBAL,
  enabled: true,
  items: [],
})

function makeState(scope: Scope, skills: Skill[] = [], groups: Group[] = [], activeGroup: Record<string, string> = {}): AppState {
  const bootstrap: Bootstrap = {
    workspaces: [{ id: 'ws-1', title: 'repo', path: 'E:/repo', trusted: true, current: true }],
    sections: [],
    skills,
    servers: [],
    groups,
    customs: [],
    activeGroup,
    disabledPrompts: [],
    copy: {} as CopyStrings,
  }
  const state = makeInitialState(bootstrap)
  state.scope = { ...scope }
  return state
}

function dshGlobal(overrides: Partial<DshSkill> = {}): DshSkill {
  return {
    name: 'alpha',
    description: 'dsh alpha',
    source: 'oh-my-dsh',
    provider: 'oh-my-dsh',
    model: true,
    user: true,
    origin: 'global',
    ...overrides,
  }
}

function dshDetail(overrides: Partial<DshSkillDetail> = {}): DshSkillDetail {
  return { ...dshGlobal(), content: 'BODY', raw: '---\nname: alpha\n---\n\nBODY', sha256: HASH_OLD, ...overrides }
}

interface HarnessOptions {
  readonly syncMany?: (commands: Record<string, unknown>[], opts?: { continueOnError?: boolean }) => Promise<SyncResult>
  readonly getDshSkill?: (name: string, scope?: Scope) => Promise<{ skill?: DshSkillDetail; errors: string[] }>
  readonly saveDshSkillSource?: (name: string, text: string, expected: string, scope: Scope) => Promise<{ path: string; sha256: string }>
}

function harness(initial: AppState, options: HarnessOptions = {}) {
  let state = initial
  const commands: Record<string, unknown>[] = []
  const syncOptions: Array<{ continueOnError?: boolean } | undefined> = []
  const host: HostPort = {
    bootstrap: () => ({
      workspaces: [{ id: 'ws-1', title: 'repo', path: 'E:/repo', trusted: true, current: true }],
      sections: [],
      skills: [],
      servers: [],
      groups: [],
      customs: [],
      activeGroup: {},
      disabledPrompts: [],
      copy: {} as CopyStrings,
    }),
    testConnection: async () => ({ status: 'connected', tools: [], message: '', toast: '' }),
    getDshSkill: options.getDshSkill,
    saveDshSkillSource: options.saveDshSkillSource,
  }
  const mutate = (fn: (s: AppState) => void) => {
    const next = cloneState(state)
    fn(next)
    state = next
  }
  const toast = (message: string) => mutate((s) => {
    s.toasts.push({ id: s.toasts.length + 1, msg: message })
  })
  const ctx: ActionContext = {
    getState: () => state,
    mutate,
    host,
    sync: (command) => { commands.push(command) },
    syncMany: async (list, opts) => {
      commands.push(...list)
      syncOptions.push(opts)
      if (options.syncMany) return options.syncMany(list, opts)
      return { applied: list.length, failed: [], scopeChanged: false }
    },
    pushToast: (s, message, label) => {
      const id = s.toasts.length + 1
      s.toasts.push({ id, msg: message, undoLabel: label })
      return id
    },
    toast,
  }
  return {
    actions: createResourceActions(ctx),
    get state() { return state },
    commands,
    syncOptions,
  }
}

function fileAt(path: string, text: string): File {
  const file = {
    name: path.split('/').pop() as string,
    size: Buffer.byteLength(text, 'utf8'),
    webkitRelativePath: path,
    text: async () => text,
  }
  return file as unknown as File
}

test('setSkillDraft merges, marks dirty and revert drops the draft', () => {
  const h = harness(makeState(GLOBAL, [globalSkill()]))
  h.actions.setSkillDraft('alpha', { label: 'Alpha 2', text: 'NEW' })
  assert.deepEqual(h.state.skillDrafts.alpha, {
    label: 'Alpha 2', desc: 'desc', text: 'NEW', model: true, user: true,
  })
  assert.equal(selectors.skillDirty(h.state, 'alpha'), true)
  h.actions.revertSkill('alpha')
  assert.equal(h.state.skillDrafts.alpha, undefined)
  assert.equal(selectors.skillDirty(h.state, 'alpha'), false)
})

test('saveSkill sends the draft text for a local skill and clears it on success', async () => {
  const h = harness(makeState(GLOBAL, [globalSkill()]))
  h.actions.setSkillDraft('alpha', { label: 'Changed', text: 'NEW BODY', model: false })
  await h.actions.saveSkill('alpha')
  assert.equal(h.commands.length, 1)
  const command = h.commands[0] as { type: string; scope: Scope; skill: Skill }
  assert.equal(command.type, 'skill.save')
  assert.deepEqual(command.scope, GLOBAL)
  assert.equal(command.skill.label, 'Changed')
  assert.equal(command.skill.text, 'NEW BODY')
  assert.equal(command.skill.model, false)
  assert.equal(command.skill.bytes, Buffer.byteLength('NEW BODY', 'utf8'))
  assert.equal(h.state.skillDrafts.alpha, undefined)
})

test('saveSkill in a workspace creates a workspace override instead of writing global', async () => {
  const h = harness(makeState(WORKSPACE, [globalSkill()]))
  h.actions.setSkillDraft('alpha', { text: 'WS BODY' })
  await h.actions.saveSkill('alpha')
  const command = h.commands[0] as { scope: Scope; skill: Skill }
  assert.deepEqual(command.scope, WORKSPACE)
  assert.equal(command.skill.scope, 'workspace')
  assert.equal(command.skill.wsId, 'ws-1')
  assert.equal(command.skill.text, 'WS BODY')
  assert.equal(h.state.skills.filter((skill) => skill.scope === 'global' && skill.name === 'alpha').length, 1)
  assert.equal(h.state.skills.filter((skill) => skill.scope === 'workspace' && skill.name === 'alpha').length, 1)
})

test('addSkillsFromFiles parses directory skills and continues after a failed save', async () => {
  const h = harness(makeState(WORKSPACE), {
    syncMany: async (list) => ({
      applied: list.length - 1,
      failed: [{ index: 0, command: 'skill.save', error: 'boom' }],
      scopeChanged: false,
    }),
  })
  const files = [
    fileAt('alpha/SKILL.md', '---\nname: alpha\ndescription: A\n---\n\nA BODY'),
    fileAt('beta/SKILL.md', '---\nname: beta\ndescription: B\n---\n\nB BODY'),
  ]
  await h.actions.addSkillsFromFiles(files, true)
  assert.equal(h.commands.length, 2)
  assert.equal(h.syncOptions[0]?.continueOnError, true)
  const first = h.commands[0] as { scope: Scope; skill: Skill }
  assert.deepEqual(first.scope, WORKSPACE)
  assert.equal(first.skill.text, 'A BODY')
  assert.equal(h.state.selected.skill?.kind === 'skill' ? h.state.selected.skill.name : null, 'beta')
  assert.ok(h.state.toasts.some((item) => item.msg.includes('已添加 1 个技能')))
  assert.ok(h.state.toasts.some((item) => item.msg.includes('失败 1 个')))
})

test('addSkillsFromFiles skips an existing same-scope skill', async () => {
  const h = harness(makeState(WORKSPACE, [globalSkill({ scope: 'workspace', wsId: 'ws-1' })]))
  await h.actions.addSkillsFromFiles([fileAt('alpha/SKILL.md', '---\nname: alpha\n---\n\nBODY')], true)
  assert.equal(h.commands.length, 0)
  assert.ok(h.state.toasts.some((item) => item.msg.includes('跳过 1 个同名')))
})

test('copyDshSkillToWorkspace saves, adds to the local group and selects the copy', async () => {
  const state = makeState(WORKSPACE, [], [workspaceGroup()], { 'workspace:ws-1': 'g1' })
  state.catalog = {
    status: 'ready',
    result: { scannedAt: '', skills: [dshGlobal()], errors: [] },
    error: null,
  }
  const h = harness(state, { getDshSkill: async () => ({ skill: dshDetail(), errors: [] }) })
  await h.actions.copyDshSkillToWorkspace('alpha')
  assert.equal(h.commands.length, 2)
  const save = h.commands[0] as { type: string; scope: Scope; skill: Skill }
  const group = h.commands[1] as { type: string; group: Group }
  assert.equal(save.type, 'skill.save')
  assert.equal(save.skill.name, 'alpha')
  assert.equal(save.skill.scope, 'workspace')
  assert.equal(group.type, 'group.save')
  assert.deepEqual(group.group.items, [{ kind: 'skill', name: 'alpha' }])
  assert.equal(h.state.selected.skill?.kind === 'skill' ? h.state.selected.skill.name : null, 'alpha')
})

test('copyDshSkillToWorkspace does not fork an inherited global group', async () => {
  const state = makeState(WORKSPACE, [], [globalGroup()], { 'workspace:ws-1': 'gg' })
  state.catalog = {
    status: 'ready',
    result: { scannedAt: '', skills: [dshGlobal()], errors: [] },
    error: null,
  }
  const h = harness(state, { getDshSkill: async () => ({ skill: dshDetail(), errors: [] }) })
  await h.actions.copyDshSkillToWorkspace('alpha')
  assert.equal(h.commands.length, 1)
  assert.equal((h.commands[0] as { type: string }).type, 'skill.save')
  assert.ok(h.state.toasts.some((item) => item.msg.includes('继承自全局')))
})

test('copyDshSkillToWorkspace reports group append failure without deleting the skill', async () => {
  const state = makeState(WORKSPACE, [], [workspaceGroup()], { 'workspace:ws-1': 'g1' })
  state.catalog = {
    status: 'ready',
    result: { scannedAt: '', skills: [dshGlobal()], errors: [] },
    error: null,
  }
  const h = harness(state, {
    getDshSkill: async () => ({ skill: dshDetail(), errors: [] }),
    syncMany: async (list) => ({
      applied: list.length,
      failed: list.some((command) => command.type === 'group.save')
        ? [{ index: 0, command: 'group.save', error: 'disk full' }]
        : [],
      scopeChanged: false,
    }),
  })
  await h.actions.copyDshSkillToWorkspace('alpha')
  assert.equal(h.commands.length, 2)
  assert.equal((h.commands[0] as { type: string }).type, 'skill.save')
  assert.ok(h.state.toasts.some((item) => item.msg.includes('技能已保存，但加入配置集失败')))
  assert.ok(h.state.toasts.some((item) => item.undoLabel === '重试加入配置集'))
})

test('copyDshSkillToWorkspace rolls back when the source hash changes', async () => {
  const state = makeState(WORKSPACE)
  state.catalog = {
    status: 'ready',
    result: { scannedAt: '', skills: [dshGlobal()], errors: [] },
    error: null,
  }
  state.dshDoc = { status: 'ready', name: 'alpha', detail: dshDetail() }
  const h = harness(state, { getDshSkill: async () => ({ skill: dshDetail({ sha256: HASH_NEW }), errors: [] }) })
  await h.actions.copyDshSkillToWorkspace('alpha')
  assert.equal(h.commands.length, 2)
  assert.equal((h.commands[0] as { type: string }).type, 'skill.save')
  assert.equal((h.commands[1] as { type: string }).type, 'skill.delete')
  assert.ok(h.state.toasts.some((item) => item.msg.includes('已撤销副本')))
})

test('saveDshSkillSource keeps raw text and records a conflict', async () => {
  const state = makeState(WORKSPACE)
  state.dshDoc = { status: 'ready', name: 'alpha', detail: dshDetail({ origin: 'workspace' }) }
  const h = harness(state, {
    saveDshSkillSource: async () => {
      const error = new Error('源文件已变更（当前 ' + HASH_NEW + '），请重新载入后再保存') as Error & { code: string }
      error.code = 'E_SKILL_CONFLICT'
      throw error
    },
  })
  await h.actions.saveDshSkillSource('alpha', 'EDITED')
  assert.equal(h.state.sourceState.status, 'conflict')
  assert.equal(h.state.sourceState.raw, 'EDITED')
  assert.equal(h.state.sourceState.sha256, HASH_OLD)
  assert.equal(h.state.sourceState.conflictSha, HASH_NEW)
  assert.ok(h.state.toasts.some((item) => item.msg.includes('保存源文件失败')))
})
