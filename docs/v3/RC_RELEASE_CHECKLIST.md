# V3 RC1 — レビューと正式公開のgate

これは公開RCブランチの正式Release gate。candidateを確認するowner reviewと正式Public Releaseを分ける。[実装記録](IMPLEMENTATION_STATUS.md)、[保存庫の境界](LOCAL_VAULT.md)を参照。

## local candidateの固定手順

1. rc.1 sourceのformat/lint/typecheckと新規targeted tests。具体的な障害だけを修正し、failure evidenceを残す。
2. 独立local commit/treeを固定。旧alpha.3/Baselineとは別identity。Owner原設計書hashを維持。
3. Mac Node22.23.3/24.19.0で既存qualificationとV3 overview/gateway/persistence/vault/Web E2E。資格は実行済みreceiptでのみ判定。
4. committed source ZIPの全file/modeがtreeと一致することを照合。fresh展開→frozen install/build/unit/security/V3・既存E2E/storage/update/stranger/coldを実行。model重み、runtime、browser profile、実データ、.gitは同梱しない。
5. SBOM/license/dependency/source scan。source ZIP SHA-256、commit、tree、環境、失敗と修正の記録をsource外release reportへ保存。
6. Swift契約/暗号fixtureとSimulator UI結果を別証跡に記録。Node暗号fixtureは架空test keyで、実device認証証明ではない。

## 正式公開前に残ること

- Web＋Mac readonly copiesを正式なV3初期範囲としてOwnerが確認。Core正本移行/live iPhone/iMessage等を完成済みと記さない。
- exact candidateのUbuntu Node22/24 CI。今回pushしないので未実行。既存V2 CIを流用しない。
- current candidateで実AIの多turn日本語/日時/提案/取消/誤操作防止の性能試験。既存cache不足で止まったRC試験はPASSではない。新取得/学習/有料APIは別承認。
- 必要な対象ブラウザ・実Mac運用でunlock期限、睡眠/復帰、容量不足/障害、既存user backup互換と保護設定を確認。実データ試験には個別許可。
- 実iPhoneのlive gateway、iOS17、LAN/TLS/device enrollmentは今回未対応。readonly previewだけの配布なら説明・a11y・端末試験をその範囲で実施する。
- release docs、SECURITY/PVR、MIT/NOTICE、依存license、公開CoC窓口、tag/artifactのidentityを新候補で確認する。GitHubの実保護・required checks/PVRはこのturn未照合。
- 公開/merge/tag/Release/deployは別の明示承認を受ける。無料上限・自動従量課金が発生しないことを確認。

`V3_LOCAL_RC_CANDIDATE` と `TODAY_V3_RELEASE_READY` を別記録とする。重大security/privacy/license/source identityやデータ損失が残る時はReleaseを停止する。公開済みcopy/clone/backupは回収不能である。

## 推奨する次段階

1. ローカルRCでWeb Chat＋Mac encrypted copiesを運用確認し、残るAI/OS gatesを閉じる。
2. 完全なDomain移行（revision、終日floating暦日、Context契約、tombstone、正本/単一writer）を独立仕様・dry-runで整える。
3. device identity/Owner承認/TLS/取消/key lifecycleを実transportへ接続し、実iPhone readonlyを検証する。
4. 継続会話・Mac常駐AI・Tool権限・MCPを段階的に実装する。実iMessage/外部送信は個別承認後。SIP無効化や任意shell実行を設計前提にしない。
