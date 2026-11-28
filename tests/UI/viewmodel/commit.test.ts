import test from 'node:test'
import assert from 'node:assert/strict'
import type { AppState, Bootstrap, CopyStrings, HostPort, Scope } from '../../../src/UI/contracts'
import { commitCommands } from '../../../src/UI/viewmodel/commit'
import { makeInitialState } from '../../../src/UI/viewmodel/state'

const GLOBAL: Scope = { kind: 'global', id: null }
const WORKSPACE: Scope = { kind: 'workspace', id: 'ws-1' }

function bootstrap(groups: Bootstrap['groups'] = []): Bootstrap {
  return {
    workspaces: [{ id: 'ws-1', title: 'repo', path: 'E:/repo', trusted: true, current: true }],
    sections: [],
    skills: [],
    servers: [],
    groups,
    customs: [],
    activeGroup: {},
    disabledPrompts: [],
    copy: {} as CopyStrings,
  }
}

function stateFor(scope: Scope = GLOBAL): AppState {
  const state = makeInitialState(bootstrap())
  state.scope = { ...scope }
  return state
}

function hostWith(send: (command: Record<string, unknown>) => void, load?: (scope: Scope) => Promise<Bootstrap>): HostPort {
  return {
    bootstrap: () => bootstrap(),
    testConnection: async () => ({ status: 'connected', tools: [], message: '', toast: '' }),
    send: async (command) => { send(command) },
    load: load ? async (scope) => load(scope) : undefined,
  }
}

test('commitCommands sends every command and reloads once', async () => {
  let state = stateFor()
  const sent: Record<string, unknown>[] = []
  let loads = 0
  const loaded = bootstrap([{ id: 'g2', name: '新组', scope: GLOBAL, enabled: true, items: [] }])
  const host = hostWith(() => undefined, async () => { loads += 1; return loaded })
  host.send = async (command) => { sent.push(command) }
  const result = await commitCommands({
    host,
    getState: () => state,
    setState: (updater) => { state = updater(state) },
    toast: (message) => { throw new Error(message) },
    workspaceRoot: () => undefined,
  }, [{ type: 'one' }, { type: 'two' }])
  assert.deepEqual(sent, [{ type: 'one' }, { type: 'two' }])
  assert.equal(loads, 1)
  assert.equal(state.groups.length, 1)
  assert.deepEqual(result, { applied: 2, failed: [], scopeChanged: false })
})

test('commitCommands does not apply a stale bootstrap after the scope changed', async () => {
  let state = stateFor(GLOBAL)
  const sent: Record<string, unknown>[] = []
  let loads = 0
  const host = hostWith(() => undefined, async () => { loads += 1; return bootstrap() })
  host.send = async (command) => {
    sent.push(command)
    state = { ...state, scope: { ...WORKSPACE } }
  }
  const result = await commitCommands({
    host,
    getState: () => state,
    setState: (updater) => { state = updater(state) },
    toast: (message) => { throw new Error(message) },
    workspaceRoot: () => 'E:/repo',
  }, [{ type: 'one' }])
  assert.equal(sent.length, 1)
  assert.equal(loads, 0)
  assert.equal(state.scope.kind, 'workspace')
  assert.equal(result.scopeChanged, true)
})
