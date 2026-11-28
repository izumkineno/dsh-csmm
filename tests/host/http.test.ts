import assert from 'node:assert/strict'
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

test('unknown methods and missing commands are rejected', async () => {
  const service = makeService()
  const unknown = await handleRpc(deps(service), { method: 'nope' } as unknown as RpcRequest)
  assert.equal(unknown.status, 400)

  const missing = await handleRpc(deps(service), { method: 'dispatch' })
  assert.equal(missing.status, 400)
  const body = missing.body as { ok: boolean; error: { code: string } }
  assert.equal(body.error.code, 'E_PAYLOAD')
})
