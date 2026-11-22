import { useAppViewModel } from '../../viewmodel/useAppViewModel'

export default function SkillPane() {
  const { state, actions, selectors } = useAppViewModel()
  const sk = state.skills.find((s) => s.name === state.sel.skill)
  if (!sk) {
    return (
      <>
        <div className="editor-head">
          <div className="crumbs">
            <span>{selectors.scopeCrumb(state.scope, state.meta)}</span><span className="sep">›</span><span>技能</span>
          </div>
        </div>
        <div className="editor-body"><div className="empty">左侧选择一个技能。这里管理技能的启用、作用域、分组成员关系与删除。</div></div>
        <div className="editor-foot"></div>
      </>
    )
  }
  const group = selectors.currentGroup(state)
  const inGroup = !!group && selectors.hasItem(group.items, 'skill', sk.name)
  const off = !selectors.effSkillEnabled(state, sk.name)
  const covered = state.scope.kind !== 'global' &&
    ((state.overrides.skill[selectors.scopeKey(state.scope)] || {})[sk.name] !== undefined)
  return (
    <>
      <div className="editor-head">
        <div className="crumbs">
          <span>{selectors.scopeCrumb(state.scope, state.meta)}</span><span className="sep">›</span><span>技能</span>
        </div>
        <div className="title-row"><strong>{sk.label || sk.name}</strong><span className="muted">/ {sk.name}</span>
          {sk.bundled && <span className="tag">插件</span>}
          {off && <span className="tag">已停用</span>}
          {covered && <span className="tag" title="本层显式设置，覆盖下层">本层覆盖</span>}
          <span className={'chip ' + (inGroup ? 'chip-on' : '')}
            title={inGroup ? '已列入当前生效分组' : '未列入当前生效分组'}>{inGroup ? '本组' : '未入组'}</span>
        </div>
      </div>
      <div className="editor-body">
        <dl className="meta-grid">
          <dt>位置</dt><dd>{sk.scope === 'global' ? '~/.dsh/skills/' + sk.name + '/SKILL.md' : '.dsh/skills/（工作区）'}</dd>
          <dt>体积</dt><dd>{selectors.formatKB(sk.bytes)} KB</dd>
          <dt>状态</dt><dd>{off ? '停用' : '启用'}</dd>
          <dt>调用策略</dt><dd>{sk.model ? '模型可调用' : '仅用户可用'} · {sk.user ? '用户可调用' : '不向用户暴露'}</dd>
        </dl>
        <div className="group-label">技能说明</div>
        <div className="detail-text desc">{sk.desc}</div>
        <div className="detail-text">{sk.text}</div>
        <div className="detail-actions">
          <button className="btn small" data-sktoggle disabled={!!sk.bundled} onClick={() => actions.toggleSkill(sk.name)}>{off ? '启用' : '停用'}</button>
          {sk.scope === 'global'
            ? (state.scope.kind !== 'global' && <button className="btn small" data-skillmove="workspace" onClick={() => actions.moveSkill(sk.name, 'workspace')}>移到当前工作区</button>)
            : <button className="btn small" data-skillmove="global" onClick={() => actions.moveSkill(sk.name, 'global')}>移到全局</button>}
          <button className="btn small" data-groupitem onClick={() => actions.setGroupItem('skill', sk.name)}>{inGroup ? '从分组移除' : '加入分组'}</button>
          <button className="btn small" data-skopen onClick={() => actions.openSkillDir()}>打开目录</button>
          {state.skDelConfirm === sk.name
            ? <><button className="btn danger small" data-skdel="yes" onClick={() => actions.deleteSkill(sk.name)}>确认删除</button>
                <button className="btn small" onClick={() => actions.setSkDelConfirm(null)}>取消</button></>
            : <button className="btn small" data-skdel onClick={() => actions.setSkDelConfirm(sk.name)}>删除</button>}
        </div>
      </div>
      <div className="editor-foot"><span className="hint">启用状态按层覆盖：本层修改影响本层及上层；删除可从 toast 撤销。插件自带技能不可停用/删除。</span></div>
    </>
  )
}
