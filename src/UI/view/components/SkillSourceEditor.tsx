import type { DshSkillDetail, SkillSourceState } from '../../contracts'

interface SkillSourceEditorProps {
  detail: DshSkillDetail
  state: SkillSourceState
  onChange: (text: string) => void
  onSave: () => void
  onReload: () => void
}

const STATUS_LABEL: Record<SkillSourceState['status'], string> = {
  idle: '等待读取',
  loading: '正在读取源文件…',
  ready: '已读取源文件',
  saving: '正在保存…',
  saved: '已保存',
  error: '读取或保存失败',
  conflict: '源文件已在磁盘上变化',
}

/** DSH 工作区源文件编辑器：文本唯一来源是视图模型的 sourceState.raw。 */
export default function SkillSourceEditor({ detail, state, onChange, onSave, onReload }: SkillSourceEditorProps) {
  const raw = state.raw ?? ''
  const dirty = state.raw !== undefined && detail.raw !== undefined && state.raw !== detail.raw
  const busy = state.status === 'saving' || state.status === 'loading'
  return (
    <div className="skill-source" data-dshsource-pane data-name={detail.name}>
      <div className="source-toolbar">
        <span className="source-path">{detail.path ?? '（源文件路径不可用）'}</span>
        <span className={'chip source-status status-' + state.status} data-dshsource-status={state.status}>
          {STATUS_LABEL[state.status]}
        </span>
        <span className="grow"></span>
        <button className="btn small" data-dshsource-reload disabled={busy} onClick={onReload}>重新载入</button>
        <button className="btn primary small" data-dshsource-save
          disabled={!dirty || busy || state.status === 'conflict'} onClick={onSave}>保存源文件</button>
      </div>
      {state.status === 'conflict' && (
        <div className="source-conflict" data-dshsource-conflict={state.conflictSha ?? ''}>
          源文件已被其他操作修改{state.conflictSha ? '（当前 ' + state.conflictSha.slice(0, 12) + '…）' : ''}；为避免覆盖，请先重新载入。
        </div>
      )}
      {state.status === 'error' && state.error && (
        <div className="source-error">保存失败：{state.error}</div>
      )}
      <textarea className="skill-source-text" value={raw} readOnly={busy}
        aria-label="SKILL.md 源文件" data-dshsource-input
        onChange={(e) => onChange(e.target.value)} />
      <div className="note" data-dshsource-note>保存后重开会话生效。源文件在工作区项目目录内，保存前会做并发校验并备份旧文件。</div>
    </div>
  )
}
