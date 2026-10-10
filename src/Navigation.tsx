import { Icon, type IconName } from './ui'

export type TodayView = 'today' | 'tasks' | 'calendar' | 'review'
export const destinations: { id: TodayView; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Today', icon: 'home' },
  { id: 'tasks', label: 'やること', icon: 'check' },
  { id: 'calendar', label: 'カレンダー', icon: 'calendar' },
  { id: 'review', label: 'ふりかえり', icon: 'history' },
]

export function Navigation({
  view,
  onNavigate,
  onAdd,
  onSettings,
  onChat,
  inert,
}: {
  view: TodayView
  onNavigate: (view: TodayView) => void
  onAdd: () => void
  onSettings: () => void
  onChat?: () => void
  inert: boolean
}) {
  const links = destinations.map(({ id, label, icon }) => (
    <button
      key={id}
      className={`rail-link ${view === id ? 'active' : ''}`}
      aria-current={view === id ? 'page' : undefined}
      onClick={() => onNavigate(id)}
    >
      <Icon name={icon} size={21} />
      <span>{label}</span>
    </button>
  ))
  return (
    <>
      <aside className="rail" aria-label="デスクトップナビゲーション" inert={inert}>
        <div className="brand">
          Today
          <span className="brand-seal" aria-hidden="true">
            日
          </span>
        </div>
        <p className="rail-label">日々を、整える。</p>
        <nav aria-label="メインナビゲーション">{links}</nav>
        <button className="rail-add" onClick={onAdd}>
          <Icon name="plus" />
          追加する
        </button>
        {onChat && (
          <button className="rail-link" onClick={onChat}>
            Today AI Chat
          </button>
        )}
        <div className="rail-bottom">
          <p>あなたの今日を、ここに。</p>
          <button className="rail-link" onClick={onSettings}>
            <Icon name="settings" />
            <span>設定</span>
          </button>
        </div>
      </aside>
      <nav className="bottom-nav" aria-label="モバイルナビゲーション" inert={inert}>
        {links}
      </nav>
    </>
  )
}
