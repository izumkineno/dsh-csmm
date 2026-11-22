import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'

function PromptList() {
  const { state, actions, selectors } = useAppViewModel()
  const groups = selectors.groupsOf(state.groups, state.scope)
  const customs = selectors.customsOf(state.customs, state.scope)
  const active = selectors.currentGroup(state)
  const activeId = state.activeGroup[selectors.scopeKey(state.scope)]
  return (
    <>
      <div className="list-actions">
        <button className="btn small" onClick={() => actions.newGroup()}>+ 新分组</button>
        <button className="btn small" onClick={() => actions.newCustom()}>+ 新自定义</button>
      </div>
      <div className="scroll">
        <button className={'item-row' + (!activeId ? ' active' : '')} data-none title="清空本层生效分组，只继承上层"
          onClick={() => actions.setNone()}>
          <span className="i-ico">∅</span><span className="i-main"><span className="i-name">不使用分组</span>
          <span className="i-meta">仅继承上层，不额外注入</span></span>
        </button>
        <div className="rail-sec">分组 <span className="count">{groups.length}</span></div>
        {groups.length === 0 && <div className="sub-empty">该作用域还没有分组</div>}
        {groups.map((g) => {
          const c = { section: 0, mcp: 0, skill: 0 }
          g.items.forEach((it) => { if (c[it.kind] !== undefined) c[it.kind]++ })
          const on = active && active.id === g.id
          const selected = state.active.kind === 'group' && state.active.id === g.id
          return (
            <button key={g.id} className={'item-row' + (selected ? ' active' : '')} data-item="group" data-id={g.id}
              onClick={() => actions.setActive('group', g.id)}>
              <span className="i-ico">▦</span>
              <span className="i-main"><span className="i-name">{g.name}</span>
                <span className="i-meta">{g.items.length} 项 · {c.section} 段 / {c.mcp} MCP / {c.skill} 技能</span></span>
              {on
                ? <span className="i-off" title="当前作用域正在生效的分组">启用中</span>
                : (selected ? <span className="i-off" title="正在编辑，尚未生效">编辑中</span> : null)}
            </button>
          )
        })}
        <div className="rail-sec">自定义提示词 <span className="count">{customs.length}</span></div>
        {customs.length === 0 && <div className="sub-empty">该作用域还没有自定义提示词</div>}
        {customs.map((c) => (
          <button key={c.id} className={'item-row' + (state.active.kind === 'custom' && state.active.id === c.id ? ' active' : '')}
            data-item="custom" data-id={c.id} onClick={() => actions.setActive('custom', c.id)}>
            <span className="i-ico">✎</span>
            <span className="i-main"><span className="i-name">{c.title}</span>
              <span className="i-meta">{c.text.length} 字 · 追加到生效正文末尾</span></span>
            {state.active.kind === 'custom' && state.active.id === c.id && <span className="i-off">编辑中</span>}
          </button>
        ))}
      </div>
    </>
  )
}

