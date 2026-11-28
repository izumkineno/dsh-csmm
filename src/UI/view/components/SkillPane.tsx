import { useEffect, useState } from 'react'
import { DSH_SOURCE_LABEL, type DshSkillDetail, type Skill, type SkillDraft } from '../../contracts'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'
import Markdown from './Markdown'
import GroupStatus from './GroupStatus'
import SkillEditor from './SkillEditor'
import SkillSourceEditor from './SkillSourceEditor'

function skillFile(sk: Skill): string {
  const lines = ['---', `name: ${sk.name}`, `description: ${sk.desc}`]
  if (sk.model || sk.user) lines.push(`invocation: ${[sk.model ? 'model' : '', sk.user ? 'user' : ''].filter(Boolean).join(', ')}`)
  lines.push('---', '', `# ${sk.label || sk.name}`, '', sk.text)
  return lines.join('\n')
}

function dshSkillFile(sk: DshSkillDetail): string {
  const lines = ['---', `name: ${sk.name}`, `description: ${sk.description}`]
  if (sk.whenToUse) lines.push(`when-to-use: ${sk.whenToUse}`)
  if (!sk.model) lines.push('disable-model-invocation: true')
  if (!sk.user) lines.push('user-invocable: false')
  lines.push('---', '', sk.content || '（正文为空）')
  return lines.join('\n')
}

const draftOf = (sk: Skill): SkillDraft => ({
  label: sk.label,
  desc: sk.desc,
  text: sk.text,
  model: sk.model,
  user: sk.user,
})

