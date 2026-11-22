import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import {
  SCOPE_LABEL,
  type Group,
  type GroupItem,
  type GroupItemKind,
} from '../../contracts'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'

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
      <span className="c-label">{label}</span>
      {meta && <span className="muted">{meta}</span>}
    </div>
  )
}

export default function GroupEditor({ g }: { g: Group }) {
  const { state, actions, selectors } = useAppViewModel()
  const sections = state.meta.sections
  const [name, setName] = useState(g.name)
  useEffect(() => { actions.ensureDraft(g) }, [g.id])
  useEffect(() => { setName(g.name) }, [g.id, g.name])
  const draft = (state.drafts[selectors.draftId(g)] as GroupItem[] | undefined) || g.items
  const dirty = name !== g.name || JSON.stringify(draft) !== JSON.stringify(g.items)
  const counts: Record<GroupItemKind, number> = { section: 0, mcp: 0, skill: 0 }
  draft.forEach((it) => { if (counts[it.kind] !== undefined) counts[it.kind]++ })
  const visibleSkills = state.skills.filter((s) => selectors.skillVisible(s, state.scope, state.meta))
  const sources = selectors.groupSources(state.meta)
  const check = (kind: GroupItemKind, n: string): boolean => selectors.hasItem(draft, kind, n)
  const toggle = (kind: GroupItemKind, n: string) => actions.toggleDraftCheck(g, kind, n)
  const onSave = () => { actions.saveGroup(g, name) }
  const onRevert = () => { actions.revertGroup(g); setName(g.name) }

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
        </div>
      </div>
      <div className="editor-body">
        <div className="banner">启用后只保留本组列出的项；未列入的资源不会进入生效提示词。勾选变化需点「保存」才生效。</div>
        <div className="summary-line">
          <span className="pill" id="sumSection">提示词段 {counts.section}</span>
          <span className="pill" id="sumMcp">MCP {counts.mcp}</span>
          <span className="pill" id="sumSkill">技能 {counts.skill}</span>
          <span className="grow"></span>
          <span className="muted" id="sumChars">≈ {selectors.groupTokens({ items: draft }, state)} tok</span>
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
        <div className="res-head">提示词段 <span className="count" id="secCount">{counts.section}</span>
          <span className="tag" title="只放行分组列出的段，未列入的不进入提示词">水泄式过滤</span></div>
        {sources.map((src) => {
          const list = sections.filter((s) => s.source === src && s.kind === 'section')
          if (!list.length) return null
          return (
            <div key={src}>
              <div className="source-head">{src}</div>
              {list.map((s) => (
                <CheckRow key={s.name} kind="section" name={s.name} label={s.name} meta={s.tokens + ' tok'}
                  checked={check('section', s.name)} onChange={() => toggle('section', s.name)} />
              ))}
            </div>
          )
        })}
        <div className="source-head">运行上下文</div>
        <CheckRow kind="section" name="working-directory:current" label="working-directory:current" meta="26 tok"
          checked disabled />

        <div className="res-head">MCP 服务器 <span className="count" id="mcpCount">{counts.mcp}</span>
          <span className="tag cat-mcp" title="勾选服务器会同时带上它的配对段与工具">段 + 工具成对</span></div>
        {selectors.filteredServers(state).map((srv) => (
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

        <div className="res-head">技能 <span className="count" id="skillCount">{counts.skill}</span>
          <span className="tag">按可见性</span></div>
        {visibleSkills.map((sk) => (
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

        <details className="unlisted">
          <summary>未列入的资源（点一下加入本组）</summary>
          <div className="chips">
            {sections.filter((s) => s.kind === 'section' && !check('section', s.name)).map((s) => (
              <button key={s.name} className="add-chip" data-additem data-kind="section" data-name={s.name}
                onClick={() => actions.addDraftItem(g, 'section', s.name)}>+ {s.name}</button>
            ))}
            {state.servers.filter((s) => !check('mcp', s.name)).map((s) => (
              <button key={s.name} className="add-chip" data-additem data-kind="mcp" data-name={s.name}
                onClick={() => actions.addDraftItem(g, 'mcp', s.name)}>+ ⚡{s.name}</button>
            ))}
            {visibleSkills.filter((s) => !check('skill', s.name)).map((s) => (
              <button key={s.name} className="add-chip" data-additem data-kind="skill" data-name={s.name}
                onClick={() => actions.addDraftItem(g, 'skill', s.name)}>+ ◆{s.name}</button>
            ))}
          </div>
        </details>
      </div>
      <div className="editor-foot">
        {effId !== g.id && <button className="btn small" data-effective title="设为当前作用域的生效分组，右侧预览即时更新" onClick={() => actions.setEffectiveGroup(g.id)}>设为生效</button>}
        <button id="saveBtn" className="btn primary" disabled={!dirty} onClick={onSave}>保存</button>
        <button id="revertBtn" className="btn" disabled={!dirty} onClick={onRevert}>还原</button>
        <span className="grow"></span>
        {delArm
          ? <><button className="btn danger small" data-gdel="yes" onClick={() => actions.deleteItem(g, 'group')}>确认删除</button>
              <button className="btn small" onClick={() => setDelArm(false)}>取消</button></>
          : <button id="deleteBtn" className="btn danger" onClick={() => setDelArm(true)}>删除分组</button>}
      </div>
    </>
  )
}
