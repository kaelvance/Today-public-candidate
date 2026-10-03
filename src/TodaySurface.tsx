import type { RefObject, ReactNode } from 'react'
import type { Item, ItemAction, PriorityResult } from './types'
import { TodayItem } from './TodayItem'
import { Icon } from './ui'
import type { TodayView } from './Navigation'
import { dateLabel } from './format'
import { scheduledItems } from './view-model'

export function Daylight() {
  return (
    <div className="daylight" aria-hidden="true">
      <div className="window-light" />
      <svg viewBox="0 0 240 300" fill="none">
        <path d="M204 296C154 195 159 98 66 12" stroke="currentColor" strokeWidth="3" />
        {[
          [77, 45, -32],
          [133, 84, 18],
          [110, 131, -25],
          [161, 162, 30],
          [140, 209, -29],
          [191, 237, 25],
        ].map(([x, y, r], i) => (
          <ellipse
            key={i}
            cx={x}
            cy={y}
            rx="13"
            ry="33"
            transform={`rotate(${r} ${x} ${y})`}
            fill="currentColor"
          />
        ))}
      </svg>
    </div>
  )
}

export function QuickEntry({
  onAdd,
  text,
  onText,
}: {
  onAdd: (text?: string) => void
  text: string
  onText: (text: string) => void
}) {
  return (
    <form
      className="quick-entry"
      onSubmit={(event) => {
        event.preventDefault()
        onAdd(text)
      }}
    >
      <button type="submit" className="icon-button" aria-label="追加">
        <Icon name="plus" />
      </button>
      <label className="sr-only" htmlFor="quick-entry">
        Todayに追加すること
      </label>
      <input
        id="quick-entry"
        value={text}
        maxLength={200}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          // Enter during Japanese IME composition confirms text, not the form.
          if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
        }}
        placeholder="Todayに追加…"
      />
      <button type="submit" className="icon-button quick-entry-expand" aria-label="入力内容を確認">
        <Icon name="arrow" size={18} />
      </button>
    </form>
  )
}

function Timeline({
  items,
  clock,
  onDetail,
  calendar = false,
}: {
  items: Item[]
  clock: Date
  onDetail: (item: Item) => void
  calendar?: boolean
}) {
  return (
    <div className="timeline">
      {items.length ? (
        items.map((item) => (
          <button key={item.id} className="timeline-row" onClick={() => onDetail(item)}>
            <span className="timeline-time">
              {calendar
                ? dateLabel(item.startAt || item.deadline, item.kind, clock, item.allDay)
                : item.allDay
                  ? '終日'
                  : new Intl.DateTimeFormat('ja-JP', { hour: 'numeric', minute: '2-digit' }).format(
                      new Date(item.startAt!),
                    )}
            </span>
            <span className="timeline-track">
              <span />
            </span>
            <span className="timeline-copy">
              <strong>{item.title}</strong>
              <small>{item.description || item.source}</small>
            </span>
            <Icon name="chevron" size={16} />
          </button>
        ))
      ) : (
        <p className="timeline-empty">
          {calendar ? '日時のある項目はありません' : 'この後の予定はありません'}
        </p>
      )}
    </div>
  )
}