function SkillList() {
  const { state, actions, selectors } = useAppViewModel()
  const list = selectors.filteredSkills(state)
  const group = selectors.currentGroup(state)
  return (
    <>
      <div className="list-actions">
        <input id="skillSearch" className="search" placeholder="搜索技能…" value={state.q.skill || ''}
          onChange={(e) => actions.setQuery('skill', e.target.value)} />
      </div>
      <div className="list-actions row2">
        <button className="btn small" data-sktool="add" onClick={() => actions.openSkillAdd()}>+ 添加</button>
        <button className="btn small" data-sktool="migrate" onClick={() => actions.openMigrate(state.skillSel)}>迁移</button>
        <button className="btn small" data-sktool="folder" onClick={() => actions.openSkillDir()}>目录</button>
      </div>
      <div className="scroll">
        {list.length === 0 && <div className="sub-empty">没有匹配的技能</div>}
        {list.map((sk) => {
          const inGroup = !!group && selectors.hasItem(group.items, 'skill', sk.name)
          const checked = state.skillSel.indexOf(sk.name) >= 0
          return (
            <div key={sk.name} className={'item-row' + (state.sel.skill === sk.name ? ' active' : '')}
              data-skillitem data-name={sk.name} role="button" tabIndex={0} aria-pressed={state.sel.skill === sk.name}
              aria-label={'查看技能 ' + sk.label} onClick={() => actions.selectSkill(sk.name)}
              onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.selectSkill(sk.name) }
              }}>
              <input type="checkbox" className="skill-check" data-skcheck checked={checked}
                aria-label={'选择 ' + sk.name} onClick={(e) => e.stopPropagation()}
                onChange={() => actions.toggleSkillCheck(sk.name)} />
              <span className={'dot ' + (sk.enabled === false ? 'off' : 'on')}></span>
              <span className="i-main"><span className="i-name">{sk.label} <span className="muted">/ {sk.name}</span></span>
                <span className="i-meta">{sk.desc} · {selectors.formatKB(sk.bytes)} KB</span></span>
              {sk.bundled && <span className="tag">插件</span>}
              {inGroup && <span className="i-off" title="已列入当前生效分组">本组</span>}
            </div>
          )
        })}
      </div>
      <div className="list-foot">
        {state.skillSel.length > 0 && (
          <div className="bulk-bar">
            <span>已选 {state.skillSel.length}</span>
            <button className="btn tiny" data-skbulk="migrate" onClick={() => actions.openMigrate(state.skillSel)}>迁移</button>
            <button className="btn tiny" data-skbulk="addgroup" title="把选中的技能加入当前生效分组" onClick={() => actions.addSkillsToGroup(state.skillSel)}>加入分组</button>
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
  const group = selectors.currentGroup(state)
  return (
    <>
      <div className="list-actions">
        <input id="mcpSearch" className="search" placeholder="搜索服务器…" value={state.q.mcp || ''}
          onChange={(e) => actions.setQuery('mcp', e.target.value)} />
      </div>
      <div className="list-actions row2">
        <button className="btn small" data-mcptool="add" onClick={() => actions.openServerForm(null, true)}>+ 添加</button>
        <button className="btn small" data-mcptool="refresh" onClick={() => actions.refreshServers()}>刷新状态</button>
      </div>
      <div className="scroll">
        {list.length === 0 && <div className="sub-empty">没有匹配的服务器</div>}
        {list.map((srv) => {
          const on = srv.status === 'connected' && srv.enabled !== false
          const enabledCount = srv.tools.filter((t) => t.on).length
          const inGroup = !!group && selectors.hasItem(group.items, 'mcp', srv.name)
          return (
            <button key={srv.name} className={'item-row' + (state.sel.mcp === srv.name ? ' active' : '')}
              data-mcpitem data-name={srv.name} aria-pressed={state.sel.mcp === srv.name}
              aria-label={'查看 MCP 服务器 ' + srv.label} onClick={() => actions.selectMcp(srv.name)}>
              <span className={'dot ' + (on ? 'on' : srv.status === 'disconnected' ? 'off' : 'bad')}></span>
              <span className="i-main"><span className="i-name">{srv.label} <span className="muted">/ {srv.name}</span></span>
                <span className="i-meta">{srv.status === 'connected' ? (enabledCount + '/' + srv.tools.length + ' 工具') : '未连接'} · {srv.transport}</span></span>
              {inGroup && <span className="i-off" title="已列入当前生效分组">本组</span>}
            </button>
          )
        })}
      </div>
    </>
  )
}

export default function ItemList() {
  const { state, selectors } = useAppViewModel()
  const label = state.tab === 'prompt' ? '提示词' : state.tab === 'skill' ? '技能' : 'MCP'
  const count = state.tab === 'prompt'
    ? selectors.groupsOf(state.groups, state.scope).length + selectors.customsOf(state.customs, state.scope).length
    : state.tab === 'skill'
      ? state.skills.filter((s) => selectors.skillVisible(s, state.scope, state.meta)).length
      : state.servers.length
  return (
    <>
      <div className="col-head">{selectors.scopeCrumb(state.scope, state.meta)} · {label} <span className="count">{count}</span></div>
      {state.tab === 'prompt' ? <PromptList /> : state.tab === 'skill' ? <SkillList /> : <McpList />}
    </>
  )
}
