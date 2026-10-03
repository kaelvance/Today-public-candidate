# Release process

## V2.0.1の公開ブラウザ修正

Ownerが公開ブラウザ不備の修正とV2.0.1公開を指示しました。2.0.0 tag / assetsを変更せず、保護default branchへPRで統合し、新identityでMac22 / 24、Ubuntu22 / 24、source / archiveの全ゲートを再実行します。追加の`Public browser` workflowはPRの静的build / smokeを実行しますが、PR artifactを公開には使いません。default branchのpushで独立build / smokeし、成功したbundleだけをGitHub Pagesへ配布します。deploy jobのみPages / OIDCの権限を持ちます。

実公開URLへ認証・ローカルサーバーなしでアクセスし、Core操作・保存・バックアップ・オフライン・subpath assets・連携APIへの通信がないことを確認します。独立した第三者役の試験も記録し、siteのdeployment.json / commit / hashesを照合してからv2.0.1 tag / Releaseを確定します。公開配布のNOTICEとMITを保持します。詳細は[公開ブラウザ版](PUBLIC_BROWSER.md)。

## V2.0の公開工程

V1.9 rc.10の独立clean rootを保持し、`kaelvance/Today-public-candidate` のPrivate branch / PRでV2を検証後、default branch `public-candidate` へ統合してPublicへ移行しました。ソース本体はMIT Copyright 2026 Kaito Kuon。元のToday private evidence historyやモデル成果物を公開候補へ移しません。専用CoC窓口は[Code of conduct](../CODE_OF_CONDUCT.md)へ掲載済みで、Ownerが作成・受信確認・公開掲載承認を報告しました。ソースのPublic化はOwnerの明示的PUBLIC GOに基づきます。最終tag・Release・配布物の照合まで必須ゲートを維持します。

17工程のqualification、12工程のfresh archive、Mac Node22/24、Ubuntu Node22/24のexact head CI、新規Lighthouse測定をreceiptで対応させます。V2 UI gateを省略しません。

Private stagingではGitHub UIがrulesetを強制しないと表示していました。準備済みルールと強制済みを区別し、公開時に実効状態を確認します。PVRはPrivate側の実受付としてPASSにしません。

## V1.9からの既存工程

1. 権利、依存、NOTICE、model/data除外、秘密/PII、architecture invariantを確認します。
2. [TESTING](TESTING.md)の全ゲートとclean clone、zero-key、AI disabled、no-model、offline/reconnectを実行します。
3. 固定commitのsource archiveを新規directoryへ展開し、内容・install/build/test/start・checksumを検証します。sourceにGit/node_modules/dist/weights/adapters/training/private dataを入れません。研究成果は別配布審査です。
4. Release qualification reportの`OSS_RELEASE_READY`を確定します。NOならpublishを実行しません。
5. V2公開前にユーザーが公開先を指定し、repository owner/default branch/license detection、Private vulnerability reporting、保護branch、CIの実行と成功を確認します。ローカルCI相当のPASSだけをGitHub成功として表示しません。
6. tested treeと公開treeの差分を確認し、version/tag/source archive/SHA-256を対応させます。公開はユーザー指示の対象です。

作業先は上記の独立repositoryです。通常のbranch / commit / push / PR / CIはOwner承認済みのV2作業範囲です。Public visibility / 正式tag / release / announcementは最終の公開承認と条件確認後に実施します。V1.9 RCは候補版で、V2.0は公開版のmajor versionです。互換性を壊す安定契約変更はmajor、互換追加はminor、修正はpatch。Experimental契約/modelは安定APIに含まれず変更を明示します。

このsourceに保存する報告はartifact checksumを自己参照しません。checksum・archiveの最終検証結果は隣接したrelease receiptとして発行します。報告と同じsource commitをarchiveに入れ、zip以外のmetadataも確認します。

## rc.2と実GitHubの最終判定

初期rc.1のcommit/ZIPはそのまま保持します。CI・packaging・READMEを修正したrc.2は別commit/ZIP/SHA-256で検証します。CIはUbuntu24.04、Node22/24、pnpm11.19.0で実行し、artifactにはrun ID/attemptを含め、失敗ログも30日保存します。重要な証跡は期限前にローカルへ保管します。最初のinstall/browser downloadで失敗した場合はGitHubのjobログを保管します。実GitHubのrunがない間はOSS_RELEASE_READY=NOです。

新しいソースと全blob一致するZIPをsource外で作成・再検証するには `pnpm release:qualify -- <evidence directory>` を使います。ソースにchecksumを自己参照で埋め込みません。zipとrelease-receipt.json、source-inventory.json、qualification.jsonを対応させます。

