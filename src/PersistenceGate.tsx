import { useEffect, useState, type ReactNode } from 'react'
import { holdStateWriter } from './storage'

/** A waiting tab has no App instance, so it cannot edit, sync, or save stale state. */
export function PersistenceGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [session, setSession] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void holdStateWriter(controller.signal, () => setReady(true)).catch(() => {
      if (!controller.signal.aborted) setUnavailable(true)
    })
    const suspend = () => {
      controller.abort()
      setReady(false)
    }
    const resume = (event: PageTransitionEvent) => {
      if (event.persisted) setSession((value) => value + 1)
    }
    window.addEventListener('pagehide', suspend)
    window.addEventListener('pageshow', resume)
    return () => {
      controller.abort()
      window.removeEventListener('pagehide', suspend)
      window.removeEventListener('pageshow', resume)
    }
  }, [session])

  if (ready) return children
  return (
    <main className="app-loading" aria-live="polite">
      <h1>
        {unavailable ? '安全に保存できるブラウザが必要です' : 'Todayの編集タブを確認しています'}
      </h1>
      <p>
        {unavailable
          ? 'この環境ではタブ間の保存競合を防げません。最新版のブラウザをHTTPSまたはlocalhostで開いてください。保存内容は変更していません。'
          : '別のタブでTodayを使用中の場合は、そのタブを閉じてください。最新の保存内容を読み込んで、このタブで自動的に再開します。'}
      </p>
    </main>
  )
}
