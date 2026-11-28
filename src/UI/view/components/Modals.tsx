import { Fragment, useEffect, useRef, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from 'react'
import type { GroupActivateModal, MigrateModal, RawModal, ServerFormModal, WorkspaceTrustModal } from '../../contracts'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'
import { findGroup } from '../../viewmodel/helpers'
import { activationImpact, buildActivationGroup } from '../../../shared/group'
import { ServerForm } from './modals/ServerForm'

function SkillAdd() {
  const { state, actions, selectors } = useAppViewModel()
  const fileRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)
  const pick = (fromFolder: boolean) => {
    const ref = fromFolder ? dirRef : fileRef
    if (ref.current) ref.current.click()
  }
  const onChange = (e: ChangeEvent<HTMLInputElement>, fromFolder: boolean) => {
    actions.addSkillsFromFiles(e.target.files, fromFolder)
    actions.closeModal()
  }
  const dirProps = { webkitdirectory: '' } as unknown as InputHTMLAttributes<HTMLInputElement>
  return (
    <>
      <div className="hint">导入到 {selectors.scopeCrumb(state.scope, state.meta)}。文件会被解析为 SKILL.md，重名自动跳过。</div>
      <div className="pick-row">
        <button className="btn" data-skpick="file" onClick={() => pick(false)}>选择 .md / .zip 文件</button>
        <button className="btn" data-skpick="dir" onClick={() => pick(true)}>选择技能目录</button>
      </div>
      <input ref={fileRef} id="skillFileInput" type="file" multiple accept=".md,.zip" hidden
        onChange={(e) => onChange(e, false)} />
      <input ref={dirRef} id="skillDirInput" type="file" multiple hidden
        {...dirProps} onChange={(e) => onChange(e, true)} />
    </>
  )
}

