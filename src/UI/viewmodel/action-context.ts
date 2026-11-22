import type { AppState, HostPort } from '../contracts'

/** actions 工厂共享的运行时依赖；状态始终从 ref 读最新值。 */
export interface ActionContext {
  getState(): AppState
  mutate(fn: (s: AppState) => void): void
  host: HostPort
  sync(command: Record<string, unknown>): void
  pushToast(s: AppState, msg: string, label?: string, fn?: () => void, ttl?: number): number
  toast(msg: string): void
}
