# V3 RC1の実装・検証範囲

2026-10-14。Ownerが選択した対象: **Web + Mac Gatewayを中心に、iOSは検証済み機能から含める**。無料/local-first、AI optional、Core保存互換、実ユーザーデータ非読取を維持する。

## 今回完成へ進めるもの

1. V3 portable backup: manual data・選択Context・source時刻・未知revisionの保持、strict preview、損失検出。V2 backupとの境界を明示する。
2. Mac local vault: passphrase導出鍵、AES-GCM暗号化SQLite、session binding、期限/lock、revision/CAS/receipt、明示削除・restore preview。実fixtureで再起動/故障/競合を試験する。
3. Web接続: 同一origin/loopbackだけのsetup/unlock/share/read/export/preview/delete。AIは既存ChatModelPortを維持し、Vaultや鍵の直接操作を許可しない。
4. Web AI Chat/承認付きCore操作/Mock Messagingの回帰、既存Core・SW・backup・a11y・security/privacyの統合試験。
5. iOS readonly previewのbuild、contract、Simulator UI、暗号/署名byte互換のfixture試験。
6. RC source review identity、SBOM/license/source scan、実行結果と未検証gateを保存する。

## 未成立ならReleaseを止めるもの

データ損失、無権限読取/変更、同意なし外部送信、重複効果、鍵/本文のlog流出、backup損失の黙認、曖昧な暦日の推測、失敗をPASSにすること。

実iMessage/外部Messaging、MCP実クライアント、常駐cloud/sync、Native AI、LAN/iPhone live接続、実OAuthはこのRCの保証範囲へ含めない。実機・外部モデル・他OS等の未検証を資格として流用しない。公開/push/merge/tag/Release、課金、new model download、実アカウント接続には進まない。

`3.0.0-rc.1` はローカルcandidateの名称であり、名称だけでRelease-readyを判定しない。最終gate表を [実装記録](IMPLEMENTATION_STATUS.md) に記す。
