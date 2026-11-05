import type { KeyboardEvent, ReactNode } from 'react'

type Item<T> = { value: T; label: ReactNode; className?: string }

/**
 * WAI-ARIA の tablist。選択中のタブだけが Tab キーで止まり、矢印キー・Home・End で移動する（移動と同時に選択する）。
 * タブの id は `${idPrefix}-tab-${value}`。panelId は全タブ共通のパネルの id か、タブごとのパネルの id を返す関数。
 * nav は目印として外側に置き、role="tablist" は内側の div に付ける（nav の役割を上書きしないため）。
 */
export function TabList<T extends string | number>({
  items,
  selected,
  onSelect,
  label,
  idPrefix,
  panelId,
  className,
}: {
  items: readonly Item<T>[]
  selected: T
  onSelect: (value: T) => void
  label: string
  idPrefix: string
  panelId: string | ((value: T) => string)
  className?: string
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const i = items.findIndex((it) => it.value === selected)
    const last = items.length - 1
    const keys: Record<string, number> = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }
    const next = keys[e.key]
    if (next === undefined) return
    e.preventDefault()
    const value = items[next].value
    onSelect(value)
    e.currentTarget.ownerDocument.getElementById(`${idPrefix}-tab-${value}`)?.focus()
  }

  return (
    <nav className={className} aria-label={label}>
      <div className="tablist" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {items.map((it) => {
          const active = it.value === selected
          return (
            <button
              key={it.value}
              id={`${idPrefix}-tab-${it.value}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={typeof panelId === 'string' ? panelId : panelId(it.value)}
              tabIndex={active ? 0 : -1}
              className={`${it.className ?? ''} ${active ? 'active' : ''}`.trim()}
              onClick={() => onSelect(it.value)}
            >
              {it.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
