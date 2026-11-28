import type { AppState, HostPort } from '../contracts'

export interface SyncFailure {
  index: number
  command: string
  error: string
}

export interface SyncResult {
  applied: number
  failed: SyncFailure[]
  scopeChanged: boolean
}

export interface SyncOptions {
  continueOnError?: boolean
}

/** actions 工厂共享的运行时依赖；状态始终从 ref 读最新值。 */
export interface ActionContext {
  getState(): AppState
  mutate(fn: (s: AppState) => void): void
  host: HostPort
  sync(command: Record<string, unknown>): void
  syncMany(commands: Record<string, unknown>[], opts?: SyncOptions): Promise<SyncResult>
  pushToast(s: AppState, msg: string, label?: string, fn?: () => void, ttl?: number): number
  toast(msg: string): void
}
