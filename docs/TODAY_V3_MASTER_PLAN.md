# Today V3 総合開発計画

## 2026-10-10: V2.1.0への移行

AI Chat・承認付きAI操作・Messaging共通基盤の正式開発対象を **Today V2.1.0** へ変更した。独立コピーで `2.1.0-alpha.1` の製品コードとMock/ローカル評価を実装した。具体的な実装状態は [V2.1実装記録](V2_1_IMPLEMENTATION.md)、[品質・残課題](V2_1_QUALIFICATION.md)を優先する。以下の元資料は2026-10-09時点の設計履歴として残す。「未実装/未承認/未実行」は元資料時点の記述であり、今回の結果を表す時はV2.1記録を参照する。

将来V3に残す範囲: GatewayWorkspace正本/永続ledger/常駐、実チャネルとiMessage、PWA実機・iOS・通知/共有、アカウント/同期/tenant/クラウド/商用。今回V2.0.3公開版・公式サイト・実アカウント・外部送信を変更していない。Qwenは未採用、iMessageは未対応、正式公開準備完了はNO。

---

監査日: 2026-10-09。区分: **設計提案。V3製品コードは未実装**。今回の承認範囲は監査と文書作成のみ。無料優先、既存Core維持を前提にする。

## 文書体系

| 文書                                     | 唯一の主担当範囲                             |
| ---------------------------------------- | -------------------------------------------- |
| 本文書                                   | 実績、公開identity、方針、意思決定、証拠索引 |
| [Architecture](TODAY_V3_ARCHITECTURE.md) | Runtime、データ所有権、port、データフロー    |
| [AI Chat](TODAY_V3_AI_CHAT_SPEC.md)      | 会話・モデル・Context・Tool契約と品質評価    |
| [Messaging](TODAY_V3_MESSAGING_SPEC.md)  | チャネル、本人対応、配達・再送・Bridge条件   |
| [Security](TODAY_V3_SECURITY_MODEL.md)   | 信頼境界、認可、同意、脅威、保持・確認       |
| [Roadmap](TODAY_V3_ROADMAP.md)           | 依存関係、見積り、gate、着手順               |
| [Gap Analysis](TODAY_V3_GAP_ANALYSIS.md) | 実装状態、未検証、変更候補と試験             |

既存の[Architecture](ARCHITECTURE.md)、[V2.0.3 Release](V2_0_3_RELEASE.md)、[AI Chat Feasibility](AI_CHAT_FEASIBILITY.md)、[Abuse Resistance](ABUSE_RESISTANCE_PLAN.md)はV2の仕様・過去の計画として維持する。本資料で「設計」「候補」と記した新機能を既存機能へ読み替えない。

## 1. V2.0.3の正式公開を確認した結果

匿名のGitHub API・公開Release・配信manifestを今回再取得した。ローカルの446 tracked files、Git履歴、README/CHANGELOG/SECURITY/CONTRIBUTING、Domain/Application/Provider/保存/worker、CI定義、保存済みreceiptと主要試験ログを照合した。全行の侵入試験・新しい全回帰実行ではない。

