# V3 alpha.3 — Fixture SQLite StorePort

> RC1の現在の実装・検証は [実装記録](IMPLEMENTATION_STATUS.md) と [Mac保存庫](LOCAL_VAULT.md) を参照。以下はalpha基盤の範囲・履歴で、local vaultの試験結果とは区別する。

2026-10-11。実装 `server/v3/sqlite-workspace-store.mjs`。既存Mock GatewayへStorePortだけを注入する。製品HTTP/UIへ接続していない。

## 保存とアクセス

- `createFixtureStoreDirectory({fixtureOnly:true})` だけが新規directory/DBを生成する。directory 0700、DB/marker 0600、同一OS owner、regular file、link count=1を要求する。
- `openFixtureSQLiteStore()` は既存の初期化済みfixture DBしか開かない。marker、store identity、application ID、schema/version、journal mode、quick_check、件数/bytesを検証する。
- FIRST_USEは正常DBに該当workspace rowがない場合だけ。DB欠損・unsafe path/permissionはUNAVAILABLE、不正header/schema/JSON/shapeはCORRUPT。両者でwriteを停止し、原物を保持する。
- root実体path、DB inode、journal sidecarを確認する。symlink、hard link、dangling journal symlink、不明なWAL/SHM、別identityを拒否する。悪意ある同一OSユーザーの競合を完全に防ぐsandboxではない。
- main DBの `BEGIN IMMEDIATE → validate/CAS → single row update → COMMIT` がdata+receiptを一緒に保存する。期待revisionが変わった場合はROLLBACK。8workspace上限を維持する。
- lease DB connectionのtransactionを保持し、同じfileを用いる別Store/processのwriterを拒否する。受理したwriteが未settleならclose/releaseを拒否。Mock Gatewayはqueueをdrainする。
- commit前のfailureはROLLBACK。commit後の応答failureは `commit_outcome_unknown`。新Runtimeが保存receiptで照合し、同一操作の効果を増やさない。
- expiryはread拒否であり、PRESENT entryの削除ではない。source capture/expiryを再起動・restoreで更新しない。auth鍵・grant・nonceはDBに含めない。

## 実行した故障試験

SQLite suiteの個別結果と件数は [実装記録](IMPLEMENTATION_STATUS.md) を参照。

1. close/reopen後のrevision・receipt・source保持、grantの非復活。
2. 同processの二重Storeと、別processのwriter拒否。
3. lease保持processのSIGKILL後に新writerが獲得できる。
4. **before_write / after_write / after_commit** で子processをSIGKILL。前二者は旧row+旧receipt、後者は新row+新receiptを回復。同一操作の再照合で重複効果なし。
5. checkpointの例外でwrite failure/UNKNOWN、未settled writeのclose/drain。
6. missing、zero、malformed DB、schema変更、JSON-valid invalid row、permission、symlink、上限のnegative。
7. fresh SQLite DBへのbackup復旧。古いsourceとreceiptを保持し、device grantsを復元しない。

checkpointは架空試験のtrusted injectionで、model/APIへ公開しない。例外注入を実disk-fullや実hardware I/O failureの試験として数えない。

## 再現して修正した問題 / 試験の訂正

**S-01:** `existsSync` はdangling symlinkでfalseになるため、初期実装が不正なjournal pathを見落とした。期待UNAVAILABLEに対しFIRST_USEになるfailureを `sqlite-path.before-fix.log` に保存。sidecarをlstatで検証する方式へ修正し、marker store identityの変更も拒否する。targetedと全SQLite回帰で確認した。

初回SQLite suiteは12/14。2件はfixture helperの引数誤りと、異なるstore UUIDを持つDB bytesを比較したテスト誤り。`sqlite-initial.log` を保存し、実helper契約・比較対象を訂正した。これらを製品脆弱性として数えない。

## 未確認 / 本番接続の停止条件

- power loss、kernel crash、故障disk、実disk-full/ENOSPC、backup後の未知操作、filesystem同期の機器保証。
- 同時reader/writeの実負荷、性能/イベントループ停止、Ubuntu/Windows/Node22資格。
- encryption/key lifecycle、削除/retention、改変者に対するbackup出所認証、restore epoch。
- 実Owner/device認証、TLS、Domain command revision、全正本migration、実ユーザーデータ・iPhone。

Node24.19.0の小規模local fixtureに限定する。これらの未検証を正式ReleaseのPASSへ含めない。導入判断は [ADR 004](../adr/004-fixture-sqlite-and-readonly-migration.md)。
