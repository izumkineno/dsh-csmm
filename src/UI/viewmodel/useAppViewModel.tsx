// 视图模型：把领域状态包装成视图可直接绑定的状态 + 命令。
// 依赖方向只有一个：view -> viewmodel -> contracts/selectors；宿主由组合根注入。
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Actions, AppState, AppViewModel, HostPort, Scope, ToastItem } from '../contracts'
import { sameScope, scopeKey, selectors } from '../model/selectors'
import type { ActionContext } from './action-context'
import { createLibraryActions } from './actions/library'
import { createModalActions } from './actions/modals'
import { createNavigationActions } from './actions/navigation'
import { createResourceActions } from './actions/resources'
import { createToastActions } from './actions/toasts'
import { applyBootstrap, cloneState, makeInitialState } from './state'

const ViewModelContext = createContext<AppViewModel | null>(null)

export function useAppViewModel(): AppViewModel {
  const vm = useContext(ViewModelContext)
  if (!vm) throw new Error('useAppViewModel must be used within AppViewModelProvider')
  return vm
}

export function AppViewModelProvider({ host, children }: { host: HostPort; children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => makeInitialState(host.bootstrap()))
  const stateRef = useRef(state)
  stateRef.current = state
  const seq = useRef(0)

  const mutate = useCallback((fn: (s: AppState) => void) => {
    setState((prev) => {
      const next = cloneState(prev)
      fn(next)
      return next
    })
  }, [])

  const actions = useMemo<Actions>(() => {
    const pushToast = (s: AppState, msg: string, label?: string, fn?: () => void, ttl = 3000): number => {
      const id = ++seq.current
      s.toasts.push({ id, msg, undoLabel: label, undo: fn })
      setTimeout(() => mutate((p) => { p.toasts = p.toasts.filter((t) => t.id !== id) }), ttl)
      return id
    }
    const toast = (msg: string) => mutate((s) => { pushToast(s, msg) })

    const workspaceRoot = (s: AppState): string | undefined =>
      s.scope.kind === 'workspace'
        ? s.meta.workspaces.find((w) => w.id === s.scope.id)?.path
        : undefined

    /** 提交写命令，然后用宿主读模型刷新；失败时保留本地状态并提示。 */
    const sync = (command: Record<string, unknown>) => {
      if (!host.send) return
      const s = stateRef.current
      const root = workspaceRoot(s)
      const scope = { ...s.scope }
      void host
        .send(command, root ?? '')
        .then(async () => {
          if (!host.load) return
          const bootstrap = await host.load(scope, root ?? '')
          setState((prev) => applyBootstrap(prev, bootstrap))
        })
        .catch((err: unknown) => {
          toast('保存失败：' + (err instanceof Error ? err.message : String(err)))
        })
    }

    const ctx: ActionContext = {
      getState: () => stateRef.current,
      mutate,
      host,
      sync,
      pushToast,
      toast,
    }

    return {
      setScope(scope: Scope) {
        mutate((s) => {
          s.scope = { ...scope }
          s.detail = null
          s.sel = { skill: null, mcp: null }
          const gid = s.activeGroup[scopeKey(scope)]
          s.active = { kind: 'group', id: gid && s.groups.some((g) => g.id === gid && sameScope(g.scope, scope)) ? gid : null }
          if (scope.kind === 'workspace' && scope.id) {
            const ws = s.meta.workspaces.find((w) => w.id === scope.id)
            if (ws && ws.trusted === false && !s.trustDeclined.includes(ws.id) && !s.modal) {
              s.modal = { type: 'workspaceTrust', wsId: ws.id }
            }
          }
        })
        if (host.load) {
          const ws = stateRef.current.meta.workspaces.find((w) => w.id === scope.id)
          void host
            .load(scope, ws?.path ?? '')
            .then((bootstrap) => setState((prev) => applyBootstrap(prev, bootstrap)))
            .catch((err: unknown) => {
              toast('读取作用域失败：' + (err instanceof Error ? err.message : String(err)))
            })
        }
      },
      ...createNavigationActions(ctx),
      ...createLibraryActions(ctx),
      ...createResourceActions(ctx),
      ...createModalActions(ctx),
      ...createToastActions(ctx),
      toast,
      loadDshPrompts() {
        if (!host.listPrompts) {
          mutate((s) => {
            s.dshPromptsState = 'error'
            s.dshPromptsError = '宿主未提供提示词读取接口'
          })
          return
        }
        mutate((s) => {
          s.dshPromptsState = 'loading'
          s.dshPromptsError = null
        })
        void host
          .listPrompts()
          .then((prompts) => {
            setState((prev) => ({
              ...prev,
              dshPrompts: prompts,
              dshPromptsState: 'ready',
              dshPromptsError: null,
            }))
          })
          .catch((err: unknown) => {
            mutate((s) => {
              s.dshPromptsState = 'error'
              s.dshPromptsError = err instanceof Error ? err.message : String(err)
            })
          })
      },
      toggleDshPrompt(name, disabled) {
        if (!host.send) {
          toast('宿主未提供提示词写入接口')
          return
        }
        const s = stateRef.current
        const root = workspaceRoot(s)
        const scope = { ...s.scope }
        mutate((cur) => {
          const next = new Set(cur.disabledPrompts)
          if (disabled) next.add(name)
          else next.delete(name)
          cur.disabledPrompts = [...next].sort()
        })
        void host
          .send({ type: 'prompt.toggle', scope, name, disabled }, root ?? '')
          .then(async () => {
            if (!host.listPrompts) return
            const prompts = await host.listPrompts()
            setState((prev) => ({ ...prev, dshPrompts: prompts }))
          })
          .catch((err: unknown) => {
            toast('保存失败：' + (err instanceof Error ? err.message : String(err)))
          })
      },
    }
  }, [mutate, host])

  const value = useMemo<AppViewModel>(() => ({ state, actions, selectors }), [state, actions])

  return <ViewModelContext.Provider value={value}>{children}</ViewModelContext.Provider>
}