Private vulnerability reportingはGitHubのpublic repository向けです。private stagingで有効と推測しません。公開前に実際に動く報告経路を確立し、SECURITY.mdを正確にします。別の専用連絡窓口を使う場合は管理者の公開承認を得ます。本人の最終GOがあるまでvisibility変更/final Release/package publication/announcementを行いません。

### PR・artifact・cacheの信頼境界

PRで生成したログ・ZIP・receiptは不信頼のデバッグ資料です。署名・publish・deployment・privileged workflowへ入力しません。Release qualification workflowにはrelease/deploy/download-artifact/workflow_run/pull_request_targetがありません。pushのartifactでも、それだけで公開許可やprovenance署名とは扱いません。固定commitと全blob一致・全ゲート・管理者reviewを確認してから公開を判断します。30日artifact保持は長期保管ではありません。

環境変数をPATH/HOME/CI/TMPDIR/PNPM_HOMEへ制限するのは設定混入防止で、OS sandboxではありません。HOMEはpnpm cacheやテストbrowserの取得場所のために残します。cacheに秘密は保存せず、cacheの有無に依存しないfrozen installを行います。GitHubのpull_request cacheはmerge refの範囲で、base branchへ復元できないという[公式の範囲制限](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)も確認します。今回のcontents:read/pull_requestにprivileged follow-upはありません。将来のrelease自動化では独立した信頼境界の再審査が必要です。

ZIP照合はコンテナの決定的再生成を主張せず、展開後の全tracked blob byte・inventory・executable bitを比較します。symlink/submodule/Git LFSはこの配布方針では拒否します。full history取得はrelease-scanの全履歴検査のためです。単にZIPを作るためではありません。

rc.6のqualification/packagingのNode test childにはUTC再現性のため固定TZ=UTCを追加します。PATH/HOME/CI/TMPDIR/PNPM_HOMEとこの固定TZ以外の環境設定を継承しません。単体のstranger/cold serverは通常起動のenv境界を維持します。

rc.5は実GitHub Actionsのlicense gateで保存されたERR_PNPM_MISSING_PACKAGE_INDEX_FILEを受け、pnpm/action-setupの非秘密PNPM_HOMEをqualification/archive子へ引き継ぎます。pnpmはPNPM_HOMEからstoreを選択するため、install/licenseで同じstoreが必要です。[pnpm公式store設定](https://github.com/pnpm/pnpm.io/blob/main/versioned_docs/version-10.x/settings.md#storedir)を参照。API token、Google/AI設定、その他の環境変数は継承しません。

rc.6ではstranger/coldのpnpm起動にも非秘密PNPM_HOMEを保持します。rc.5の実Ubuntu CIでlicenseと通常E2Eは成功した一方、strangerのpnpm startがstore不一致を検出して自動installを試み、ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTYで終了したためです。storeの一致で意図しない再installを防ぎ、READMEのpnpm start自体を検証します。CIフラグやAI/Google/API設定をserverへ追加継承しません。

## Public移行時の必須確認

1. 固定した正式版候補のreport/receiptと残る項目を所有者が確認する。公開前の技術qualificationを満たしてからPUBLIC GOを判断する。公開後にしか実証できないgateが残る間はTODAY_V2_RELEASE_READY=NOを維持し、正式tag/Releaseを発行しない。
2. default branch（現在はpublic-candidate）への統合とPublicへの変更は、対象commitと操作を明示し、OwnerのPUBLIC GOと委任範囲を確認して実施する。
3. Publicへの変更が許可された時点で、Private vulnerability reportingを有効化し、Security/Advisoriesの受付画面と通知経路を実確認する。Privateの通常Issueは将来利用者の非公開報告窓口ではない。
4. default branchのPR必須・実check `Zero-key / Node 22` / `Zero-key / Node 24`・force push/削除制限を実設定し、enforced状態を確認する。sole maintainerの自己承認が不可能なreview要件は設定せず、owner判断とchecksを記録する。
5. default branchのREADME/MIT検出/文書/template、未認証のpublic clone→install/build/runを確認する。統合/version変更後のcommitに対応するCI/archiveを再確認する。
6. 脆弱性受付・保護設定・public cloneが未確認ならV2 Release/tagを発行しない。今回のPrivate RC検証でこれらをPASSとしない。

Actions内部Node20廃止警告は実rc.6で確認され、GitHub側はActionをNode24へ移行して実行しています。matrixのNode22/24とは別です。固定SHA更新は将来の供給元と互換性の再確認で行い、今回「新しいから」という理由で依存を変えません。
