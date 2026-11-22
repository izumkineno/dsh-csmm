import { useAppViewModel } from '../../viewmodel/useAppViewModel'

export default function Toast() {
  const { state, actions } = useAppViewModel()
  if (!state.toasts.length) return null
  return (
    <div id="toastHost">
      {state.toasts.map((t) => (
        <div className="toast" key={t.id}>
          <span>{t.msg}</span>
          {t.undoLabel && <button className="undo" onClick={() => actions.runToastUndo(t)}>{t.undoLabel}</button>}
          <button className="icon-btn" onClick={() => actions.removeToast(t.id)} aria-label="关闭">×</button>
        </div>
      ))}
    </div>
  )
}
