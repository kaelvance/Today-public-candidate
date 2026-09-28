export function AIAssistance({
  configured,
  enabled,
  onChange,
}: {
  configured: boolean
  enabled: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="setting-group">
      <h3>AI アシスト</h3>
      <p>
        オンの場合、入力の解釈が難しいときだけ文章を設定済みの外部 AI
        サービスに送ります。オフでも通常の入力解析は使えます。
      </p>
      <div className="theme-options" role="group" aria-label="AI アシスト">
        <button
          className={!enabled ? 'selected' : ''}
          aria-pressed={!enabled}
          onClick={() => onChange(false)}
        >
          オフ
        </button>
        <button
          className={enabled ? 'selected' : ''}
          aria-pressed={enabled}
          onClick={() => onChange(true)}
          disabled={!configured}
        >
          オン
        </button>
      </div>
      {!configured && <p className="setting-note">AI サービスは未設定です。</p>}
    </div>
  )
}