function Migrate({ m }: { m: MigrateModal }) {
  const { state, actions, selectors } = useAppViewModel()
  const workspaces = state.meta.workspaces
  const ws = selectors.currentWsId(state.scope, state.meta)
  const targets = workspaces.filter((w) => w.id !== ws)
  const list = selectors.visibleSkills(state)
  const toggle = (name: string) => {
    const i = m.checked.indexOf(name)
    const checked = i < 0 ? m.checked.concat([name]) : m.checked.filter((x) => x !== name)
    actions.updateModal({ checked })
  }
  return (
    <>
      <div className="f-row"><label>源作用域</label><span>{selectors.scopeCrumb(state.scope, state.meta)}</span></div>
      <div className="f-row"><label htmlFor="migTarget">目标工作区</label>
        <select id="migTarget" value={m.target} onChange={(e) => actions.updateModal({ target: e.target.value })}>
          <option value="">— 选择 —</option>
          {targets.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
        </select>
      </div>
      <div className="f-row"><label>说明</label><span className="muted">复制到目标工作区；全局定义保留，目标已有同名技能时跳过。</span></div>
      <div className="f-row col"><label>技能</label>
        <div className="mig-list">
          {list.length === 0 && <div className="sub-empty">当前作用域没有技能</div>}
          {list.map((s) => (
            <label key={s.name} className="mig-check">
              <input type="checkbox" data-migskill checked={m.checked.indexOf(s.name) >= 0} onChange={() => toggle(s.name)} />
              <span>{s.label || s.name}</span><span className="muted">/ {s.name} · {selectors.formatKB(s.bytes)} KB</span>
            </label>
          ))}
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={() => actions.closeModal()}>取消</button>
        <button className="btn primary" data-migrun onClick={() => actions.runMigrate()}>执行复制</button>
      </div>
    </>
  )
}

function TrustPrompt({ m }: { m: WorkspaceTrustModal }) {
  const { state, actions } = useAppViewModel()
  const ws = state.meta.workspaces.find((w) => w.id === m.wsId)
  return (
    <>
      <div className="hint">首次打开这个工作区。它的 <code>.dsh</code> 配置可能包含 MCP 启动命令与本地技能，是否信任并加载？</div>
      <dl className="meta-grid">
        <dt>工作区</dt><dd>{ws ? ws.title : m.wsId}</dd>
        <dt>路径</dt><dd>{ws ? ws.path : '—'}</dd>
      </dl>
      <div className="hint">信任只影响是否加载该工作区的配置，不会改变全局配置。你可以随时在作用域栏重新打开。</div>
      <div className="modal-foot">
        <button className="btn" data-trust="decline" onClick={() => actions.declineTrust(m.wsId)}>暂不信任</button>
        <button className="btn primary" data-trust="accept" onClick={() => actions.trustWorkspace(m.wsId)}>信任并加载</button>
      </div>
    </>
  )
}

function ActivateGroup({ m }: { m: GroupActivateModal }) {
  const { state, actions, selectors } = useAppViewModel()
  const group = findGroup(state, m.groupId)
  if (!group) return <div className="hint">这个配置集已不存在，可能已在别处删除。</div>
  const draft = state.drafts[selectors.draftId(group)]
  const items = Array.isArray(draft) ? draft : group.items
  const name = (m.name ?? group.name).trim() || '未命名配置集'
  const next = buildActivationGroup({ ...group, name }, items)
  const impact = activationImpact(next)
  return (
    <>
      <div className="hint">把「{name}」设为生效后，当前作用域的提示词段与工具会按它过滤；运行上下文与插件自身提示词始终保留。</div>
      <dl className="meta-grid">
        <dt>配置集</dt><dd>{name}（{items.length} 项）</dd>
        <dt>提示词段</dt><dd>{impact.sections} 个</dd>
        <dt>工具</dt><dd>{impact.tools === 0 ? '0 个（会拒绝所有工具）' : impact.tools + ' 个（只放行勾选的）'}</dd>
      </dl>
      {impact.emptyGroup && <div className="note" data-impact="empty">这个配置集没有任何成员。设为生效后，除运行上下文和插件自身段外，其余提示词段都会被过滤，所有工具也会被拒绝。</div>}
      {!impact.emptyGroup && impact.noSections && <div className="note" data-impact="no-sections">这个配置集没有提示词段。设为生效后，其余提示词段都会被过滤。</div>}
      {!impact.emptyGroup && impact.noTools && <div className="note" data-impact="empty-tools">这个配置集没有工具。设为生效后，所有工具都会被拒绝。至少勾选一个工具后再设为生效。</div>}
      <div className="modal-foot">
        <button className="btn" onClick={() => actions.closeModal()}>取消</button>
        <button className="btn primary" data-confirm-activate onClick={() => actions.confirmActivateGroup(m.groupId)}>仍然设为生效</button>
      </div>
    </>
  )
}

function SkillScan() {
  const { state, actions, selectors } = useAppViewModel()
  const scan = state.scan
  const result = scan.result
  return (
    <>
      <div className="hint">只读扫描 DSH 的用户级与当前工作区技能目录；不会导入、修改或删除任何文件。</div>
      {scan.status === 'loading' && <div className="note" data-skscan="loading">正在读取技能目录…</div>}
      {scan.status === 'error' && <div className="note" data-skscan="error">扫描失败：{scan.error || '未知错误'}</div>}
      {result && (
        <>
          <dl className="meta-grid">
            <dt>扫描时间</dt><dd>{new Date(result.scannedAt).toLocaleString()}</dd>
            <dt>技能</dt><dd>{result.skills.length} 个</dd>
            {result.restricted && <><dt>范围</dt><dd>当前工作区未受信任，只扫描了全局技能。</dd></>}
          </dl>
          <div className="scan-roots">
            {result.roots.map((r) => (
              <div key={r.scope + (r.wsId || '')} className="scan-root" data-skscan-root={r.scope}>
                <span className={'tag' + (r.exists ? '' : ' off')}>{r.exists ? '存在' : '不存在'}</span>
                <span className="scan-root-scope">{r.scope === 'global' ? '用户级' : '项目级'}</span>
                <code className="scan-path">{r.path}</code>
                <span className="muted">{r.count} 个</span>
              </div>
            ))}
          </div>
          <div className="scan-list">
            {result.skills.length === 0 && <div className="sub-empty">没有扫描到技能</div>}
            {result.skills.map((sk) => (
              <div key={sk.dir} className={'scan-row' + (sk.enabled ? '' : ' disabled')} data-skscan-item data-name={sk.name}>
                <div className="scan-main">
                  <div className="scan-title">
                    <strong>{sk.label}</strong>
                    <span className="muted">/ {sk.name}</span>
                    <span className="tag">{sk.scope === 'global' ? '全局' : '工作区'}</span>
                    {!sk.enabled && <span className="tag off">已禁用</span>}
                    {sk.model === false && <span className="tag off">模型不可调用</span>}
                    {sk.user === false && <span className="tag off">用户不可调用</span>}
                  </div>
                  <div className="scan-desc">{sk.desc || '（没有 description）'}</div>
                  {sk.whenToUse && <div className="scan-when">何时使用：{sk.whenToUse}</div>}
                  <div className="scan-path">{sk.rel} · {selectors.formatKB(sk.bytes)} KB</div>
                  {sk.notes.length > 0 && <ul className="scan-notes">{sk.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
                </div>
              </div>
            ))}
          </div>
          {result.errors.length > 0 && (
            <details className="scan-errors" open>
              <summary>扫描时遇到 {result.errors.length} 个问题</summary>
              <ul>{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>
            </details>
          )}
        </>
      )}
      <div className="modal-foot">
        <button className="btn" onClick={() => actions.closeModal()}>关闭</button>
        <button className="btn primary" data-skscan="rescan" disabled={scan.status === 'loading'}
          onClick={() => actions.scanSkills()}>重新扫描</button>
      </div>
    </>
  )
}

function Raw({ m }: { m: RawModal }) {
  const { actions } = useAppViewModel()
  return (
    <>
      <div className="hint">服务器 {m.serverName} 的宿主原始配置，仅供查看；编辑请使用「编辑配置」。修改会由宿主校验并写回。</div>
      <textarea id="fRaw" className="raw-text" value={m.text} readOnly />
      <div className="modal-foot">
        <button className="btn" onClick={() => actions.closeModal()}>关闭</button>
      </div>
    </>
  )
}

export default function Modals() {
  const { state, actions } = useAppViewModel()
  const m = state.modal
  const mType = m ? m.type : null
  const modalRef = useRef<HTMLDivElement>(null)
  const prevFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!mType) return
    prevFocus.current = document.activeElement as HTMLElement | null
    const node = modalRef.current
    const first = node && (
      node.querySelector<HTMLElement>('.modal-body button, .modal-body input:not([hidden]), .modal-body select, .modal-body textarea')
      || node.querySelector<HTMLElement>('button')
    )
    if (first) first.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { actions.closeModal(); return }
      if (e.key === 'Tab' && node) {
        const items = Array.from(node.querySelectorAll<HTMLElement>('button, input:not([hidden]), select, textarea'))
          .filter((el) => !(el as HTMLButtonElement).disabled)
        if (!items.length) return
        const head = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === head) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); head.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (prevFocus.current) prevFocus.current.focus()
    }
  }, [mType])

  if (!m) return null
  const titles: Record<string, string> = {
    skillAdd: '添加技能',
    migrate: '复制技能到工作区',
    serverForm: m.type === 'serverForm' && m.editing ? '编辑 MCP 服务器' : '添加 MCP 服务器',
    raw: '原始配置',
    skillScan: '扫描 DSH 技能',
    groupActivate: '设为生效？',
    workspaceTrust: '信任此工作区？',
  }
  return (
    <div className="modal-mask" data-modalclose onMouseDown={(e) => { if (e.target === e.currentTarget) actions.closeModal() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" ref={modalRef}>
        <div className="modal-head"><strong id="modalTitle">{titles[m.type] || '编辑'}</strong>
          <button className="icon-btn" onClick={() => actions.closeModal()} aria-label="关闭">×</button></div>
        <div className="modal-body">
          {m.type === 'skillAdd' && <SkillAdd />}
          {m.type === 'migrate' && <Migrate m={m} />}
          {m.type === 'serverForm' && <ServerForm m={m} />}
          {m.type === 'raw' && <Raw m={m} />}
          {m.type === 'skillScan' && <SkillScan />}
          {m.type === 'groupActivate' && <ActivateGroup m={m} />}
          {m.type === 'workspaceTrust' && <TrustPrompt m={m} />}
        </div>
      </div>
    </div>
  )
}
