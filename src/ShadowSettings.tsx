import { useState } from 'react'
import { ShadowLog } from './intelligence/shadow'

export function ShadowSettings({
  enabled,
  onChange,
}: {
  enabled: boolean
  onChange: (value: boolean) => void
}) {
  const [, setRevision] = useState(0)
  const metrics = new ShadowLog(localStorage).metrics()
  return (
    <div className="setting-group">
      <h3>実生活でのシャドー評価</h3>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        モデル提案と手動修正の結果をこの端末だけに記録する
      </label>
      <p>提案は自動で結合されません。記録は外部へ送信されません。</p>
      <p role="status">
        記録 {metrics.observed} 件 · 評価済み {metrics.labelled} 件 · 誤結合の指摘{' '}
        {metrics.falseMerges} 件 · 関連見逃しの指摘 {metrics.missedRelations} 件
      </p>
      <button
        className="reset-button"
        disabled={!metrics.observed}
        onClick={() => {
          new ShadowLog(localStorage).clear()
          setRevision((value) => value + 1)
        }}
      >
        この端末の評価記録を消去
      </button>
    </div>
  )
}
