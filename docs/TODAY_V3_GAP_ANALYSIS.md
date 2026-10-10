# Today V3 Gap Analysis / V2.0.3監査

## 2026-10-10: V2.1.0への移行

AI Chat・承認付きAI操作・Messaging共通基盤の正式開発対象を **Today V2.1.0** へ変更した。独立コピーで `2.1.0-alpha.1` の製品コードとMock/ローカル評価を実装した。具体的な実装状態は [V2.1実装記録](V2_1_IMPLEMENTATION.md)、[品質・残課題](V2_1_QUALIFICATION.md)を優先する。以下の元資料は2026-10-09時点の設計履歴として残す。「未実装/未承認/未実行」は元資料時点の記述であり、今回の結果を表す時はV2.1記録を参照する。

将来V3に残す範囲: GatewayWorkspace正本/永続ledger/常駐、実チャネルとiMessage、PWA実機・iOS・通知/共有、アカウント/同期/tenant/クラウド/商用。今回V2.0.3公開版・公式サイト・実アカウント・外部送信を変更していない。Qwenは未採用、iMessageは未対応、正式公開準備完了はNO。

---

基準: [Master Plan](TODAY_V3_MASTER_PLAN.md)の固定V2.0.3 identity。監査日2026-10-09。`実装済み`はコードが存在する意味、`検証`は当該実行証跡の範囲。**実装と検証を別軸で分類**する。V3の変更候補は承認待ち。

## 1. 機能状態の全体分類

| 対象                                        | 実装状態                   | 確認した検証と限界                                                                                           | 根拠                                                                 |
| ------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Today / やること / カレンダー / ふりかえり  | 実装済み                   | V2 UI20 flows・responsive/axeの過去receipt。カレンダーは日時付き項目一覧で月gridではない                     | `Navigation.tsx`, `TodaySurface.tsx`, `calendar.ts`; E01/E02         |
| task/event作成・編集                        | 実装済み                   | unit/Core/V2 E2E、クイック入力・確認・IME。AI Chat経由は未実装                                               | `App.tsx`, `capture.ts`, `TodayItem.tsx`; E02                        |
| 完了・復元・保留・固定                      | 実装済み                   | 既存E2Eの操作確認。復元は項目stateの取消で完全DB restoreではない                                             | `App.tsx` completeItem/restoreItem/snoozeItem/changeItem; E02        |
| 検索・優先度                                | 実装済み                   | 決定的projection/priorityとUI試験。AI優先度提案の一般精度とは別                                              | `view-model.ts`, `priority.ts`, `application/projection.ts`          |
| Context Engine / 訂正 / provenance          | 実装済み                   | domain/relationship/projection tests、SOURCE/USER/DERIVED・競合。意味解釈の全入力保証ではない                | `domain/*`, `application/today.ts`, E02                              |
| Intelligence Router                         | 実装済み・AI拡張は実験段階 | schema/privacy/deadline/concurrency/source fingerprint試験。汎用Chat portではない                            | `intelligence/router.ts`, `privacy.ts`, `schemas.ts`                 |
| Provider / Source Plugin / Model contract   | 実装済み・実験段階         | mock/contract/失敗隔離試験。trusted same-processでOS sandboxなし                                             | `ports/providers.ts`, `extensions/*`, docs/PLUGINS.md                |
| IndexedDB / localStorage mirror             | 実装済み                   | shape/不在/破損/失敗・revision選択・abortの15障害ケース。平文、OS crash/eviction未検証                       | `storage.ts`, recovery tests, E02                                    |
| 単一編集タブ・writer引継ぎ                  | 実装済み                   | Web Locks＋accepted write drain＋再loadの過去試験。悪意ある同originへの隔離ではない                          | `PersistenceGate.tsx`, `scripts/storage-ownership.mjs`               |
| backup export/import / 復旧                 | 実装済み                   | preview/重複/取消/追加、正常copyから復旧。manual additive importで同ID置換・full state restore・syncではない | `backup.ts`, backup/recovery regression                              |
| Service Worker / offline / 更新             | 実装済み                   | cache済みCore、waiting、前世代cache、precache失敗、5更新flows。synthetic shell、フルReact世代移行未検証      | `public/sw.js`, `main.tsx`, `scripts/e2e-update.mjs`                 |
| PWA manifest                                | 実装済み                   | `manifest.webmanifest`/icon/registrationあり。実iOS install/通知/shortcutは未検証または未実装                | `public/*`, `index.html`; E01                                        |
| Gmail / Google Calendar読み取り             | 実装済み・任意local設定    | readonly OAuth/PKCE/state/token storageとmock gateway試験。実account・一般公開OAuth運用は未検証              | `server/gmail.mjs`, `calendar.mjs`, `token-store.mjs`, adapters; E02 |
| メール送信 / 外部予定write                  | 未実装                     | read-only Provider。compose表現があってもAPI送信能力ではない                                                 | `ports/providers.ts`, server実装                                     |
| MLX local bridge                            | 実装済み・実験段階         | manifest/hash/start/loopback/budget/role境界。今回実モデルを起動していない                                   | `server/local-model.mjs`, node-test, E05                             |
| Ollama bridge                               | 実装済み・実験段階         | fake server契約試験。別labでQwen3.5実modelを利用したが公開Web接続ではない                                    | `server/ollama-model.mjs`, E06                                       |
| Today Model Gamma                           | 研究成果・実験段階         | Qwen3-1.7B MLX4bit+LoRA SFT、Fact/Temporal品質未達。汎用会話・本番未検証                                     | model card/manifests; E05                                            |
| Qwen3.5-4B                                  | 別labで実験段階            | 7問、うち厳密一致2問、残り内容観測。短文速度/メモリ観測あり、比較/長文/tool信頼性未検証                      | E06。製品source/Releaseに重みなし                                    |
| Remote / legacy AI入力補助                  | 実装済み・任意設定         | mock/negative/privacy試験。実credentialsとcloud Chat品質は未検証                                             | `server/ai.mjs`, `remote-model.mjs`, adapters                        |
| 公開ブラウザ版                              | 正式公開・実装済み         | 現在のdeployment version/commit一致。過去live HTTPS smoke・匿名cloneあり。今回UIの再smokeはしていない        | docs/PUBLIC_BROWSER.md; E02/E03                                      |
| MIT / SBOM / NOTICE                         | 整備済み                   | 固定source/public asset・過去license gate照合。モデル重みは別license                                         | LICENSE/SBOM/THIRD_PARTY_NOTICES/E02                                 |
| CI / source/archive                         | 実運用済み                 | 同commit4環境のreceiptと公開CI success確認。今回製品test再実行なし                                           | E02/E03                                                              |
| repository保護 / PVR                        | 設定有効を確認             | active ruleset、Node22/24必須、PVR enabled。通知配送/違反PR再実験未実施                                      | E04                                                                  |
| AI Chat / 多turn履歴                        | 未実装                     | feasibility文書だけ。独立labの会話と製品Chatを混同しない                                                     | docs/AI_CHAT_FEASIBILITY.md                                          |
| Messaging / iMessage / 公式Bot              | 未実装                     | 仕様調査のみ、send/実authenticationなし                                                                      | 新Messaging spec                                                     |
| user accounts / device sync / SaaS / 課金   | 未実装                     | Node sessionとsource provider syncはaccounts/device syncではない                                             | 新Architecture/Security                                              |
| native iOS / App Intents / 共有sheet / 通知 | 未実装                     | Web responsiveをネイティブ/実機確認と呼ばない                                                                | roadmapの別stage                                                     |

