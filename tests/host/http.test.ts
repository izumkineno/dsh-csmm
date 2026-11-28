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

test('skillScan returns the scanned DSH roots and skills', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-http-scan-'))
  const home = path.join(root, 'home')
  const global = scopePaths(path.join(root, 'global'))
  const dir = path.join(home, 'skills', 'http-one')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: http-one\ndescription: HTTP 技能\n---\nbody')
  const service = new CsmmService({ global, home })

  const result = await handleRpc(deps(service), {
    method: 'skillScan',
    scope: { kind: 'global' },
  })
  assert.equal(result.status, 200)
  const body = result.body as {
    ok: boolean
    scan: { roots: Array<{ path: string; exists: boolean; count: number }>; skills: Array<{ name: string; desc: string }> }
  }
  assert.equal(body.ok, true)
  assert.equal(body.scan.roots.length, 1)
  assert.equal(body.scan.roots[0].exists, true)
  assert.equal(body.scan.roots[0].count, 1)
  assert.deepEqual(body.scan.skills.map((s) => s.name), ['http-one'])
  assert.equal(body.scan.skills[0].desc, 'HTTP 技能')
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
