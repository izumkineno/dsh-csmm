import { useAppViewModel } from '../../viewmodel/useAppViewModel'

export default function TopBar() {
  const { state } = useAppViewModel()
  return (
    <header className="topbar">
      <h1>系统提示词</h1>
      <span className="tag-draft">{state.copy.appTag}</span>
      <span className="spacer"></span>
      <span className="hint">{state.copy.scopeHint}</span>
    </header>
  )
}
