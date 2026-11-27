import type { GroupItemKind } from '../../contracts'
import { useAppViewModel } from '../../viewmodel/useAppViewModel'

/**
 * 资源行上的成员关系状态。成员写入只发生在配置集编辑器；
 * 目录与详情页只说明它是否在生效配置集里。
 */
export default function GroupStatus({ kind, name }: { kind: GroupItemKind | 'context'; name: string }) {
  const { state, selectors } = useAppViewModel()
  if (kind === 'context') {
    return <span className="i-on" title="运行上下文不参与配置集，始终注入">始终注入</span>
  }

  const current = selectors.currentGroup(state)
  const winner = selectors.winningLayer(state)
  const anchor = current ?? winner.group
  const chainGroups = selectors
    .chainFor(state.scope, state.meta)
    .flatMap((scope) => selectors.groupsOf(state.groups, scope, state.meta))
  const others = chainGroups.filter(
    (group) => group.id !== anchor?.id && selectors.hasItem(group.items, kind, name),
  ).length

  if (current) {
    const draft = state.drafts[selectors.draftId(current)]
    const items = Array.isArray(draft) ? draft : current.items
    const on = selectors.hasItem(items, kind, name)
    return (
      <>
        <span className={on ? 'i-on' : 'i-off'} data-groupstatus data-kind={kind} data-name={name}
          data-state={on ? 'included' : 'excluded'}
          title={on ? '已包含在当前配置集「' + current.name + '」' : '未包含在当前配置集「' + current.name + '」'}>
          {on ? '已包含' : '未包含'}
        </span>
        {others > 0 && <span className="tag" title={'还列在 ' + others + ' 个其他配置集'}>另 {others} 个配置集</span>}
      </>
    )
  }

  if (winner.group) {
    const on = selectors.hasItem(winner.group.items, kind, name)
    if (on) {
      return <span className="i-on" data-groupstatus data-kind={kind} data-name={name} data-state="effective"
        title={'由继承的配置集「' + winner.group.name + '」生效'}>生效</span>
    }
    return others > 0
      ? <span className="tag" data-groupstatus data-kind={kind} data-name={name} data-state="other">另 {others} 个配置集</span>
      : <span className="i-off" data-groupstatus data-kind={kind} data-name={name} data-state="unlisted"
        title="当前生效配置集没有引用它">未列入</span>
  }

  return <span className="tag" data-groupstatus data-kind={kind} data-name={name} data-state="none"
    title="当前作用域没有生效配置集；新建并设为生效后才会过滤">无生效配置集</span>
}
