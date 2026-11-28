import type { AppState, HostPort } from '../contracts'
import { scopeKey } from '../model/selectors'
import type { SyncOptions, SyncResult } from './action-context'
import { applyBootstrap } from './state'

export interface CommitRuntime {
  host: HostPort
  getState(): AppState
  setState(updater: (prev: AppState) => AppState): void
  toast(message: string): void
  workspaceRoot(state: AppState): string | undefined
}

/** 顺序提交多条写命令；全部结束后只在作用域未变时刷新一次读模型。 */
export async function commitCommands(
  runtime: CommitRuntime,
  commands: Record<string, unknown>[],
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const result: SyncResult = { applied: 0, failed: [], scopeChanged: false }
  const state = runtime.getState()
  const root = runtime.workspaceRoot(state)
  const scope = { ...state.scope }
  const key = scopeKey(scope)
  if (!runtime.host.send) {
    commands.forEach((command, index) => {
      result.failed.push({ index, command: JSON.stringify(command), error: '宿主未提供写入接口' })
    })
    return result
  }
  const send = runtime.host.send
  for (let i = 0; i < commands.length; i += 1) {
    const command = commands[i]
    try {
      await send(command, root ?? '')
      result.applied += 1
    } catch (err: unknown) {
      result.failed.push({
        index: i,
        command: JSON.stringify(command),
        error: err instanceof Error ? err.message : String(err),
      })
      if (!opts.continueOnError) break
    }
  }
  if (runtime.host.load) {
    if (scopeKey(runtime.getState().scope) !== key) {
      result.scopeChanged = true
      return result
    }
    try {
      const bootstrap = await runtime.host.load(scope, root ?? '')
      runtime.setState((prev) => (scopeKey(prev.scope) === key ? applyBootstrap(prev, bootstrap) : prev))
      if (scopeKey(runtime.getState().scope) !== key) result.scopeChanged = true
    } catch (err: unknown) {
      runtime.toast('读取作用域失败：' + (err instanceof Error ? err.message : String(err)))
    }
  }
  return result
}
