import { readingClubPlugin } from './extensions/reading-club-plugin'

export function PluginSettings({ sampleVisible }: { sampleVisible: boolean }) {
  return (
    <div className="setting-group" aria-label="Pluginの状態">
      <h3>Plugin</h3>
      <p>
        {readingClubPlugin.manifest.name} · {sampleVisible ? '有効' : '無効'} · 読み取り専用サンプル
      </p>
      <p>資格情報は使いません。外部のPluginはこのビルドに含まれていません。</p>
    </div>
  )
}
