import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'
import ActiveGroupBar from './ActiveGroupBar'
import GroupStatus from './GroupStatus'
import ManageList from './ManageList'
import PromptList from './PromptList'

function ScopeTag({ scope }: { scope: 'global' | 'workspace' }) {
  return <span className="tag" title={scope === 'global' ? '定义在全局' : '定义在当前工作区'}>{scope === 'global' ? '全局' : '工作区'}</span>
}

function SkillList() {
  const { state, actions, selectors } = useAppViewModel()
  const list = selectors.filteredSkills(state)
  const selected = state.selected.skill?.kind === 'skill' ? state.selected.skill.name : null
  return (
    <>
      <div className="list-actions">
        <input id="skillSearch" className="search" title="在当前作用域可见的全部技能中搜索，跨切换标签保留" placeholder="搜索技能…" value={state.q.skill || ''}
          onChange={(e) => actions.setQuery('skill', e.target.value)} />
      </div>
      <div className="list-actions row2">
        <button className="btn small" data-sktool="add" onClick={() => actions.openSkillAdd()}>+ 添加</button>
        <button className="btn small" data-sktool="migrate" onClick={() => actions.openMigrate(state.skillSel)}>复制到…</button>
        <button className="btn small" data-sktool="folder" onClick={() => actions.openSkillDir()}>目录</button>
        <button className="btn small" data-sktool="scan" disabled={state.scan.status === 'loading'}
          title="只读扫描 DSH 用户级与当前工作区的技能目录" onClick={() => actions.scanSkills()}>
          {state.scan.status === 'loading' ? '扫描中…' : '扫描 DSH'}
        </button>
      </div>
      <div className="scroll">
        {list.length === 0 && <div className="sub-empty">没有匹配的技能</div>}
        {list.map((sk) => {
          const active = selected === sk.name
          const checked = state.skillSel.indexOf(sk.name) >= 0
          const on = selectors.effSkillEnabled(state, sk.name)
          return (
            <div key={sk.name} className={'item-row' + (active ? ' active' : '')}
              data-skillitem data-name={sk.name} role="button" tabIndex={0} aria-pressed={active}
              aria-label={'查看技能 ' + sk.label} onClick={() => actions.selectResource({ kind: 'skill', name: sk.name })}
              onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.selectResource({ kind: 'skill', name: sk.name }) }
              }}>
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
            </div>
          )
        })}
      </div>
      <div className="list-foot">
        {state.skillSel.length > 0 && (
          <div className="bulk-bar on">
            <span>已选 {state.skillSel.length}</span>
            <button className="btn tiny" data-skbulk="migrate" onClick={() => actions.openMigrate(state.skillSel)}>复制</button>
            <button className="btn tiny" data-skbulk="clear" onClick={() => actions.setSkillSel([])}>清空</button>
          </div>
        )}
        <label className="toggle-line"><input id="pluginToggle" type="checkbox" checked={state.showPlugin !== false}
          onChange={(e) => actions.setShowPlugin(e.target.checked)} /> 显示插件自带技能</label>
      </div>
    </>
  )
}

function McpList() {
  const { state, actions, selectors } = useAppViewModel()
  const list = selectors.filteredServers(state)
  const selected = state.selected.mcp?.kind === 'mcp' ? state.selected.mcp.name : null
  return (
    <>
      <div className="list-actions">
        <input id="mcpSearch" className="search" title="在当前作用域可见的全部 MCP 服务器中搜索，跨切换标签保留" placeholder="搜索服务器…" value={state.q.mcp || ''}
          onChange={(e) => actions.setQuery('mcp', e.target.value)} />
      </div>
      <div className="list-actions row2">
        <button className="btn small" data-mcptool="add" onClick={() => actions.openServerForm(null, true)}>+ 添加</button>
        <button className="btn small" data-mcptool="refresh" onClick={() => actions.refreshServers()}>刷新状态</button>
      </div>
      <div className="scroll">
        {list.length === 0 && <div className="sub-empty">没有匹配的服务器</div>}
        {list.map((srv) => {
          const active = selected === srv.name
          const on = srv.status === 'connected' && selectors.effServerEnabled(state, srv.name)
          const enabledCount = srv.tools.filter((t) => selectors.effToolOn(state, srv.name, t.name)).length
          return (
            <div key={srv.name} className={'item-row' + (active ? ' active' : '')}
              data-mcpitem data-name={srv.name} role="button" tabIndex={0} aria-pressed={active}
              aria-label={'查看 MCP 服务器 ' + srv.label} onClick={() => actions.selectResource({ kind: 'mcp', name: srv.name })}
              onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.selectResource({ kind: 'mcp', name: srv.name }) }
              }}>
              <span className={'dot ' + (on ? 'on' : srv.status === 'disconnected' ? 'off' : 'bad')}></span>
              <span className="i-main"><span className="i-name">{srv.label} <span className="muted">/ {srv.name}</span></span>
                <span className="i-meta">{srv.status === 'connected' ? (enabledCount + '/' + srv.tools.length + ' 工具') : '未连接'} · {srv.transport}</span></span>
              <span className="i-tail">
                <ScopeTag scope={srv.scope} />
                <GroupStatus kind="mcp" name={srv.name} />
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

export default function ItemList() {
  const { state, actions, selectors } = useAppViewModel()
  const catalog = selectors.promptCatalog(state)
  const label = state.tab === 'prompt' ? '提示词' : state.tab === 'skill' ? '技能' : state.tab === 'mcp' ? 'MCP' : '配置集与生效'
  const count = state.tab === 'prompt'
    ? catalog.sections.length + catalog.contexts.length + catalog.tools.length + selectors.customsOf(state.customs, state.scope, state.meta).length
    : state.tab === 'skill'
      ? selectors.visibleSkills(state).length
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
