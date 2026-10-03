import { browserOnly } from './deployment'

export type CalendarUi = {
  configured: boolean
  connection: 'disconnected' | 'connected' | 'expired'
  phase: 'loading' | 'idle' | 'refreshing' | 'synced' | 'stale' | 'offline' | 'failed'
  error?: string
}

export function ConnectedServices({
  calendar,
  mail,
  lastSyncedAt,
  mailSyncedAt,
  online,
  onConnect,
  onDisconnect,
  onRefresh,
  onMailConnect,
  onMailDisconnect,
  onMailRefresh,
}: {
  calendar: CalendarUi
  mail: CalendarUi
  lastSyncedAt?: string
  mailSyncedAt?: string
  online: boolean
  onConnect: () => void
  onDisconnect: () => void
  onRefresh: () => void
  onMailConnect: () => void
  onMailDisconnect: () => void
  onMailRefresh: () => void
}) {
  if (browserOnly)
    return (
      <div className="setting-group">
        <h3>接続サービス</h3>
        <p>ブラウザ版ではGoogle Calendar・Gmailに接続しません。</p>
        <p>手動のタスク・予定はこのブラウザに保存されます。端末間の同期はありません。</p>
        <p>ブラウザのデータを消去する前に、バックアップを書き出してください。</p>
      </div>
    )
  const status =
    calendar.phase === 'loading'
      ? '確認中'
      : calendar.phase === 'failed'
        ? '確認できません'
        : !calendar.configured
          ? '接続の準備が必要'
          : calendar.connection === 'expired'
            ? '再接続が必要'
            : calendar.connection === 'connected'
              ? '接続中'
              : '未接続'
  const last =
    lastSyncedAt && Number.isFinite(new Date(lastSyncedAt).getTime())
      ? new Intl.DateTimeFormat('ja-JP', {
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(lastSyncedAt))
      : null
  const mailLast =
    mailSyncedAt && Number.isFinite(new Date(mailSyncedAt).getTime())
      ? new Intl.DateTimeFormat('ja-JP', {
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(mailSyncedAt))
      : null
  return (
    <div className="setting-group">
      <h3>接続サービス</h3>
      <p>Today は予定をタスクと一緒に表示するために、カレンダーを利用します。</p>
      <div className="service-status">
        <strong>Google Calendar</strong>
        <span>{status}</span>
      </div>
      {calendar.phase === 'refreshing' && <p role="status">予定を更新しています…</p>}
      {calendar.phase === 'stale' && last && (
        <p role="status">
          予定を更新できませんでした。前回の取得: {last}。保存済みの予定を表示しています。
        </p>
      )}
      {calendar.phase === 'offline' && calendar.connection === 'connected' && (
        <p role="status">
          オフラインです。{last ? `前回の取得: ${last}。` : ''}保存済みの予定を表示しています。
        </p>
      )}
      {calendar.phase === 'failed' && <p role="status">接続状態を確認できませんでした。</p>}
      {!calendar.configured && calendar.phase !== 'loading' && calendar.phase !== 'failed' && (
        <p>接続にはこのアプリの設定が必要です。README を参照してください。</p>
      )}
      {calendar.configured && calendar.connection === 'connected' && (
        <div className="service-actions">
          <button
            className="reset-button"
            onClick={onRefresh}
            disabled={!online || calendar.phase === 'refreshing'}
          >
            予定を更新
          </button>
          <button className="reset-button" onClick={onDisconnect} disabled={!online}>
            接続を解除
          </button>
        </div>
      )}
      {calendar.configured && calendar.connection !== 'connected' && (
        <button className="reset-button" onClick={onConnect} disabled={!online}>
          接続する
        </button>
      )}
      <div className="service-status">
        <strong>Gmail</strong>
        <span>
          {mail.phase === 'loading'
            ? '確認中'
            : !mail.configured
              ? '接続の準備が必要'
              : mail.connection === 'expired'
                ? '再接続が必要'
                : mail.connection === 'connected'
                  ? '接続中'
                  : '未接続'}
        </span>
      </div>
      <p>
        Today
        は直近14日・最大100件のメールの件名、差出人、日時、短い抜粋を読み、予定や対応に関係する候補のみ本文を取得します。Google
        の権限表示はメールと設定の閲覧を含みますが、Today
        は設定を取得しません。メールの送信、変更、削除はしません。Gmail の内容を外部 AI
        に送る処理はありません。いつでも接続を解除できます。
      </p>
      {mailLast && (
        <p role="status">
          Gmail の最終更新: {mailLast}
          {mail.phase === 'stale' || mail.phase === 'offline'
            ? '。保存済みの情報を表示しています。'
            : '。'}
        </p>
      )}
      {mail.phase === 'refreshing' && <p role="status">Gmail から必要な情報を確認しています…</p>}
      {mail.phase === 'failed' && (
        <p role="status">Gmail の状態を確認できませんでした。保存済みの情報は利用できます。</p>
      )}
      {mail.phase === 'stale' && (
        <p role="status">
          Gmail の更新に失敗しました。
          {mail.error === 'RATE_LIMITED'
            ? '時間を置いて再試行してください。'
            : mail.connection === 'expired'
              ? '再接続してください。'
              : '後で再試行してください。'}
        </p>
      )}
      {!mail.configured && mail.phase !== 'loading' && (
        <p>
          接続には Google OAuth クライアントと暗号化トークン保管の設定が必要です。README
          を参照してください。
        </p>
      )}
      {mail.configured && mail.connection === 'connected' && (
        <div className="service-actions">
          <button
            className="reset-button"
            onClick={onMailRefresh}
            disabled={!online || mail.phase === 'refreshing'}
          >
            Gmail を更新
          </button>
          <button className="reset-button" onClick={onMailDisconnect} disabled={!online}>
            Gmail の接続を解除
          </button>
        </div>
      )}
      {mail.configured && mail.connection !== 'connected' && (
        <button className="reset-button" onClick={onMailConnect} disabled={!online}>
          Gmail に接続する
        </button>
      )}
    </div>
  )
}
