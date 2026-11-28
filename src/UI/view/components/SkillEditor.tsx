import type { KeyboardEvent } from 'react'
import type { SkillDraft } from '../../contracts'

interface SkillEditorProps {
  name: string
  draft: SkillDraft
  dirty: boolean
  disabled?: boolean
  onChange: (patch: Partial<SkillDraft>) => void
  onSave: () => void
  onRevert: () => void
}

/** 插件技能编辑器：所有值来自视图模型草稿，组件本身不持有编辑状态。 */
export default function SkillEditor({ name, draft, dirty, disabled = false, onChange, onSave, onRevert }: SkillEditorProps) {
  const onTextKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (dirty && !disabled) onSave()
    }
  }
  return (
    <div className="skill-editor" data-skill-editor>
      <div className="field-label">名称</div>
      <input className="f-input" value={name} readOnly aria-label="技能名称（只读）" data-skill-field="name" />
      <div className="field-label">显示名称</div>
      <input className="f-input" value={draft.label} aria-label="技能显示名称"
        data-skill-field="label" onChange={(e) => onChange({ label: e.target.value })} />
      <div className="field-label">描述</div>
      <textarea className="f-area skill-desc" value={draft.desc} aria-label="技能描述"
        data-skill-field="desc" onChange={(e) => onChange({ desc: e.target.value })} />
      <div className="field-label">正文（SKILL.md 的 Markdown 部分）</div>
      <textarea className="skill-text" value={draft.text} aria-label="技能正文" onKeyDown={onTextKeyDown}
        data-skill-field="text" onChange={(e) => onChange({ text: e.target.value })} />
      <div className="skill-invocation">
        <label><input type="checkbox" checked={draft.model}
          data-skill-field="model" onChange={(e) => onChange({ model: e.target.checked })} /> 模型可调用</label>
        <label><input type="checkbox" checked={draft.user}
          data-skill-field="user" onChange={(e) => onChange({ user: e.target.checked })} /> 用户可调用</label>
      </div>
      <div className="editor-meta">
        <span>{draft.text.length} 字</span>
        <span className={'skill-dirty' + (dirty ? ' on' : '')} data-skill-dirty={dirty ? 'true' : 'false'}>
          {dirty ? '未保存' : '已保存'}
        </span>
        <span className="grow"></span>
        <button className="btn primary" data-skill-save disabled={!dirty || disabled} onClick={onSave}>保存</button>
        <button className="btn" data-skill-revert disabled={!dirty || disabled} onClick={onRevert}>还原</button>
      </div>
      <div className="note">保存后重开会话生效；取消勾选模型调用后，该技能不会出现在模型上下文中。</div>
    </div>
  )
}
