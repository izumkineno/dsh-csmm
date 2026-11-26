import { useAppViewModel } from '../../viewmodel/useAppViewModel'

export default function DetailView() {
  const { state, actions, selectors } = useAppViewModel()
  const d = state.detail
  const group = selectors.currentGroup(state)
  const back = <button className="linkbtn" data-back onClick={() => actions.closeDetail()}>‹ 返回</button>
  if (!d) return null
  if (d.kind === 'prompt') {
    const view = selectors.resolvePromptDetail(state, d.name, d.promptKind)
    const kindLabel = d.promptKind === 'context' ? '运行上下文' : d.promptKind === 'tool' ? '工具定义' : '提示词段'
    if (!view) {
      const hint = state.dshPromptsState === 'error'
        ? '读取宿主提示词失败：' + (state.dshPromptsError || '未知错误')
        : state.dshPromptsState === 'ready'
          ? '宿主没有返回该条目，可能已被移除。'
          : '正在读取宿主提示词…'
      return (
        <>
          <div className="editor-head">
            <div className="crumbs">{back}<span className="sep">›</span><span>{kindLabel}</span><span className="sep">›</span><span>{d.name}</span></div>
            <div className="title-row"><strong>{d.name}</strong><span className="chip">{kindLabel}</span></div>
          </div>
          <div className="editor-body"><div className="empty">{hint}</div></div>
          <div className="editor-foot">{back}</div>
        </>
      )
    }
    return (
      <>
        <div className="editor-head">
          <div className="crumbs">{back}<span className="sep">›</span><span>{kindLabel}</span><span className="sep">›</span><span>{view.name}</span></div>
          <div className="title-row"><strong>{view.name}</strong><span className="chip">{kindLabel}</span><span className="tag">只读</span></div>
        </div>
        <div className="editor-body">
          <dl className="meta-grid">
            <dt>来源</dt><dd>{view.source}</dd>
            <dt>体积</dt><dd>{view.tokens.toLocaleString('en-US')} tok · {view.text.length.toLocaleString('en-US')} 字</dd>
          </dl>
          <div className="group-label">全文</div>
          <div className="detail-text" style={{ maxHeight: '60vh' }}>{view.text || '（空）'}</div>
        </div>
        <div className="editor-foot">{back}</div>
      </>
    )
  }
  if (d.kind === 'mcp') {
    const srv = selectors.resolvedServer(state, d.name)
    if (!srv) {
      return (
        <>
          <div className="editor-head">{back}</div>
          <div className="editor-body"><div className="empty">服务器不存在。</div></div>
        </>
      )
    }
    const inGroup = !!group && selectors.hasItem(group.items, 'mcp', srv.name)
    const inherited = srv.scope === 'global' && state.scope.kind === 'workspace'
    return (
      <>
        <div className="editor-head">
          <div className="crumbs">{back}<span className="sep">›</span><span>资源</span><span className="sep">›</span><span>{srv.name}</span></div>
          <div className="title-row"><strong>{srv.label || srv.name}</strong><span className="muted">/ {srv.name}</span>
            <span className={'chip ' + (srv.status === 'connected' ? 'chip-on' : '')}>{srv.status}</span>
            <span className="chip">{srv.transport}</span>
            <span className="tag" title={srv.scope === 'global' ? '定义在全局' : '定义在当前工作区'}>{srv.scope === 'global' ? '全局定义' : '工作区定义'}</span>
            {inherited && <span className="tag" title="继承自全局，本层可停用或复制覆盖">继承自全局</span>}</div>
        </div>
        <div className="editor-body">
          <dl className="meta-grid">
            <dt>工具</dt><dd>{srv.tools.length} 个</dd>
            <dt>配对段</dt><dd>mcp:{srv.name} · {srv.tokens} tok</dd>
            <dt>认证</dt><dd>{srv.auth}</dd>
          </dl>
          <div className="group-label">工具</div>
          <div className="res">
            {srv.tools.length === 0 && <div className="sub-empty">无工具</div>}
            {srv.tools.map((t) => (
              <div key={t.name} className="res-row tool-row">
                <input type="checkbox" data-tool checked={selectors.effToolOn(state, srv.name, t.name)}
                  onChange={(e) => actions.toggleTool(srv.name, t.name, e.target.checked)} aria-label={t.name} />
                <span className="t-name">mcp__{srv.name}__{t.name}</span>
                <span className="t-meta">{selectors.effToolOn(state, srv.name, t.name) ? '启用' : '已 deny'}</span>
              </div>
            ))}
          </div>
          <div className="group-label">说明</div>
          <div className="detail-text">{srv.instructions || '（无说明）'}</div>
          <div className="detail-actions">
            <button className="btn small" data-restart onClick={() => actions.restartConnection()}>重启连接</button>
            <button className="btn small" data-configedit onClick={() => actions.openServerForm(srv, false)}>编辑配置</button>
            {group && <button className="btn small" data-groupitem onClick={() => actions.setGroupItem('mcp', srv.name)}>{inGroup ? '从分组移除' : '加入分组'}</button>}
          </div>
        </div>
        <div className="editor-foot">{back}</div>
      </>
    )
  }
  const sk = selectors.resolvedSkill(state, d.name)
  if (!sk) {
    return (
      <>
        <div className="editor-head">{back}</div>
        <div className="editor-body"><div className="empty">技能不存在。</div></div>
      </>
    )
  }
  const inGroup = !!group && selectors.hasItem(group.items, 'skill', sk.name)
  const inherited = sk.scope === 'global' && state.scope.kind === 'workspace'
  return (
    <>
      <div className="editor-head">
        <div className="crumbs">{back}<span className="sep">›</span><span>资源</span><span className="sep">›</span><span>{sk.name}</span></div>
        <div className="title-row"><strong>{sk.label || sk.name}</strong><span className="muted">/ {sk.name}</span>
          {sk.bundled && <span className="tag">插件</span>}
          <span className="tag" title={sk.scope === 'global' ? '定义在全局' : '定义在当前工作区'}>{sk.scope === 'global' ? '全局定义' : '工作区定义'}</span>
          {inherited && <span className="tag" title="继承自全局，本层可停用或复制覆盖">继承自全局</span>}</div>
      </div>
      <div className="editor-body">
        <dl className="meta-grid">
          <dt>作用域</dt><dd>{sk.scope === 'global' ? '全局' : '工作区'}</dd>
          <dt>体积</dt><dd>{sk.bytes} bytes</dd>
          <dt>说明</dt><dd>{sk.desc}</dd>
        </dl>
        <div className="group-label">SKILL.md</div>
        <div className="detail-text">{sk.text}</div>
        <div className="detail-actions">
          {sk.scope === 'global'
            ? (state.scope.kind !== 'global' && <button className="btn small" data-skillmove="workspace" onClick={() => actions.moveSkill(sk.name, 'workspace')}>复制到当前工作区</button>)
            : <button className="btn small" data-skillmove="global" onClick={() => actions.moveSkill(sk.name, 'global')}>复制到全局</button>}
          {group && <button className="btn small" data-groupitem onClick={() => actions.setGroupItem('skill', sk.name)}>{inGroup ? '从分组移除' : '加入分组'}</button>}
        </div>
      </div>
      <div className="editor-foot">{back}</div>
    </>
  )
}
