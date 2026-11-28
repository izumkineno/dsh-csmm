import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { handleRpc } from '../../src/host/http'
import { scopePaths } from '../../src/host/paths'
import { CsmmService } from '../../src/host/service'
import type { RpcRequest } from '../../src/shared/types'

function makeService(): CsmmService {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-http-'))
  const global = scopePaths(path.join(root, 'global'))
  return new CsmmService({
    global,
    workspaces: [{ id: 'ws-1', title: 'repo', path: path.join(root, 'repo'), trusted: false }],
  })
}

function deps(service: CsmmService) {
  return { service: async () => service }
}

test('snapshot returns ok with a snapshot body', async () => {
  const service = makeService()
  const result = await handleRpc(deps(service), {
    method: 'snapshot',
    scope: { kind: 'global' },
  })
  assert.equal(result.status, 200)
  const body = result.body as { ok: boolean; snapshot: { revision: number } }
  assert.equal(body.ok, true)
  assert.equal(body.snapshot.revision, 0)
})

test('dispatch applies a command and returns the new revision', async () => {
  const service = makeService()
  const request: RpcRequest = {
    method: 'dispatch',
    command: {
      type: 'group.none',
      scope: { kind: 'global' },
      expectedRevision: 0,
    },
  }
  const result = await handleRpc(deps(service), request)
  assert.equal(result.status, 200)
  const body = result.body as { ok: boolean; snapshot: { revision: number; bootstrap: { activeGroup: Record<string, string> } } }
  assert.equal(body.ok, true)
  assert.equal(body.snapshot.revision, 1)
  assert.equal(body.snapshot.bootstrap.activeGroup['global:'], '')
})

test('testConnection is honest when the host has no probe', async () => {
  const service = makeService()
  const result = await handleRpc(deps(service), {
    method: 'testConnection',
    server: {
      name: 'x',
      label: 'x',
      scope: 'global',
      status: 'disconnected',
      transport: 'stdio',
      tokens: 0,
      auth: 'none',
      tools: [],
      instructions: '',
    },
  })
  assert.equal(result.status, 200)
  const body = result.body as { ok: boolean; outcome: { status: string; message: string } }
  assert.equal(body.outcome.status, 'error')
  assert.match(body.outcome.message, /未提供/)
})

test('promptList returns the host assembly and degrades to empty', async () => {
  const service = makeService()
  const result = await handleRpc(
    { ...deps(service), promptList: async () => [{ name: 'p', text: 'hello', tokens: 2, kind: 'section' as const }] },
    { method: 'promptList' },
  )
  assert.equal(result.status, 200)
  const body = result.body as { ok: boolean; prompts: Array<{ name: string; tokens: number }> }
  assert.equal(body.ok, true)
  assert.deepEqual(body.prompts, [{ name: 'p', text: 'hello', tokens: 2, kind: 'section' }])

  const empty = await handleRpc(deps(service), { method: 'promptList' })
  assert.deepEqual((empty.body as { prompts: unknown[] }).prompts, [])
})

test('skillCatalog returns the DSH registry skills for the requested scope', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-http-scan-'))
  const global = scopePaths(path.join(root, 'global'))
  const calls: Array<{ cwd?: string }> = []
  const service = new CsmmService({
    global,
    registry: {
      list: async (options) => {
        calls.push(options)
        return [{
          name: 'http-one',
          description: 'HTTP 技能',
          whenToUse: '通过 HTTP 提供技能时',
          source: 'user-dsh',
          provider: 'filesystem',
          invocation: { modelInvocable: true, userInvocable: false },
        }]
      },
      get: async (name) => (name === 'http-one'
        ? {
            name: 'http-one',
            description: 'HTTP 技能',
            whenToUse: '通过 HTTP 提供技能时',
            source: 'user-dsh',
            provider: 'filesystem',
            invocation: { modelInvocable: true, userInvocable: false },
            content: '# HTTP 正文',
          }
        : undefined),
    },
  })

  const result = await handleRpc(deps(service), {
    method: 'skillCatalog',
    scope: { kind: 'global' },
  })
  assert.equal(result.status, 200)
  const body = result.body as {
    ok: boolean
    catalog: { skills: Array<{ name: string; description: string; model: boolean; user: boolean }> }
  }
  assert.equal(body.ok, true)
  assert.deepEqual(calls, [{}])
  assert.deepEqual(body.catalog.skills.map((s) => s.name), ['http-one'])
  assert.equal(body.catalog.skills[0].description, 'HTTP 技能')
  assert.equal(body.catalog.skills[0].model, true)
  assert.equal(body.catalog.skills[0].user, false)

  const detail = await handleRpc(deps(service), {
    method: 'skillDetail',
    skillName: 'http-one',
    scope: { kind: 'global' },
  })
  assert.equal(detail.status, 200)
  const detailBody = detail.body as { detail: { skill?: { name: string; content: string } } }
  assert.equal(detailBody.detail.skill?.name, 'http-one')
  assert.equal(detailBody.detail.skill?.content, '# HTTP 正文')

  const missing = await handleRpc(deps(service), { method: 'skillDetail' })
  assert.equal(missing.status, 400)
})


