import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import {
  SCOPE_LABEL,
  type Group,
  type GroupItem,
  type GroupItemKind,
} from '../../contracts'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'

type Filter = 'all' | 'selected' | 'unselected'

function CheckRow(props: {
  kind: GroupItemKind
  name: string
  label: string
  meta?: string
  checked?: boolean
  disabled?: boolean
  onChange?: () => void
  icon?: ReactNode
}) {
  const { kind, name, label, meta, checked, disabled, onChange, icon } = props
  return (
    <div className={'check-row' + (disabled ? ' resident' : '')}>
      <input type="checkbox" data-check="1" data-kind={kind} data-name={name} checked={!!checked}
        disabled={disabled} onChange={onChange} aria-label={label} />
      {icon && <span className="r-ico">{icon}</span>}
      <label className="c-label" onClick={() => { if (!disabled) onChange?.() }}>{label}</label>
      {meta && <span className="muted">{meta}</span>}
    </div>
  )
}

export default function GroupEditor({ g }: { g: Group }) {
  const { state, actions, selectors } = useAppViewModel()
  const ownSections = state.meta.sections.filter((section) => section.kind === 'section')
  const dshSections = state.dshPrompts
    .filter((p) => p.kind === 'section' && !ownSections.some((s) => s.name === p.name))
    .map((p) => ({ name: p.name, source: 'DSH', tokens: p.tokens }))
  const sections = [...ownSections, ...dshSections]
  const [name, setName] = useState(g.name)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  useEffect(() => { actions.ensureDraft(g) }, [g.id])
  useEffect(() => { setName(g.name) }, [g.id, g.name])
  useEffect(() => { setQuery(''); setFilter('all') }, [g.id])

  const draft = (state.drafts[selectors.draftId(g)] as GroupItem[] | undefined) || g.items
  const dirty = name !== g.name || JSON.stringify(draft) !== JSON.stringify(g.items)
  const counts: Record<GroupItemKind, number> = { section: 0, mcp: 0, skill: 0 }
  draft.forEach((it) => { if (counts[it.kind] !== undefined) counts[it.kind]++ })
  const visibleSkills = selectors.visibleSkills(state)
  const visibleServers = selectors.visibleServers(state)
  const sources = selectors.groupSources(state.meta)
  const check = (kind: GroupItemKind, n: string): boolean => selectors.hasItem(draft, kind, n)
  const toggle = (kind: GroupItemKind, n: string) => actions.toggleDraftCheck(g, kind, n)
  const onSave = () => { actions.saveGroup(g, name) }
  const onRevert = () => { actions.revertGroup(g); setName(g.name) }

  const needle = query.trim().toLowerCase()
  const match = (kind: GroupItemKind, resource: string): boolean => {
    if (needle && !resource.toLowerCase().includes(needle)) return false
    const on = check(kind, resource)
    if (filter === 'selected') return on
    if (filter === 'unselected') return !on
    return true
  }
  const sectionList = sections.filter((section) => match('section', section.name))
  const serverList = visibleServers.filter((server) => match('mcp', server.name))
  const skillList = visibleSkills.filter((skill) => match('skill', skill.name))

  const toggleMany = (kind: GroupItemKind, names: string[], on: boolean) => {
    names.forEach((resource) => {
      if (check(kind, resource) !== on) actions.toggleDraftCheck(g, kind, resource)
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.modal')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && dirty) {
        e.preventDefault()
        actions.saveGroup(g, name)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, name, g.id])

  const [delArm, setDelArm] = useState(false)
  useEffect(() => { setDelArm(false) }, [g.id])
  const effId = state.activeGroup[selectors.scopeKey(g.scope)]
  const stateLabel = effId === g.id ? '生效中' : effId === '' ? '本层为空' : '继承中'
  const stateClass = effId === g.id ? 'on' : effId === '' ? 'off' : 'inherit'

  return (
    <>
      <div className="editor-head">
        <div className="crumbs">
          <span>{selectors.scopeCrumb(g.scope, state.meta)}</span><span className="sep">›</span><span>分组</span>
        </div>
        <div className="title-row">
          <input id="itemName" className="title-input" value={name} onChange={(e) => setName(e.target.value)}
            aria-label="分组名称" />
          <span className={'chip scope-' + g.scope.kind}>{SCOPE_LABEL[g.scope.kind]}</span>
          <span className="chip">分组</span>
          <span className={'chip state-' + stateClass}>{stateLabel}</span>
        </div>
      </div>
      <div className="editor-body">
        <div className="banner">启用后只保留本组列出的项；未列入的资源不会进入生效提示词。勾选变化需点「保存」才生效。</div>
        <div className="summary-line">
          <span className="pill" id="sumSection">提示词段 {counts.section}</span>
          <span className="pill" id="sumMcp">MCP {counts.mcp}</span>
          <span className="pill" id="sumSkill">技能 {counts.skill}</span>
          <span className="grow"></span>
          <span className="muted" id="sumChars" title="仅统计本组列出的提示词段、技能与 MCP，不含自定义提示词与运行上下文">组内资源 ≈ {selectors.groupTokens({ items: draft }, state)} tok</span>
        </div>
        {counts.section === 0 && (counts.skill > 0 || counts.mcp > 0) && (
          <div className="note" data-empty-prompt>
            本组没有勾选任何提示词段：设为生效后系统提示词为空，仅保留技能与 MCP。分组白名单不区分类型，需要提示词段时请在上方一并勾选。
          </div>
        )}

        <div className="editor-tools">
          <input type="search" className="search" value={query} onChange={(e) => setQuery(e.target.value)}
            title="仅搜索当前分组可加入的资源" placeholder="搜索本组可加入的资源…" aria-label="搜索本组资源" />
          <div className="seg" role="group" aria-label="资源筛选">
            {([['all', '全部'], ['selected', '已选'], ['unselected', '未选']] as Array<[Filter, string]>).map(([key, label]) => (
              <button key={key} className="btn tiny" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
            ))}
          </div>
        </div>

        <div className="xlink-row">
          <div className="xlink" data-gotab="mcp" role="link" tabIndex={0} onClick={() => actions.setTab('mcp')}
            onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.setTab('mcp') }
            }}>
            <span>⚡</span><span>去管理 MCP 工具</span><span className="muted">›</span>
          </div>
          <div className="xlink" data-gotab="skill" role="link" tabIndex={0} onClick={() => actions.setTab('skill')}
            onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.setTab('skill') }
            }}>
            <span>◆</span><span>去管理技能</span><span className="muted">›</span>
          </div>
        </div>

        <details className="res" open>
          <summary className="res-head">
            <span>提示词段</span>
            <span className="count" id="secCount">{counts.section}/{sections.length}</span>
            <span className="muted">{selectors.groupTokens({ items: draft.filter((it) => it.kind === 'section') }, state)} tok</span>
            <span className="tag" title="只放行分组列出的段，未列入的不进入提示词">白名单</span>
            <span className="spacer"></span>
            <button className="btn tiny" onClick={(e) => { e.preventDefault(); toggleMany('section', sectionList.map((s) => s.name), true) }}>全选</button>
            <button className="btn tiny" onClick={(e) => { e.preventDefault(); toggleMany('section', sectionList.map((s) => s.name), false) }}>清空</button>
          </summary>
          {sources.map((src) => {
            const list = sectionList.filter((s) => s.source === src)
            if (!list.length) return null
            return (
              <div key={src}>
                <div className="source-head">{src}<span className="count">{list.filter((s) => check('section', s.name)).length}/{list.length}</span></div>
                {list.map((s) => (
                  <CheckRow key={s.name} kind="section" name={s.name} label={s.name} meta={s.tokens + ' tok'}
                    checked={check('section', s.name)} onChange={() => toggle('section', s.name)} />
                ))}
              </div>
            )
          })}
          {dshSections.length > 0 && (
            <div>
              <div className="source-head">DSH 注册提示词<span className="count">{dshSections.filter((s) => check('section', s.name)).length}/{dshSections.length}</span></div>
              {dshSections.filter((s) => match('section', s.name)).map((s) => (
                <CheckRow key={s.name} kind="section" name={s.name} label={s.name} meta={s.tokens + ' tok'}
                  checked={check('section', s.name)} onChange={() => toggle('section', s.name)} />
              ))}
            </div>
          )}
          <div className="source-head">运行上下文</div>
          {state.meta.sections.filter((s) => s.kind === 'context').map((s) => (
            <CheckRow key={s.name} kind="section" name={s.name} label={s.name} meta={s.tokens + ' tok'}
              checked disabled />
          ))}
          {!sectionList.length && <div className="empty">没有匹配的提示词段。</div>}
        </details>


        <details className="res" open>
          <summary className="res-head">
            <span>MCP 服务器</span>
            <span className="count" id="mcpCount">{counts.mcp}/{visibleServers.length}</span>
            <span className="muted">{selectors.groupTokens({ items: draft.filter((it) => it.kind === 'mcp') }, state)} tok</span>
            <span className="tag cat-mcp" title="勾选服务器会同时带上它的配对段与工具">段 + 工具成对</span>
            <span className="spacer"></span>
            <button className="btn tiny" onClick={(e) => { e.preventDefault(); toggleMany('mcp', serverList.map((s) => s.name), true) }}>全选</button>
            <button className="btn tiny" onClick={(e) => { e.preventDefault(); toggleMany('mcp', serverList.map((s) => s.name), false) }}>清空</button>
          </summary>
          {serverList.map((srv) => (
            <div key={srv.name} className="res-row">
              <input type="checkbox" data-check="1" data-kind="mcp" data-name={srv.name}
                checked={check('mcp', srv.name)} onChange={() => toggle('mcp', srv.name)} aria-label={srv.name} />
              <span className="r-ico">⚡</span>
              <span className={'status-dot ' + (srv.status === 'connected' ? 'on' : 'off')}></span>
              <span className="c-label">{srv.name}</span>
              <span className="muted">mcp:{srv.name} · {srv.tools.length} 工具</span>
              <button className="linkbtn" data-manage="mcp" data-name={srv.name}
                onClick={() => actions.openDetail({ kind: 'mcp', name: srv.name })}>详情</button>
            </div>
          ))}
          {!serverList.length && <div className="empty">没有匹配的 MCP 服务器。</div>}
        </details>

        <details className="res" open>
          <summary className="res-head">
            <span>技能</span>
            <span className="count" id="skillCount">{counts.skill}/{visibleSkills.length}</span>
            <span className="muted">{selectors.groupTokens({ items: draft.filter((it) => it.kind === 'skill') }, state)} tok</span>
            <span className="tag">按可见性</span>
            <span className="spacer"></span>
            <button className="btn tiny" onClick={(e) => { e.preventDefault(); toggleMany('skill', skillList.map((s) => s.name), true) }}>全选</button>
            <button className="btn tiny" onClick={(e) => { e.preventDefault(); toggleMany('skill', skillList.map((s) => s.name), false) }}>清空</button>
          </summary>
          {skillList.map((sk) => (
            <div key={sk.name} className="res-row">
              <input type="checkbox" data-check="1" data-kind="skill" data-name={sk.name}
                checked={check('skill', sk.name)} onChange={() => toggle('skill', sk.name)} aria-label={sk.name} />
              <span className="r-ico">◆</span>
              <span className="c-label">{sk.name}</span>
              <span className="muted">{selectors.formatKB(sk.bytes)} KB · {sk.model ? '模型可调用' : '仅用户可用'}</span>
              <button className="linkbtn" data-manage="skill" data-name={sk.name}
                onClick={() => actions.openDetail({ kind: 'skill', name: sk.name })}>详情</button>
            </div>
          ))}
          {!skillList.length && <div className="empty">没有匹配的技能。</div>}
        </details>

        <details className="unlisted">
          <summary>未列入的资源（点一下加入本组）</summary>
          <div className="chips">
            {sections.filter((s) => !check('section', s.name) && (!needle || s.name.toLowerCase().includes(needle))).map((s) => (
              <button key={s.name} className="add-chip" data-additem data-kind="section" data-name={s.name}
                onClick={() => actions.addDraftItem(g, 'section', s.name)}>+ {s.name}</button>
            ))}
            {visibleServers.filter((s) => !check('mcp', s.name) && (!needle || s.name.toLowerCase().includes(needle))).map((s) => (
              <button key={s.name} className="add-chip" data-additem data-kind="mcp" data-name={s.name}
                onClick={() => actions.addDraftItem(g, 'mcp', s.name)}>+ ⚡{s.name}</button>
            ))}
            {visibleSkills.filter((s) => !check('skill', s.name) && (!needle || s.name.toLowerCase().includes(needle))).map((s) => (
              <button key={s.name} className="add-chip" data-additem data-kind="skill" data-name={s.name}
                onClick={() => actions.addDraftItem(g, 'skill', s.name)}>+ ◆{s.name}</button>
            ))}
          </div>
        </details>
      </div>
      <div className="editor-foot">
        {effId !== g.id && <button className="btn small" data-effective title={dirty ? '保存当前更改并设为生效分组' : '设为当前作用域的生效分组，右侧预览即时更新'} onClick={() => actions.setEffectiveGroup(g.id)}>{dirty ? '保存并设为生效' : '设为生效'}</button>}
        <button id="saveBtn" className="btn primary" title="只保存草稿，不改动生效分组" disabled={!dirty} onClick={onSave}>保存草稿</button>
        <button id="revertBtn" className="btn" disabled={!dirty} onClick={onRevert}>还原</button>
        {dirty && <span className="hint dirty">未保存更改</span>}
        <span className="grow"></span>
        {delArm
          ? <><button className="btn danger small" data-gdel="yes" onClick={() => actions.deleteItem(g, 'group')}>确认删除</button>
              <button className="btn small" onClick={() => setDelArm(false)}>取消</button></>
          : <button id="deleteBtn" className="btn danger" onClick={() => setDelArm(true)}>删除分组</button>}
      </div>
    </>
  )
}
