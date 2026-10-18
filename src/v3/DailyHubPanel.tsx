import { useEffect, useRef, useState } from 'react'
import type { PersistedState } from '../types'
import type { CalendarUi } from '../ConnectedServices'
import { overviewScopes, type DailyOverview } from './contracts'
import { projectWorkspace, selectableOverviewItems } from './projection'
import { VaultPanel } from './VaultPanel'

const errors: Record<string, string> = {
  request_denied: 'この端末のTodayセッションと同一画面からの操作が必要です。',
  snapshot_required: '共有データは未登録または期限切れです。選び直してください。',
  invalid_snapshot: '共有データの形式・時刻・件数を確認してください。',
  snapshot_expired: '共有データの期限が切れています。選び直してください。',
  v3_disabled: '日次サマリーの実験APIは無効です。',
  rate_limited: '操作が続いています。1分待ってから再試行してください。',
}
async function request(
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
  signal?: AbortSignal,
) {
  const res = await fetch(`/api/v3/${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: {
      'X-Today-Request': '1',
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const value = await res.json()
  if (!res.ok) throw new Error(errors[value.code] || '日次サマリーを取得できませんでした。')
  return value
}
export function DailyHubPanel({
  getState,
  calendar,
}: {
  getState: () => PersistedState
  calendar: CalendarUi
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [selection, setSelection] = useState<string[]>([])
  const [consent, setConsent] = useState(false)
  const [overview, setOverview] = useState<DailyOverview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [expired, setExpired] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const operationGate = useRef(false)
  useEffect(() => {
    const abort = new AbortController()
    fetch('/api/v3/status', { cache: 'no-store', signal: abort.signal })
      .then((r) => r.json())
      .then((v) => setEnabled(v.enabled === true))
      .catch(() => {
        if (!abort.signal.aborted) setEnabled(false)
      })
    return () => {
      abort.abort()
      controller.current?.abort()
    }
  }, [])
  useEffect(() => {
    if (!overview) return
    const check = () => setExpired(Date.parse(overview.expiresAt) <= Date.now())
    check()
    const timer = window.setInterval(check, 1000)
    return () => window.clearInterval(timer)
  }, [overview])
  const items = selectableOverviewItems(getState().items)
  async function publish() {
    if (operationGate.current || !consent) return
    operationGate.current = true
    setBusy(true)
    setError('')
    setOverview(null)
    const abort = new AbortController()
    controller.current = abort
    const timeout = window.setTimeout(() => abort.abort(), 10_000)
    try {
      const snapshot = projectWorkspace(getState(), selection, calendar)
      await request(
        'workspace-snapshot',
        'POST',
        { consent: true, scopes: overviewScopes, snapshot },
        abort.signal,
      )
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date())
      const part = (type: string) => parts.find((p) => p.type === type)?.value
      const date = `${part('year')}-${part('month')}-${part('day')}`
      const result = (await request(
        `overview?date=${date}&tz=${encodeURIComponent(timeZone)}`,
        'GET',
        undefined,
        abort.signal,
      )) as DailyOverview
      setOverview(result)
      setConsent(false)
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '取得できませんでした。')
      else setError('処理を中止しました。登録済みデータは最大5分で失効します。')
    } finally {
      window.clearTimeout(timeout)
      operationGate.current = false
      setBusy(false)
    }
  }
  async function revoke() {
    if (operationGate.current) return
    operationGate.current = true
    setBusy(true)
    setError('')
    try {
      await request('workspace-snapshot', 'DELETE')
      setOverview(null)
      setConsent(false)
      setSelection([])
    } catch {
      setError('破棄を確認できませんでした。登録済みデータは最大5分で失効します。')
    } finally {
      operationGate.current = false
      setBusy(false)
    }
  }
  function download() {
    if (!overview || expired) return
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(overview, null, 2)], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `today-overview-${overview.date}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div className="setting-group daily-hub">
      <VaultPanel getState={getState} calendar={calendar} />
      <p>V3のローカル実験です。タスク・予定は変更しません。AIや外部APIは呼びません。</p>
      <p>
        選択したタイトル・日時・優先度だけを、このMacのTodayサーバーのメモリに最大5分共有します。メール本文・説明文・認証情報は共有しません。
      </p>
      {enabled === null ? (
        <p role="status">実験APIを確認しています…</p>
      ) : !enabled ? (
        <p role="status">
          実験APIは無効です。この開発コピーをTODAY_V3_OVERVIEW=1で起動してください。
        </p>
      ) : (
        <>
          <fieldset disabled={busy}>
            <legend>共有するタスク・予定を選択</legend>
            {items.length === 0 && (
              <p>共有できる手動タスク・予定はありません。サンプルデータは対象外です。</p>
            )}
            {items.map((item) => (
              <label className="overview-choice" key={item.id}>
                <input
                  type="checkbox"
                  checked={selection.includes(item.id)}
                  disabled={!!item.allDay}
                  onChange={(e) =>
                    setSelection((ids) =>
                      e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id),
                    )
                  }
                />
                {item.title}
                {item.allDay ? '（終日はこの実験の対象外）' : ''}
              </label>
            ))}
            <label className="overview-choice">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              選択した項目をこのMacへ5分間共有することに同意する
            </label>
          </fieldset>
          <div className="overview-actions">
            <button
              className="button button-primary"
              disabled={!consent || busy}
              onClick={() => void publish()}
            >
              選択して日次サマリーを生成
            </button>
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => void revoke()}
            >
              共有データを破棄
            </button>
          </div>
        </>
      )}
      {busy && <p role="status">処理しています…</p>}
      {error && <p role="alert">{error}</p>}
      {overview && (
        <section aria-label="日次サマリー結果">
          <h3>
            {overview.date} · {overview.timeZone}
          </h3>
          <p>{overview.summary}</p>
          <p>
            取得: {overview.capturedAt} / 失効: {overview.expiresAt}
          </p>
          {expired && <p role="alert">期限切れです。現在の状態として使わないでください。</p>}
          <ul>
            {overview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <h4>タスク</h4>
          <ul>
            {overview.tasks.map((task) => (
              <li key={task.id}>
                {task.title} — {task.reason}
              </li>
            ))}
          </ul>
          <h4>予定</h4>
          <ul>
            {overview.events.map((event) => (
              <li key={event.id}>
                {event.title} · {event.startAt || event.startDate}
              </li>
            ))}
          </ul>
          <p>
            JSONを書き出すと選択した情報がファイルに残ります。サーバーでの破棄は、このファイルを削除しません。
          </p>
          <button className="button button-secondary" disabled={expired || busy} onClick={download}>
            iPhoneプレビュー用JSONを書き出す
          </button>
        </section>
      )}
    </div>
  )
}
