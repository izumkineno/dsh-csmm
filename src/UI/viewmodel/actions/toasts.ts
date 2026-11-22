import type { Actions } from '../../contracts'
import type { ActionContext } from '../action-context'

export function createToastActions(ctx: ActionContext): Pick<Actions, 'removeToast' | 'runToastUndo'> {
  const { mutate } = ctx
  return {
    removeToast(id) { mutate((s) => { s.toasts = s.toasts.filter((t) => t.id !== id) }) },
    runToastUndo(t) { if (t.undo) t.undo(); mutate((s) => { s.toasts = s.toasts.filter((x) => x.id !== t.id) }) },
  }
}
