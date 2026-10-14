# ADR 004 — SQLiteによる架空Workspace永続化とV2移行dry-run

2026-10-11。状態: ローカルalpha.3のfixture試験に採用。実ユーザーの正本DB移行、遠隔Gateway、production資格の決定ではない。

## 基準と決定

Ownerは「永続保存と架空V2データの移行検証」の開始を承認した。alpha.2の未commit変更50ファイルをhash付きで記録し、独立した `work/v3.0.0-alpha.3/source`、branch `dev/v3-persistence-alpha3` へ継承した。既存依存とNode24.19.0だけを利用する。

1. 新しいStorePortはSQLiteのtransactionでprojectionとreceiptを同じrowにcommitする。追加依存・cloud DB・課金APIを導入しない。
2. 新規生成した私有fixture directoryに限定する。既存DB欠損・破損時に新DBや空stateを自動作成しない。
3. data DBと独立したSQLite lease DBを用いる。lease connectionの `BEGIN IMMEDIATE` をRuntimeの寿命中保持し、受理したwriteのsettlement後にROLLBACKする。複数の協調StorePort/processが同じlease fileを使う契約である。
4. PIDの生死判定、lock file削除、timeoutによる強制writer移譲は行わない。process終了後のSQLite lock解放を試験する。
5. journalはDELETE、synchronousはFULL。prepared statementsでID/JSONを束縛する。extension loadingを許可しない。
6. V2は引き続きDomain正本。移行checkerは架空のmanual exportのread-only dry-runで、Gatewayはselected readonly replicaのままにする。
7. 元のbackup bytesを保存対象として返す。normalizationによる値の損失、ID重複、欠損日時、曖昧な終日暦日、未確定操作はBLOCKEDとして返す。書き戻しや推測復元を行わない。

## 根拠と限界

実Runtimeの `process.version=v24.19.0`、SQLite `3.53.3` を確認した。[当該Node版の公式資料](https://nodejs.org/download/release/v24.19.0/docs/api/sqlite.html) は `node:sqlite` をStability 1.2 / release candidate、DatabaseSyncを同期APIと記載している。試験用StorePortの利用と、production runtime採用は別gateである。

[SQLite transaction資料](https://www.sqlite.org/lang_transaction.html) のwrite transaction/BEGIN IMMEDIATEと、[journal・synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous)、[atomic commit](https://www.sqlite.org/atomiccommit.html) を参照した。FULL設定だけでストレージ機器・filesystemの保証を証明できない。今回のSIGKILLはOSを稼働させたprocess crashであり、停電・kernel crash・故障diskの試験ではない。

lease DBは協調protocolであり、同じOSユーザーの悪意あるコードや直接SQLite書換えの権限を隔離しない。短期device grantはRAMのまま、実Owner認証・TLS・Keychainとは未接続。fixture DBは暗号化していないので実個人情報の投入は禁止する。

## 正本方式の比較

| 方式                                    | 長所                                       | 必要な追加契約                                                     | 現段階                  |
| --------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ | ----------------------- |
| Browser正本 + selected readonly replica | V2互換性維持、無断同期を避けて復旧を試せる | 選択同意、source期限、削除/取消連鎖                                | alpha.3の架空試験に採用 |
| Gateway正本 + browser client            | 常駐・複数端末の共通読み書き               | Domain revision、migration、offline queue、restore epoch、rollback | 保留                    |
| Browser/Gateway双方writer               | offline編集の柔軟性                        | conflict/merge、delete tombstone、操作順序・再送                   | 今回採用しない          |

同期・Gateway正本への移行は、架空shadow比較→移行形式の合意→復旧訓練→Owner承認の順序とする。IndexedDBの実ファイルをGatewayから直接読まない。

参照: [永続化](../v3/PERSISTENCE_QUALIFICATION.md)、[移行](../v3/V2_MIGRATION_REPORT.md)、[現在の結果](../v3/IMPLEMENTATION_STATUS.md)、[前段ADR](003-gateway-mock-before-live-identity.md)。
