import { useEffect, useState } from 'react'
import type { IntelligenceMode } from './intelligence/types'
import { browserOnly } from './deployment'

const modes: Array<{ value: IntelligenceMode; label: string }> = [
  { value: 'LOCAL_ONLY', label: 'この端末のみ' },
  { value: 'PREFER_LOCAL', label: 'ローカルを優先' },
  { value: 'LOCAL_REMOTE_FALLBACK', label: 'ローカル＋外部フォールバック' },
  { value: 'REMOTE_LOCAL_FALLBACK', label: '外部を優先しローカルへ戻す' },
  { value: 'CUSTOM_ONLY', label: 'カスタムProviderのみ' },
  { value: 'DISABLED', label: 'AIを使用しない' },
]
export function IntelligenceSettings({
  mode,
  onModeChange,
  remotePrivateConsent,
  onRemotePrivateConsentChange,
}: {
  mode: IntelligenceMode
  onModeChange: (mode: IntelligenceMode) => void
  remotePrivateConsent: boolean
  onRemotePrivateConsentChange: (enabled: boolean) => void
}) {
  const [advanced, setAdvanced] = useState(false)
  const [modelState, setModelState] = useState('CHECKING')
  const [modelId, setModelId] = useState('')
  const [loading, setLoading] = useState(false)
  const [remoteAvailable, setRemoteAvailable] = useState(false)
  const [remotePrivateAllowed, setRemotePrivateAllowed] = useState(false)
  const [remoteModelId, setRemoteModelId] = useState('')
  const [remoteProtocol, setRemoteProtocol] = useState('')
  const [ollamaModelId, setOllamaModelId] = useState('')
  useEffect(() => {
    if (browserOnly) return
    let active = true
    const refresh = async () => {
      try {
        const response = await fetch('/api/local-model/status', { credentials: 'same-origin' })
        const body = (await response.json()) as { state?: string; modelId?: string }
        if (active) {
          setModelState(response.ok && typeof body.state === 'string' ? body.state : 'ERROR')
          setModelId(body.modelId || '')
        }
      } catch {
        if (active) setModelState('UNAVAILABLE')
      }
      try {
        const response = await fetch('/api/ollama-model/status', { credentials: 'same-origin' })
        const body = (await response.json()) as { available?: boolean; modelId?: string }
        if (active) setOllamaModelId(response.ok && body.available ? body.modelId || '' : '')
      } catch {
        if (active) setOllamaModelId('')
      }
      try {
        const response = await fetch('/api/remote-model/status', { credentials: 'same-origin' })
        const body = (await response.json()) as {
          available?: boolean
          localPrivateAllowed?: boolean
          modelId?: string
          protocol?: string
        }
        if (active) {
          setRemoteAvailable(response.ok && body.available === true)
          setRemotePrivateAllowed(response.ok && body.localPrivateAllowed === true)
          setRemoteModelId(body.modelId || '')
          setRemoteProtocol(body.protocol || '')
        }
      } catch {
        if (active) {
          setRemoteAvailable(false)
          setRemotePrivateAllowed(false)
        }
      }
    }
    void refresh()
    const timer = window.setInterval(refresh, 15_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])
  const load = async () => {
    setLoading(true)
    setModelState('LOADING')
    try {
      const response = await fetch('/api/local-model/load', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-today-request': '1' },
        body: '{}',
      })
      const body = (await response.json()) as { state?: string }
      setModelState(response.ok && typeof body.state === 'string' ? body.state : 'ERROR')
    } catch {
      setModelState('ERROR')
    } finally {
      setLoading(false)
    }
  }
  const stateText: Record<string, string> = {
    CHECKING: 'ローカルモデルを確認中。通常のTodayで動作中。',
    NOT_INSTALLED: 'ローカルモデル未導入。通常のTodayで動作中。',
    VERIFYING: 'ローカルモデルの整合性を確認中。',
    READY: 'ローカルモデルを検証済み。必要時に起動できます。',
    LOADING: 'ローカルモデルを起動中。通常のTodayは利用できます。',
    RUNNING: 'ローカルモデルがこの端末で稼働中。',
    CORRUPT: 'ローカルモデルの検証に失敗しました。通常のTodayで動作中。',
    INCOMPATIBLE: 'ローカルモデルの設定が非互換です。通常のTodayで動作中。',
    ERROR: 'ローカルモデルを利用できません。通常のTodayで動作中。',
    UNAVAILABLE: 'ローカルモデルの状態を取得できません。通常のTodayで動作中。',
  }
  if (browserOnly)
    return (
      <div className="setting-group">
        <h3>インテリジェンス</h3>
        <p>ブラウザ版はAIを使わずに動作します。タスク・予定の整理はこの端末で処理します。</p>
        <p>Google連携・外部AI・ローカルモデルは、READMEのローカル版で利用できます。</p>
      </div>
    )
  return (
    <div className="setting-group" role="group" aria-label="インテリジェンス設定">
      <h3>インテリジェンス</h3>
      <p>Context判定は決定的な処理を優先します。モデルは必要な場合だけ提案を返します。</p>
      <label htmlFor="intelligence-mode">処理方法</label>
      <select
        id="intelligence-mode"
        value={mode}
        onChange={(event) => onModeChange(event.target.value as IntelligenceMode)}
      >
        {modes.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {(mode === 'LOCAL_REMOTE_FALLBACK' ||
        mode === 'REMOTE_LOCAL_FALLBACK' ||
        mode === 'PREFER_LOCAL' ||
        mode === 'CUSTOM_ONLY') && (
        <>
          <p>
            {remoteAvailable
              ? '外部Providerが設定されています。'
              : '外部Providerは未設定です。ローカル機能は利用できます。'}
          </p>
          <label>
            <input
              type="checkbox"
              checked={remotePrivateConsent}
              disabled={!remotePrivateAllowed}
              onChange={(event) => onRemotePrivateConsentChange(event.target.checked)}
            />
            手動で登録した項目を外部モデルへ送ることを許可する
          </label>
          <p>
            {remotePrivateAllowed
              ? '手動項目の送信にはこの端末での許可も必要です。'
              : '手動項目の送信はサーバー設定で無効です。'}{' '}
            Gmail・Calendarの情報はこの許可に含まれず、外部へ送りません。
          </p>
        </>
      )}
      <p role="status">
        {mode === 'DISABLED'
          ? 'AIは無効です。通常のTodayは引き続き利用できます。'
          : stateText[modelState] || stateText.ERROR}
      </p>
      {mode !== 'DISABLED' && modelState === 'READY' && (
        <button
          className="reset-button"
          type="button"
          disabled={loading}
          onClick={() => void load()}
        >
          ローカルモデルを起動
        </button>
      )}
      <button
        className="reset-button"
        type="button"
        aria-expanded={advanced}
        onClick={() => setAdvanced((value) => !value)}
      >
        詳細設定
      </button>
      {advanced && (
        <div className="intelligence-advanced">
          <p>
            ローカルMLX: {modelId || '未設定'}（{modelState}）· 実験的
          </p>
          <p>Ollama: {ollamaModelId || '未設定または未接続'} · この端末内 · 実験的</p>
          <p>
            外部Provider:{' '}
            {remoteAvailable ? `${remoteModelId}（${remoteProtocol || 'today-json'}）` : '未設定'} ·
            ネットワークが必要 · 実験的
          </p>
          <p>
            モデル重みはこのアプリに同梱されていません。導入には開発者による明示的な設定とSHA-256検証が必要です。
          </p>
          <p>Gmailを含む接続サービスの情報は、この設定だけでは外部モデルに送信されません。</p>
          <p>カスタムProviderは開発者向け拡張契約から追加できます。</p>
        </div>
      )}
    </div>
  )
}
