import { dateLabel } from './format'
import { Icon, type IconName } from './ui'
import type { Item, ItemAction, PriorityResult } from './types'

export function TodayItem({
  item,
  rank,
  prominent = false,
  onAction,
  onDetail,
}: {
  item: Item
  rank: PriorityResult
  prominent?: boolean
  onAction: (item: Item, action: ItemAction) => void
  onDetail: (item: Item) => void
}) {
  const primary = item.actions[0]
  const secondary = item.actions[1]
  const icon: IconName =
    item.kind === 'event' ? 'calendar' : item.kind === 'email' ? 'mail' : 'check'
  const stale = item.demo && Date.now() - new Date(item.sourceUpdatedAt).getTime() > 6 * 3_600_000
  return (
    <article className={`action-item ${prominent ? 'prominent' : ''}`}>
      <div className="item-symbol">
        <Icon name={icon} size={20} />
      </div>
      <div className="item-content">
        <div className="item-kicker">
          {item.pinned
            ? '固定'
            : prominent
              ? 'いま注目'
              : rank.layer === 'next'
                ? '次に確認'
                : '把握しておく'}{' '}
          <span aria-hidden="true">·</span> {rank.reason}
        </div>
        <h3>{item.title}</h3>
        {prominent && item.description && <p className="item-description">{item.description}</p>}
        {(item.deadline || item.startAt) && (
          <p className="item-time">
            <Icon name="clock" size={16} />
            {dateLabel(item.deadline || item.startAt, item.kind, new Date(), item.allDay)}
          </p>
        )}
        <div className="item-bottom">
          <span className="source">{item.source}</span>
          {stale && <span className="sync-pill">更新確認が必要</span>}
          {item.syncStatus === 'failed' && <span className="sync-pill">接続を確認</span>}
          {item.syncStatus === 'pending' && <span className="sync-pill">保留中</span>}
        </div>
        <div className="item-actions">
          {primary && (
            <button
              className={prominent ? 'button button-primary' : 'button button-secondary'}
              onClick={() => onAction(item, primary)}
            >
              {primary.label}
              <Icon name={prominent ? 'arrow' : 'chevron'} size={17} />
            </button>
          )}
          {secondary && (
            <button className="button button-text" onClick={() => onAction(item, secondary)}>
              {secondary.label}
            </button>
          )}
          {!secondary && primary?.type !== 'view' && (
            <button
              className="button button-text detail-link"
              onClick={() => onDetail(item)}
              aria-label={`${item.title}の詳細`}
            >
              詳細
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
