# V3 alpha.2 — GatewayWorkspace / StorePort

> RC1の現在の実装・検証は [実装記録](IMPLEMENTATION_STATUS.md) と [Mac保存庫](LOCAL_VAULT.md) を参照。以下はalpha基盤の範囲・履歴で、local vaultの試験結果とは区別する。

alpha.3では本契約のStorePortをfixture SQLiteへ注入した。[永続化試験](PERSISTENCE_QUALIFICATION.md)、[V2移行dry-run](V2_MIGRATION_REPORT.md)、[ADR 004](../adr/004-fixture-sqlite-and-readonly-migration.md) を参照。以下の「Mock atomicity/disk未確認」はalpha.2基盤の範囲であり、alpha.3のprocess crash試験を否定するものではない。実ユーザーのDomain正本は変更していない。

2026-10-11。実装: `server/v3/mock-workspace-store.mjs`, `gateway-contract.mjs`, `mock-gateway.mjs`。

## データ正本の範囲

V2のDomain正本は引き続きbrowser IndexedDB。今回のGatewayWorkspaceは**架空のselected projection**と試験操作receiptを持つ。Domain taskの新規作成・編集・同期・実データ移行を実装したものではない。ブラウザ閉鎖中も期限内のprojectionを照会できる設計は試せるが、新しい予定を取得・更新する能力の証明にはならない。

`FixtureWorkspaceDocument` は `schemaVersion=1`, `fixtureOnly=true`, `workspaceId`, monotonic `revision`, `updatedAt`, `data:WorkspaceSnapshot`, `receipts`。dataのcapture/expiry/provider時刻は保持する。sourceTime、暦日、unknown field、duplicate ID、件数/byte上限を検証する。restoreに成功しても古いprojectionは古いまま。

このrevisionはMock projection envelopeの版数であり、V2 Domainのtask revisionや将来の承認付き操作のtarget revisionとは別である。

## 読取状態

| StorePort状態 | 意味                                | 動作                                                       |
| ------------- | ----------------------------------- | ---------------------------------------------------------- |
| FIRST_USE     | 該当entryが存在しない               | 空の正常データを返さない。Ownerが明示的にfixtureを作成する |
| PRESENT       | schema/metadata/receiptを検証できた | scopeとsource期限を満たす時だけdeviceへ返す                |
| UNAVAILABLE   | storeへアクセスできない             | read/write停止、元entryを保持                              |
| CORRUPT       | JSON/schema/shape/metadataが不正    | read/write停止、空stateで上書きしない                      |

Mockはencoded JSONを保持し、毎loadで検証する。期限切れprojectionはPRESENTのままread拒否。corrupt entryへのin-place repairはこの段階で許可せず、別のfresh Mock storeに有効backupを復元する試験を行う。

## Writer・commit

- 同じMock Store objectにつきwriter leaseは一つ。第二Runtimeのclaimを拒否する。
- Owner fixture commandは一つのbounded queueを通す。revision CASで古い対象への書き込みを拒否する。
- dataとidempotency receiptを一つのencoded entryでcommitする。receiptはoperation ID、validated request hash、revisionだけ。
- 同ID・同payloadのreplayは保存済みreceiptを返し、効果を増やさない。同ID・異payloadは拒否。
- commit前のfailureは元entryを保持する。commit後の応答failureはUNKNOWNとして返す。Gatewayによる自動再試行は行わず、同一操作のreceipt照合で結果を確認する。
- `close()` は新しい要求を止め、受理済みwriteのsettlementを待ってからwriter leaseを解放する。
- ledger上限に達したら新writeを停止する。古いreceiptのevictionでgateを弱めない。
- Store全体のentryは8workspaceまで。Runtimeを閉じて別membershipで再作成してもこの上限は変わらない。上限では新規作成を拒否し、既存data/receiptを保持する。

これは同一プロセスのMock atomicityである。disk/fsync/OS crash、別プロセスwriter、実DB transaction、ネットワークpartitionの保証は未確認。

## Backup / restore

Owner portだけがexport/restoreを実行する。backupはformat version、fixture marker、workspace ID、createdAt、workspace document、SHA-256を持ち、最大128KiB。**SHA-256は破損検出であり出所認証・暗号化ではない。** 文書の出所とOwnerによる選択は将来のtrusted UIで確認する。

restoreは同workspaceのvalid schema/checksumを検証する。revisionは現在とbackupの最大値より増やし、現在receiptとbackup receiptを整合させる。矛盾・超過は停止する。restore自身もidempotent。別workspaceへの復元、scope/credential持込、未知schemaや余分fieldは拒否。

公開鍵・秘密鍵・device grant・nonce・proof・browser cookie・OAuth tokenはbackupへ含めない。新Runtimeで端末を再登録する。fresh storeからの復旧はbackupに含まれるsource/receiptだけを回復でき、backup後の未知の操作まで保証するものではない。productionではrestore epochと未確定commandの照合が必要。

## 永続正本への次段階

1. 同じStorePortを実transactional storeへ置き換える。保存・復旧・電源断・多process writerのreceiptを取る。
2. V2 backupからのread-only migration checkerを架空fixtureで作る。終日暦日、revision、IDs、削除、旧保存の保持を確かめる。
3. canonical Gateway方式とreadonly replica方式をADRで比較し、単一writerとoffline behaviorを決める。
4. 正本移行はshadow比較、明示承認、checkpoint、復旧訓練を経る。GatewayがIndexedDBのファイルを直接読む方式は採用しない。

具体的なdisk engine、暗号化/鍵管理、削除/retention、実ユーザーデータの移行は未採用・未実行。0円条件を満たすlocal構成から検証する。

参照: [認証](GATEWAY_PROTOCOL.md) / [ADR 003](../adr/003-gateway-mock-before-live-identity.md) / [試験](IMPLEMENTATION_STATUS.md)。
