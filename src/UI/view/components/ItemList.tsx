import { useAppViewModel } from '../../viewmodel/useAppViewModel'
import ActiveGroupBar from './ActiveGroupBar'
import GroupStatus from './GroupStatus'
import ManageList from './ManageList'
import PromptList from './PromptList'
import { ResourceGroup, ResourceList, ResourceRow, useResourceGroups } from './ResourceList'

function ScopeTag({ scope }: { scope: 'global' | 'workspace' }) {
  return <span className="tag" title={scope === 'global' ? '定义在全局' : '定义在当前工作区'}>{scope === 'global' ? '全局' : '工作区'}</span>
}

function SkillList() {
  const { state, actions, selectors } = useAppViewModel()
  const list = selectors.filteredSkills(state)
  const dsh = selectors.filteredDshSkills(state)
  const dshGroups = selectors.dshSkillGroups(state)
  const selected = state.selected.skill?.kind === 'skill' ? state.selected.skill.name : null
  const catalog = state.catalog
  const open = (name: string) => actions.selectResource({ kind: 'skill', name })
  const { isOpen, toggle } = useResourceGroups('skill')
  const searching = (state.q.skill || '').trim().length > 0
  const groupOpen = (id: string) => isOpen(id, searching)

  return (
    <ResourceList
      search={{
        id: 'skillSearch',
        value: state.q.skill || '',
        onChange: (value) => actions.setQuery('skill', value),
        placeholder: '搜索技能…',
        title: '在当前作用域可见的全部技能中搜索，跨切换标签保留',
        ariaLabel: '搜索技能',
      }}
      actions={
        <>
          <button className="btn small" data-sktool="add" onClick={() => actions.openSkillAdd()}>+ 添加</button>
          <button className="btn small" data-sktool="migrate" onClick={() => actions.openMigrate(state.skillSel)}>复制到…</button>
          <button className="btn small" data-sktool="folder" onClick={() => actions.openSkillDir()}>目录</button>
          <button className="btn small" data-sktool="refresh" disabled={catalog.status === 'loading'}
            title="刷新 DSH 技能注册表（只读）" onClick={() => actions.loadDshSkills()}>
            {catalog.status === 'loading' ? '刷新中…' : '刷新'}
          </button>
        </>
      }
      footer={
        <>
          {state.skillSel.length > 0 && (
            <div className="bulk-bar on">
              <span>已选 {state.skillSel.length}</span>
              <button className="btn tiny" data-skbulk="migrate" onClick={() => actions.openMigrate(state.skillSel)}>复制</button>
              <button className="btn tiny" data-skbulk="clear" onClick={() => actions.setSkillSel([])}>清空</button>
            </div>
          )}
          <label className="toggle-line"><input id="pluginToggle" type="checkbox" checked={state.showPlugin !== false}
            onChange={(e) => actions.setShowPlugin(e.target.checked)} /> 显示插件自带技能</label>
        </>
      }
    >
      <ResourceGroup groupId="skill:plugin" title="本插件技能" count={list.length}
        open={groupOpen('skill:plugin')} onToggle={() => toggle('skill:plugin')}
        empty={list.length === 0 ? <div className="sub-empty">{searching ? '没有匹配的本插件技能' : '还没有本插件技能'}</div> : null}>
        {list.map((sk) => {
          const active = selected === sk.name
          const checked = state.skillSel.indexOf(sk.name) >= 0
          const on = selectors.effSkillEnabled(state, sk.name)
          return (
            <ResourceRow key={sk.name} active={active}
              ariaLabel={'查看技能 ' + sk.label}
              data={{ skillitem: '', name: sk.name }}
              onClick={() => open(sk.name)}>
              <input type="checkbox" className="skill-check" data-skcheck checked={checked}
                aria-label={'选择 ' + sk.name} onClick={(e) => e.stopPropagation()}
                onChange={() => actions.toggleSkillCheck(sk.name)} />
              <span className={'dot ' + (on ? 'on' : 'off')}></span>
              <span className="i-main"><span className="i-name">{sk.label} <span className="muted">/ {sk.name}</span></span>
                <span className="i-meta">{sk.desc} · {selectors.formatKB(sk.bytes)} KB</span></span>
              <span className="i-tail">
                {sk.bundled && <span className="tag">插件</span>}
                <ScopeTag scope={sk.scope} />
                <GroupStatus kind="skill" name={sk.name} />
              </span>
            </ResourceRow>
          )
        })}
      </ResourceGroup>

      <ResourceGroup groupId="skill:dsh" title="DSH 技能" count={dsh.length}
        open={groupOpen('skill:dsh')} onToggle={() => toggle('skill:dsh')}>
        {catalog.result?.restricted && <div className="note" data-dsh-restricted>当前工作区未受信任，只显示全局 DSH 技能。</div>}
        {catalog.status === 'loading' && <div className="sub-empty">正在读取 DSH 技能注册表…</div>}
        {catalog.status === 'error' && <div className="sub-empty">DSH 技能读取失败：{catalog.error || '未知错误'}</div>}
        {dshGroups.map((group) => (
          <ResourceGroup key={'dshgroup:' + group.key} groupId={'dsh:' + group.key} title={group.label}
            count={group.skills.length} nested
            open={groupOpen('dsh:' + group.key)} onToggle={() => toggle('dsh:' + group.key)}
            data={{ dshgroup: group.key }}>
            {group.skills.map((sk) => {
              const active = selected === sk.name
              return (
                <ResourceRow key={'dsh:' + sk.name} active={active}
                  ariaLabel={'查看 DSH 技能 ' + sk.name}
                  data={{ dshitem: '', name: sk.name }}
                  onClick={() => open(sk.name)}>
                  <span className="dot on"></span>
                  <span className="i-main"><span className="i-name">{sk.name}</span>
                    <span className="i-meta">{sk.description || '无描述'}</span></span>
                  <span className="i-tail">
                    {sk.origin === 'workspace' && <span className="tag">工作区</span>}
                    {!sk.model && <span className="tag" title="模型不可调用">仅用户</span>}
                  </span>
                </ResourceRow>
              )
            })}
          </ResourceGroup>
        ))}
        {catalog.status === 'ready' && dsh.length === 0 && <div className="sub-empty">{searching ? '没有匹配的 DSH 技能' : '还没有 DSH 技能'}</div>}
      </ResourceGroup>
    </ResourceList>
  )
}

