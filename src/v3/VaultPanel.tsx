import { useEffect, useRef, useState } from 'react'
import type { PersistedState } from '../types'
import type { CalendarUi } from '../ConnectedServices'
import type { DailyOverview } from './contracts'
import { projectWorkspace, selectableOverviewItems } from './projection'
import { makePortableArchive } from './portable-backup'

interface VaultStatus {
  enabled: boolean
  initialized?: boolean
  locked?: boolean
  revision?: number
  epoch?: string
  expiresAt?: string
  hasSnapshot?: boolean
  hasArchive?: boolean
  archiveRecords?: number
}
const messages: Record<string, string> = {
  vault_authentication_failed:
    '解除できませんでした。パスフレーズまたはファイルを確認してください。',
  vault_locked: '保存庫はロックされています。',
  vault_reshare_required: '再起動・復元後は、ブラウザで項目を選び直して共有してください。',
  vault_clock_regressed: 'Macの時刻が戻りました。処理を止めています。時刻を確認してください。',
  vault_snapshot_expired: '共有データの期限が切れています。選び直してください。',
  vault_busy: '処理中です。完了を待ってください。',
  vault_revision_conflict: '保存内容が変わりました。状態を確認してやり直してください。',
  vault_epoch_conflict: '保存庫の世代が変わりました。状態を確認してください。',
  vault_rate_limited: '解除操作が続いています。1分待ってください。',
  vault_receipt_limit: '操作記録の上限です。バックアップを確保し、保存庫の運用を見直してください。',
  vault_writer_active: 'この保存庫は別のTodayプロセスが使用しています。',
  vault_outcome_unknown:
    '保存結果を確認できません。状態を確認してから、同じ操作の結果を照合してください。',
}
async function vaultRequest(route: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/v3/vault/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: {
      'X-Today-Request': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json()
  if (!response.ok)
    throw new Error(
      messages[result.code] ||
        '保存庫にアクセスできませんでした。元のデータは変更せず、確認してください。',
    )
  return result
}
function downloadJSON(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function VaultPanel({
  getState,
  calendar,
}: {
  getState: () => PersistedState
  calendar: CalendarUi
}) {
  const [status, setStatus] = useState<VaultStatus | null>(null),
    [phrase, setPhrase] = useState(''),
    [confirmPhrase, setConfirmPhrase] = useState('')
  const [consent, setConsent] = useState(false),
    [archiveConsent, setArchiveConsent] = useState(false),
    [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [overview, setOverview] = useState<DailyOverview | null>(null)
  const [preview, setPreview] = useState<{
    archiveRecords: number
    contexts: number
    unresolvedAllDay: number
    restoreToken: string
    epoch: string
    revision: number
  } | null>(null)
  const [backup, setBackup] = useState<unknown>(null),
    [backupPhrase, setBackupPhrase] = useState(''),
    [deletion, setDeletion] = useState<{ nonce: string; epoch: string; revision: number } | null>(
      null,
    )
  const gate = useRef(false),
    active = useRef<AbortController | null>(null),
    mounted = useRef(true)
  const refresh = async () => {
    const next = await vaultRequest('status')
    if (mounted.current) setStatus(next as VaultStatus)
    return next as VaultStatus
  }
  useEffect(() => {
    mounted.current = true
    const abort = new AbortController()
    vaultRequest('status', undefined, abort.signal)
      .then((v) => setStatus(v))
      .catch(() => {
        if (!abort.signal.aborted) setStatus({ enabled: false })
      })
    return () => {
      mounted.current = false
      abort.abort()
      active.current?.abort()
    }
  }, [])
  useEffect(() => {
    if (status?.locked || !status?.expiresAt) return
    const timer = setInterval(() => {
      if (Date.parse(status.expiresAt!) <= Date.now()) {
        setStatus({ ...status, locked: true })
        setOverview(null)
        setPreview(null)
        setDeletion(null)
        setBackup(null)
        setConsent(false)
        setArchiveConsent(false)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [status])
  const [snapshotExpired, setSnapshotExpired] = useState(false)
  useEffect(() => {
    if (!overview) return
    const check = () => setSnapshotExpired(Date.parse(overview.expiresAt) <= Date.now())
    check()
    const timer = setInterval(check, 1000)
    return () => clearInterval(timer)
  }, [overview])
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (gate.current) return
    gate.current = true
    setBusy(true)
    setError('')
    const abort = new AbortController()
    active.current = abort
    const timer = setTimeout(() => abort.abort(), 30_000)
    try {
      await action(abort.signal)
      await refresh()
    } catch (e) {
      if (mounted.current) {
        setError(
          abort.signal.aborted
            ? '処理を中止しました。保存結果は状態を再確認してください。'
            : e instanceof Error
              ? e.message
              : '処理できませんでした。',
        )
        setOverview(null)
        try {
          await refresh()
        } catch {
          /* Keep prior status explicitly with the displayed error. */
        }
      }
    } finally {
      clearTimeout(timer)
      gate.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function share(signal: AbortSignal) {
    const snapshot = projectWorkspace(getState(), selected, calendar),
      operationId = crypto.randomUUID()
    await vaultRequest(
      'publish',
      {
        epoch: status!.epoch,
        expectedRevision: status!.revision,
        operationId,
        consent: true,
        data: snapshot,
      },
      signal,
    )
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
      parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date())
    const part = (kind: string) => parts.find((p) => p.type === kind)?.value,
      date = `${part('year')}-${part('month')}-${part('day')}`
    setOverview(
      await vaultRequest(
        `overview?date=${date}&tz=${encodeURIComponent(timeZone)}`,
        undefined,
        signal,
      ),
    )
    setConsent(false)
  }
  const items = selectableOverviewItems(getState().items)
  if (!status?.enabled)
    return (
      <section aria-label="Mac保存庫">
        <h3>Mac保存庫</h3>
        <p>
          ローカルGatewayで利用できます。公開ブラウザ版のCore・AI Chatは、保存庫なしで使えます。
        </p>
      </section>
    )
  return (
    <section aria-label="Mac保存庫" className="setting-group">
      <h3>Mac保存庫</h3>
      <p>
        選択した共有データ・バックアップを、このMacへ暗号化して保存します。Todayの元データは変更しません。外部AIへ送りません。
      </p>
      <p>パスフレーズは復旧できません。ダウンロード済みのコピーは、保存庫を消去しても残ります。</p>
      <p role="status">
        {status.locked
          ? 'ロック中'
          : `解除中 · 保存版 ${status.revision} · 失効時刻 ${status.expiresAt}`}
      </p>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy}>
        <legend>{status.locked ? '保存庫を解除' : '共有・バックアップ'}</legend>
        {status.locked ? (
          <>
            <label>
              保存庫のパスフレーズ
              <input
                type="password"
                autoComplete="off"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                minLength={12}
                maxLength={256}
              />
            </label>
            {!status.initialized && (
              <label>
                パスフレーズを再入力
                <input
                  type="password"
                  autoComplete="off"
                  value={confirmPhrase}
                  onChange={(e) => setConfirmPhrase(e.target.value)}
                  maxLength={256}
                />
              </label>
            )}
            <p>12文字以上の、ほかのアカウントで使っていないパスフレーズを設定してください。</p>
            <label>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              このMacの保存庫を使用することに同意する
            </label>
            <button
              className="button button-primary"
              disabled={
                !consent || phrase.length < 12 || (!status.initialized && phrase !== confirmPhrase)
              }
              onClick={() =>
                void run(async (signal) => {
                  const input = phrase
                  setPhrase('')
                  setConfirmPhrase('')
                  await vaultRequest(
                    status.initialized ? 'unlock' : 'setup',
                    { passphrase: input, consent: true },
                    signal,
                  )
                  setConsent(false)
                })
              }
            >
              {status.initialized ? '保存庫を解除する' : '暗号化保存庫を作成する'}
            </button>
          </>
        ) : (
          <>
            <div>
              {items.map((i) => (
                <label className="overview-choice" key={i.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(i.id)}
                    disabled={!!i.allDay}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked ? [...ids, i.id] : ids.filter((id) => id !== i.id),
                      )
                    }
                  />
                  {i.title}
                  {i.allDay ? '（元の終日暦日は未確認）' : ''}
                </label>
              ))}
            </div>
            <label>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              選択した項目をMacへ保存し、5分間の照会に使うことに同意する
            </label>
            <button
              className="button button-primary"
              disabled={!consent || !selected.length}
              onClick={() => void run(share)}
            >
              Macへ選択共有する
            </button>
            <label>
              <input
                type="checkbox"
                checked={archiveConsent}
                onChange={(e) => setArchiveConsent(e.target.checked)}
              />
              手動データと関連Contextを、このMacへバックアップすることに同意する
            </label>
            <p>
              手動データの状態・説明・日時を保持します。未確認のrevision・終日暦日は推測しません。外部サービス・未確定操作は対象外です。
            </p>
            <button
              className="button button-secondary"
              disabled={!archiveConsent}
              onClick={() =>
                void run(async (signal) => {
                  await vaultRequest(
                    'archive',
                    {
                      epoch: status.epoch,
                      expectedRevision: status.revision,
                      operationId: crypto.randomUUID(),
                      consent: true,
                      data: makePortableArchive(getState()),
                    },
                    signal,
                  )
                  setArchiveConsent(false)
                })
              }
            >
              V3バックアップをMacに保存する
            </button>
            <button
              className="button button-secondary"
              disabled={!status.hasSnapshot && !status.hasArchive}
              onClick={() =>
                void run(async (signal) => {
                  downloadJSON(
                    await vaultRequest('export', undefined, signal),
                    'today-v3-encrypted-backup.json',
                  )
                })
              }
            >
              暗号化バックアップを書き出す
            </button>
            <button
              className="button button-secondary"
              disabled={!status.hasArchive}
              onClick={() =>
                void run(async (signal) =>
                  downloadJSON(
                    await vaultRequest('archive-export', undefined, signal),
                    'today-v3-portable-archive.json',
                  ),
                )
              }
            >
              V3アーカイブJSONを書き出す（暗号化なし）
            </button>
            <p>
              暗号化なしのアーカイブには説明やContextが含まれます。安全な場所へ保存してください。
            </p>
            <button
              className="button button-text"
              onClick={() =>
                void run(async (signal) => {
                  await vaultRequest('lock', {}, signal)
                  setOverview(null)
                  setPreview(null)
                  setDeletion(null)
                  setBackup(null)
                  setSelected([])
                  setConsent(false)
                  setArchiveConsent(false)
                })
              }
            >
              保存庫をロックする
            </button>
            <label>
              暗号化バックアップのプレビュー
              <input
                type="file"
                accept="application/json,.json"
                onChange={async (e) => {
                  setPreview(null)
                  setBackup(null)
                  const f = e.target.files?.[0]
                  // Re-selecting the same backup after restore/clear must fire a new change event.
                  e.currentTarget.value = ''
                  if (!f) return
                  if (f.size > 3_000_000) {
                    setError('ファイルは3MB以下を選択してください。')
                    return
                  }
                  try {
                    setBackup(JSON.parse(await f.text()))
                  } catch {
                    setError('対応JSONを選択してください。')
                  }
                }}
              />
            </label>
            <label>
              バックアップのパスフレーズ
              <input
                type="password"
                autoComplete="off"
                value={backupPhrase}
                onChange={(e) => setBackupPhrase(e.target.value)}
                maxLength={256}
              />
            </label>
            <button
              className="button button-secondary"
              disabled={!backup || backupPhrase.length < 12}
              onClick={() =>
                void run(async (signal) => {
                  const input = backupPhrase
                  setBackupPhrase('')
                  setPreview(await vaultRequest('preview', { backup, passphrase: input }, signal))
                })
              }
            >
              復元内容を確認する
            </button>
            {preview && (
              <div role="group" aria-label="Mac保存庫の復元確認">
                <p role="status">
                  プレビューのみ：手動データ {preview.archiveRecords}件、Context {preview.contexts}
                  件、未確認の終日暦日 {preview.unresolvedAllDay}件。元のTodayへ自動復元しません。
                </p>
                <p>
                  現在のMac保存庫のコピーを、確認したバックアップへ置き換えます。元のTodayは変更しません。古い照会・操作要求は失効します。
                </p>
                <button
                  className="button button-text"
                  onClick={() =>
                    void run(async (signal) => {
                      await vaultRequest(
                        'cancel-restore',
                        { restoreToken: preview.restoreToken },
                        signal,
                      )
                      setPreview(null)
                    })
                  }
                >
                  復元を取り消す
                </button>
                <button
                  className="button button-secondary"
                  onClick={() =>
                    void run(async (signal) => {
                      await vaultRequest(
                        'restore-confirm',
                        {
                          restoreToken: preview.restoreToken,
                          epoch: preview.epoch,
                          revision: preview.revision,
                          confirmed: true,
                        },
                        signal,
                      )
                      setPreview(null)
                      setOverview(null)
                      setDeletion(null)
                      setBackup(null)
                      setConsent(false)
                      setArchiveConsent(false)
                    })
                  }
                >
                  確認してMac保存庫に復元する
                </button>
              </div>
            )}
            <button
              className="button button-text"
              onClick={() =>
                void run(async (signal) =>
                  setDeletion(await vaultRequest('delete-preview', {}, signal)),
                )
              }
            >
              保存庫のコピーを消去…
            </button>
            {deletion && (
              <div role="group" aria-label="保存庫の消去確認">
                <p>
                  このMacの共有コピーとバックアップを消去します。元のTodayとダウンロード済みファイルは残ります。
                </p>
                <button
                  className="button button-text"
                  onClick={() =>
                    void run(async (signal) => {
                      await vaultRequest('cancel-delete', { nonce: deletion.nonce }, signal)
                      setDeletion(null)
                    })
                  }
                >
                  消去を取り消す
                </button>
                <button
                  className="button button-secondary"
                  onClick={() =>
                    void run(async (signal) => {
                      await vaultRequest(
                        'delete-confirm',
                        {
                          nonce: deletion.nonce,
                          epoch: deletion.epoch,
                          revision: deletion.revision,
                          confirmed: true,
                        },
                        signal,
                      )
                      setDeletion(null)
                      setOverview(null)
                      setPreview(null)
                      setBackup(null)
                      setSelected([])
                      setConsent(false)
                      setArchiveConsent(false)
                    })
                  }
                >
                  確認して保存庫のコピーを消去する
                </button>
              </div>
            )}
          </>
        )}
      </fieldset>
      {busy && (
        <p role="status">
          処理しています…
          <button className="button button-text" onClick={() => active.current?.abort()}>
            中止
          </button>
        </p>
      )}
      {overview && (
        <div role="region" aria-label="Mac日次サマリー">
          <p>{overview.summary}</p>
          <p>
            取得時刻 {overview.capturedAt} · 失効時刻 {overview.expiresAt}
          </p>
          {snapshotExpired && (
            <p role="status">期限切れです。現在の情報として使わず、選び直してください。</p>
          )}
          <button
            className="button button-secondary"
            disabled={snapshotExpired}
            onClick={() => downloadJSON(overview, `today-overview-${overview.date}.json`)}
          >
            MacのサマリーJSONを書き出す
          </button>
        </div>
      )}
    </section>
  )
}
