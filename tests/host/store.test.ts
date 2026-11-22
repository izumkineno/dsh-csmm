import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { globalPaths, scopePaths, workspacePaths } from '../../src/host/paths'
import {
  StoreError,
  acquireLock,
  emptyStore,
  loadSecrets,
  loadStore,
  saveSecrets,
  saveStore,
  withLock,
} from '../../src/host/store'

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-'))
}

test('paths build the two owned roots', () => {
  const home = path.join('C:', 'dsh-home')
  assert.equal(globalPaths(home).root, path.join(home, 'dsh-csmm'))
  assert.equal(
    workspacePaths('C:\\repo', 'ws-1').root,
    path.join('C:\\repo', '.dsh', 'ws-1'),
  )
  assert.equal(scopePaths('C:\\root').store, path.join('C:\\root', 'store.json'))
})

test('store loads an empty document when missing and increments revision', () => {
  const root = tempRoot()
  const paths = scopePaths(root)
  assert.equal(loadStore(paths).revision, 0)

  const first = saveStore(paths, emptyStore())
  assert.equal(first.revision, 1)
  assert.equal(loadStore(paths).revision, 1)

  const second = saveStore(paths, first, 1)
  assert.equal(second.revision, 2)
  assert.equal(loadStore(paths).revision, 2)
})

test('save rejects a stale expectedRevision', () => {
  const root = tempRoot()
  const paths = scopePaths(root)
  const doc = saveStore(paths, emptyStore())
  assert.throws(
    () => saveStore(paths, doc, 0),
    (error: unknown) => error instanceof StoreError && error.code === 'E_REVISION',
  )
})

test('overwriting creates a backup and keeps at most ten', () => {
  const root = tempRoot()
  const paths = scopePaths(root)
  let doc = saveStore(paths, emptyStore())
  for (let i = 0; i < 12; i += 1) doc = saveStore(paths, doc, doc.revision)
  const backups = fs.readdirSync(paths.backups)
  assert.ok(backups.length <= 10)
  assert.ok(backups.length >= 1)
  const revisions = backups
    .map((name) => JSON.parse(fs.readFileSync(path.join(paths.backups, name), 'utf8')) as { revision: number })
    .map((entry) => entry.revision)
  assert.ok(Math.max(...revisions) < doc.revision)
})

test('lock is exclusive and reusable after release', () => {
  const root = tempRoot()
  const paths = scopePaths(root)
  const release = acquireLock(paths)
  assert.throws(
    () => acquireLock(paths),
    (error: unknown) => error instanceof StoreError && error.code === 'E_LOCKED',
  )
  release()

  const value = withLock(paths, () => 42)
  assert.equal(value, 42)
  assert.equal(fs.existsSync(paths.lock), false)
})

test('secrets are stored separately and normalize missing data', () => {
  const root = tempRoot()
  const paths = scopePaths(root)
  assert.deepEqual(loadSecrets(paths), { schemaVersion: 1, servers: {} })

  saveSecrets(paths, { schemaVersion: 1, servers: { s: { env: { A: '1' }, headers: {} } } })
  const loaded = loadSecrets(paths)
  assert.equal(loaded.servers.s.env.A, '1')
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(paths.secrets).mode & 0o777, 0o600)
  }
})
