import { useEffect, useState } from 'react'
import { SCOPE_LABEL, type CustomDraft, type CustomPrompt } from '../../contracts'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'

export default function CustomEditor({ c }: { c: CustomPrompt }) {
  const { state, actions, selectors } = useAppViewModel()
  const draftKey = 'custom:' + c.id
  const stash = state.drafts[draftKey] as CustomDraft | undefined
  const [name, setName] = useState(stash ? stash.name : c.title)
  const [text, setText] = useState(stash ? stash.text : c.text)

  useEffect(() => {
    const d = state.drafts[draftKey] as CustomDraft | undefined
    setName(d ? d.name : c.title)
    setText(d ? d.text : c.text)
  }, [c.id])

  const dirty = name !== c.title || text !== c.text
  const onSave = () => actions.saveCustom(c, name, text)
  const onRevert = () => {
    actions.revertCustom(c)
    setName(c.title)
    setText(c.text)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.modal')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && dirty) {
        e.preventDefault()
        actions.saveCustom(c, name, text)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, name, text, c.id])

  const [delArm, setDelArm] = useState(false)
  useEffect(() => { setDelArm(false) }, [c.id])

  return (
    <>
      <div className="editor-head">
        <div className="crumbs">
          <span>{selectors.scopeCrumb(c.scope, state.meta)}</span><span className="sep">›</span><span>自定义提示词</span>
        </div>
        <div className="title-row">
          <input id="itemName" className="title-input" value={name}
            onChange={(e) => { setName(e.target.value); actions.setCustomDraft(c.id, e.target.value, text) }}
            aria-label="自定义标题" />
          <span className={'chip scope-' + c.scope.kind}>{SCOPE_LABEL[c.scope.kind]}</span>
        </div>
      </div>
      <div className="editor-body">
        <div className="banner">自定义提示词追加到生效正文末尾；只影响当前作用域。</div>
        <div className="field-label">正文</div>
        <textarea id="customText" className="custom-text" value={text}
          onChange={(e) => { setText(e.target.value); actions.setCustomDraft(c.id, name, e.target.value) }}
          placeholder="写给模型的补充说明…" />
        <div className="editor-meta">
          <span id="charCount">{text.length} 字 · ≈ {selectors.tokenEstimate(text)} tok</span>
          <span className="grow"></span>
          <span id="saveState">{dirty ? '未保存' : '已保存'}</span>
        </div>
        <div className="note">保存前右侧预览不会包含这里的改动。</div>
      </div>
      <div className="editor-foot">
        <button id="saveBtn" className="btn primary" disabled={!dirty} onClick={onSave}>保存</button>
        <button id="revertBtn" className="btn" disabled={!dirty} onClick={onRevert}>还原</button>
        <span className="grow"></span>
        {delArm
          ? <><button className="btn danger small" data-cdel="yes" onClick={() => actions.deleteItem(c, 'custom')}>确认删除</button>
              <button className="btn small" onClick={() => setDelArm(false)}>取消</button></>
          : <button id="deleteBtn" className="btn danger" onClick={() => setDelArm(true)}>删除自定义</button>}
      </div>
    </>
  )
}
