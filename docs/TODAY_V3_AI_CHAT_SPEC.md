# Today V3 AI Chat specification

## 2026-10-10: V2.1.0への移行

AI Chat・承認付きAI操作・Messaging共通基盤の正式開発対象を **Today V2.1.0** へ変更した。独立コピーで `2.1.0-alpha.1` の製品コードとMock/ローカル評価を実装した。具体的な実装状態は [V2.1実装記録](V2_1_IMPLEMENTATION.md)、[品質・残課題](V2_1_QUALIFICATION.md)を優先する。以下の元資料は2026-10-09時点の設計履歴として残す。「未実装/未承認/未実行」は元資料時点の記述であり、今回の結果を表す時はV2.1記録を参照する。

将来V3に残す範囲: GatewayWorkspace正本/永続ledger/常駐、実チャネルとiMessage、PWA実機・iOS・通知/共有、アカウント/同期/tenant/クラウド/商用。今回V2.0.3公開版・公式サイト・実アカウント・外部送信を変更していない。Qwenは未採用、iMessageは未対応、正式公開準備完了はNO。

---

区分: **未実装の契約と合格基準案**。本仕様は既存JSON抽出bridgeを開放する許可ではない。[Architecture](TODAY_V3_ARCHITECTURE.md)と[Security](TODAY_V3_SECURITY_MODEL.md)を同時に満たす。

## 1. 最初に提供する体験

Alphaはlocal Node版の任意Chat。ユーザーが会話の目的と読取り範囲を選び、今日/明日の予定、検索、優先度の理由、Contextの要約を出典付きで返す。手動の4画面と入力は残す。モデル未導入・停止時もCoreが動く。

予定作成・変更・完了などはAlphaでは実行しない。返信文はdraftとして表示するだけで、Gmail draft保存や送信を意味しない。Google由来の内容は専用scopeとsource選択・必要最小fieldがある時だけ読む。初期Alphaは架空/手動項目から始める。

日時の検索範囲・優先度計算・item数はApplicationが決定し、モデルにDB問い合わせ文を作らせない。モデルは「接続済み」「送信した」等を決定する主体ではない。

## 2. 独立したChat契約

現行`src/intelligence/types.ts`のPromptMessageはsystem/userのみ、capabilityは構造化抽出用。local/Ollama bridgeは少数messages、JSON、短いtoken/timeout、thinking無効。汎用多turn・assistant履歴・read/write tool・streamの契約はない。既存は維持し、次の新portを別versionで実装する候補。

```ts
// 設計を示す型。ソースへ実装していない。
type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'tool'; toolCallId: string; name: ReadToolName; content: string }

interface ChatModelPort {
  identity(): {
    providerId: string
    modelId: string
    artifactDigest?: string
    locality: 'local' | 'remote'
    maxContextTokens: number
    supports: { assistant: boolean; stream: boolean; cancel: boolean; tools: boolean }
  }
  countTokens(messages: readonly ChatMessage[]): number
  respond(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>
}
```

`ChatRequest`にはcontractVersion、turnId、conversationId、runtime binding、selected snapshot ID/revision、budget、messages、許可されたread tool schemas、privacy classes、consent receipt IDを持つ。principal/grantsは信頼するruntimeが設定し、モデルへ認証情報を渡さない。クライアントのclaimed role・workspace・scopeをbackendがそのまま認可しない。

`ChatEvent`はdelta / readToolProposal / final / usage / failure。model/provider identity、順序sequence、turn generationが一致する時だけ採用。terminalは一度だけ。toolはmodel出力をそのまま呼ばず、brokerがschema/権限/引数/回数を検査する。plain-textしか使えないモデルはread tool proposalを無効化し、決定的に取得したContextから回答する。

system roleは製品が固定し、ユーザー編集不可。assistantは検証済み過去回答だけ。user本文中のrole記述をroleとして扱わない。tool roleはexecutorが生成した結果だけで、providerが未対応なら引用dataへ変換して能力差を表示する。サーバー/Adapterから受け取った本文もすべてuntrusted。

## 3. 会話ライフサイクル・操作性

`IDLE → VALIDATING → CONTEXT_READY → QUEUED → GENERATING → [READ_TOOL_PENDING → GENERATING] → COMPLETED`。

どの段階でもcancel/failureへ遷移できる。STOPPINGはbackend処理が終了した確認まで保持。画面だけを閉じてin-flight枠を即解放しない。late delta/finalはgenerationを照合して破棄する。