function McpList() {
  const { state, actions, selectors } = useAppViewModel()
  const list = selectors.filteredServers(state)
  const selected = state.selected.mcp?.kind === 'mcp' ? state.selected.mcp.name : null
  const { isOpen, toggle } = useResourceGroups('mcp')
  const searching = (state.q.mcp || '').trim().length > 0
  const open = (id: string) => isOpen(id, searching)
  const global = list.filter((srv) => srv.scope === 'global')
  const workspace = list.filter((srv) => srv.scope === 'workspace')

  const rows = (servers: typeof list) => servers.map((srv) => {
    const active = selected === srv.name
    const on = srv.status === 'connected' && selectors.effServerEnabled(state, srv.name)
    const enabledCount = srv.tools.filter((t) => selectors.effToolOn(state, srv.name, t.name)).length
    return (
      <ResourceRow key={srv.name} active={active}
        ariaLabel={'查看 MCP 服务器 ' + srv.label}
        data={{ mcpitem: '', name: srv.name }}
        onClick={() => actions.selectResource({ kind: 'mcp', name: srv.name })}>
        <span className={'dot ' + (on ? 'on' : srv.status === 'disconnected' ? 'off' : 'bad')}></span>
        <span className="i-main"><span className="i-name">{srv.label} <span className="muted">/ {srv.name}</span></span>
          <span className="i-meta">{srv.status === 'connected' ? (enabledCount + '/' + srv.tools.length + ' 工具') : '未连接'} · {srv.transport}</span></span>
        <span className="i-tail">
          <ScopeTag scope={srv.scope} />
          <GroupStatus kind="mcp" name={srv.name} />
        </span>
      </ResourceRow>
    )
  })

  return (
    <ResourceList
      search={{
        id: 'mcpSearch',
        value: state.q.mcp || '',
        onChange: (value) => actions.setQuery('mcp', value),
        placeholder: '搜索服务器…',
        title: '在当前作用域可见的全部 MCP 服务器中搜索，跨切换标签保留',
        ariaLabel: '搜索 MCP 服务器',
      }}
      actions={
        <>
          <button className="btn small" data-mcptool="add" onClick={() => actions.openServerForm(null, true)}>+ 添加</button>
          <button className="btn small" data-mcptool="refresh" onClick={() => actions.refreshServers()}>刷新状态</button>
        </>
      }
    >
      {list.length === 0 && <div className="sub-empty">{searching ? '没有匹配的服务器' : '还没有 MCP 服务器'}</div>}
      {global.length > 0 && (
        <ResourceGroup groupId="mcp:global" title="全局" count={global.length}
          open={open('mcp:global')} onToggle={() => toggle('mcp:global')}>
          {rows(global)}
        </ResourceGroup>
      )}
      {workspace.length > 0 && (
        <ResourceGroup groupId="mcp:workspace" title="工作区" count={workspace.length}
          open={open('mcp:workspace')} onToggle={() => toggle('mcp:workspace')}>
          {rows(workspace)}
        </ResourceGroup>
      )}
    </ResourceList>
  )
}

export default function ItemList() {
  const { state, actions, selectors } = useAppViewModel()
  const catalog = selectors.promptCatalog(state)
  const label = state.tab === 'prompt' ? '提示词' : state.tab === 'skill' ? '技能' : state.tab === 'mcp' ? 'MCP' : '配置集与生效'
  const count = state.tab === 'prompt'
    ? catalog.sections.length + catalog.contexts.length + catalog.tools.length + selectors.customsOf(state.customs, state.scope, state.meta).length
    : state.tab === 'skill'
      ? selectors.visibleSkills(state).length + selectors.visibleDshSkills(state).length
      : state.tab === 'mcp'
        ? selectors.visibleServers(state).length
        : selectors.groupsOf(state.groups, state.scope, state.meta).length
  const restricted = selectors.isRestricted(state)
  return (
    <>
      <div className="col-head" title={state.tab === 'prompt' ? catalog.sections.length + ' 段 / ' + catalog.contexts.length + ' 上下文 / ' + catalog.tools.length + ' 工具' : undefined}>
        {selectors.scopeCrumb(state.scope, state.meta)} · {label} <span className="count">{count}</span>
      </div>
      {restricted && (
        <div className="note trust-banner" data-restricted>
          <div><b>受限模式</b>：工作区配置尚未加载。信任后才会读取该工作区的配置集、技能与 MCP 定义。</div>
          <button className="btn small" data-trust-banner onClick={() => {
            const ws = (state.meta.workspaces || []).find((w) => w.id === state.scope.id)
            if (ws) actions.trustWorkspace(ws.id)
          }}>信任并加载</button>
        </div>
      )}
      {state.tab !== 'manage' && <ActiveGroupBar />}
      {state.tab === 'prompt' ? <PromptList /> : state.tab === 'skill' ? <SkillList /> : state.tab === 'mcp' ? <McpList /> : <ManageList />}
    </>
  )
}
