# V2.1 ブラウザChat・独立オンデバイス / API設計

2026-10-10。公開判定は現identityのqualificationと実機モデル評価後に行う。本資料はAlphaから追加した変更の仕様であり、実行していないgateのPASSを意味しない。

## 経路と費用

| 経路                   | 推論場所                                | 配信・取得                                                                                | APIキー / 費用                                                                                   |
| ---------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ブラウザQwen（実験的） | 利用者端末のWebGPU / Dedicated Worker   | WebLLM 0.2.85はアプリ同梱。Qwen3-1.7B MLC q4f16_1とWASMは取得同意後に固定revisionから取得 | キー不要、推論課金なし。初回約1GB、メモリ約2GB以上、回線費・電力・端末資源は利用者負担           |
| ローカルOllama         | 利用者のloopback Ollama                 | Todayローカルサーバー経由。インストール済みモデル名とdigestを検査                         | キー不要。Todayはモデルを自動pullしない                                                          |
| 任意API                | 管理者の設定した互換completion endpoint | Todayローカルサーバー経由。公開Pagesにキー・API backendはない                             | 初期無効。自前ローカルAPIを無料の基準とする。外部HTTPSは管理者の明示設定とユーザー送信同意が必要 |
| Mock                   | 端末内の決定的simulator                 | 取得なし                                                                                  | 実AIではないことを表示                                                                           |

CoreはどのAI経路も使用せず動作する。PagesではブラウザQwenとMockを利用できる。APIモデルはローカル版をブラウザで開く場合に利用でき、静的Pagesにサーバー用秘密を埋め込まない。公開Pagesから開発者Macへ接続しない。

## 固定モデル

- ID: `Qwen3-1.7B-q4f16_1-MLC`、1.7B、4bit weight / fp16 compute。
- upstream: [Qwen/Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B)、Apache-2.0。
- MLC revision: `80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc`。
- WASM repository revision: `025bcaf3780fa8254f5e5efd3bfea0a5397248f4`、`web-llm-models/v0_2_84/base/Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm`。
- 既存Gamma / Qwen3.5 GGUFを転用せず、学習・Adapter・蒸留・新たな量子化は行わない。upstream配布済みMLCを推論する。
- GitHubソースZIP / Releaseには重み・キャッシュ・モデル実行時keyを含めない。
- [WebLLM公式](https://webllm.mlc.ai/docs/)に基づくWorker実装。新しいモデルへ自動更新しない。固定URLはimmutabilityの対策であり、全tensorの暗号学的SRI検証完了を主張しない。

## ライフサイクルと情報保護

起動・モデル選択だけでは取得しない。「無料のモデルを取得することを許可」→「モデルを準備する」の後だけ取得する。Hugging Face / GitHubはIPと取得URLを観測できる。モデル配布先へ会話本文を送信しない。GPU非対応・容量不足・通信失敗・device lossは停止し、Coreを継続する。無断API fallbackなし。

WorkerはChatを閉じる／モデル切替／停止ボタンで終了しGPU状態を解放する。各推論前にKV stateを許可済みrequestから再構築する。取得取消はWorker終了とload promise取消で遅延成功を採用しない。取得に10分上限。推論は30秒上限、出力512tokens、context4096tokens、同時1。ブラウザキャッシュは保持され、ブラウザ設定から消去できる。オフライン推論は必要なruntime/modelがキャッシュされた場合のみで、evictionを前提に常時動作を保証しない。

会話はuser/assistantの完了ペアのみ。最大6ペア、本文4500文字 / 6000 UTF-8 bytes、超過時は古い完了ペアを削る。最新入力・Contextを切り詰めない。選択手動データ最大6件、60秒TTL。履歴はメモリのみ、backupへ混ぜない。画面終了・許可撤回・モデル／範囲変更で履歴・操作receiptを消す。systemはアプリ固定、外部メッセージやタスク名をsystem命令にしない。

出力JSONを決定的に検証し、citationsと対象を選択内に限定する。モデルのtool call、削除、メール送信、任意URLの実行、任意field書換えを拒否。AI提案は保存を意味しない。承認は既存Application / 単一writer / 保存成功を経て初めて完了を表示する。日時の推論変換をブラウザモデルに任せない。`explicit-commands.ts`が全文一致した `予定「タイトル」を明日15時に追加` 等をContextの現地日付・timezoneでUTCへ変換する。存在しない日付・夏時間のgap/foldは拒否し、曖昧な日時・対象はエディタへ案内する。これらの明示コマンドはLLMを呼ばずCoreの解析として扱う。一般会話と選択情報への質問はモデルが推論する。

CSPは通常のscript evalを許可せず、WebAssembly用`wasm-unsafe-eval`とsame-origin Worker、モデル配布先だけのconnect許可を追加する。外部APIのブラウザ直接呼び出しはない。ユーザー生成HTML/Markdownの実行を追加しない。

## API接続契約

`server/chat-api.mjs`はQwen等の自前互換completion API向け。独立したChat契約を既存構造化抽出のRouterから分離する。環境変数は`.env.example`を参照。

- `TODAY_CHAT_API_ENDPOINT` / `TODAY_CHAT_API_MODEL`、任意のserver-only `TODAY_CHAT_API_KEY`。
- numeric loopback HTTPを無料自前APIの基準にする。外部HTTPSには`TODAY_CHAT_API_ALLOW_EXTERNAL=true`。設定はoperator権限のみ、clientが任意endpoint/modelを差し替えない。
- redirect禁止、body/roles/同意/TTL/出力/モデル名検査、toolsなし、JSON schema response、30秒、中断伝播、同時1、既定100試行/server process（失敗も消費）。自動再送なし。
- この試行上限はproviderの金額上限ではない。再起動でリセットされる。外部providerの無料枠・料金・データ保持・上限を別に確認し、provider側の支出制限なしに有料APIを有効化しない。
- schema response / exact model IDを返さないproviderは拒否する。すべてのAPIの互換性・ライブ接続を主張しない。
- 未対応操作要求は共通の決定的なcapability policyでモデル呼び出し前に停止する。モデルが「送信します」「保存しました」等の未確認の実行主張を返した場合も、Coreの結果と混同させず未実行と表示する。この文字列検査は全ての言い換えを検出する保証ではなく、実行能力を与えないApplication境界が保護の本体である。

APIキーをフォーム、ログ、Git、Pages、localStorage、会話Contextへ配置しない。本開発では有料APIの実呼び出し・key provisioningを実行しない。

## Releaseの範囲

実メッセージ送信、iMessage、ブラウザ閉鎖時の返信、常駐Gateway、同期、永続会話、Google情報のChat連携は未対応。MessagingはMockと独立したinert公式API契約preview。実チャネル有効化は別承認と検証を必要とする。

[実装](V2_1_IMPLEMENTATION.md) / [モデル評価](V2_1_MODEL_EVALUATION.md) / [Security](V2_1_SECURITY_REVIEW.md) / [Qualification](V2_1_QUALIFICATION.md)。旧Alphaの数値を新candidateのPASSへ流用しない。
