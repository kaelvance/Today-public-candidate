# V2.0.2 保存競合修正・追加監査

調査日: 2026-10-04。修正候補であり、公開済みのV2.0.1を変更したという報告ではありません。

## 確認して修正した問題

### 1. 複数タブによる保存内容の上書き

V2.0.1公開URLの空のbrowser contextで、タブAの追加後に古いstateのタブBで追加すると、Aの項目が保存から消えました。各タブが全stateを保存し、writeChainがタブをまたいで排他しないことが原因です。

V2.0.2候補はWeb Locksで編集タブを1つにします。所有権取得前にはAppをmountせず、入力・provider同期・state保存を開始しません。所有権が移ったタブはAppを新しくmountして保存を再読込します。保存APIも所有権なしの要求を拒否します。pagehideで受け入れ済みのwriteをdrainしてから、存続するdocument間でlockを解放します。実document終了時のlock解放はbrowserに任せます。bfcache復帰時は再取得します。

旧版は新しいlockを使わないため、保存slotも分離しました。旧データは読込移行し、旧コピーを保持します。移行後の旧slot更新は新版のデータを上書きしません。旧版での後続編集の自動mergeは行いません。

これは単一編集タブ方式で、複数タブの同時共同編集機能ではありません。lockを無視する同originの悪意あるscriptに対するセキュリティ境界ではありません。

### 2. バックアップ内の同じIDの重複

同じmanual itemを2件含むfixtureで、従来mergeBackupはadded=2を返しました。既存stateのIDだけを検査し、同じimport内で受け入れたIDを登録しなかったためです。受け入れ時にID集合を更新し、重複を除外しました。既存のmanual-only／追加型復元契約は維持します。

## 調査で確認した既存の防御

- 公開web buildはGoogle／外部AI／ローカルモデルのproviderを利用せず、静的Coreとして動作する。
- ユーザー入力やbackupからJavaScript、shell、実行file、任意module URLをロードするUIはない。Reactに文字列として表示する。
- Source Pluginは現在、ビルドに含まれる読み取りサンプル。外部pluginを任意URLからインストールする機構はない。
- Source Pluginのpermission／action種別／risk／batch量を検証する。ただしtrusted JavaScript functionの実行前sandboxではない。
- remote modelはserver設定のendpoint、HTTPS等の構文検証、redirect拒否、timeout、response byte上限、資格情報らしい入力の拒否、connected/sensitive data拒否を持つ。OpenAI互換responseのtool_callsは拒否する。
- local modelの起動はoperator設定のPythonと固定module引数で行う。ブラウザから任意executable／pathを渡すAPIではない。実行環境自体をOS sandbox化する実装ではない。
- local serverはloopback Host／Origin、POST header、OAuth state等を確認する。tokenは暗号化file保存。public multiuser serverへ転用する想定ではない。
- CI action SHA固定、PRのread権限、PR artifactと公開deployの分離を維持する。

上記はコードと既存／追加の試験範囲の説明であり、侵入テストや形式検証に合格したという意味ではありません。

## 今回の修正に含めない、追加設計／高度調査が必要な項目

| 項目                    | 現時点の根拠・未確認                                                                                                                                 | 今回の判断                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 完全backup／復元        | 現行はmanual items中心。Context訂正等の完全な復旧ではない。同じIDの更新を置換しない。UI説明と一致する制約。                                          | schema・privacy・復元衝突の設計が必要。今回重複だけ修正。                                |
| 完全削除・暗号化        | 項目は平文で保持。「一覧から外す」は本文削除ではない。app内の完全削除UIなし。                                                                        | 新たな破壊操作と鍵管理の設計が必要。今回追加しない。                                     |
| 同origin trust          | GitHub Pagesの他projectとoriginを共有する。subpath／SW scopeはstorage隔離ではない。                                                                  | Google私的データの導入前に専用originと移行を設計。現侵害は未確認。                       |
| 実Google OAuth          | NOT_CONFIGURED／MOCK_VERIFIED_ONLY。実token refresh、取消、Workspace admin block未確認。                                                             | 実account・OAuth projectが必要。mockを実接続PASSに置き換えない。                         |
| Calendar／Gmail取得範囲 | Calendar primaryと7日窓・page cap、Gmail初期14日／100件、truncationとcursorの設計。                                                                  | 公開webでは接続なし。backfillと正規同期の変更は別更新で設計。                            |
| DNS／egress             | remote endpointはoperator設定。hostname構文検査はDNS rebindingやprivate IP解決の完全検証ではない。                                                   | browserから任意endpointを設定できるBFFを作る前にegress制御を専門監査。攻撃は実行しない。 |
| Plugin sandbox          | normalize/health/fetchは同じJS realmのtrusted function。型・manifest検査では悪意あるfunctionを隔離できない。health等の全callに強制終了を保証しない。 | 動的pluginを導入しない。Worker／process隔離とbudgetを別設計。                            |
| Model runtime           | hash検査は選んだartifactとの一致であり、Python／package／modelの安全性証明ではない。MLX runtimeをOS隔離していない。                                  | 実モデル再学習・巨大loadなし。独立runtime監査とsupply chain検証が必要。                  |
| 文脈内の秘密情報        | 正規表現はあらゆる秘密・個人情報を検出できない。PUBLICという申告も内容の安全性証明ではない。                                                         | 自動分類に依存してprivate原文をremoteへ送る機能を追加しない。                            |
| ブラウザ／実端末        | ChromiumとPlaywright WebKitで所有権の先行回帰を実施。実Safari、iPhone、Android、強制crash、browser実bfcache／OS休止の全組合せは未検証。              | 合成page lifecycle試験と実bfcacheの証明を区別する。結果がない環境をPASSとしない。        |
| PVR通知／独立侵入試験   | GitHub受付設定と実mail配信・第三者の攻撃耐性は別。                                                                                                   | 不要な試験メール送信や外部security診断を行わない。専門監査候補として保持。               |

## 検証証拠と公開判定

source外のqualification receipt、ログ、browser JSONに実行結果・version・commit・tree・archive checksumを記録します。失敗ログも保持します。変更後の先行試験ではunit 135件、Chromiumの所有権5flow、ローカル保存／破損mirror回復、dependency auditの既知advisory 0、299件のlicense/SBOM整合を確認しました。最終commitのqualificationとは別の先行結果です。

追加のPlaywright Firefoxは「Could not find profile folder」で起動できず、一時的な新規profile指定でも解決しませんでした。アプリのFirefox対応をPASSとは判定しません。Playwright WebKitでは通常のCore smokeの後、offline reloadが「WebKit encountered an internal error」で失敗しました。automation／service worker／実Safariの切り分けが必要なため、通常のgateを弱めず、独立した所有権試験の結果と全web試験を区別して保存します。実Safariの欠点と断定せず、未解決項目として報告します。

必要gate: 保存所有権・旧データ移行・旧writer分離・lock非対応停止・mirror破損回復、backup重複回帰、既存unit/security/remote/local/ollama/OSS/license/dependency/build/E2E/V2 accessibility、固定source archive照合。Mac／Ubuntu、Node22／24は実行済みのreceiptだけを根拠にします。public site未反映のcandidateを正式Release完了とは判定しません。
