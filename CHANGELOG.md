# Changelog

## 2.0.0-rc.2 — 2026-09-30

- rc.1のfresh archive cold startが実日付で固定予定を過去として扱い、見出し待機に失敗。既存scenario suiteと同じ9/28のUI時計を固定し、3試行とpageerror assertionを維持。元のfailure / ZIP / receiptは保持。

## 2.0.0-rc.1 — 2026-09-30

- 和紙・墨・自然光のV2画面、4画面navigation、クイック入力、完了復元、future calendarを追加。保存schemaとProvider境界を維持。
- 4件のcalendar unit、20フローのV2 UI / axe / responsive / text resize検証を追加し、qualificationとarchiveにも組み込む。
- Gmail fixture clockとstranger selectorを明示し、元のassertionを維持。V2文書8件、SBOM、MPL-2.0のaxe noticeを追加。
- Private候補。CoC窓口未作成、Public操作未承認。詳しくは[TODAY_V2_CHANGELOG](TODAY_V2_CHANGELOG.md)。

## 1.9.0-rc.10 — 2026-09-29

- scenario UI時計を9/28に固定し、既存の9/25過去課題と9/30未来予定の両fixtureを満たす。rc.9のあとで見る待機失敗を保存。Context時計・製品・assertion・件数は変更しない。

## 1.9.0-rc.9 — 2026-09-29

- 固定scenario日付に対するbrowser DateをJST/UTC両方で固定。JST日付境界で相対表示が変わる実CI失敗を訂正し、時刻・日付の期待値とpageerror検査を維持。製品コード・依存・workflow変更なし。

## 1.9.0-rc.8 — 2026-09-28

GitHubのREADME実表示で開発用URLへ後続日本語が混入するautolink不具合を確認。明示Markdownリンクへ修正し、metadata/対象版を更新。rc.7の成功CI/archive証跡を保持。製品コード・lock・workflow・テスト期待値は無変更で全再検証。

## 1.9.0-rc.7 — 2026-09-28

Final RCの文書監査で取得先・現在の対象版・公開手順の古い記載を訂正。Private RCと公開default branch/cloneの違い、脆弱性受付の未設定、公開時の強制保護の確認を明記。metadataとSBOM root版を更新。製品コード・lock・依存・テスト期待値は変更せず同じ全ゲートで再検証。

## 1.9.0-rc.6 — 2026-09-28

- rc.5の実Ubuntu CIでlicense/48 E2Eが成功後、archive stranger startupでpnpm startのstore解決が再度分離。stranger/coldの起動envにも非秘密PNPM_HOMEを保持し、README起動のstoreをfrozen installと一致させる。assertionsとモデル・Google/AI設定の非継承は維持する。失敗artifactは保存。

## 1.9.0-rc.5 — 2026-09-28

- 実Ubuntu Actionsでpnpm licensesがstore indexを見失う失敗を修正。qualification/archive子プロセスに非秘密のPNPM_HOMEのみを追加継承し、pnpm/action-setupのstoreと一致させる。Core production codeと学習済みモデルは変更しない。
- Private GitHub RC branch/Draft PRとAction許可リストを導入。Privateのbranch protectionは現プランで強制不可のため、PR/CI確認を運用上の必須条件として明記する。

## 1.9.0-rc.4 — 2026-09-28

rc.3はMacのJSTではNode22/24全ゲート成功。ただしUTCでunit5件とscenarioのJST固定表示assertionが失敗しました。local calendar入力のテスト日時をlocal date constructorへ修正し、既存scenarioはJSTを明示、別contextでUTC表示01:00/手動訂正09:30を確認する回帰flowを追加。qualification/archiveのNode child TZをUTCへ固定し、通常47→48 E2E（追加UTC1、既存47維持）。Core/Context Engine/modelの製品コード変更なし。元failure logsとrc.3のcommit/ZIPを保持します。

## 1.9.0-rc.3 — 2026-09-28

rc.2のqualificationで全163tests/47E2Eは成功しましたが、code-auditがtracked JSONを更新しpackagingのclean-tree検査が停止しました。監査結果をsource外へ保存するCLI optionを追加し、qualificationではそれを指定します。失敗commitとログは維持。clean-tree assertionを弱めず新RCで再検証します。Core/model/UI変更なし。

## 1.9.0-rc.2 — 2026-09-28

rc.1のcommitとarchiveを保持し、RC最終検証向けのCI・packaging・documentationを修正。Core/UI/Provider/Plugin/model構造は変更していません。

- READMEのPC「追加する」とmobile「追加」を区別。
- Node22/24・Ubuntu24.04のCI matrix、checkoutのcredential非保持、固定SHAのartifact保存を追加。
- exact commitのZIP作成・全blob比較・新規展開先でinstall/build/163tests/47E2E/startを検証。
- 独立profileの初回利用・ブラウザ/サーバー再起動と、3回上限のcold起動を追加。cold例外の再発は停止しstack/optimizer/module URL/React graph/HMRログを保存。
- root版とSBOM metadata/graphの整合性チェックを追加。
- 実GitHub実行は別ゲート。workflowを用意しただけで成功と表示しません。

## 1.9.0-rc.1 — 2026-09-28

V1.8の機能を凍結した公開前の候補版です。

- Unicode署名比較・不正なrequest URL・OAuth stateの寿命と容量を修正。
- 任意モデル設定の破損をCore起動から分離。manifest読取とHTTP応答に上限を追加。
- Providerのavailabilityを含む期限・キャンセル、世代情報の解放、MLX起動/停止競合を修正。
- 不正なPlugin actionのrisk値、保存データのprototype key、数値の暗黙変換を拒否。
- Service Workerの更新キャッシュと他アプリのキャッシュ保護を修正。
- モデル重み・Adapter・研究データをソース配布から分離。GammaはExperimentalを維持。
- cold development起動のReact identityとprebundle entryを明示して再現性を改善。
- MIT、依存台帳・SBOM・NOTICE、CI、setupと公開手順を整備。

## 1.8 — 先行ローカル版

Feature Completeの基準版。Gammaのsealed評価はFalse Merge 0/40、Context Recall 40/40、Fact 12/32、Temporal 9/32。品質ゲートを満たさず、標準モデルへ昇格していません。旧研究成果はこの配布に含まれません。
