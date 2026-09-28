# RC final qualification status

対象は1.9.0-rc.10です。初期rc.1のcommitとZIPは別に保持しています。Coreの機能・UI・Context Engine・Provider・Plugin・Gammaは変更していません。

この版はCIでNode22/24、Ubuntu24.04、163 automated tests、通常48 E2E、別枠のstranger6 flows、3回上限cold probe、exact commit ZIPの全blob一致と新規展開先での再検証を実行する手順を持ちます。workflowを用意しただけでは実GitHub ActionsのPASSではありません。実行環境と結果、SHA-256、commitはソースに自己参照で埋め込まず、GitHub Actionsのqualification.json/release-receipt.json artifactと外部のqualification reportで確定します。

2026-09-28に [kaelvance/Today](https://github.com/kaelvance/Today) とowner権限を実確認し、ユーザー承認でPrivateへ変更しました。RCの作業入口は [Draft PR #1](https://github.com/kaelvance/Today/pull/1)、未完了項目は [RCからV2のgate issue #2](https://github.com/kaelvance/Today/issues/2) で管理します。初期main commitを保存したRC branch上で調整しています。rc.4以前のログイン/アクセス未完了は履歴であり、現在の状態ではありません。

## 未完了の公開ゲート

- Private RC repositoryは実確認済み。公開前のlicense detectionとdocument/template rendering、公開時の設定を確認。
- rc.6の実CIは両Nodeで成功した履歴。現候補は冒頭の版を別commit/ZIPとして全ゲート再検証し、run/receiptで確定する。
- private vulnerability reporting等の実際に利用できる非公開報告経路。
- branch protection/rulesetの適用可否を確認し、実設定または運用規約を確定。
- 上記の結果を反映した最終GO/NO-GO判定。

GitHubのPrivate vulnerability reportingはpublic repository向けの機能です。[GitHub公式資料](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository) を参照してください。非公開ステージングのためにPublicへ変更することはありません。必要であれば、別途承認された専用の非公開報告窓口を設けてから公開を判断します。非承認の個人連絡先を掲載しません。

現在の外部ゲートが未完了の間は `OSS_RELEASE_READY = NO` です。全ゲート成功後もユーザーの最終公開許可が必要です。model weights/Adapter/training dataの公開を含む許可ではありません。

## rc.2からの修正

rc.2のpackagingはtracked audit JSONの生成でclean-tree assertionに失敗しました。rc.3ではauditをsource外へ出し、コミット済みtreeを無変更で検証します。rc.2のcommitと原失敗ログは維持します。初期rc.1のJSON証跡は履歴snapshotで、現版の実行結果は外部receipt/qualification reportを参照します。

## rc.3からの修正

UTCの再現試験でunit125 PASS/5 FAIL、scenario時刻assertionがtimeout。日付の製品仕様（local calendar）とfixtureのJST前提を分離し、rc.4で厳密な期待値を保ったままUTC回帰1 flowを追加。最終テストはNode UTC、browser JST/UTCの指定を証跡へ記録します。

## rc.5 実GitHub環境

kaelvance/Todayをユーザー承認でPrivateへ変更。rc.4のGitHub source treeはローカル候補と同一。初回実Ubuntu Node 22/24 CIはlicense gateで失敗し、原ログを保持。pnpm/action-setupが設定するPNPM_HOMEを削除してstoreの解決場所が変わったため、rc.5でその非秘密pathのみ追加継承する。実CI再検証が成功するまでOSS_RELEASE_READY=NO。Privateのbranch protectionは現プランで強制不可。Private vulnerability reportingは公開前に別途実経路の確立が必要。

## rc.6 実Ubuntu stranger起動

rc.5の実CIではlicense/通常E2Eが成功。archive strangerのpnpm startのenvでもPNPM_HOMEを保持する必要が判明し、cold起動とともにrc.6で修正。Core production sourceと期待値の変更なし。再検証が成功するまでOSS_RELEASE_READY=NO。

## rc.7 Final RC文書監査

READMEの未確定取得先、SECURITYのrc.4対象表記、RELEASEの未指定公開先を現在のPrivate branchへ訂正。公開clone/main/非公開脆弱性受付/強制保護が未確認であることを明記。metadata/SBOMのToday root版のみ更新し、lock/dependency graphとsrc/server/publicはrc.6から無変更。全再検証が成功しても、公開前gate未完了ならOSS_RELEASE_READY=NO。最終判定とchecksumはsource外report/receiptへ記録する。

## rc.8 GitHub README表示

rc.7の全macOS/実Ubuntu Node22/24検証は成功した履歴を保持。実GitHub Markdown表示で開発用loopback URLに後続の日本語が混入したため、READMEの当該URLを明示リンクへ修正。相対ファイル存在検査だけではautolinkの正しさを確認できない。metadataの版を更新し、同じ全ゲートとGitHub表示を再確認する。製品コード・依存・workflow・テストは変更しない。

## rc.9 日付境界のscenario再現性

rc.8のMac全検証は成功したが、実Ubuntu Node22/24はJSTの9月29日以降にscenarioで失敗した原ログを保持。固定9/30予定の表示は実時計により「明日」へ変わり、固定文字列9/30のassertionと矛盾していた。同じsource/fixtureでブラウザDateだけを9/25と9/29へ変更し、9/30と明日の表示を独立確認。JST/UTC両pageのDateを既存scenario基準日時へ固定し、timerは通常進行、09:30と01:00の厳密な期待値・pageerror検査・テスト件数を維持する。製品コード・依存・workflowは変更せず全再検証する。

## rc.10 scenario時計の複数fixture整合

rc.9は9/30の相対表示を固定したが、9/25の既存曖昧課題fixtureも今日になり、あとで見るtabの期待と矛盾した。Mac/実Ubuntu両Nodeの原失敗を保存。UI時計の固定基準を、過去9/25と未来9/30の両fixtureを満たす9/28へ変更し、Context内部の9/25時計は変更しない。全7 scenario flowsとUTC時刻、厳密assertion、件数、pageerrorを維持。製品変更なし。
