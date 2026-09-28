# External AI consultation and disagreement log

2026-09-28、ユーザー許可に基づきDeepSeekとSakana Chatへ、問題・期待/実挙動・不変条件・既存テスト・制約・Codex仮説・短い匿名化codeを送信しました。鍵/token/cookie/個人メール/予定/端末path/private dataは送信していません。全repositoryは送らず、6件のセキュリティ/async仮説に限定しました。

DeepSeekはログインをユーザー自身が完了し、**ディープシンク有効・スマート検索無効**を画面で確認してから送信。Sakanaはguestで利用できるNamazuを使用し、メッセージに伴う利用規約同意はユーザーが明示承認しました。Fugu Maxや有料modelを使ったとは主張しません。外部回答は未検証の提案で、外部AI自身がテストを実行した証拠ではありません。

| Issue / Codex initial hypothesis      | 提案 / 一致・相違                                            | 最終判断・証拠                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| UTF16長とBufferbyte長で署名比較が例外 | 両AI一致。DeepSeekはASCII形式も提案                          | UTF8byte長比較＋base64url43字限定。security Unicode回帰PASS                                                                       |
| try前のrequest URL生成でreject        | 両AI一致。ただしSakanaの「不正percentなら必ずURL例外」は過大 | invalid absolute URL/originで実測。URLはcatch、Host先検証。Nodeはpercent文字列すべてをrejectするわけではない                      |
| pending stateのexpiry/capacity不足    | 両AI一致、DeepSeekは検証後single-useを提案                   | 512件、10分、毎request expiry回収。wrong-sessionでは消費しない。512+expiry回帰PASS                                                |
| 不正manifestでCore全体停止            | 両AI一致。DeepSeekは読取上限も提案                           | fd stat/read64KiB、optional構成隔離。不正/oversized/no-model回帰PASS                                                              |
| available待機が推論deadline外         | 両AI一致                                                     | availability+inferの同じrace、cancel後infer禁止、finally解放。Vitest回帰PASS                                                      |
| generations/rate map増大              | 両AI一致。DeepSeekはHTTP409/1000件別上限/TTLも提案           | generationsはrouter内部、active予算とfinally/同一generation検査で限定。追加HTTP契約変更は採用せず。ai rate mapはexpiry掃除+1024件 |
| crypto / filesystem境界               | Sakanaはnonce/0600/TOCTOUの追加仮説                          | 既存random12byteIV・wx0600・renameをコード再確認、16並列書込・tamper試験。same-OS-user/parent directoryはaccepted risk            |
| trusted Plugin / model権限            | 両AIはsandbox不足やprivacyの限界を指摘                       | sandboxと表示しない、read-only/schema/remote拒否を検証。malicious同一processはaccepted risk                                       |

採用変更はV1.9 candidateのsecurity/index/router/local-model/storage/source-pluginにあります。追加HTTP409など新しいProvider契約や大きなarchitecture変更は行っていません。Sakanaが示したHTML report生成や想定20testsは実行結果として数えません。root causeはCodexがコードと再現テストで独立検証しました。

## License consultation

指定された既存ChatGPTへsource licenseとmodel分離を相談し、末尾にユーザー指定文を添付しました。ChatGPTのMIT案をそのまま権利の事実とは扱わず、ユーザーへ権利と公開名義の最終確認を実施。確認された名義Kaito KuonでMITを反映しました。第三者依存/Qwenの権利は各上流LICENSEで照合しました。

## 追加のDeepSeek思考モードレビュー: cold development起動

clean cloneの初回development scenarioでuseStateのnull例外を1回観測し、production SHAは一致、React版は各1つ、その後は再現しないという事実と、dedupe/includeの最小対策・cold3回成功だけを匿名化して追加相談しました。DeepSeekはroot cause断定不可、低リスクの緩和、pageerror assertion維持、上限付きcold検証とproduction比較を提案しました。Codexも因果を証明したとは扱わず、fresh cloneとartifactを含むcold起動の検証を残します。件数を増やすための無限反復や新依存は採用しません。

## RC最終検証: CI・chain of custody（2026-09-28）

追加のDeepSeekレビューはディープシンク有効を確認して実施。匿名化したCI trigger/permissions/runtime/pinned actions、clean HEAD→展開後blob比較→新規install/build/test/E2E/restart/cold、artifact保存、GitHub未認証の停止境界だけを送信しました。秘密・PII・実端末path・private logs・AIの思考過程はこの記録に含めません。Sakana Namazuにも同じ趣旨で追加を試みましたが、匿名認証のnetwork-request-failedで回答を取得できず、1回の更新/再試行後に停止。初期V1.9のSakanaレビューは上記の履歴を維持し、今回回答したと数えません。

