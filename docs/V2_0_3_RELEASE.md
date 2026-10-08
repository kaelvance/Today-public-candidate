# Today V2.0.3 — 保存・復旧・更新

## 範囲

V2.0.2候補の単一編集タブ方式を引き継ぎ、確認済みの保存障害を修正します。Google権限、AI実行権限、モデル配布は追加しません。新しい依存パッケージは追加せず、依存検査で発見したHigh advisory GHSA-68fv-2mgg-jv7qの修正版として、間接依存source-map-jsだけを1.2.1から1.2.2へ更新します。SBOMとNOTICEを再生成・照合します。AI Chatは[調査報告](AI_CHAT_FEASIBILITY.md)のみです。

- JSONとして正常でも保存schemaではないmirrorを正常な空stateと誤認しない。
- 両読込不能・破損は自動保存を停止し、再試行を表示。初回利用は全保存slotの不在を確認した場合だけ。
- 正常な保存コピーをrevision順に選び、片方の書込失敗で以前の正常コピーを削除しない。
- IndexedDBの明示abortもPromiseを終了し、受入済みwriteのdrain後にタブ所有権を渡す。
- バックアップ追加前に件数を確認し、取消可能。手動項目の追加であり完全復元ではない。
- 診断コピーはversion、保存・読込状態、online、mode、SWの定型値のみ。本文、URL、tokenを含めない。
- 更新workerは待機し、旧画面を強制切替しない。同scopeの前世代assetを保持する。失敗した新規precacheは破棄して前世代として誤採用しない。

## 必須qualification

`pnpm release:qualify -- <source外directory>` は既存の全gateに加えweb build、web E2E、保存復旧、更新試験をsourceとfresh archiveで実行します。Node22/24、Mac/Ubuntuを別receiptで記録します。依存・license・SBOM・secret scanを省略しません。正式候補のcommit/treeと全archive blob・実行bit・SHA-256を照合します。

追加試験は架空データと独立profileを使います。`test:update` は公開2.0.1の実SW fixtureと新SWを使った合成HTML shellで、複数旧タブ、更新待機、precache失敗、offline、HTTP404を検証します。実React画面の世代移行試験とは区別します。`test:recovery` は実アプリと実storage moduleを使った障害注入です。

この文書を置いたこと自体はqualification完了ではありません。実行結果、source identity、未確認項目は外部receipt / GitHub Release Reportに記録します。

## 既知の制約と未確認

- 保存は平文、同じoriginの信頼に依存。単一編集タブ方式は悪意ある同origin scriptのsandboxではない。
- GitHub Pagesの別projectとoriginを共有。subpath/SW scopeはlocalStorageの分離ではない。
- バックアップはmanual items中心。同ID置換、Context等の完全復元、端末間同期は未実装。
- ブラウザ容量・OS終了・サイトデータ削除による消失を防ぐ永続保証はない。IDB transactionがterminal eventを発行しない環境の無期限停止対策は未検証。
- 実Safariは専用の架空データ環境でCore追加・保存・再読込・配信サーバー停止後の再読込と操作を確認した。旧candidateと共通の実装blobに対する限定的な検証であり、実iPhone/Android、実BFCache、OS強制終了・休止のPASSではない。Playwright engineの結果と区別する。
- Google実アカウント・外部AI本番接続、Gammaの対話品質、独立第三者の侵入試験は未検証。
- 試験で対応環境の重大な保存・更新障害が確認された場合は正式Releaseを停止し、制約の記載だけでPASSにしない。

## 公開順序

1. 固定候補で全ローカルgate、source/archive、Ubuntu CIを確認。
2. 保護PRからdefault branchへ統合し、そのidentityでCIとPagesを再確認。
3. 匿名clone・fresh smoke、公開文書、PVR・required checks、deployment identityを照合。
4. `v2.0.3` tag、GitHub Release、source ZIP・SHA-256・receiptを対応させる。
5. 旧tag/Releaseは書き換えない。公開コピーは取り消せず、障害時は正式公開を停止して最小修正を新identityで再検証する。

## 依存検査で発見したblocker

2026-10-08の新candidate qualificationはdependency gateで停止しました。postcss経由の開発依存source-map-js1.2.1が、indexed source mapのsection offsetによるevent-loop DoSの対象でした。[公式advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)は1.2.2を修正版としています。旧failure logを保存し、当該間接依存のみを更新します。公開Coreでの実悪用や利用者データ流出を確認したという報告ではありません。更新後のaudit・license・SBOMと全qualificationを新identityで実行します。
