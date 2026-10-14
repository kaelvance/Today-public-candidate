# V3 alpha.2 — Gateway安全性レビュー

本書はalpha.2の認証Mockレビュー。alpha.3のSQLite fixture/process crashと移行checkerの追加レビューは [永続化](PERSISTENCE_QUALIFICATION.md)、[移行](V2_MIGRATION_REPORT.md) を参照。diskの限定試験が追加されても、実認証・暗号化・power loss・正本移行・production接続のHOLDは解除しない。

2026-10-11。Codexによる実装レビューと架空negative試験。第三者AIへのコード送信、実アカウントやモデル推論、侵入先の調査は行っていない。有限のMock PASSを完全な安全性やproduction資格として扱わない。

## 今回見つけて修正した問題

**G-01: 端末IDだけでread challenge枠を埋められる。** 初期Mockはchallenge発行後の署名だけを検証し、発行時点でdeviceのquotaを消費した。第三者がdevice IDを知ると本人のreadを妨げられる。

外部未接続のMockで再現した。`gateway-read-init.before-fix.log` に期待された拒否が起きないfailureを保存。read-init署名、server issuer/intent/query/client nonce/時刻の束縛、accepted nonceのreplay拒否を追加した。bad proofはslot/quotaを使わない。targeted2件がPASS。

nonce cacheは受付済み30秒のinitだけを保持し、device失効/取消とcloseで取り除く。署名を知る相手のpassive/active attackやnetworkレベルDoSまでこのMockだけで解決したとは扱わない。

**G-02: Runtimeのworkspace membershipを変える再起動でStore件数上限を超えられる。** 初期MockはRuntimeごとの8workspace上限だけを検証し、同じStore objectに残った別membershipのentryを合算しなかった。

8件を保存してRuntimeを再作成し、9件目が拒否されないfailureを `gateway-workspace-capacity.before-fix.log` に保存した。Store自身で新規entry作成時の8件上限を検証し、fault injectionの新規entryにも適用した。上限では `workspace_capacity_reached` を返し、既存8件を保持する。targeted1件がPASS。自動削除・evictionで上限を回避しない。

両修正後にGateway全29件、Server回帰全69件（Gateway29件を含む）、offline integration9フローをPASS。外部fetch呼出は0。Mockの有限試験結果であり、実network/device/diskの資格ではない。

## 確認した安全条件

| 脅威                                 | 実装・試験で確認した範囲                                            |
| ------------------------------------ | ------------------------------------------------------------------- |
| 未承認端末・別鍵・表示名のなりすまし | Owner承認と鍵所持証明を分離、key type/fingerprintを検証             |
| scope/tenant/query/issuer改変        | server側binding、strict fields、署名全体、別workspace data出力なし  |
| 署名の再送・別protocolへの転用       | purpose/issuer/nonce、pair/read/read-initの一回限り消費             |
| 取消とin-flight応答                  | await後にdeviceと期限を再確認、pending要求を除去                    |
| staleやclock rollback                | source capture/expiryを維持、clock後退と期限切れreadを拒否          |
| 失敗読取からの空データ上書き         | FIRST_USE/UNAVAILABLE/CORRUPTを分離、後二者ではwrite停止            |
| 同時write・途中停止・応答不明        | single writer、CAS、drain、atomic receipt、UNKNOWN照合              |
| backup改変・別workspace              | bounded decode、schema/workspace/checksum、Owner-only control       |
| 無限蓄積                             | ticket/read/device/queue/receipt/audit上限、receipt保護を削除しない |
| title/proofのlog混入                 | auditに本文・署名・鍵を記録しない、返却値と入力をclone              |

## 製品接続を止める未解決条件

1. **実Owner認証なし**: Owner portはtrusted harness。これをHTTP/MCP/modelへ公開してはならない。実ログイン・登録画面・本人確認・XSS対策が必要。
2. **実transportなし**: TLS/server identity、request/response binding、pre-auth rate、pairing window、timeout/body上限、ネットワークDoSは未実装。LAN公開やcookie流用で代替しない。
3. **diskのdurabilityなし**: Mock Storeは同一processのobjectだけ。電源断、多process、fsync、実transaction atomicity、暗号化・復旧・削除・retentionを未検証。
4. **実device鍵なし**: Nodeのfixture Ed25519のみ。Swift/Keychain/Secure Enclave/lock state/reinstall/recoveryの検証は別。現実の人物・端末所有権はMockから証明できない。
5. **backupの真正性/暗号化なし**: checksumを再計算できる相手の改変を認証できない。Ownerが選んだvalid架空backupを復元するMockで、個人情報backupの本番要件を満たさない。
6. **正本・Domain commandなし**: Gatewayはselected projection。V2 canonical state、task target revision、外部OAuth操作、message宛先権限、LLM prompt injectionの安全性はこの試験の対象外。
7. **完全なaudit保存なし**: bounded RAMで除外件数を表示。productionの持続的なsecurity監視や復旧時command reconciliationは未実装。

これらは今回のMockを誤って実サービスへ接続しないためのrelease blockerで、公開V2.1.0に新しい同種の脆弱性を確認したという意味ではない。新Gatewayの本番接続・V3正式ReleaseはHOLD。

## 費用・Owner判断

追加依存・モデルdownload・実API・有料契約・新規Store加入なし。ローカルの試験と公開一次資料の確認に限定した。実認証、実データ露出、OS権限、署名・配布、課金・公開に進む時だけ、具体的な範囲と代替案を提示する。現在のMock修正にOwner-only判断は必要ない。

評価ログはsource外の `../evidence/`。[契約](GATEWAY_PROTOCOL.md)、[Store](GATEWAY_WORKSPACE_SPEC.md)、[実装とgate](IMPLEMENTATION_STATUS.md) を参照。
