import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRemoteHost, HostError, requestRpc } from '../../src/client/hostPort'
import type { Snapshot } from '../../src/shared/types'

type FetchCall = { url: string; init: RequestInit; body: Record<string, unknown> }

function snapshot(): Snapshot {
  return {
    revision: 0,
    diagnostics: [],
    bootstrap: {
      workspaces: [],
      sections: [],
      skills: [],
      servers: [],
      groups: [],
      customs: [],
      activeGroup: {},
      disabledPrompts: [],
      copy: {
        skillDir: '',
        refreshServers: '',
        newSkillText: '',
        newSkillDesc: '',
        oauthOn: '',
        oauthOff: '',
        serverSaved: '',
        rawSaved: '',
        formTesting: '',
        restart: '',
        configEdit: '',
        toolSaved: '',
        appTag: '',
        scopeHint: '',
      },
    },
  }
}

function stubFetch(t: { after(fn: () => void): void }, response: () => Response): FetchCall[] {
  const calls: FetchCall[] = []
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      init: init ?? {},
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    })
    return response()
  }
  t.after(() => {
    globalThis.fetch = original
  })
  return calls
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('requestRpc returns the host payload on 200', async (t) => {
  const calls = stubFetch(t, () => json(200, { ok: true, snapshot: snapshot() }))
  const result = await requestRpc({ method: 'snapshot', scope: { kind: 'global' } })
  assert.equal(result.snapshot?.revision, 0)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/dsh-csmm/rpc')
  assert.equal(calls[0].body.method, 'snapshot')
})

test('requestRpc preserves host error code and status', async (t) => {
  for (const status of [400, 403, 409, 423]) {
    stubFetch(t, () => json(status, {
      ok: false,
      error: { code: `E_${status}`, message: `failed-${status}` },
    }))
    await assert.rejects(
      () => requestRpc({ method: 'skillSourceSave' }),
      (error: unknown) => error instanceof HostError
        && error.code === `E_${status}`
        && error.status === status
        && error.message === `failed-${status}`,
    )
  }
})

test('requestRpc maps a non-JSON failure to E_HTTP', async (t) => {
  stubFetch(t, () => new Response('bad gateway', { status: 502 }))
  await assert.rejects(
    () => requestRpc({ method: 'snapshot' }),
    (error: unknown) => error instanceof HostError
      && error.code === 'E_HTTP'
      && error.status === 502
      && error.message === 'bad gateway',
  )
})

test('requestRpc treats body.ok=false as a host error', async (t) => {
  stubFetch(t, () => json(200, { ok: false, error: { code: 'E_SCHEMA', message: 'bad shape' } }))
  await assert.rejects(
    () => requestRpc({ method: 'snapshot' }),
    (error: unknown) => error instanceof HostError && error.code === 'E_SCHEMA' && error.status === 200,
  )
})

test('saveDshSkillSource sends the workspace scope and returns saved', async (t) => {
  const calls = stubFetch(t, () => json(200, {
    ok: true,
    saved: { path: 'E:/repo/skills/edit/SKILL.md', sha256: 'a'.repeat(64) },
  }))
  const host = createRemoteHost(snapshot(), 'E:/repo')
  const saved = await host.saveDshSkillSource('edit', 'TEXT', 'b'.repeat(64), {
    kind: 'workspace',
    id: 'ws-1',
  })
  assert.equal(saved.path, 'E:/repo/skills/edit/SKILL.md')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].body.method, 'skillSourceSave')
  assert.equal(calls[0].body.workspaceRoot, 'E:/repo')
  assert.deepEqual(calls[0].body.scope, { kind: 'workspace', id: 'ws-1' })
  assert.equal(calls[0].body.skillName, 'edit')
  assert.equal(calls[0].body.text, 'TEXT')
  assert.equal(calls[0].body.expectedSha256, 'b'.repeat(64))
})

test('saveDshSkillSource rejects non-workspace scopes without a request', async (t) => {
  const calls = stubFetch(t, () => json(200, {}))
  const host = createRemoteHost(snapshot(), 'E:/repo')
  await assert.rejects(
    () => host.saveDshSkillSource('edit', 'TEXT', 'b'.repeat(64), { kind: 'global' }),
    (error: unknown) => error instanceof HostError && error.code === 'E_PAYLOAD',
  )
  assert.equal(calls.length, 0)
})

test('saveDshSkillSource rejects a response without saved', async (t) => {
  stubFetch(t, () => json(200, { ok: true }))
  const host = createRemoteHost(snapshot(), 'E:/repo')
  await assert.rejects(
    () => host.saveDshSkillSource('edit', 'TEXT', 'b'.repeat(64), { kind: 'workspace', id: 'ws-1' }),
    (error: unknown) => error instanceof HostError && error.code === 'E_PROTOCOL',
  )
})