| Codex初期仮説 / issue                                | DeepSeek提案                                                                   | 独立判定と証拠                                                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 固定HEADを展開byteと比較すれば同じsourceを確認できる | ZIP container byteは非決定的。展開比較に限定、symlink/LFS/submodule/modeを明示 | 採用/確認。実装は当初から展開後とcat-file blobの比較。NUL区切りinventoryとexecutable bit比較を補強。非対応形式を拒否、固定ZIPのSHAを別保存                                                |
| PR artifactは合格やpublish authorityではない         | debug専用、release/署名へ渡さない、env filterをsandboxと呼ばない               | 採用。docs/RELEASEで明文化。workflowにprivileged follow-up/deploy/releaseはない。source/child envを独立確認                                                                               |
| Actions40字SHA固定、全履歴scanにfetch-depth0が必要   | SHAを上流commitで確認、深さ1も検討                                             | SHA確認を採用。上流git refsでcheckout v4.3.1、setup-node v4.4.0、pnpm action v4、upload-artifact v4.6.2の一致を照合。depth1は全履歴scan要件のため不採用                                   |
| cacheはpnpm storeのみ、secretsなし、frozen lock      | PRからbase cacheが汚染され得るためcache:falseを提案                            | このworkflowへの一般化を不採用。GitHub公式はpull_request cacheをmerge refへ隔離し、base/別PRへ復元不可と規定。privileged triggerなし。秘密はcache対象にしない。将来workflow変更時は再審査 |
| 実GitHub/非公開報告がないのでCONDITIONAL             | 実CI/報告/保護branch/署名等を追加ゲートに                                      | 実CIと報告経路は既存必須ゲート。署名はこのsource RCの必須条件として与えられていないため新しい自動署名基盤は追加せず、未署名と明記。SBOM/auditは独立チェック。AI意見だけで判定しない       |

検証結果はsource外のqualification.json/release-receipt.json/全工程ログで確定します。ローカル実行を実Actionsと表示しません。匿名化された外部レビューもセキュリティ認証ではありません。

## Ultimate Final RC独立レビュー（2026-09-28）

DeepSeekディープシンク有効を確認し、実rc.6 CI成功、Private/main未統合、PVR/保護未設定、rc.7の文書訂正、既存のprivacy/model/plugin境界だけを匿名化して追加相談。秘密・個人データ・端末path・private logsは送信せず、思考過程を公開しない。

| 提案                                             | 独立判定                 | 根拠・処置                                                                                                     |
| ------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 文書/clone案内訂正後に同じ全検証                 | ACCEPTED                 | README/SECURITY/RELEASEの古い記載を実確認。rc.7としてmetadata更新、全再検証                                    |
| 履歴・PR/Issue・失敗artifactも秘密/PII監査       | ACCEPTED                 | tracked available history、GitHub公開対象のcommit tree対応、コメント、取得済みartifactを別スコープで検査       |
| PVRと強制保護未確認なら公開NO                    | ACCEPTED                 | 実Private画面とGitHub公式資料に基づく。公開するための権限は今回与えられていない                                |
| Remoteへの接続サービス情報拒否をegress層でも確認 | ACCEPTED / EXISTING      | server/remote-modelのCONNECTED_SERVICE_DATA/SENSITIVE_CONTEXT拒否、remote regression。UIだけの主張にしない     |
| cold3回をroot cause修復としない                  | ACCEPTED / EXISTING      | 同じMITIGATED / NOT REPRODUCED、pageerror検出を維持                                                            |
| 実Google/remote接続未実施は必ず公開ブロッカー    | REJECTED AS GENERAL RULE | 任意機能でCore公開の必須条件ではない。NOT_CONFIGURED/MOCK_VERIFIED_ONLYを保持し実接続PASSとしない              |
| 全dangling/reflogも普遍的な公開監査義務          | PARTIAL                  | 公開予定branch/tagの履歴と取得可能な関連資料を確認。取得不可・非公開local objectまで普遍的 absenceを保証しない |
| token権限/uninstall/plugin失敗のstranger再検証   | PARTIAL / EXISTING       | 既存security/plugin/corruptionとREADME resetを照合。実利用者のOS/site data削除や実token生成は行わない          |

Sakana Namazuは送信を試みたが応答を得られず、今回の独立レビューはREVIEW_NOT_COMPLETED — COMMUNICATION_FAILURE。以前の成功レビューと区別する。AI意見だけで新機能、署名基盤、追加依存を導入しない。最終結果はsource外report/receiptで確定する。