- 送信前にモデル/ローカル・外部/選択Contextを表示。Enter送信は日本語IME composition中に発火させない。送信失敗時は下書きを保持。
- キャンセルボタンを常時到達可能にする。Escで取消できるがUI閉鎖と実取消を混同しない。
- 初期は非streaming finalでよい。stream導入後もpartial文を確定事実や承認previewへ使わない。
- 一会話一turn、runtime全体生成同時1、待機2件まで。重複turnIdは同じ結果/状態へjoinし、別推論を増やさない。混雑時はbusyとして拒否。
- モデルのstatus確認と明示warmupは別。通常Core起動でload/pullしない。model auto-fallbackは禁止。
- 再試行はread-only inferenceのみ、ユーザー操作で1回まで。生成cancel/曖昧commitは自動retryしない。
- UIはキーボード・screen reader・文字拡大・reduced motionで操作可能。stream tokenごとのaria-live通知を避け、完了/中止/エラーをまとめて通知する。

## 4. 初期budget案

以下は評価して固定する上限案であり、現行製品の保証値ではない。

| 資源      | Alpha候補の上限/動作                                                                   |
| --------- | -------------------------------------------------------------------------------------- |
| context   | 2048 tokensから開始。output256・安全余白128を確保しinput<=1664                         |
| history   | 最大6 complete turn pairs、token budgetが先。古いpairを削り、その省略を表示            |
| Context   | 最大6 records、最大400tokens、title/time/status/sourceを先。本文の全文を暗黙投入しない |
| 入力      | user2000文字、JSON body32KiBまで、さらにモデルtokenizerの総budget検査                  |
| tool      | 一turn最大2 read calls、result最大8KiB、model round-trip最大3                          |
| 応答      | 最大256tokens/4000文字。上限終了はtruncatedと表示、操作提案に使わない                  |
| deadline  | warm turn30秒、明示cold load60秒、read tool5秒。total deadlineを延長して回数を隠さない |
| cancel    | UI受付即時、broker停止応答2秒目標。runtime生成の実停止とCPU/GPU解放も別測定            |
| model保持 | 初期30秒idleでunload候補。同時loaded model1、text-only、thinking=false                 |
| 診断      | 成否/latency/token/型付き理由のみ。本文・system prompt・tokenは保存しない              |

tokenizerが未対応・カウント不可信なら長文を受理しない。文字数だけでcontext適合を保証しない。system/現在の質問を黙って切り落とさず、必要なら範囲縮小を求める。古いhistoryのAI要約を長期記憶として自動保存しない。

既存Routerのmemory budget2048MiBと、4Bモデル試験の約3.11GBは一致しない。新Chat policyでモデルごとのresource admissionを独立設計する。M5/16GBで6GiBを暫定モデルruntime ceiling候補とし、他アプリを含むmemory pressure・swap増加・Core応答低下で停止する。RSS値を厳密なUnified Memory最大値と扱わない。強制killはworkspace writerではなく所有するモデルprocessに限定し、実停止手段の検証なしにresource gate PASSとしない。

## 5. Context・事実・時間の契約

Context selectionには同意したsource、item ID、fields、生成時刻、timezone、revision、有効期限を含む。メールや外部文書は明確にdataとして区切る。SOURCE/USER/DERIVEDとユーザー訂正を維持し、生成文をSOURCEへ昇格させない。

- 回答の引用IDは読取り結果に存在するIDのみ。存在しないIDを拒否。取得時刻・stale・truncated・矛盾を表示。
- 「今日」「明日」「金曜」はruntimeがIANA timezoneとnowを固定し、日付境界を解決。曖昧な期限・同名タスクは追加質問する。
- メールから「次回」を推論して確定予定を書かない。source eventのexact dateと推定を区別する。
- 未接続/未許可/期限切れは専用reasonで返す。モデルの文章で接続成功を捏造しない。
- 会話メモリーは参照情報。承認、grant、変更の証明にならない。

## 6. Tool catalogと変更提案

| operation                                                | 初期許可           | 認可/制約                                                            |
| -------------------------------------------------------- | ------------------ | -------------------------------------------------------------------- |
| listSchedule / searchTasks                               | Alpha              | scoped workspace、決定的query、timezone/range/件数上限               |
| readContext / explainPriority                            | Alpha              | 選択scopeとsource ID、明示された出典                                 |
| readSelectedMail / readCalendar                          | 後続read-only gate | 接続・source grant・selection、fetchは既存readonly Provider経由      |
| proposeTaskCreate / proposeTaskUpdate                    | Beta               | 提案のみ、unknown field/曖昧対象/不正時刻を拒否                      |
| commitTaskCreate / commitTaskUpdate / complete / restore | Betaの独立gate     | modelに非公開。アプリ確認、single-use receipt、revision、idempotency |
| prepareReplyText                                         | 後続read-only gate | local表示/手動コピー。外部保存・送信しない                           |
| Gmail送信/削除、Calendar外部write                        | 今回のV3初期範囲外 | 新OAuth・法務・高影響安全gateと別承認が必要                          |
| shell / 任意HTTP / code / Plugin導入 / file操作          | 全段階禁止         | schemaに存在させない                                                 |