| 項目                     | 今回の確認結果                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Repository               | `kaelvance/Today-public-candidate`、Public、default `public-candidate`                                                     |
| Version / Release        | `2.0.3` / `v2.0.3`、draft=false、prerelease=false                                                                          |
| 公開日時                 | 2026-10-08 15:10:46 UTC（10月9日00:10:46 JST）                                                                             |
| default・tag・local HEAD | `a0d2e013c942350e552e98db63ca820df36b011a`                                                                                 |
| Tree                     | `51963ae02fa3fe75af548cd11cd8f7237de583e6`                                                                                 |
| 正式source ZIP SHA-256   | `d202c026264c66d4123f162d0abc6eacfe45fc14dc356caf467419d9a9c63146`                                                         |
| Archive                  | 名前付き公開assetを再取得しhash一致、446ファイルの内容をGit blobと再照合し不一致0                                          |
| 公開Web                  | [Today Web](https://kaelvance.github.io/Today-public-candidate/)、deployment.json version/commit一致                       |
| ライセンス               | MIT、Copyright 2026 Kaito Kuon                                                                                             |
| 保護                     | ruleset 24412874 active、default branch対象、PR・strict Node22/24 checks、force push/deletion禁止。独立承認review必須数は0 |
| 脆弱性窓口               | PVR enabled=true。第三者からの通知受信は未検証                                                                             |

公開tag/Release一覧はv2.0.0・v2.0.1・v2.0.3で、v2.0.2の独立Releaseはない。open PRは0。開発準備中というissue #6がopenのまま残っており、最新Releaseとの案内整合性は今後の文書・issue整理候補。今回GitHubを変更していない。

ローカルbranch名は`prep/v2.0.3-free-first`のまま、originは別のローカルcheckout。ローカルにv2.0.3 tagがないことを公開tag不在と誤認しない。文書追加前の作業ツリーはclean。今回の新設計資料は未commit・未pushで、正式Release ZIPに含まれない。

### Qualificationの意味

同一commitの保存済みreceiptを今回読み取り検証した。Mac Node22.13.0/24.19.0、Ubuntu24.04 Node22.23.3/24.21.0の各環境は、**過去に実行されたsource 21 gate・fresh archive 16 gateのexitCode=0、passed=true**。全archive hashも一致した。今回これらの製品試験を再実行したという意味ではない。

公開CIの対象commitでRelease qualification・Firefox/WebKit・Pagesがsuccess。receiptは142 unit tests、V2 UI 20 flows/21 axe checks、保存復旧15 cases、更新5 flows、既存E2E、dependency/license/SBOM/security/OSS検査を記録する。archive全実行bit照合は公開receiptで確認した過去結果。今回再照合したのはZIP hashとファイル内容。

実端末iPhone/Android、実BFCache、OS kill/suspend、browser eviction、フルReact世代更新、Google実credentials、外部AI本番接続、独立侵入試験は未検証。Safariの限定観測やLinux WebKit結果を実iPhoneのPASSにしない。axe incompleteを保持し、WCAG認証と記さない。現在の脆弱性不存在も保証しない。[公開Release](https://github.com/kaelvance/Today-public-candidate/releases/tag/v2.0.3)とE02を優先する。

## 2. V1〜V2の継承実績

| 段階                                | 証拠で確認できる実績・境界                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1初期〜1.2                         | 項目操作、検索、手動保存、バックアップの開発履歴。現在の実装はV2ソースと回帰で判断し、当時の全acceptance完了を一括認定しない                      |
| V1.3〜1.5                           | Domain/Application/Provider/Context分離、SOURCE/USER/DERIVED、Intelligence Routerとprivacy/schema/提案検証。Google読み取りの実装と架空応答試験    |
| V1.6 Alpha / V1.7 Beta / V1.8 Gamma | ローカルモデル研究。現行Gamma資料はfrozen Qwen3-1.7B MLX4bit + 別LoRA SFT Adapter。教師蒸留なし。Alpha/Beta個別の全学習条件を今回再監査していない |
| V1.9                                | MIT、NOTICE、SBOM、契約試験、source/archive qualification、RC失敗の保存・修正履歴。古いRC資料は履歴であり最新公開判定ではない                     |
| V2.0.0                              | 4画面、和紙・墨のUI、クイック入力・確認、既存Coreを継承                                                                                           |
| V2.0.1                              | GitHub Pagesの静的公開Core。ローカルNode版と機能範囲が異なる                                                                                      |
| V2.0.2候補                          | 単一編集タブ・競合防止。独立正式ReleaseではなくV2.0.3へ取り込まれた                                                                               |
| V2.0.3                              | 保存破損・読込失敗・IDB abort・引継ぎ・バックアップ確認・安全なworker更新、source-map-js1.2.2、正式公開identityを確認                             |

GammaはContext false merge0/40・recall40/40、Fact12/32・Temporal9/32で品質未達。汎用Chat採用・重み配布はしていない。2026-10-09の別試験Qwen3.5-4BはV2.0.3の実装・qualificationから分離する。

## 3. 不変条件と製品範囲

1. AIを無効化・停止・未導入でも手動Core、保存、オフラインが動く。
2. モデルは出力データと提案だけ。DB・OAuth token・外部変更権限を保持しない。
3. 初期Chatはread-only。後続の変更は決定的なvalidator、権限、対象・差分のユーザー確認、revision再確認を経る。
4. ローカルContext利用への許可と外部AI送信同意、メッセージチャネルへの返答同意は別に扱う。無断fallbackをしない。
5. V2データを空stateで上書きしない。バックアップ互換性と単一writerを守る。
6. privacy・安全性・アクセシビリティを性能より先にgate化する。
7. ブラウザ単独、local Node、常駐Gateway、将来multi-tenant cloudを別deployment modeにする。

**推奨する最初の製品:** local Node版の任意Web Chat + ユーザーが選んだToday snapshotのread-only対話。公開PagesはAI不要のCoreを維持し、開発者Macを公開利用者のバックエンドにしない。公開Pagesからloopbackへ自動接続する方式も採用しない。WebGPUやcloud Chatは独立評価後の選択肢。

## 4. 無料優先・配布方針

- Alphaは既存の利用者管理ローカルruntimeを任意利用。モデル起動・新取得には明示操作と容量説明が必要。Coreの依存条件にしない。
- 今回モデル取得・推論・学習・蒸留・Adapter作成・有料APIを実施しない。クラウド予算初期値0、予約できない料金のリクエストは停止、残量を超えるfallbackをしない。
- PWA/Webを最初に改善する。ネイティブiOSのApp Store配布はApple Developer Program費用等の判断が別途必要で、無料前提の必須条件にしない。[Apple会員比較](https://developer.apple.com/support/compare-memberships/)
- Messaging APIの無料枠はホスティング・常時稼働Mac・電力・通信・規約変更を無くさない。無料枠上限時は返信保留/停止し、自動契約・upgrade・paid broadcastをしない。
- MIT公開Coreの既存利用権を取り消さない。ホスティング・任意同期・サポート・AI枠のサービス提供は別段階。モデル・Adapter・第三者コードは別license/NOTICE、重みはsource repo非同梱。

## 5. 設計上の主要決定

| ID  | 推奨決定                                     | 理由                                                                      |
| --- | -------------------------------------------- | ------------------------------------------------------------------------- |
| D01 | Core上にConversation層を追加                 | 全面書換えを避け、決定的Domainを保持                                      |
| D02 | ChatModelPortを新設、既存抽出契約と分離      | system/userのみ・JSON制約を多turnへ無検証転用しない                       |
| D03 | BrowserWorkspaceを初期の正本とする           | NodeはブラウザIDBを読めない。送信するsnapshotは選択・期限付き             |
| D04 | 「Webを閉じて操作」にはGatewayWorkspace gate | 正本repository・移行・単一writerなしでは成立しない                        |
| D05 | すべての初期Chat変更をconfirmation必須       | 現行UIのlow-risk即時操作をAIの権限へ継承しない                            |
| D06 | Messaging先行は公式API1チャネル              | Telegram private chatを調査優先、Discord/LINEは用途別。iMessageは独立実験 |
| D07 | BlueBubbles Private APIは対象外              | SIP無効化・注入の前提を許容しない                                         |
| D08 | Qwen3.5-4Bは暫定評価候補                     | 小規模試験のみ。GammaをChatとして採用しない                               |
| D09 | sync・SaaS・課金は別gate                     | Chat成功はmulti-tenantや同期安全性を証明しない                            |

これらは実装への提案であり、今回の作業でコード変更の承認が得られたとは扱わない。次の承認単位はRoadmapのA0/A1。

## 6. 証拠索引・優先順位

確認優先順位: 固定commitのコード/試験 → 同identityの実行receipt → 現在の匿名API → 現在の一次サービス資料 → Notionの構想。Notionのverificationはunverifiedで、V3欄は計画。

| ID  | 証拠                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E01 | [固定source tree](https://github.com/kaelvance/Today-public-candidate/tree/a0d2e013c942350e552e98db63ca820df36b011a)、ローカルGit全446 blob、package/lock/SBOM/CI                                                                                                                                                                                                                          |
| E02 | [Release](https://github.com/kaelvance/Today-public-candidate/releases/tag/v2.0.3)、[公開qualification receipt](https://github.com/kaelvance/Today-public-candidate/releases/download/v2.0.3/Today-2.0.3-qualification.json)、[Release Report](https://github.com/kaelvance/Today-public-candidate/releases/download/v2.0.3/Today-2.0.3-Release-Report.md)、Mac/Ubuntu4組の保存済みreceipt |
| E03 | [Release CI](https://github.com/kaelvance/Today-public-candidate/actions/runs/37797275329)、[Browser CI](https://github.com/kaelvance/Today-public-candidate/actions/runs/37797275496)、[Pages CI](https://github.com/kaelvance/Today-public-candidate/actions/runs/37797275190)、[deployment.json](https://kaelvance.github.io/Today-public-candidate/deployment.json)                    |
| E04 | [ruleset API](https://api.github.com/repos/kaelvance/Today-public-candidate/rulesets/24412874)、[PVR API](https://api.github.com/repos/kaelvance/Today-public-candidate/private-vulnerability-reporting)。設定は確認、違反PRによるenforcement再実験は今回していない                                                                                                                        |
| E05 | [AI Chat Feasibility](AI_CHAT_FEASIBILITY.md)、[Gamma model card](../models/today-model/model-card/MODEL_CARD.md)、base manifest。非公開の重みは未読取り                                                                                                                                                                                                                                   |
| E06 | workspace内`work/ai-lab/2026-10-09-qwen35-4b/REPORT.ja.md`、`evidence/evaluation.json`/`summary.json`。前作業の独立7問試験。公開repoのfixtureではない                                                                                                                                                                                                                                      |
| E07 | [Notion総合設計書](https://app.notion.com/p/3f38f33299418135a751d5367c332683)。接続経由で読取り成功、最終編集2026-10-08T23:37:10Z。公開・実装証拠を代替しない                                                                                                                                                                                                                              |
| E08 | 今回の匿名取得・照合JSONはworkspace内`work/v3-design/evidence/`。個人credentialsや実ユーザーデータは含めない                                                                                                                                                                                                                                                                               |

`docs/qualification/RC_FINAL_STATUS.md`などは1.9 RCの歴史snapshot。現在がPrivate/NOという記載をV2.0.3へ適用しない。CHANGELOGにはV2.0.1/2の正式公開と候補の説明に不足があるため、次の文書更新で時系列を補足する候補とする。過去receiptは書き換えない。

## 7. 未確認・次の判断

全機能の状態はGap Analysis、停止条件はSecurity、実装承認単位はRoadmapへ集約する。最初に承認すべき範囲は、Chat専用契約・fake model・架空snapshotを使うread-onlyの小さい実装。新モデル比較、外部AI、OAuth追加、実iMessage・公式サービスへの送信、sync、公開・課金はそれぞれ別承認とする。
