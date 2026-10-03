# Today V2 security and privacy report

## 対象と判定方法

個人端末上のloopbackアプリ、optional provider、ソース配布、clean Git historyを対象とします。Node security / remote integration / model tests、OSS scan、manual code review、dependency auditを実行し、結果は固定commitのqualification receiptに記録します。`PASS_WITH_SCOPE`はこのスコープの検証を通過した意味で、監査認証や無欠陥の保証ではありません。

## V2の変更

新UIはReactのtext escapingを利用し、外部画像・font・SDKを追加しない。DaylightのSVGは自作の固定pathだけで、入力文字列をSVG / HTMLへ挿入しない。自然文は既存確認dialogを通って手動項目へ変換する。画面遷移をremote permissionや操作同意として利用しない。既存のrisk / confirmation / provider consent / source privacyを維持する。axeはdev dependencyで、production JSへimportしない。

## 継承する境界

- 127.0.0.1へのbind、Host / Origin照合、CSP、resource limit、timeout。
- 任意Remote endpointは管理者指定HTTPS、TLS検証、redirect拒否。DNS解決IPの固定はなく、その制約は既存Threat modelに記載。
- provider由来データのRemote Model送信はサーバー境界で拒否。AIアシストと処理方法は別設定。
- OAuth tokenは既存の暗号化store。秘密情報はブラウザレビューや文書へ転送しない。
- trusted Pluginは同一プロセスであり、OS sandboxではない。
- 保存・backupは平文。同一OSユーザー、共有端末、拡張機能、ディスク・backup流出の防御は対象外。

## 配布・履歴

ソースarchiveはnode_modules / dist / .git / .env.local / runtime telemetry / weights / adapters / training dataを含まない。全tracked byte / modeをGit commitと照合し、LFS・symlink・submoduleを拒否する。モデルカードや架空回帰fixtureはソースに含むが、実学習datasetとは別。

元のToday private historyには個人メールmetadataがあるため移植せず、独立したclean rootからV2へ進める。author / committerはKaito KuonとOwnerのGitHub noreplyを使用。履歴scanは既知credential patterns・個人home pathを調べる限定的な検査で、任意の文章内PIIを完全に検出するものではない。vendor notice中のupstream著作権表示をOwnerの個人データとして削除しない。

## 外部AI review

ChatGPT、DeepSeek（DeepThink有効）、Sakanaを技術レビューに使用。非機密の設計概要と短い概念コードを送付し、credentials・Gmail / Calendar本文・private dataset・個人ログは送付しない。レビューは助言で、Owner承認や実テスト成功の代替ではない。Sakanaの規約同意はOwnerの明示回答を受けて送信。

CoCや脆弱性の詳細を公開Issueへ送る提案、既存保存キーを新規schemaへ置換する提案、証拠なしのhistory削除、focus outline削除は採用しない。既存source / testと照合して修正を採否判断する。

## 未完了条件

CoC専用非公開窓口は[Code of conduct](CODE_OF_CONDUCT.md)へ掲載済み。Ownerの作成・受信確認・掲載承認に基づきます。PVRはPrivateではPublic時の受付確認を代替できない。実Google認証、実Remote account、全モデル実推論、全支援技術を今回のmock検証から保証しない。ソースのPublic化はOwnerの明示的PUBLIC GOで承認されました。重みの配布は今回のソース公開に含めません。PVRの有効化・公開受付・管理者通知設定と、未検証の外部reporter実送信/通知配達を区別します。
