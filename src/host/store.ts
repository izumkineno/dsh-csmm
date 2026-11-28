import fs from 'node:fs'
import path from 'node:path'
import type { SecretsDocument, StoreDocument } from '../shared/types'
import type { ScopePaths } from './paths'

export type StoreErrorCode =
  | 'E_SCHEMA'
  | 'E_PARSE'
  | 'E_LOCKED'
  | 'E_REVISION'
  | 'E_APPLY'

export class StoreError extends Error {
  readonly code: StoreErrorCode

  constructor(code: StoreErrorCode, message: string) {
    super(message)
    this.name = 'StoreError'
    this.code = code
  }
}

export function emptyStore(): StoreDocument {
  return {
    schemaVersion: 1,
    revision: 0,
    workspaces: [],
    activeGroup: {},
    groups: [],
    customs: [],
    skills: [],
    servers: [],
    disabledPrompts: [],
  }
}

export function emptySecrets(): SecretsDocument {
  return { schemaVersion: 1, servers: {} }
}

export function loadStore(paths: ScopePaths): StoreDocument {
  let raw: string
  try {
    raw = fs.readFileSync(paths.store, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore()
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new StoreError('E_PARSE', `cannot parse ${paths.store}`)
  }
  return normalizeStore(parsed, paths.store)
}

export function saveStore(
  paths: ScopePaths,
  document: StoreDocument,
  expectedRevision?: number,
): StoreDocument {
  const current = loadStore(paths)
  if (expectedRevision !== undefined && expectedRevision !== current.revision) {
    throw new StoreError(
      'E_REVISION',
      `revision conflict: expected ${expectedRevision}, current ${current.revision}`,
    )
  }
  const next: StoreDocument = { ...document, schemaVersion: 1, revision: current.revision + 1 }
  if (fs.existsSync(paths.store)) backupStore(paths)
  atomicWrite(paths.store, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

export function loadSecrets(paths: ScopePaths): SecretsDocument {
  let raw: string
  try {
    raw = fs.readFileSync(paths.secrets, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptySecrets()
    throw error
  }
  try {
    const parsed = JSON.parse(raw) as SecretsDocument
    return { schemaVersion: 1, servers: parsed.servers ?? {} }
  } catch {
    throw new StoreError('E_PARSE', `cannot parse ${paths.secrets}`)
  }
}

export function saveSecrets(paths: ScopePaths, document: SecretsDocument): void {
  atomicWrite(paths.secrets, `${JSON.stringify(document, null, 2)}\n`, 0o600)
}

export function backupStore(paths: ScopePaths): void {
  fs.mkdirSync(paths.backups, { recursive: true })
  const revision = loadStore(paths).revision
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = path.join(paths.backups, `store-${revision}-${stamp}.json`)
  fs.copyFileSync(paths.store, target)
  pruneBackups(paths.backups, 10)
}

export function withLock<T>(paths: ScopePaths, fn: () => T): T {
  return withFileLock(paths.lock, fn)
}

export function withFileLock<T>(lockFile: string, fn: () => T): T
export function withFileLock<T>(lockFile: string, fn: () => Promise<T>): Promise<T>
export function withFileLock<T>(lockFile: string, fn: () => T | Promise<T>): T | Promise<T> {
  const release = acquireFileLock(lockFile)
  try {
    const value = fn()
    if (value && typeof (value as Promise<T>).then === 'function') {
      return Promise.resolve(value).finally(release)
    }
    release()
    return value
  } catch (error) {
    release()
    throw error
  }
}

export function acquireLock(paths: ScopePaths): () => void {
  return acquireFileLock(paths.lock)
}

function acquireFileLock(lockFile: string): () => void {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true })
  let fd: number
  try {
    fd = fs.openSync(lockFile, 'wx')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new StoreError('E_LOCKED', `store is locked: ${lockFile}`)
    }
    throw error
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
  } finally {
    fs.closeSync(fd)
  }
  let released = false
  return () => {
    if (released) return
    released = true
    try {
      fs.unlinkSync(lockFile)
    } catch {
      /* already removed */
    }
  }
}

export function atomicWrite(file: string, data: string, mode = 0o644): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  let fd: number | undefined
  try {
    fd = fs.openSync(tmp, 'wx', mode)
    fs.writeFileSync(fd, data)
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(tmp, file)
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd)
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    throw error
  }
}

function pruneBackups(dir: string, keep: number): void {
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('store-') && name.endsWith('.json'))
    .map((name) => ({ name, time: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time)
  for (const file of files.slice(keep)) {
    fs.unlinkSync(path.join(dir, file.name))
  }
}

function normalizeStore(input: unknown, file: string): StoreDocument {
  if (!input || typeof input !== 'object') {
    throw new StoreError('E_SCHEMA', `${file}: store must be an object`)
  }
  const doc = input as Partial<StoreDocument>
  if (doc.schemaVersion !== 1) {
    throw new StoreError('E_SCHEMA', `${file}: unsupported schemaVersion`)
  }
  return {
    schemaVersion: 1,
    revision: typeof doc.revision === 'number' ? doc.revision : 0,
    workspaces: Array.isArray(doc.workspaces) ? doc.workspaces : [],
    activeGroup: doc.activeGroup && typeof doc.activeGroup === 'object' ? doc.activeGroup : {},
    groups: Array.isArray(doc.groups)
      ? doc.groups.map((group) => ({
          ...group,
          items: Array.isArray(group.items)
            ? group.items.filter(
                (item) => !(typeof item?.name === 'string' && item.name.startsWith('dsh-csmm:')),
              )
            : [],
        }))
      : [],
    customs: Array.isArray(doc.customs) ? doc.customs : [],
    skills: Array.isArray(doc.skills) ? doc.skills : [],
    servers: Array.isArray(doc.servers) ? doc.servers : [],
    disabledPrompts: Array.isArray(doc.disabledPrompts)
      ? doc.disabledPrompts.filter(
          (name): name is string => typeof name === 'string' && !name.startsWith('dsh-csmm:'),
        )
      : [],
  }
}
