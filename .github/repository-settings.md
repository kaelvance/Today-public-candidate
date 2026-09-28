# Public repository settings checklist

Private RC stagingはkaelvance/Todayで実確認済みです。RC作業はDraft PR #1、残るgateはissue #2で管理します。以下はV2公開前に管理者が設定・実確認する項目です。

- Description: `Local-first Japanese daily organizer with optional, replaceable intelligence.`
- Suggested topics: `local-first`, `react`, `typescript`, `privacy`, `productivity`, `experimental-ai`。
- Default branch `main`。rootのLICENSEでMITを認識することをGitHub UIで確認。
- Private vulnerability reportingを有効化。SECURITY/行動規範の実連絡経路を確認。
- mainのdirect push/force push/deleteを制限し、PR reviewとRelease qualification jobの成功を必須化。管理者bypassも可能なら制限。
- fork PRには秘密を渡さない。CIはcontents:read、権限昇格するpull_request_targetを使わない。
- Actionsは固定commit。依存変更時はlock/SBOM/license/auditと変更点をreview。
- 成功した公開CIのみbadgeを表示。未実行の値を表示しない。
- release/tagはtested commitに対応、checksumを添付、Experimentalとnot configuredを明記。

実Actionsで確認したcheck名は `Zero-key / Node 22` と `Zero-key / Node 24` です。実Actionsのcheck名を確認してからrulesetへ登録します。未実行のstatusをrequired checkとして推測で設定しません。sole maintainerの場合のreview運用・例外は明示します。tagはprotected運用でtested commitを指し、public releaseはユーザーの最終GOに限定します。GitHubプランによるprivate repositoryの保護機能の可用性は実設定で確認します。未設定の保護を「有効」と表示しません。

## Private RC staging 実確認（2026-09-28）

- Repository: kaelvance/Today、Private、default main。既存initial main commitを保存しRC branch/Draft PRを使用。
- Actions: 現RCの4 uses SHAのみ外部Action許可、full SHA固定必須。GITHUB_TOKEN default read、ActionによるPR作成/承認off、fork PR execution off、他repositoryアクセスoff、証跡30日。
- GitHubはPrivateのbranch protectionを現プランで強制しないと表示。強制保護有効とは扱わない。mainへのdirect/force push・branch削除を行わず、Draft PR上で実CIと人の判断を確認する運用。課金/移管/公開による回避は実施しない。
- 実CIが全成功しても、非公開脆弱性報告経路と最終公開GOが未完了ならOSS_RELEASE_READY=NO。