export function TodaySurface({
  view,
  today,
  clock,
  online,
  query,
  onQuery,
  searchRef,
  items,
  attention,
  later,
  completed,
  upcoming,
  rankById,
  expanded,
  onExpand,
  onAction,
  onDetail,
  onRestore,
  onAdd,
  quickText,
  onQuickText,
  onSettings,
  onShowSamples,
  showSamples,
  canShowSamples,
  scenario,
  notices,
}: {
  view: TodayView
  today: string
  clock: Date
  online: boolean
  query: string
  onQuery: (query: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  items: Item[]
  attention: Item[]
  later: Item[]
  completed: Item[]
  upcoming: Item[]
  rankById: Map<string, PriorityResult>
  expanded: boolean
  onExpand: (expanded: boolean) => void
  onAction: (item: Item, action: ItemAction) => void
  onDetail: (item: Item) => void
  onRestore: (item: Item) => void
  onAdd: (text?: string) => void
  quickText: string
  onQuickText: (text: string) => void
  onSettings: () => void
  onShowSamples: () => void
  showSamples: boolean
  canShowSamples: boolean
  scenario: string | null
  notices: ReactNode
}) {
  const lead = attention[0]
  const rest = attention.slice(1)
  const visibleRest = expanded || query ? rest : rest.slice(0, 3)
  const hiddenCount = Math.max(0, rest.length - visibleRest.length)
  const activeItems = items.filter((item) => item.status === 'active')
  const calendarItems = scheduledItems(activeItems)
  const title =
    view === 'today'
      ? 'Today'
      : view === 'tasks'
        ? 'やること'
        : view === 'calendar'
          ? 'カレンダー'
          : 'ふりかえり'
  const row = (item: Item, prominent = false) => (
    <TodayItem
      key={item.id}
      item={item}
      rank={
        rankById.get(item.id) || {
          itemId: item.id,
          priorityScore: 0,
          reason: 'あとで確認',
          confidence: item.confidence,
          suggestedActions: [],
          layer: 'later',
        }
      }
      prominent={prominent}
      onAction={onAction}
      onDetail={onDetail}
    />
  )
  const archive = (
    <>
      {later.length > 0 && (
        <details className="archive-section">
          <summary>
            あとで見る <span>{later.length} 件</span>
          </summary>
          <div className="archive-list">
            {later.map((item) => (
              <button key={item.id} onClick={() => onDetail(item)}>
                <span>{item.title}</span>
                <small>{rankById.get(item.id)?.reason}</small>
                <Icon name="chevron" size={16} />
              </button>
            ))}
          </div>
        </details>
      )}
      {completed.length > 0 && (
        <details className="archive-section">
          <summary>
            完了・整理済み <span>{completed.length} 件</span>
          </summary>
          <div className="archive-list">
            {completed.slice(0, 30).map((item) => (
              <div key={item.id} className="archive-row">
                <span>{item.title}</span>
                <button onClick={() => onRestore(item)}>戻す</button>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  )
  return (
    <>
      <header className="v2-header">
        <div>
          <h1 id="view-heading" tabIndex={-1}>
            {title}
          </h1>
          <p className="v2-date">{today}</p>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            aria-label="検索欄へ移動"
            onClick={() => searchRef.current?.focus()}
          >
            <Icon name="search" />
          </button>
          <button className="icon-button mobile-settings" onClick={onSettings} aria-label="設定">
            <Icon name="settings" />
            <span className="sr-only">設定</span>
          </button>
        </div>
      </header>
      {!online && (
        <p className="connection offline" role="status">
          <span className="connection-dot" />
          オフラインで利用中
        </p>
      )}
      {notices}
      <label className="search-box">
        <Icon name="search" size={19} />
        <span className="sr-only">Todayを検索</span>
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="必要なことを探す"
          aria-label="Todayを検索"
        />
        <kbd>⌘ K</kbd>
      </label>
      {query && (
        <div className="search-hint" role="status">
          「{query}」に一致する {activeItems.length} 件{' '}
          <button onClick={() => onQuery('')}>クリア</button>
        </div>
      )}
      <div className="summary-line">
        <span>{activeItems.length} 件の確認事項</span>
        {completed.length > 0 && <span> · {completed.length} 件完了</span>}
        {showSamples && <span className="demo-label">サンプルを表示中</span>}
        {scenario && <span className="demo-label">{scenario}</span>}
      </div>
      {view === 'today' ? (
        <div className="content-grid">
          <div className="today-column">
            <p className="v2-promise">3秒で今日やることが分かる</p>
            {lead ? (
              <section className="priority-section" aria-labelledby="now-heading">
                <div className="section-heading">
                  <h2 id="now-heading">今いちばん大切なこと</h2>
                </div>
                {row(lead, true)}
              </section>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">
                  <Icon name={query ? 'search' : 'check'} size={27} />
                </div>
                <h2>{query ? '一致する項目はありません' : '今すぐ対応するものはありません'}</h2>
                <p>
                  {query
                    ? '別の言葉で探してください。'
                    : '思いついたことを追加すると、ここで整理できます。'}
                </p>
                <button
                  className="button button-secondary"
                  onClick={() => (query ? onQuery('') : onAdd())}
                >
                  {query ? '検索をクリア' : 'タスクや予定を追加'}
                  <Icon name="arrow" size={17} />
                </button>
                {!query && canShowSamples && (
                  <button className="sample-button" onClick={onShowSamples}>
                    サンプルの一日を見る
                  </button>
                )}
              </div>
            )}
          </div>
          <section className="upcoming-section" aria-label="今日の予定">
            <div className="section-heading">
              <h2>このあと</h2>
              <span className="section-count">今日の予定</span>
            </div>
            <Timeline items={upcoming} clock={clock} onDetail={onDetail} />
          </section>
          <div className="awareness-section">
            {rest.length > 0 && (
              <section className="other-section" aria-labelledby="next-heading">
                <div className="section-heading">
                  <h2 id="next-heading">気にしておくこと</h2>
                  <span className="section-count">{rest.length} 件</span>
                </div>
                <div className="item-list">{visibleRest.map((item) => row(item))}</div>
                {hiddenCount > 0 && (
                  <button className="disclosure-button" onClick={() => onExpand(true)}>
                    ほか {hiddenCount} 件を見る
                    <Icon name="chevron" size={18} />
                  </button>
                )}
                {expanded && rest.length > 3 && (
                  <button className="disclosure-button" onClick={() => onExpand(false)}>
                    少なく表示
                  </button>
                )}
              </section>
            )}
            {archive}
          </div>
        </div>
      ) : view === 'tasks' ? (
        <section className="destination-surface" aria-label="すべてのやること">
          <p className="view-intro">今のことも、これからのことも。</p>
          <h2 className="sr-only">やること一覧</h2>
          {activeItems.length ? (
            <div className="item-list">{activeItems.map((item) => row(item))}</div>
          ) : (
            <p className="timeline-empty">
              {query ? '一致する項目はありません' : 'やることはまだありません'}
            </p>
          )}
        </section>
      ) : view === 'calendar' ? (
        <section className="destination-surface" aria-label="日時のある項目">
          <p className="view-intro">予定と締め切りを、時刻順に。</p>
          <Timeline items={calendarItems} clock={clock} onDetail={onDetail} calendar />
        </section>
      ) : (
        <section className="destination-surface" aria-label="完了した項目">
          <p className="view-intro">積み重ねた一歩を、ふりかえる。</p>
          <p>{completed.length} 件の完了・整理済み</p>
          <div className="archive-list">
            {completed.length ? (
              completed.map((item) => (
                <div key={item.id} className="archive-row">
                  <span>{item.title}</span>
                  <button onClick={() => onRestore(item)} aria-label={`${item.title}を戻す`}>
                    戻す
                  </button>
                </div>
              ))
            ) : (
              <p className="timeline-empty">完了した項目はまだありません</p>
            )}
          </div>
        </section>
      )}
      <QuickEntry onAdd={onAdd} text={quickText} onText={onQuickText} />
      <p className="v2-footer">日々に、余白を。</p>
    </>
  )
}
