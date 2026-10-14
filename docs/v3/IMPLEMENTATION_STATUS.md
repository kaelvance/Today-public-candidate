# Today V3 / 3.0.0-rc.1 実装・検証状況

2026-10-14。Owner選択: **Web＋Mac Gateway中心、iOSは検証済み機能から含める**。未公開のlocal RC、新しい課金¥0。[範囲](RC_SCOPE.md)、[保存庫](LOCAL_VAULT.md)、[公開gate](RC_RELEASE_CHECKLIST.md)を参照。

## Sourceと証跡

V2.1.0基準commit `3e3b6a25c9053090373ef1d7d91dd87439be3a6a` / tree `dea7060b6bda7d7ea6a7c8670774ff9b280a998f` からalpha.1〜3追加を継承した独立コピー。branch `dev/v3-local-rc1`。alpha.3の60ファイルhashは `../evidence/alpha3-baseline.json`。原V2.1.0/alphaコピー・公開環境・公式サイトを変更しない。

Owner原設計書SHA-256: `65fdc0805ac1557f5c7b81eb507b7ff2a9c776fcd7fee298dc4562e2cc7d9d35`。原文を編集しない。

固定後の新commit/tree/ZIP SHA-256と結果はsource外 `../evidence/rc-review-report.md`、`../evidence/qualification-node24/qualification.json`、`../evidence/qualification-node22/qualification.json` を参照。生成後だけ有効。source内に自分自身のidentityを埋め込まない。旧alpha/V2のPASSを新identityへ無条件に流用しない。

## 現在の実装

| 対象                                                      | 実装・境界                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 4画面、タスク/予定、検索、保存、復旧、Context、単一writer | V2.1.0 Core継承。既存保存schemaとexporterを維持                                                         |
| Web Chat、Qwen、Ollama、任意API、承認付きCore操作         | 既存ChatModelPortと決定的validatorを維持。Gammaを汎用Chatに転用しない                                   |
| Messaging                                                 | Mock受信/返信、inert API preview。実チャネル送信なし                                                    |
| Web DailyOverview                                         | selected_only・日時/期限/由来、readonly JSON export                                                     |
| Mac local vault                                           | 実loopback HTTP＋暗号化SQLite。setup/unlock/share/read/archive/export/preview/承認復元/承認消去/lock    |
| Portable archive                                          | manual task/event +関連Context/訂正のreadonly JSON。未知revision/終日暦日を明記。Core import未対応      |
| 認証/同期                                                 | local signed session＋passphrase。remote enrollmentはMock。multi-device同期なし                         |
| iOS                                                       | readonly JSON preview、失敗時クリア、期限/由来表示、CryptoKit byte契約。Native AI/live Mac/iMessageなし |

**Mac保存庫はCoreの正本ではなく、ブラウザIndexedDB/localStorageは従来の平文保存。** モデルにvault key/SQL/OAuth権限を渡さない。常駐AI・ブラウザ閉鎖時の返信は未対応。

## 固定前に実行した試験

| Gate                              | 観測結果                                                                       | 証跡                                                 |
| --------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Vault unit + HTTP security        | 21 PASS（Vault17＋HTTP4）                                                      | `../evidence/vault-targeted-final.log`               |
| Portable/projection/migration     | 18 PASS                                                                        | `../evidence/v3-unit.log`                            |
| Vault SIGKILL before/after commit | 2 PASS、暗号化/receipt/再起動                                                  | `../evidence/vault-crash.log`                        |
| Node22 vault + fixture SQLite     | 29 PASS（拡張前の対象）                                                        | `../evidence/node22-vault.log`                       |
| 既存Chat browser E2E              | PASS、flowはreceipt参照                                                        | `../evidence/chat-browser.log`                       |
| Vault Web                         | 8 flow PASS・消去後の同一backup復元/内容照合・390/1440px axe violations0       | `../evidence/vault-browser-restoreretry/result.json` |
| Swift package / Mac               | 13 PASS、Node生成Ed25519/AES-GCM fixture                                       | `../evidence/native-core.final.log`                  |
| iOS27 Simulator / Xcode27         | build＋1 UI test PASS。未接続→架空demo→消去                                    | `../evidence/native-ui.log`                          |
| current Web Qwen / cache-only     | **起動未達**。copied synthetic cacheにparams_shard_0.binがなく、外部取得を遮断 | `../evidence/cached-model/receipt.json`              |

全資格の完了宣言ではない。固定後にqualify-release/release-packageをNode22/24で実行し、receiptだけを最終結果に使う。現行復元UIのE2E/a11yも再実行する。GitHub/Ubuntu CIはpushしないため未実行。過去の実Qwen成功はV2.1.0履歴で、current RCの実推論PASSではない。

## 障害の保存と修正

1. RC-01: busy解除がcallerへ結果を返した後となり、直後の要求を誤ってbusyにした。finallyをreturned promiseへ結合。
2. RC-02: close再呼出しが閉じたSQLiteへ触れた。idempotent closeとhandle解除。
3. RC-03: Web消去confirmがpreview補助fieldまで送りstrict validatorに拒否された。nonce/epoch/revision/confirmedだけを送る。gateを弱めない。
4. offset日時の正規化で既存UTC表記が変わり回帰。Z表記を保持し、offsetだけ同じinstantのUTCへ変換。Coreの日時は変更しない。

5. RC-04: 消去後に同じbackupファイルを再選択してもfile inputのchangeが発火せず、復元previewが無効になった。file object取得後にinputをresetし、同じファイルの再選択を可能にした。Web E2Eの消去→同じbackupで復元→アーカイブ照合で回帰を検証する。

6. RC-05: 全qualificationがOwner原設計書232行の英文をTypeScriptの型として誤検出して停止した。原文hash＋file＋line＋categoryに限定した監査済みprose判定を追加し、製品コード・変更済み文書・秘密情報のgateは維持した。5件のpolicy regressionで判定境界を検証。失敗した旧identityのqualificationは保持する。

初回failとdiagnostic/harness failureをevidenceに保持。test harnessの待機不備と製品faultを区別する。SIGKILLは電源断保証ではない。

## 未対応・未検証

- current実モデル、Ubuntu CI、Safari/Firefox/実iPhone/iOS17、sleep/wake・disk-full・物理停電。
- 完全Core移行、per-item revision/tombstone/終日floating暦日、Context完全契約とCore適用。
- real Owner/device identity、TLS/LAN/live iPhone、key lifecycle/rotation、OS攻撃者・XSS・全ディスクrollbackの独立監査。
- 実iMessage、MCP client、外部OAuth/メッセージ/有料API、Mac常駐AI、cloud/sync。
- GitHub現保護/required checks/PVR照合、公開tag/Release照合。

`TODAY_V3_RELEASE_READY = NO`。local RCと正式Public Releaseの資格を分ける。

## 再現

```sh
pnpm test:v3-vault
pnpm test:v3-persistence
pnpm test:v3-gateway
pnpm test:v3-server
pnpm test:v3-migration
pnpm build
pnpm test:v3-vault-e2e -- ../evidence/vault-browser
pnpm test:v3-e2e -- ../evidence/overview-browser
```

架空データ・専用保存庫・独立Chrome contextのみ。完全qualification/archiveは [公開gate](RC_RELEASE_CHECKLIST.md) の手順を使用する。