## 2. 公開qualificationの再照合

E02のsource21・fresh archive16 gateをMac/Ubuntu・Node22/24の4組で確認し、すべて同commit/ZIP/exitCode0。公開assetのSHA-256を再計算、Git全446 blobと内容一致。E03のpublic CI checksは対象commitでsuccess。PVR enabled、ruleset activeも現在のAPI結果で確認した。

この監査が再実行したのは公開資料取得・identity/hash/blob照合と文書検査であり、製品のunit/E2E/モデルbenchmarkではない。公開tag/Release一覧でv2.0.2不在を確認。open PRは0、準備中の開発ノートissue #6がopenとして残る。正式版未公開と誤解させる案内は別承認後に更新候補で、製品blockerと同一視しない。旧`docs/qualification/*.json`の依存/test数を最新receiptとして使わない。Release時auditの0 vulnerabilitiesはその時点のsnapshotで、今日の新advisory不存在を確認したものではない。

## 3. 改修対象候補とリスク・試験（全て承認待ち）

| Gap ID / priority         | 不足・理由                     | 最小の対象候補                                                             | 主リスク                                                 | 承認後の試験 / 完了条件                                                                 |
| ------------------------- | ------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| G01 / P0                  | Chat契約なし                   | 新`src/conversation/contracts.ts`, `server/chat/*`; 既存types/bridgeは維持 | role偽装、budget逸脱、抽出regression                     | fake modelのassistant/stream/cancel/late result/token bounds、既存model契約維持         |
| G02 / P0                  | Context/Today読取りscope       | 新TodayReadPort、`application/today.ts`のprojection adapter                | source漏洩・stale・日時誤り                              | 選択ID/fieldだけ、JST/UTC/DST・権限撤回・引用ID検査                                     |
| G03 / P0                  | local Chat UIと履歴            | 新Chat panel、Appの明示入口、独立history store                             | IME、focus、本文保存、Core保存干渉                       | text-only/IME/focus/a11y/保存OFF/delete、AIなしCore回帰                                 |
| G04 / P0                  | Chat resource/model policy     | 新ChatModelPort/Ollama adapter/Chat endpoint                               | OOM、timeout後残存生成、無断cloud                        | digest/同時1/queue/deadline/実cancel・memory pressure/Core共存、採用評価                |
| G05 / P0 before write     | CRUD command port・確認契約    | App内操作の機能別adapter＋新command handlers                               | UI挙動/undo/保存の破壊、TOCTOU                           | before/after/全変更確認・revision・writer・source restriction、既存操作E2E              |
| G06 / P0 before write     | durable ledger / crash outcome | StorageProvider拡張候補、IDB journalとrepository adapter                   | mirrorとledger不一致、二重効果/結果不明                  | cancel/abort/kill/restart/duplicate・pending settlement、atomicity未証明ならwrite保留   |
| G07 / P0 before Messaging | Web終了後のデータ所有者        | 新GatewayWorkspace runtime/repository＋移行tool                            | 正本の二重化、旧backup切捨て                             | explicit migration/reconcile/read-only旧保存、唯一writer、source一致。browser閉鎖試験   |
| G08 / P0 before Messaging | 認証/binding/inbox/outbox      | 新Gateway/Adapter共通contracts                                             | 偽造sender、誤送信、replay、echo                         | fake transport負例、single-use linking、delivery unknown、queue/revoke                  |
| G09 / P1                  | 公式API候補実検証              | 専用Telegram adapter候補、Discord/LINE比較                                 | 第三者送信/secret/無料上限                               | Owner別承認、dedicated private fixture、paid capability無効、quota stop                 |
| G10 / optional HOLD       | iMessage規約/権限/新OS         | 独立BlueBubbles connector案                                                | Full Disk Access、SIP/private API、license差、未知sender | 規約適用確認・release固定・SIP維持・専用環境・基本1対1のみ。未成立なら延期              |
| G11 / P1                  | cloud/selected mail consent    | 新server policy / Chat privacy receipts                                    | 現行connected-data拒否を弱める・Google制限               | payload allowlist、送信preview、endpoint binding、revoke/zero budget。OAuth追加は別承認 |
| G12 / P1                  | mobile実機・lifecycle          | まず既存PWA/worker試験、後にiOS adapter                                    | OS suspend/eviction/通知漏れ                             | 実iPhone/Android/Safari、install/offline/BFCache/kill/更新、最小device matrix           |
| G13 / later               | accounts/sync/tenancy          | 別cloud service/repository/protocol                                        | user間漏洩、競合、鍵回復、運用費                         | A/B isolation・concurrent edit・deletion/restore・cost reservation。V3必須にしない      |
| G14 / P1 governance       | V3 critical checks/review      | `.github/workflows/*`, ruleset更新案                                       | 安全gateの見落し/CI費用                                  | auth/policy/Chat/Browser安全checks、独立review提案、予算・required job名一致            |
| G15 / docs                | 履歴snapshotの読み違い         | docs index/CHANGELOG/qualification歴史注記候補                             | V1のNOをV2現在と誤認、自己参照hash                       | 現在Releaseへのlinks、過去receipt保存、新identityのdoc qualification                    |