`CommandProposal`はtype、対象IDまたは新規fields、expectedRevision、before/after、出典、理由、expiresAtを持つ。Executorが許可型・表示内容を再構成し、modelのHTML/確認文を使わない。

`ConfirmationReceipt`はauthenticated principal/workspace、proposalのcanonical hash、revision、確認UI/channel、時刻、nonce、短いexpiryに結び付ける。初期Betaは**全変更をアプリ内で確認**する。後続iMessage操作確認はMessaging §8 / Security §11の独立gateを満たす場合に限る。model/メッセージ本文の「はい」からreceiptを生成しない。変更後にwriterのdurable resultを読み直し、保存された内容とrevisionを確認して初めて完了と表示する。失敗/結果不明なら未実行と断定も成功と断定もしない。

## 7. 履歴・プライバシー

初期履歴はメモリのみ、保存OFF。opt-in保存はCore stateから独立したstore、保持期限7日/100turn候補、per-conversation delete/exportと一括削除を先に実装。平文local保存を説明し、ログやbackupへ自動混入しない。

クラウド履歴送信はprovider・model・endpoint・送信field・選択item・上限・保持条件を示す別同意。過去にローカルで話した履歴全体をcloud切替で自動送信しない。同意撤回は待機turn・Context grantを無効化し、in-flight通信はcancelする。既に送信したコピーの回収は保証しない。

## 8. モデル候補: 観測と未確認を分ける

| 候補                          | 確認済み                                                                                                                                                                    | 未確認/採用方針                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Qwen3.5:4b Ollama GGUF Q4_K_M | E06:4.2B metadata、digest固定、M5/16GB、7問、日本語/日付/短い複数turn/JSON、warm中央値0.70秒・0.282〜1.478秒、cold8.163秒、約40.4tokens/s、runtime報告3.11GB・観測RSS3.72GB | 小規模候補。TTFT/p95/peak Unified Memory/長会話/多様な攻撃/画像/tool calls未評価。他モデルより優秀とは判断しない |
| Qwen3-1.7B base MLX4bit       | 既存manifest約930MB、Apache-2.0、構造化抽出接続の設計・研究履歴                                                                                                             | Adapterなしでの汎用Chat/Japanese/複数turn/速度は比較未実施。軽量比較候補                                         |
| Today Model Gamma             | frozen上記base + 別LoRA SFT、蒸留なし。Fact12/32・Temporal9/32                                                                                                              | **汎用Chatには採用しない**。既存の研究成果として保持                                                             |
| 別Ollama対応model             | Port形式上の候補                                                                                                                                                            | 名前・revision・量子化・license・容量を指定して別承認後に比較。今回は取得なし                                    |
| cloud model                   | 交換可能なportの設計候補                                                                                                                                                    | 未評価・未接続。無料creditsを永続無料と扱わない。予算0で初期無効                                                 |

