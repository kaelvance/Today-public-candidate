import type { ChatModelPort, ChatReply, ChatRequest } from './contracts'
export class HttpChatModel implements ChatModelPort {
  constructor(private readonly route: 'local' | 'api' = 'local') {}
  get id() {
    return this.route === 'api' ? 'configured-api' : 'local-ollama-experimental'
  }
  async respond(request: ChatRequest, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(
      this.route === 'api' ? '/api/chat/api/respond' : '/api/chat/respond',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-today-request': '1' },
        body: JSON.stringify(request),
        signal,
      },
    )
    if (!response.ok) throw new Error('local_chat_failed')
    return response.json()
  }
}
/** Deterministic simulator, never presented as a real AI. No network. */
export class MockChatModel implements ChatModelPort {
  readonly id = 'mock-not-ai'
  async respond(request: ChatRequest, signal: AbortSignal): Promise<ChatReply> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 40)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(new Error('chat_cancelled'))
        },
        { once: true },
      )
    })
    if (signal.aborted) throw new Error('chat_cancelled')
    const message = request.messages.at(-1)!.content
    const title = message.match(/^タスク「([^」]+)」を追加$/)?.[1]
    if (title)
      return {
        text: '試験用Mockがタスク追加案を作りました。確認するまで変更しません。',
        citations: [],
        proposal: { type: 'create', kind: 'task', title },
      }
    const target = request.context.facts.find((fact) => message === `「${fact.title}」を完了`)
    if (target)
      return {
        text: '試験用Mockが完了案を作りました。確認してください。',
        citations: [target.id],
        proposal: { type: 'update', targetId: target.id, patch: { status: 'done' } },
      }
    return {
      text: request.context.facts.length
        ? `試験用Mockが選択情報を表示します。\n${request.context.facts.map((f) => `${f.title}（${f.status === 'done' ? '完了' : '未完了'}）${f.at ? ` / ${f.at}` : ''}`).join('\n')}`
        : '試験用Mockです。選択された情報はありません。例: タスク「読書」を追加',
      citations: request.context.facts.map((f) => f.id),
      proposal: null,
    }
  }
}
