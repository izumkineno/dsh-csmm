import { useEffect, useRef } from 'react'
import { useAppViewModel } from '../viewmodel/useAppViewModel'
import DetailView from './components/DetailView'
import ErrorBoundary from './components/ErrorBoundary'
import GroupEditor from './components/GroupEditor'
import ItemList from './components/ItemList'
import McpPane from './components/McpPane'
import Modals from './components/Modals'
import PageTabs from './components/PageTabs'
import Preview from './components/Preview'
import PromptPane from './components/PromptPane'
import ScopeRail from './components/ScopeRail'
import SkillPane from './components/SkillPane'
import Toast from './components/Toast'
import TopBar from './components/TopBar'

function EmptyEditor({ hint }: { hint: string }) {
  return (
    <>
      <div className="editor-head"></div>
      <div className="editor-body"><div className="empty">{hint}</div></div>
      <div className="editor-foot"></div>
    </>
  )
}

function Editor() {
  const { state } = useAppViewModel()
  if (state.detail) return <DetailView />
  if (state.tab === 'skill') return <SkillPane />
  if (state.tab === 'mcp') return <McpPane />
  if (state.tab === 'prompt') return <PromptPane />
  const group = state.active.kind === 'group'
    ? state.groups.find((g) => g.id === state.active.id)
    : undefined
  return group
    ? <GroupEditor g={group} />
    : <EmptyEditor hint="左侧选择配置集，或新建配置集。" />
}

export default function App() {
  const { state, actions } = useAppViewModel()
  const scopeCount = 1 + state.meta.workspaces.length
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (state.dshPromptsState === 'idle') actions.loadDshPrompts()
  }, [state.dshPromptsState, actions])
  useEffect(() => {
    if (state.catalog.status === 'idle') actions.loadDshSkills()
  }, [state.catalog.status, actions])
  useEffect(() => {
    mainRef.current?.focus()
  }, [state.detail, state.tab, state.active.kind, state.active.id])
  return (
    <div className="app">
      <TopBar />
      <PageTabs />
      <div className="body">
        <nav className="col" aria-label="作用域">
          <div className="col-head">作用域 <span className="count">{scopeCount}</span></div>
          <div className="scroll"><ErrorBoundary><ScopeRail /></ErrorBoundary></div>
          <div className="rail-foot">全局定义可被工作区同名定义覆盖。</div>
        </nav>
        <nav className="col" aria-label="列表"><ErrorBoundary><ItemList /></ErrorBoundary></nav>
        <main className="col" aria-label="编辑" ref={mainRef} tabIndex={-1}><ErrorBoundary><Editor /></ErrorBoundary></main>
        <aside className="col" aria-label="生效预览"><ErrorBoundary><Preview /></ErrorBoundary></aside>
      </div>
      <Toast />
      <Modals />
    </div>
  )
}
