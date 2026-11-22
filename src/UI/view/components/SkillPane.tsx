import { useState } from 'react'
import type { Skill } from '../../contracts'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'
import Markdown from './Markdown'

function skillFile(sk: Skill): string {
  const lines = ['---', `name: ${sk.name}`, `description: ${sk.desc}`]
  if (sk.model || sk.user) lines.push(`invocation: ${[sk.model ? 'model' : '', sk.user ? 'user' : ''].filter(Boolean).join(', ')}`)
  lines.push('---', '', `# ${sk.label || sk.name}`, '', sk.text)
  return lines.join('\n')
}

export default function SkillPane() {
  const { state, actions, selectors } = useAppViewModel()
  const [view, setView] = useState<'preview' | 'raw'>('preview')
  const sk = selectors.resolvedSkill(state, state.sel.skill)
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
  const local = sk.scope === 'workspace' && state.scope.kind === 'workspace'
  const inherited = sk.scope === 'global' && state.scope.kind === 'workspace'
  return (
    <>
      <div className="editor-head">
        <div className="crumbs">
          <span>{selectors.scopeCrumb(state.scope, state.meta)}</span><span className="sep">›</span><span>技能</span>
        </div>
        <div className="title-row"><strong>{sk.label || sk.name}</strong><span className="muted">/ {sk.name}</span>
          {sk.bundled && <span className="tag">插件</span>}
          <span className="tag" title={sk.scope === 'global' ? '定义在全局' : '定义在当前工作区'}>{sk.scope === 'global' ? '全局定义' : '工作区定义'}</span>
          {local && <span className="tag" title="本层定义，覆盖同名全局技能">本层覆盖</span>}
          {inherited && <span className="tag" title="继承自全局，本层可停用或复制覆盖">继承自全局</span>}
          {off && <span className="tag">已停用</span>}
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
        <div className="skilldoc-head">
          <span className="group-label">SKILL.md</span>
          <div className="seg" role="tablist" aria-label="SKILL.md 显示方式">
            <button role="tab" aria-selected={view === 'preview'} data-skillview="preview"
              className={'btn small' + (view === 'preview' ? ' active' : '')} onClick={() => setView('preview')}>预览</button>
            <button role="tab" aria-selected={view === 'raw'} data-skillview="raw"
              className={'btn small' + (view === 'raw' ? ' active' : '')} onClick={() => setView('raw')}>原文</button>
          </div>
        </div>
        {view === 'preview'
          ? <div className="skilldoc"><Markdown source={skillFile(sk)} /></div>
          : <pre className="md-raw" data-skillraw>{skillFile(sk)}</pre>}
        <div className="detail-actions">
          <button className="btn small" data-sktoggle disabled={!!sk.bundled} onClick={() => actions.toggleSkill(sk.name)}>{off ? '启用' : '停用'}</button>
          {sk.scope === 'global'
            ? (state.scope.kind !== 'global' && <button className="btn small" data-skillmove="workspace" onClick={() => actions.moveSkill(sk.name, 'workspace')}>复制到当前工作区</button>)
            : <button className="btn small" data-skillmove="global" onClick={() => actions.moveSkill(sk.name, 'global')}>复制到全局</button>}
          <button className="btn small" data-groupitem onClick={() => actions.setGroupItem('skill', sk.name)}>{inGroup ? '从分组移除' : '加入分组'}</button>
          <button className="btn small" data-skopen onClick={() => actions.openSkillDir()}>打开目录</button>
          {state.skDelConfirm === sk.name
            ? <><button className="btn danger small" data-skdel="yes" onClick={() => actions.deleteSkill(sk.name)}>{local ? '确认删除' : '确认停用'}</button>
                <button className="btn small" onClick={() => actions.setSkDelConfirm(null)}>取消</button></>
            : <button className="btn small" data-skdel onClick={() => actions.setSkDelConfirm(sk.name)}>{local ? '删除' : '在本层停用'}</button>}
        </div>
      </div>
      <div className="editor-foot"><span className="hint">技能定义按作用域保存：工作区同名定义覆盖全局，其他工作区不受影响。停用只影响当前作用域；删除工作区定义后恢复继承全局。</span></div>
    </>
  )
}