今回この表の製品コード/設定は変更していない。各実装PRで理由・範囲・risk・testを提示して承認する。一般的cleanup目的の全面変更は不要。

## 4. 重大な未確認を解消する試験

- 保存: terminal eventのないIDB transaction、実BFCache・OS kill/suspend・storage quota/eviction、旧V2タブと新UIの実世代移行。
- 端末: 実iPhone/Android、native Safariの全flow、screen reader、axe incomplete/contrastと手動確認。
- Provider: 専用Google accountでreadonly OAuth失効・revoke・paging・同期範囲。一般提供のverification条件。実private dataを無承認取得しない。
- Model: Japanese/日時/多turn/tool proposalの固定評価、TTFT/p95/peak Unified Memory/電力/低RAM・cancel。Qwen7例を製品適格性に拡張しない。
- Security/governance: PVR通知配送、現在のDependabot/secret scanning/CodeQL設定、第三者セキュリティレビュー、auth/tenant侵入試験。
- Messaging: BlueBubbles exact release/new OS/license・terms、TLS/query secret、本人binding、sleep/dedup/unknown delivery。現段階は実現性資料であり動作保証なし。

既知限界の列挙でPASSを代替しない。対応対象でデータ喪失・無承認操作が再現された場合、release gateは止める。

## 5. 現在の判定

`V2_0_3_PUBLIC_RELEASE_IDENTITY = CONFIRMED`。既存qualificationは同identityの過去実行として確認。

`V3_IMPLEMENTED = NO` / `V3_RELEASE_READY = NO`。read-only Chatを開発開始するための設計は整ったが、G01〜G04のコード作成・採用試験・実機gateは承認後に実施する。