Qwen3.5公式card/選択版LICENSEはApache-2.0だが、Ollama量子化artifactの由来・変換変更表示・license blobとNOTICEは配布前にdigestごと再確認する。MITのTodayがモデルもMITにするわけではない。[Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B)、[LICENSE](https://huggingface.co/Qwen/Qwen3.5-4B/blob/main/LICENSE)、[Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B)、[Ollama Chat API](https://docs.ollama.com/api/chat)。

## 9. 採用評価計画（未実行）

新取得・学習・有料APIは別承認。既存7問の実測をV3 benchmarkへ流用しない。評価前に用途・rubric・固定fixture・sealed holdoutを定め、同一quant/context/temperature/machine状態で候補を比較する。

- 品質: 日本語/多turn/事実/時刻/不明/出典/注入/操作提案を各25問、計200問の架空fixture案。日付はJST/UTC/DST、月年境界、同名item、矛盾、古いsourceを含む。100問development・100問sealed。
- rubric: ground truthのtask result、引用の存在、事実と推定の区別、不要送信/操作。主観的会話品質は複数評者で別採点。
- 安全: 悪意あるtool proposal・role spoof・メール内命令・越権・同意撤回・重複turn等は決定的validator testで拒否100%、無承認変更0、scope外出力0を必須。有限fixtureの0は全入力保証ではない。
- 暫定品質gate: schemaが有効なproposal>=95%、日時/事実/検索のground-truth正答>=90%。満たさない機能は質問/決定的表示に縮小。閾値は評価開始前に固定し、後から緩めてPASSにしない。
- 性能: warm100turnでp50<=2秒/p95<=8秒を短い回答の暫定目標、TTFT、cold、tokens/s、runtime RSS/Metal/OS pressure/swap、30分継続、cancel実停止を測定。既存7件からp95を主張しない。
- Core共存: 推論中の追加/保存/復旧/複数タブ・worker待機・低RAM/ネットワーク失敗を実機で確認。Core劣化時はChatを停止。

結果はmodel/artifact/runtime digest、fixture hash、machine条件、回答raw、判定、失敗を含むreceiptへ記録。学校利用はまず架空データで行い、実ユーザー・教員・未成年の情報を無承認評価へ投入しない。

## 10. iMessage会話プロファイル（追加設計）

ChatModelPortを使う専用profileで、既存Intelligence Routerの抽出requestとは分離。モデル採用・起動/benchmarkは今回行わない。詳細な受信/返信権限は[Messaging §8](TODAY_V3_MESSAGING_SPEC.md)。

### 会話の範囲と必要な読取り

会話keyはGatewayがbinding/workspace/threadから生成。モデルがconversationIdや別threadの履歴を指定できない。recipient・sender・policy versionの変更で新conversationとなり、旧Contextを継承しない。

1. 認証/dedup後、許可capability・runtime時刻/timezone・最小historyからmodelが理解/読取り提案。
2. 通常会話はDB読取り0。照会が必要な場合だけ`listSchedule/searchTasks/readContext`へschema/範囲の検証済みrequestを渡す。
3. brokerはconsistent snapshotの選択field、revision、source IDs、freshness、truncated/conflictを返す。モデルはその結果に基づいて自然文の返答案を作る。
4. output policyが回答種別と出典を検査し、別のreply authorizationでBridgeへ送る。権限不明時はdraftに止める。

`ReplyCandidate`候補: `{kind:ordinary|grounded_read|clarification|operation_proposal, text, citations[], snapshotId?, observedRevision?, mentionedFactIds[], operationProposalId?}`。未知field/種類/引用IDを拒否し、宛先・送信許可・commit receiptを含めさせない。操作状態はExecutor由来の固定templateで付加する。

通常会話にはTodayの私的Contextを最初から添付しない。「いつもの予定」等で対象が不明なら質問。read-resultのどのfieldを外部iMessageへ出してよいかもgrantに含む。許可されていないメール/添付・機密を要約すれば安全になるとは扱わない。

自由文全体の機密漏洩や事実性をLLM判定だけで保証できない。根拠の検証ができない部分は自動送信しない。機密照会にはallowlisted fieldからの固定templateを優先し、普通の日本語表現を整えるモデルと公開可能データを決定するpolicyを分ける。

### 履歴保持

raw messageの恒久保存は初期OFF。複数turnは認証済み会話ごとのmemory-only bufferで最大6turn pairs/2048token budget、30分idleで破棄候補。これにより再起動後の長期記憶は提供しない。

継続履歴は別opt-inで7日/100turnの上限候補、全文local平文である説明、conversation delete/export、source grant撤回時のpurgeを要する。command/inbox/outboxの最小ID/状態は本文履歴とは別の保持契約。confirmation nonceは期限後に承認に使えないが、消費済みoperation記録は再実行を防ぐため残す。

historyのuser/assistantにもprivacy class、由来source IDs、policy versionを付与。権限縮小・source削除・mode/宛先変更では関連turn、model context/cache、未送信draftを無効化。過去のassistant回答を、既に失効したContextの再公開根拠にしない。Bridge側Messagesには返信が残り、Todayで履歴を削除しても外部コピーの消去は保証しない。

### 推論budget・失敗・確認の解釈

§4のcontext2048/最大256output/同時1/queue2/read2callsを継承。global deadline内でtool-result後の生成を行い、read失敗でtimeoutを繰り返し延長しない。thinking=falseから開始し、高度な推論modeや長い履歴は別評価。chain-of-thoughtやsystem内容を返信/ログへ出さない。

Qwen3.5-4Bは暫定評価候補。7問の結果は継続会話・iMessage品質・tool reliabilityの採用証拠ではない。Mockでは決定的なfake ChatModelPortを使い、モデル品質とrouting/操作安全性を別判定する。

送信/操作確認はLLMの推論対象ではない。`確認 <challenge>`/`取消 <challenge>`/`停止`はGatewayの厳密parserを先に通す。modelへnonceの生成・承認判断を委譲しない。未許可write要求は提案/説明だけで実行しない。

未接続/期限切れ/許可なし/model failureに専用typed reasonを返す。auto失敗返答は認証済みthreadへの非機密固定文を一度まで、manualはUIに留める。結果不明commitや配達を成功/失敗確定と捏造しない。料金が発生するcloudへfallbackしない。
