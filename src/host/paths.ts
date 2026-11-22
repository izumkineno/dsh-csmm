import path from 'node:path'

/** Absolute paths owned by one scope's store. */
export interface ScopePaths {
  root: string
  store: string
  secrets: string
  backups: string
  lock: string
}

export function scopePaths(root: string): ScopePaths {
  return {
    root,
    store: path.join(root, 'store.json'),
    secrets: path.join(root, 'secrets.json'),
    backups: path.join(root, 'backups'),
    lock: path.join(root, 'store.lock'),
  }
}

export function globalPaths(dshHome = process.env.DSH_HOME): ScopePaths {
  if (!dshHome) throw new Error('DSH_HOME is not set')
  return scopePaths(path.join(dshHome, 'dsh-csmm'))
}

export function workspacePaths(workspaceRoot: string, workspaceId: string): ScopePaths {
  if (!workspaceRoot) throw new Error('workspace root is required')
  if (!workspaceId) throw new Error('workspace id is required')
  return scopePaths(path.join(workspaceRoot, '.dsh', workspaceId))
}