export default function SkillPane() {
  const { state, actions, selectors } = useAppViewModel()
  const [view, setView] = useState<'preview' | 'edit'>('preview')
  const [dshView, setDshView] = useState<'preview' | 'source'>('preview')
  const [copying, setCopying] = useState(false)
  const skName = state.selected.skill?.kind === 'skill' ? state.selected.skill.name : null
  const sk = selectors.resolvedSkill(state, skName)
  const dsh = skName ? selectors.dshSkill(state, skName) : undefined
  const dshName = dsh?.name
  const dshDoc = dshName && state.dshDoc.name === dshName ? state.dshDoc : undefined

  useEffect(() => {
    setView('preview')
    setDshView('preview')
    setCopying(false)
  }, [skName])

  useEffect(() => {
    if (!dshName) return
    if (state.dshDoc.name === dshName && state.dshDoc.status !== 'idle') return
    actions.loadDshSkill(dshName)
  }, [dshName, state.dshDoc.name, state.dshDoc.status, actions])

  if (!sk) {
    if (dsh) {
      const ready = dshDoc?.status === 'ready' && dshDoc.detail ? dshDoc.detail : undefined
      const editableSource = dsh.origin === 'workspace' && ready?.raw !== undefined
      const sourceState = dshDoc?.name === dsh.name ? state.sourceState : { status: 'idle' as const, name: dsh.name }
      return (
        <>
          <div className="editor-head">
            <div className="crumbs">
              <span>{selectors.scopeCrumb(state.scope, state.meta)}</span><span className="sep">›</span><span>技能</span>
            </div>
            <div className="title-row"><strong>{dsh.name}</strong><span className="tag">DSH</span>
              <span className="tag" title={dsh.origin === 'workspace' ? '当前工作区可见' : '全局可见'}>{dsh.origin === 'workspace' ? '工作区' : '全局'}</span>
            </div>
          </div>
          <div className="editor-body" data-dsh-pane data-name={dsh.name}>
            <dl className="meta-grid">
              <dt>来源</dt><dd data-dsh-source={dsh.source}>{DSH_SOURCE_LABEL[dsh.source] ?? dsh.source}{dsh.provider ? ' · ' + dsh.provider : ''}</dd>
              {dsh.path && <><dt>位置</dt><dd>{dsh.path}</dd></>}
              <dt>作用域</dt><dd>{dsh.origin === 'workspace' ? '当前工作区可见' : '全局可见'}</dd>
              <dt>调用策略</dt><dd>{dsh.model ? '模型可调用' : '仅用户可用'} · {dsh.user ? '用户可调用' : '不向用户暴露'}</dd>
              <dt>说明</dt><dd>{dsh.description || '无描述'}</dd>
              {dsh.whenToUse && <><dt>何时使用</dt><dd>{dsh.whenToUse}</dd></>}
            </dl>
            <div className="skilldoc-head">
              <span className="group-label">SKILL.md</span>
              {ready && (
                <div className="seg" role="tablist" aria-label="SKILL.md 显示方式">
                  <button role="tab" aria-selected={dshView === 'preview'} data-dshview="preview"
                    className={'btn small' + (dshView === 'preview' ? ' active' : '')} onClick={() => setDshView('preview')}>预览</button>
                  {editableSource && (
                    <button role="tab" aria-selected={dshView === 'source'} data-dshsource-edit data-dshview="source"
                      className={'btn small' + (dshView === 'source' ? ' active' : '')} onClick={() => setDshView('source')}>编辑源文件</button>
                  )}
                </div>
              )}
            </div>
            {dshDoc?.status === 'error'
              ? (
                <div className="note" data-dsh-doc-error>
                  读取技能正文失败：{dshDoc.error}
                  <button className="btn small" data-dshretry onClick={() => actions.loadDshSkill(dsh.name)}>重试</button>
                </div>
              )
              : dshDoc?.status === 'ready' && dshDoc.detail
                ? (dshView === 'source' && editableSource
                    ? <SkillSourceEditor
                        detail={dshDoc.detail}
                        state={sourceState}
                        onChange={(text) => actions.setDshSourceText(text)}
                        onSave={() => { void actions.saveDshSkillSource(dsh.name, state.sourceState.raw ?? '') }}
                        onReload={() => { void actions.reloadDshSkillSource(dsh.name) }}
                      />
                    : <div className="skilldoc" data-dshpreview><Markdown source={dshSkillFile(dshDoc.detail)} /></div>)
                : <div className="note" data-dsh-doc-loading>正在读取技能正文…</div>}
            {dsh.origin === 'global' && (
              <div className="detail-actions">
                <button className="btn" data-dsh-copy disabled={copying}
                  onClick={() => {
                    setCopying(true)
                    void actions.copyDshSkillToWorkspace(dsh.name).finally(() => setCopying(false))
                  }}>{copying ? '复制中…' : '复制到工作区并编辑'}</button>
              </div>
            )}
            <div className="note" data-dsh-note>
              {dsh.origin === 'workspace'
                ? '这是当前工作区的项目技能源文件，可在“编辑源文件”中修改；保存后重开会话生效。'
                : '由 DSH 技能注册表提供，全局/用户级技能只读；可复制到工作区后编辑。停用或修改请在 DSH 侧进行。'}
            </div>
          </div>
          <div className="editor-foot"><span className="hint">DSH 技能来自当前作用域可见的注册表；顶部刷新按钮会重新读取目录与正文。</span></div>
        </>
      )
    }
    return (
      <>
        <div className="editor-head">
          <div className="crumbs">
            <span>{selectors.scopeCrumb(state.scope, state.meta)}</span><span className="sep">›</span><span>技能</span>
          </div>
        </div>
        <div className="editor-body"><div className="empty">左侧选择一个技能。这里管理技能的启用、作用域、配置集归属与删除。</div></div>
        <div className="editor-foot"></div>
      </>
    )
  }
  const off = !selectors.effSkillEnabled(state, sk.name)
  const local = sk.scope === 'workspace' && state.scope.kind === 'workspace'
  const inherited = sk.scope === 'global' && state.scope.kind === 'workspace'
  const draft = selectors.skillDraft(state, sk.name) ?? draftOf(sk)
  const dirty = selectors.skillDirty(state, sk.name)
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
        </div>
      </div>
      <div className="editor-body" data-skill-pane data-name={sk.name}>
        <dl className="meta-grid">
          <dt>位置</dt><dd>{sk.scope === 'global' ? '~/.dsh/skills/' + sk.name + '/SKILL.md' : '.dsh/skills/（工作区）'}</dd>
          <dt>体积</dt><dd>{selectors.formatKB(sk.bytes)} KB</dd>
          <dt>状态</dt><dd>{off ? '停用' : '启用'}</dd>
          <dt>配置集</dt><dd><GroupStatus kind="skill" name={sk.name} /></dd>
          <dt>调用策略</dt><dd>{sk.model ? '模型可调用' : '仅用户可用'} · {sk.user ? '用户可调用' : '不向用户暴露'}</dd>
        </dl>
        <div className="skilldoc-head">
          <span className="group-label">SKILL.md</span>
          <div className="seg" role="tablist" aria-label="SKILL.md 显示方式">
            <button role="tab" aria-selected={view === 'preview'} data-skillview="preview"
              className={'btn small' + (view === 'preview' ? ' active' : '')} onClick={() => setView('preview')}>预览</button>
            <button role="tab" aria-selected={view === 'edit'} data-skill-edit data-skillview="edit"
              className={'btn small' + (view === 'edit' ? ' active' : '')} onClick={() => setView('edit')}>编辑</button>
          </div>
        </div>
        {view === 'preview'
          ? <div className="skilldoc"><Markdown source={skillFile(sk)} /></div>
          : <SkillEditor
              name={sk.name}
              draft={draft}
              dirty={dirty}
              onChange={(patch) => actions.setSkillDraft(sk.name, patch)}
              onSave={() => { void actions.saveSkill(sk.name) }}
              onRevert={() => actions.revertSkill(sk.name)}
            />}
        <div className="detail-actions">
          <button className="btn small" data-sktoggle disabled={!!sk.bundled} onClick={() => actions.toggleSkill(sk.name)}>{off ? '启用' : '停用'}</button>
          {sk.scope === 'global'
            ? (state.scope.kind !== 'global' && <button className="btn small" data-skillmove="workspace" onClick={() => actions.moveSkill(sk.name, 'workspace')}>复制到当前工作区</button>)
            : <button className="btn small" data-skillmove="global" onClick={() => actions.moveSkill(sk.name, 'global')}>复制到全局</button>}
          <button className="btn small" data-editgroup onClick={() => actions.editInGroup('skill', sk.name)}>在配置集中编辑</button>
          <button className="btn small" data-skopen onClick={() => actions.openSkillDir()}>打开目录</button>
          {state.skDelConfirm === sk.name
            ? <><button className="btn danger small" data-skdel="yes" onClick={() => actions.deleteSkill(sk.name)}>{local ? '确认删除' : '确认停用'}</button>
                <button className="btn small" onClick={() => actions.setSkDelConfirm(null)}>取消</button></>
            : <button className="btn small" data-skill-delete data-skdel onClick={() => actions.setSkDelConfirm(sk.name)}>{local ? '删除' : '在本层停用'}</button>}
        </div>
      </div>
      <div className="editor-foot"><span className="hint">技能定义按作用域保存：工作区同名定义覆盖全局，其他工作区不受影响。停用只影响当前作用域；删除工作区定义后恢复继承全局。</span></div>
    </>
  )
}
