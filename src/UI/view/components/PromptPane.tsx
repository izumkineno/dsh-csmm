import { useAppViewModel } from '../../viewmodel/useAppViewModel'
import CustomEditor from './CustomEditor'
import GroupStatus from './GroupStatus'

const KIND_LABEL = { section: '提示词段', context: '运行上下文', tool: '工具定义' } as const

export default function PromptPane() {
  const { state, actions, selectors } = useAppViewModel()
  const ref = selectors.currentResource(state)
  if (ref?.kind === 'custom') {
    const custom = state.customs.find((c) => c.id === ref.id)
    return custom
      ? <CustomEditor c={custom} />
      : <div className="editor-body"><div className="empty">该自定义提示词已不存在。</div></div>
  }
  if (!ref) {
    return (
      <>
        <div className="editor-head"></div>
        <div className="editor-body"><div className="empty">左侧选择提示词段、运行上下文或工具定义查看全文，或新建自定义提示词。</div></div>
        <div className="editor-foot"></div>
      </>
    )
  }
  if (ref.kind !== 'section' && ref.kind !== 'context' && ref.kind !== 'tool') {
    return <div className="editor-body"><div className="empty">该资源不属于提示词页。</div></div>
  }
  const promptKind = ref.kind
  const view = selectors.resolvePromptDetail(state, ref.name, promptKind)
  const kindLabel = KIND_LABEL[promptKind]
  if (!view) {
    const hint = state.dshPromptsState === 'error'
      ? '读取宿主提示词失败：' + (state.dshPromptsError || '未知错误')
      : state.dshPromptsState === 'ready'
        ? '宿主没有返回该条目，可能已被移除。'
        : '正在读取宿主提示词…'
    return (
      <>
        <div className="editor-head">
          <div className="crumbs"><span>{selectors.scopeCrumb(state.scope, state.meta)}</span><span className="sep">›</span><span>{kindLabel}</span><span className="sep">›</span><span>{ref.name}</span></div>
        </div>
        <div className="editor-body"><div className="empty">{hint}</div></div>
        <div className="editor-foot"></div>
      </>
    )
  }

  return (
    <>
      <div className="editor-head">
        <div className="crumbs"><span>{selectors.scopeCrumb(state.scope, state.meta)}</span><span className="sep">›</span><span>{kindLabel}</span><span className="sep">›</span><span>{view.name}</span></div>
        <div className="title-row"><strong>{view.name}</strong><span className="chip">{kindLabel}</span><span className="tag">只读</span></div>
      </div>
      <div className="editor-body">
        <dl className="meta-grid">
          <dt>来源</dt><dd>{view.source}</dd>
          <dt>体积</dt><dd>{view.tokens.toLocaleString('en-US')} tok · {view.text.length.toLocaleString('en-US')} 字</dd>
          <dt>配置集</dt><dd><GroupStatus kind={promptKind} name={ref.name} /></dd>
        </dl>
        <div className="group-label">全文</div>
        <div className="detail-text" style={{ maxHeight: 'none' }}>{view.text || '（空）'}</div>
      </div>
      <div className="editor-foot">
        {promptKind === 'context'
          ? <span className="hint">运行上下文由宿主在每轮装配时注入，只读且不参与配置集。</span>
          : <button className="btn small" data-editgroup onClick={() => actions.editInGroup(promptKind, ref.name)}>在配置集中编辑</button>}
        {promptKind !== 'context' && (
          <span className="hint">这里只读；成员写入集中在「配置集与生效」页的编辑器，保存或设为生效后才应用。</span>
        )}
      </div>
    </>
  )
}
