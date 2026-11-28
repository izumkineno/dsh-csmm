import { useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

type DataAttributes = Record<string, string>

const dataAttrs = (data?: DataAttributes): Record<`data-${string}`, string> | undefined =>
  data
    ? (Object.fromEntries(
        Object.entries(data).map(([key, value]) => [`data-${key}`, value]),
      ) as Record<`data-${string}`, string>)
    : undefined

export interface ResourceSearch {
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel?: string
  id?: string
  title?: string
  data?: DataAttributes
}

export interface ResourceListProps {
  search: ResourceSearch
  actions: ReactNode
  footer?: ReactNode
  children: ReactNode
}

/** 三个资源页共用的列表壳：搜索行、操作行、滚动区和可选底栏。 */
export function ResourceList({ search, actions, footer, children }: ResourceListProps) {
  return (
    <>
      <div className="list-actions">
        <input
          id={search.id}
          className="search"
          type="text"
          title={search.title}
          placeholder={search.placeholder}
          aria-label={search.ariaLabel ?? search.placeholder}
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          {...dataAttrs(search.data)}
        />
      </div>
      <div className="list-actions row2">{actions}</div>
      <div className="scroll">{children}</div>
      {footer != null && <div className="list-foot">{footer}</div>}
    </>
  )
}

const GROUP_STORAGE_PREFIX = 'dsh-csmm:groups:v1:'

function groupStorageKey(namespace: string): string {
  return GROUP_STORAGE_PREFIX + namespace
}

function readClosedGroups(key: string): Record<string, boolean> {
  try {
    if (typeof window === 'undefined') return {}
    const raw = window.localStorage.getItem(key)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const closed: Record<string, boolean> = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (value === true) closed[id] = true
    }
    return closed
  } catch {
    return {}
  }
}

function writeClosedGroups(key: string, closed: Record<string, boolean>): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(key, JSON.stringify(closed))
  } catch {
    // 浏览器禁用本地存储时退化为仅当前挂载内生效。
  }
}

/** 折叠状态按列表保存在 localStorage（作用域间保持一致）；搜索时仍强制展开。 */
export function useResourceGroups(namespace: string) {
  const storageKey = groupStorageKey(namespace)
  const [closed, setClosed] = useState<Record<string, boolean>>(() => readClosedGroups(storageKey))
  const isOpen = (id: string, forceOpen = false) => forceOpen || !closed[id]
  const toggle = (id: string) => {
    const next = { ...closed }
    if (next[id]) delete next[id]
    else next[id] = true
    setClosed(next)
    writeClosedGroups(storageKey, next)
  }
  return { isOpen, toggle }
}

export interface ResourceGroupProps {
  groupId: string
  title: ReactNode
  count?: number
  open: boolean
  onToggle: () => void
  children?: ReactNode
  empty?: ReactNode
  nested?: boolean
  data?: DataAttributes
}

/** 可折叠分组；顶层与嵌套层使用同一套标题、计数和箭头。 */
export function ResourceGroup({
  groupId,
  title,
  count,
  open,
  onToggle,
  children,
  empty,
  nested = false,
  data,
}: ResourceGroupProps) {
  const bodyId = 'rg-' + groupId.replace(/[^a-zA-Z0-9_-]+/g, '-')
  return (
    <section className={'res-group' + (nested ? ' nested' : '')} {...dataAttrs(data)}>
      <button
        type="button"
        className="res-group-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="res-twist" aria-hidden="true">▸</span>
        <span className="res-group-title">{title}</span>
        {typeof count === 'number' && <span className="count">{count}</span>}
      </button>
      {open && (
        <div className="res-group-body" id={bodyId}>
          {children}
          {empty}
        </div>
      )}
    </section>
  )
}

export interface ResourceRowProps {
  active?: boolean
  ariaLabel: string
  onClick: () => void
  data?: DataAttributes
  children: ReactNode
}

/** 三个资源页共用的行：点击、键盘和当前态样式只在这里维护。 */
export function ResourceRow({ active = false, ariaLabel, onClick, data, children }: ResourceRowProps) {
  return (
    <div
      className={'item-row' + (active ? ' active' : '')}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      {...dataAttrs(data)}
    >
      {children}
    </div>
  )
}
