import { useEffect, useRef, useState } from 'react'
import type { PersistedState } from './types'
import { browserOnly } from './deployment'
import { ApprovalBroker, type ApprovalReceipt } from './application/chat-commands'
import { contextSnapshot } from './chat/context'
import { ConversationOrchestrator } from './chat/orchestrator'
import { HttpChatModel, MockChatModel } from './chat/models'
import { BrowserChatModel } from './chat/browser-model'
import { MessagingGateway, MockMessagingAdapter, type OutboxEntry } from './chat/messaging'
import type { ChatReply, ChatTurn } from './chat/contracts'
import './chat.css'

export function ChatPanel({
  state,
  read,
  commit,
}: {
  state: PersistedState
  read: () => PersistedState
  commit: (next: PersistedState, expected: string) => Promise<void>
}) {
  const [mode, setMode] = useState('gpu' in navigator && isSecureContext ? 'browser' : 'mock')
  const [configured, setConfigured] = useState(false)
  const [apiConfigured, setApiConfigured] = useState(false)
  const [apiDescription, setApiDescription] = useState('')
  const [downloadConsent, setDownloadConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [modelReady, setModelReady] = useState(false)
  const [loadProgress, setLoadProgress] = useState('')
  const deviceModel = useRef(new BrowserChatModel())
  const [consent, setConsent] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sources, setSources] = useState<string[]>([])
  const [pending, setPending] = useState<ApprovalReceipt | null>(null)
  const [outbox, setOutbox] = useState<OutboxEntry[]>([])
  const approval = useRef(new ApprovalBroker())
  const conversation = useRef(new ConversationOrchestrator(new MockChatModel()))
  const gateway = useRef(new MessagingGateway(new MockMessagingAdapter(), new MockChatModel()))
  const binding = useRef({
    conversationId: 'synthetic-owner-thread',
    senderId: 'synthetic-owner',
    credential: crypto.randomUUID(),
  })
  const alive = useRef(true)
  const mockBound = useRef(false)
  useEffect(() => {
    alive.current = true
    if ('gpu' in navigator && isSecureContext) {
      conversation.current = new ConversationOrchestrator(deviceModel.current)
      gateway.current = new MessagingGateway(new MockMessagingAdapter(), deviceModel.current)
    }
    if (!browserOnly)
      fetch('/api/chat/status', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : { configured: false }))
        .then((s) => {
          if (alive.current) setConfigured(s.configured === true)
          if (alive.current) setApiConfigured(s.api?.configured === true)
          if (alive.current && s.api?.configured === true)
            setApiDescription(`${s.api.host} / ${s.api.model}`)
        })
        .catch(() => {})
    const conversations = conversation,
      messages = gateway,
      broker = approval,
      device = deviceModel.current
    return () => {
      alive.current = false
      conversations.current.clear()
      messages.current.clear()
      broker.current.discard()
      device.dispose()
    }
  }, [])
  const candidates = state.items.filter(
    (item) => item.sourceId === 'manual' && !item.demo && ['task', 'event'].includes(item.kind),
  )
  function reset(nextMode = mode) {
    conversation.current.clear()
    gateway.current.clear()
    approval.current.discard()
    const model =
      nextMode === 'browser'
        ? deviceModel.current
        : nextMode === 'local'
          ? new HttpChatModel()
          : nextMode === 'api'
            ? new HttpChatModel('api')
            : new MockChatModel()
    conversation.current = new ConversationOrchestrator(model)
    gateway.current = new MessagingGateway(new MockMessagingAdapter(), model)
    mockBound.current = false
    setSources([])
    setTurns([])
    setPending(null)
    setOutbox([])
    setConsent(false)
    setError('')
    setNotice('')
  }
  async function loadModel() {
    if (!downloadConsent || loading) return
    setLoading(true)
    setError('')
    try {
      await deviceModel.current.load(downloadConsent, (p) => {
        if (alive.current) setLoadProgress(p)
      })
      if (alive.current) {
        setModelReady(true)
        setLoadProgress('モデルの準備ができました。推論は端末内で行います。')
      }
    } catch {
      if (alive.current)
        setError(
          'モデルを準備できませんでした。WebGPU対応・空き容量・通信・取消を確認してください。Coreのデータは変更しません。',
        )
    } finally {
      if (alive.current) setLoading(false)
    }
  }
  function stage(reply: ChatReply, base: PersistedState) {
    if (reply.proposal) setPending(approval.current.stage(reply.proposal, base))
  }
  async function send(mockMessage = false) {
    if (!consent || working || loading || (mode === 'browser' && !modelReady) || !input.trim())
      return
    setWorking(true)
    setError('')
    setNotice('')
    approval.current.discard()
    setPending(null)
    try {
      const base = structuredClone(read())
      const snapshot = contextSnapshot(base, selected)
      if (mockMessage) {
        const identity = binding.current
        if (!mockBound.current) {
          gateway.current.bind({
            adapter: 'mock',
            ...identity,
            mode: 'manual',
            expiresAt: Date.now() + 600_000,
          })
          mockBound.current = true
        }
        const result = await gateway.current.receive(
          {
            adapter: 'mock',
            eventId: crypto.randomUUID(),
            ...identity,
            text: input,
            fromSelf: false,
            hops: 0,
            receivedAt: Date.now(),
          },
          identity.credential,
          snapshot,
        )
        if (alive.current) {
          setOutbox(gateway.current.entries())
          stage(result.reply, base)
          setNotice('架空メッセージの返信案を生成しました。外部送信はありません。')
        }
      } else {
        const reply = await conversation.current.ask(input, snapshot)
        if (alive.current) {
          setSources(reply.citations.map((id) => snapshot.facts.find((f) => f.id === id)!.title))
          setTurns(conversation.current.turns())
          stage(reply, base)
        }
      }
      if (alive.current) setInput('')
    } catch {
      if (alive.current)
        setError(
          '処理できませんでした。取消・情報の変更・期限切れ・モデル停止の場合は、情報を選び直して再試行してください。履歴を消去するか共有情報を減らすと、会話容量を確保できます。変更の完了とは扱いません。',
        )
    } finally {
      if (alive.current) setWorking(false)
    }
  }
  async function approve() {
    if (!pending || working) return
    setWorking(true)
    setError('')
    try {
      await approval.current.approve(pending.id, read, commit)
      if (alive.current) {
        setNotice('承認した変更を保存しました。')
        setPending(null)
      }
    } catch {
      if (alive.current) {
        setError(
          '変更を保存できませんでした。対象の変更・期限切れ・保存失敗を確認し、新しい操作案からやり直してください。',
        )
        setPending(null)
      }
    } finally {
      if (alive.current) setWorking(false)
    }
  }
  async function sendDraft(id: string) {
    if (working) return
    setWorking(true)
    try {
      await gateway.current.approve(id)
      if (alive.current) setOutbox(gateway.current.entries())
    } catch {
      if (alive.current)
        setError('Mock返信を送れませんでした。送信結果が不明な場合は再送しません。')
    } finally {
      if (alive.current) setWorking(false)
    }
  }
  const proposal = pending?.proposal
  return (
    <section className="chat-panel" aria-label="AI Chat">
      <p>
        V2.1.0。AIは任意です。履歴はこの画面を閉じると消去され、バックアップには含まれません。AIの回答には誤りがあり得ます。
      </p>
      <label>
        会話モデル
        <select
          value={mode}
          disabled={working || loading}
          onChange={(e) => {
            setMode(e.target.value)
            if (e.target.value !== 'browser') {
              deviceModel.current.dispose()
              setModelReady(false)
              setDownloadConsent(false)
              setLoadProgress('')
            }
            reset(e.target.value)
          }}
        >
          <option value="mock">試験用Mock（実際のAIではありません）</option>
          <option value="browser" disabled={!('gpu' in navigator) || !isSecureContext}>
            オンデバイスQwen（実験的・WebGPU）
          </option>
          <option value="local" disabled={!configured || browserOnly}>
            ローカルOllama（実験的）
          </option>
          <option value="api" disabled={!apiConfigured || browserOnly}>
            設定したAPIモデル（外部送信あり）
          </option>
        </select>
      </label>
      {!('gpu' in navigator) && (
        <p>
          このブラウザはWebGPUに対応していません。対応するChrome等、またはローカル版のモデル接続をご利用ください。
        </p>
      )}
      {mode === 'browser' && (
        <section aria-label="オンデバイスモデルの準備">
          <p>
            Qwen3-1.7B・MLC
            4bit。初回は約1GBのモデルと推論プログラムを取得し、端末のGPU・約2GB以上のメモリを使用します。会話はモデル配布先へ送信しません。キャッシュはブラウザに保存され、容量不足で消去される場合があります。通信料はご利用の回線契約によります。
          </p>
          <label className="chat-check">
            <input
              type="checkbox"
              checked={downloadConsent}
              disabled={loading || modelReady}
              onChange={(e) => setDownloadConsent(e.target.checked)}
            />
            無料のモデルをHugging Face / GitHubから取得して端末内で使うことを許可する
          </label>
          <button
            type="button"
            disabled={!downloadConsent || loading || modelReady}
            onClick={() => void loadModel()}
          >
            モデルを準備する
          </button>
          <button
            type="button"
            disabled={!loading && !modelReady}
            onClick={() => {
              deviceModel.current.dispose()
              setModelReady(false)
              reset()
              setLoadProgress('モデルを停止しました。キャッシュは保持しています。')
            }}
          >
            取得を取消／モデルを停止
          </button>
          {loadProgress && <p role="status">{loadProgress}</p>}
        </section>
      )}
      {mode === 'api' && (
        <p>
          送信先: {apiDescription}。
          会話と選択情報を、管理者が設定したAPIへ送信します。利用条件・料金・保存方針を確認してください。キーはブラウザへ配布しません。自動切替・自動再送はありません。
        </p>
      )}
      {!configured && (
        <p>ローカルモデルは未設定です。モデルの自動取得・外部AIへの送信は行いません。</p>
      )}
      <fieldset disabled={working}>
        <legend>共有する手動タスク・予定（最大6件）</legend>
        {candidates.length === 0 && <p>共有できる手動データはありません。</p>}
        {candidates.map((item) => (
          <label className="chat-check" key={item.id}>
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              disabled={!selected.includes(item.id) && selected.length >= 6}
              onChange={(e) => {
                reset()
                setSelected((ids) =>
                  e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id),
                )
              }}
            />
            {item.title}
          </label>
        ))}
      </fieldset>
      <label className="chat-check">
        <input
          type="checkbox"
          checked={consent}
          disabled={working}
          onChange={(e) => {
            if (!e.target.checked) reset()
            else setConsent(true)
          }}
        />
        {mode === 'api'
          ? '選択した情報と会話を、設定した外部APIへ送信することを許可する'
          : '選択した情報と会話を、このローカルモデル／Mockに渡すことを許可する'}
      </label>
      <div className="chat-history" role="log" aria-label="会話履歴" aria-live="polite">
        {turns.map((turn, i) => (
          <p key={i}>
            <strong>
              {turn.role === 'user' ? 'あなた' : mode === 'mock' ? '試験用Mock' : 'Today AI'}
            </strong>
            <br />
            {turn.content}
          </p>
        ))}
      </div>
      {sources.length > 0 && <p>回答で参照した共有情報: {sources.join('、')}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <label>
          メッセージ
          <textarea
            value={input}
            maxLength={2000}
            disabled={working}
            onChange={(e) => setInput(e.target.value)}
            placeholder="今日の予定を確認／タスク「読書」を追加"
          />
        </label>
        <div className="chat-actions">
          <button
            className="primary-button"
            disabled={
              !consent || working || loading || (mode === 'browser' && !modelReady) || !input.trim()
            }
          >
            会話する
          </button>
          <button
            type="button"
            disabled={
              !consent || working || loading || (mode === 'browser' && !modelReady) || !input.trim()
            }
            onClick={() => void send(true)}
          >
            Mockメッセージを受信
          </button>
          <button
            type="button"
            disabled={!working || !!pending}
            onClick={() => {
              conversation.current.cancel()
              gateway.current.cancel()
            }}
          >
            推論を取消
          </button>
          <button type="button" disabled={working} onClick={() => reset()}>
            履歴と許可を消去
          </button>
        </div>
      </form>
      {working && <p role="status">処理中です。対象は確認後に変更されます。</p>}
      {proposal && (
        <section className="chat-proposal" aria-label="変更内容の確認">
          <h3>変更内容の確認</h3>
          <p>
            {proposal.type === 'create'
              ? `新規${proposal.kind === 'task' ? 'タスク' : '予定'}: ${proposal.title}`
              : `対象: ${read().items.find((i) => i.id === proposal.targetId)?.title || '見つかりません'}`}
          </p>
          {proposal.type === 'update' && (
            <p>
              {proposal.patch.title && `タイトル: ${proposal.patch.title} / `}
              {proposal.patch.status &&
                `状態: ${proposal.patch.status === 'done' ? '完了' : '未完了'} / `}
              {proposal.patch.at && `日時: ${new Date(proposal.patch.at).toLocaleString('ja-JP')}`}
            </p>
          )}
          {proposal.type === 'create' && proposal.at && (
            <p>日時: {new Date(proposal.at).toLocaleString('ja-JP')}</p>
          )}
          <p>この内容だけを実行します。対象が変わった場合は中止します。</p>
          <button disabled={working} className="primary-button" onClick={() => void approve()}>
            この変更を承認して保存
          </button>
          <button
            disabled={working}
            onClick={() => {
              approval.current.discard()
              setPending(null)
            }}
          >
            却下
          </button>
        </section>
      )}
      {outbox.map((entry) => (
        <section className="chat-proposal" key={entry.message.id} aria-label="Mock返信案">
          <h3>Mock返信案（宛先: 架空の本人）</h3>
          <p>{entry.message.text}</p>
          <p>送信状態: {entry.state}</p>
          <button
            disabled={working || !['DRAFT', 'FAILED'].includes(entry.state)}
            onClick={() => void sendDraft(entry.message.id)}
          >
            Mock返信を承認して送信
          </button>
        </section>
      ))}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      <p>
        メール・外部カレンダーの変更、実iMessage、実サービスへの送信は未対応です。ブラウザを閉じた状態での参照・返信も未対応です。
      </p>
    </section>
  )
}