function skillSourceService(options: { globalSource?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-http-save-'))
  const workspaceRoot = path.join(root, 'repo')
  const file = path.join(workspaceRoot, '.dsh', 'skills', 'edit', 'SKILL.md')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const initial = '---\nname: edit\n---\n\nOLD'
  fs.writeFileSync(file, initial, 'utf8')
  const service = new CsmmService({
    global: scopePaths(path.join(root, 'global')),
    workspace: { id: 'ws-1', paths: scopePaths(path.join(root, 'state', 'ws-1')) },
    workspaces: [{ id: 'ws-1', title: 'repo', path: workspaceRoot, trusted: false }],
    workspaceRoot,
    registry: {
      list: async () => [],
      get: async (name) => (name === 'edit'
        ? {
            name: 'edit',
            description: 'edit',
            source: options.globalSource ? 'user-dsh' : 'project-dsh',
            provider: 'test',
            path: file,
            invocation: { modelInvocable: true, userInvocable: true },
            content: 'OLD',
          }
        : undefined),
    },
  })
  service.dispatch({ type: 'trust.set', workspaceId: 'ws-1', trusted: true })
  return { service, file, initial, root }
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

test('skillSourceSave validates the payload and maps errors to HTTP status codes', async () => {
  const fixture = skillSourceService()
  const scope = { kind: 'workspace' as const, id: 'ws-1' }
  const missing = await handleRpc(deps(fixture.service), {
    method: 'skillSourceSave',
    skillName: 'edit',
    scope,
    expectedSha256: sha256(fixture.initial),
  })
  assert.equal(missing.status, 400)
  assert.equal((missing.body as { error: { code: string } }).error.code, 'E_PAYLOAD')

  const conflict = await handleRpc(deps(fixture.service), {
    method: 'skillSourceSave',
    skillName: 'edit',
    scope,
    text: 'REPLACED',
    expectedSha256: '0'.repeat(64),
  })
  assert.equal(conflict.status, 409)
  assert.equal((conflict.body as { error: { code: string } }).error.code, 'E_SKILL_CONFLICT')
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), fixture.initial)
})

test('skillSourceSave writes a workspace source and returns the saved path', async () => {
  const fixture = skillSourceService()
  const next = '---\nname: edit\n---\n\nNEW'
  const result = await handleRpc(deps(fixture.service), {
    method: 'skillSourceSave',
    skillName: 'edit',
    scope: { kind: 'workspace', id: 'ws-1' },
    text: next,
    expectedSha256: sha256(fixture.initial),
  })
  assert.equal(result.status, 200)
  const body = result.body as { ok: boolean; saved: { path: string; sha256: string } }
  assert.equal(body.ok, true)
  assert.equal(body.saved.path, fixture.file)
  assert.equal(body.saved.sha256, sha256(next))
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), next)
})

test('skillSourceSave maps lock and missing sources to 423 and 404', async () => {
  const locked = skillSourceService()
  const lock = path.join(locked.root, 'state', 'ws-1', 'skill-source.lock')
  fs.mkdirSync(path.dirname(lock), { recursive: true })
  fs.writeFileSync(lock, 'held')
  const lockedResult = await handleRpc(deps(locked.service), {
    method: 'skillSourceSave',
    skillName: 'edit',
    scope: { kind: 'workspace', id: 'ws-1' },
    text: 'NEW',
    expectedSha256: sha256(locked.initial),
  })
  assert.equal(lockedResult.status, 423)
  assert.equal((lockedResult.body as { error: { code: string } }).error.code, 'E_LOCKED')

  const missing = skillSourceService()
  fs.unlinkSync(missing.file)
  const missingResult = await handleRpc(deps(missing.service), {
    method: 'skillSourceSave',
    skillName: 'edit',
    scope: { kind: 'workspace', id: 'ws-1' },
    text: 'NEW',
    expectedSha256: sha256(missing.initial),
  })
  assert.equal(missingResult.status, 404)
  assert.equal((missingResult.body as { error: { code: string } }).error.code, 'E_SOURCE_MISSING')
})

test('skillSourceSave refuses read-only sources with 403', async () => {
  const fixture = skillSourceService({ globalSource: true })
  const result = await handleRpc(deps(fixture.service), {
    method: 'skillSourceSave',
    skillName: 'edit',
    scope: { kind: 'workspace', id: 'ws-1' },
    text: 'NOPE',
    expectedSha256: sha256(fixture.initial),
  })
  assert.equal(result.status, 403)
  assert.equal((result.body as { error: { code: string } }).error.code, 'E_SOURCE_READONLY')
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), fixture.initial)
})

test('unknown methods and missing commands are rejected', async () => {
  const service = makeService()
  const unknown = await handleRpc(deps(service), { method: 'nope' } as unknown as RpcRequest)
  assert.equal(unknown.status, 400)

  const missing = await handleRpc(deps(service), { method: 'dispatch' })
  assert.equal(missing.status, 400)
  const body = missing.body as { ok: boolean; error: { code: string } }
  assert.equal(body.error.code, 'E_PAYLOAD')
})
