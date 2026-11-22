import { useAppViewModel } from '../../viewmodel/useAppViewModel'

export default function McpPane() {
  const { state, actions, selectors } = useAppViewModel()
  const srv = selectors.resolvedServer(state, state.sel.mcp)
  if (!srv) {
    return (
      <>
        <div className="editor-head">
          <div className="crumbs">
            <span>{selectors.scopeCrumb(state.scope, state.meta)}</span><span className="sep">›</span><span>MCP 服务器</span>
          </div>
        </div>
        <div className="editor-body"><div className="empty">左侧选择一个服务器。这里测试连接、维护工具白名单与认证。</div></div>
        <div className="editor-foot"></div>
      </>
    )
  }
  const group = selectors.currentGroup(state)
  const inGroup = !!group && selectors.hasItem(group.items, 'mcp', srv.name)
  const on = srv.status === 'connected' && selectors.effServerEnabled(state, srv.name)
  const local = srv.scope === 'workspace' && state.scope.kind === 'workspace'
  const inherited = srv.scope === 'global' && state.scope.kind === 'workspace'
  const q = (srv.toolQ || '').trim().toLowerCase()
  const tools = srv.tools.filter((t) => !q || t.name.toLowerCase().indexOf(q) >= 0)
  const disabledCount = srv.tools.filter((t) => !selectors.effToolOn(state, srv.name, t.name)).length
  return (
    <>
      <div className="editor-head">
        <div className="crumbs">
          <span>{selectors.scopeCrumb(state.scope, state.meta)}</span><span className="sep">›</span><span>MCP 服务器</span>
        </div>
        <div className="title-row"><strong>{srv.label || srv.name}</strong><span className="muted">/ {srv.name}</span>
          <span className={'chip ' + (on ? 'chip-on' : '')}>
            {on ? 'connected' : (!selectors.effServerEnabled(state, srv.name) ? '已停用' : srv.status)}
          </span>
          <span className="chip">{srv.transport}</span>
          <span className="tag" title={srv.scope === 'global' ? '定义在全局' : '定义在当前工作区'}>{srv.scope === 'global' ? '全局定义' : '工作区定义'}</span>
          {local && <span className="tag" title="本层定义，覆盖同名全局服务器">本层覆盖</span>}
          {inherited && <span className="tag" title="继承自全局，本层可停用或复制覆盖">继承自全局</span>}
          {srv.oauth && <span className="chip">oauth</span>}
        </div>
      </div>
      <div className="editor-body">
        <dl className="meta-grid">
          <dt>配对段</dt><dd>mcp:{srv.name} · {srv.tokens} tok</dd>
          <dt>工具</dt><dd>{srv.tools.length} 个（{disabledCount} deny）</dd>
          <dt>进程</dt><dd>常驻</dd>
          <dt>配置</dt><dd>{srv.transport === 'stdio' ? 'stdio · ' + srv.command : 'http · ' + srv.url}</dd>
        </dl>
        <div className="filter-row">
          <input id="toolSearch" className="search" placeholder="过滤工具…" value={srv.toolQ || ''}
            onChange={(e) => actions.setToolQuery(srv.name, e.target.value)} />
          <button className="btn tiny" data-toolall title="选中当前过滤出的工具"
            onClick={() => actions.setAllTools(srv.name, true, tools.map((t) => t.name))}>全选</button>
          <button className="btn tiny" data-toolnone title="取消当前过滤出的工具"
            onClick={() => actions.setAllTools(srv.name, false, tools.map((t) => t.name))}>全不选</button>
        </div>
        <div className="res tool-list">
          {tools.length === 0 && <div className="sub-empty">{srv.tools.length ? '没有匹配的工具' : '尚未拉取工具清单，点「测试连接」'}</div>}
          {tools.map((t) => (
            <div key={t.name} className="res-row tool-row">
              <input type="checkbox" data-tool data-tool-name={t.name} checked={selectors.effToolOn(state, srv.name, t.name)}
                onChange={(e) => actions.toggleTool(srv.name, t.name, e.target.checked)} aria-label={t.name} />
              <span className="t-name">mcp__{srv.name}__{t.name}</span>
              <span className="t-meta">{selectors.effToolOn(state, srv.name, t.name) ? '启用' : '已 deny'}</span>
            </div>
          ))}
        </div>
        <div className="filter-row">
          <span className="muted">{srv.tools.length - disabledCount}/{srv.tools.length} 启用</span>
          <span className="grow"></span>
          <span className="muted" data-toolhint>工具开关即时生效</span>
        </div>
        {srv.testMsg && <div className="note">{srv.testMsg}</div>}
        <div className="group-label">服务器说明（进入提示词的配对段）</div>
        <div className="detail-text">{srv.instructions || '（无说明）'}</div>
        <div className="detail-actions">
          <button className="btn small" data-mcptest onClick={() => actions.testConnection(srv.name)}>{srv.testing ? '测试中…' : '测试连接'}</button>
          <button className="btn small" data-mcptoggle onClick={() => actions.toggleMcp(srv.name)}>{selectors.effServerEnabled(state, srv.name) ? '停用' : '启用'}</button>
          <button className="btn small" data-mcpconfig onClick={() => actions.openServerForm(srv, false)}>编辑配置</button>
          <button className="btn small" data-mcpraw onClick={() => actions.openRaw(srv)}>查看原文</button>
          {srv.auth === 'oauth' && <button className="btn small" data-mcpoauth onClick={() => actions.oauthToggle(srv.name)}>{srv.oauth ? '断开登录' : 'OAuth 登录'}</button>}
          <button className="btn small" data-restart onClick={() => actions.restartConnection()}>重启连接</button>
          {group && <button className="btn small" data-groupitem onClick={() => actions.setGroupItem('mcp', srv.name)}>{inGroup ? '从分组移除' : '加入分组'}</button>}
          {state.mcpDelConfirm === srv.name
            ? <><button className="btn danger small" data-mcpdel="yes" onClick={() => actions.deleteMcp(srv.name)}>{local ? '确认删除' : '确认停用'}</button>
                <button className="btn small" onClick={() => actions.setMcpDelConfirm(null)}>取消</button></>
            : <button className="btn small" data-mcpdel onClick={() => actions.setMcpDelConfirm(srv.name)}>{local ? '删除' : '在本层停用'}</button>}
        </div>
      </div>
      <div className="editor-foot"><span className="hint">MCP 配置按作用域保存：工作区同名定义覆盖全局，其他工作区不受影响。工具 deny 与「停用服务器」不同：前者只关单个工具，后者让整组 mcp__ 工具定义消失。</span></div>
    </>
  )
}
