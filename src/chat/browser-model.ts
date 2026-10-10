import type { MLCEngineInterface } from '@mlc-ai/web-llm'
import { validateReply, type ChatModelPort, type ChatRequest } from './contracts'
import { browserReplySchema, completionMessages } from './prompt'

export const browserModelId = 'Qwen3-1.7B-q4f16_1-MLC'
export const browserModelRevision = '80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc'
const libRevision = '025bcaf3780fa8254f5e5efd3bfea0a5397248f4'

/** Worker owns GPU state; loading is an explicit action, never part of respond(). */
export class BrowserChatModel implements ChatModelPort {
  readonly id = browserModelId
  private engine: MLCEngineInterface | null = null
  private worker: Worker | null = null
  private generation = 0
  private busy = false
  private cancelLoad: (() => void) | null = null
  ready() {
    return this.engine !== null
  }
  async load(consent: boolean, progress: (message: string) => void) {
    if (!consent) throw new Error('model_download_consent_required')
    if (this.worker) throw new Error('model_already_loading')
    if (!('gpu' in navigator) || !isSecureContext) throw new Error('webgpu_unavailable')
    const generation = ++this.generation
    const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm')
    if (generation !== this.generation) throw new Error('model_load_cancelled')
    const worker = new Worker(new URL('./browser-worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker
    const cancelled = new Promise<never>((_, reject) => {
      this.cancelLoad = () => reject(new Error('model_load_cancelled'))
    })
    const timer = setTimeout(() => this.dispose(), 600_000)
    try {
      const engine = await Promise.race([
        cancelled,
        CreateWebWorkerMLCEngine(worker, browserModelId, {
          logLevel: 'ERROR',
          initProgressCallback: (p) => {
            if (generation === this.generation) {
              const step = p.text.startsWith('Fetching param cache')
                ? 'モデル取得'
                : p.text.startsWith('Loading GPU shader modules')
                  ? 'GPU準備'
                  : '初期化'
              progress(
                `${step}: ${Math.round(p.progress * 100)}%（現在の工程） / ${Math.ceil(p.timeElapsed)}秒`,
              )
            }
          },
          appConfig: {
            model_list: [
              {
                model_id: browserModelId,
                model: `https://huggingface.co/mlc-ai/${browserModelId}/resolve/${browserModelRevision}/`,
                model_lib: `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${libRevision}/web-llm-models/v0_2_84/base/Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm`,
                overrides: { context_window_size: 4096 },
              },
            ],
          },
        }),
      ])
      if (generation !== this.generation) {
        worker.terminate()
        throw new Error('model_load_cancelled')
      }
      this.engine = engine
    } catch {
      worker.terminate()
      if (this.worker === worker) this.worker = null
      throw new Error('browser_model_load_failed')
    } finally {
      clearTimeout(timer)
      if (generation === this.generation) this.cancelLoad = null
    }
  }
  dispose() {
    this.generation++
    this.cancelLoad?.()
    this.cancelLoad = null
    this.engine = null
    this.worker?.terminate()
    this.worker = null
    this.busy = false
  }
  async respond(request: ChatRequest, signal: AbortSignal): Promise<unknown> {
    const engine = this.engine
    if (!engine || this.busy || signal.aborted) throw new Error('browser_model_unavailable')
    this.busy = true
    const generation = this.generation
    const cancel = () => engine.interruptGenerate()
    signal.addEventListener('abort', cancel, { once: true })
    try {
      // Rebuild KV state from the allowed request; revoked/scope-changed history is not reused.
      await engine.resetChat()
      if (signal.aborted || generation !== this.generation) throw new Error('chat_cancelled')
      const reply = await engine.chat.completions.create({
        messages: completionMessages(request),
        stream: false,
        temperature: 0.7,
        top_p: 0.8,
        seed: 42,
        max_tokens: 512,
        response_format: {
          type: 'json_object',
          schema: JSON.stringify(browserReplySchema(request)),
        },
        extra_body: { enable_thinking: false },
      })
      if (signal.aborted || generation !== this.generation) throw new Error('chat_cancelled')
      const choice = reply.choices[0]
      if (
        reply.choices.length !== 1 ||
        choice.finish_reason !== 'stop' ||
        choice.message.tool_calls?.length
      )
        throw new Error('browser_invalid_response')
      const text = choice.message.content
      if (typeof text !== 'string' || text.length > 6000)
        throw new Error('browser_invalid_response')
      // Qwen's non-thinking template may emit an empty think marker before JSON.
      // Strip only that exact empty prefix; never extract arbitrary embedded JSON.
      const json = text.replace(/^<think>\s*<\/think>\s*/, '')
      const result = validateReply(JSON.parse(json), request.context)
      if (
        result.proposal &&
        ('at' in result.proposal || (result.proposal.type === 'update' && result.proposal.patch.at))
      )
        throw new Error('date_requires_editor')
      return result
    } finally {
      signal.removeEventListener('abort', cancel)
      if (generation === this.generation) this.busy = false
    }
  }
}
