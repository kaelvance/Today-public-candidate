# Today V2 OSS release report

## 状態

本書は公開手順と判定条件を定義します。`TODAY_V2_RELEASE_READY` の最終値は、固定identityの全ゲートを実証したGitHub Releaseのソース外report/receiptで確認します。

Ownerの明示的PUBLIC GOに基づき、独立repositoryをPublicへ移行しました。ソース公開だけでは正式Release完了と判定しません。実行後の固定commit / tree / CI / archive / SHA-256 / 全ゲート判定はソース外receiptへ記録します。本書の予定を実施済みとして解釈しないでください。

## 公開候補

元の`kaelvance/Today`のprivate evidence historyは公開しない。独立root `9229313647722c2ccadeacb9025a6d824113e39b`から`kaelvance/Today-public-candidate`のPrivate候補へV2を配送し、Privateでの統合・再qualification後にPublicへ移行しました。GitHub Desktopの既存ログインを利用し、別の既存GitHub connectorでcommit / tree / noreplyを照合する。Device Flowは停止し、新しいPAT貼付やcredential抽出を行わない。

V1.9 rc.10のclean配送とCIはV2の合格証拠ではない。V2 source → V2 commit / tree → Private branch → 実Ubuntu CI → exact source archiveの対応を新しく作る。最終archiveは固定commitから生成し、self-referenceを避けてhashをソース外へ保持する。

## 権利とライセンス

Today source、自作SVG icons・CSS、架空回帰fixtureはMIT、Copyright 2026 Kaito Kuon。Ownerが承認した権利・名義を変更しない。依存はそれぞれのupstreamライセンスで、lockfile全component、integrity、SPDX表現、noticeをSBOM / inventoryへ収録する。

V2で追加したaxe-core4.13.0はMPL-2.0の検証用依存で、未改変のupstream取得とnoticeを保持する。MITソースのライセンス表示で依存のMPLを上書きしない。production bundleにはaxeをimportしない。モデル・Adapter・学習dataの再配布権利は、このMITソース候補の資格判定に含めない。

## GitHub工程

Private branch / PR / exact head CI、README / LICENSE / SECURITY / CONTRIBUTING / CoC / templates、pinned read-only Actions、SBOM、source archiveとhashを準備する。強制branch rulesetの適用可否は実画面で確認し、plan依存で強制不可の場合は未強制と明記した運用手順を残す。設定が存在することと実際に強制されることを混同しない。

PVRはpublic repository用のため、Private検証ではPublic側の実受付をPASSにしない。未開設のprivate窓口を捏造しない。公開後の匿名cloneも公開前に合格とは言わない。

## 正式公開に必要な条件

1. CoC窓口は[Code of conduct](CODE_OF_CONDUCT.md)へ掲載済み。Ownerが作成・受信確認・掲載承認を報告しました。
2. その窓口と2.0.0のversion / SBOM / 公開文書を反映した新identityへ、Mac Node22/24・実Ubuntu Node22/24でsource/archiveの全qualificationを実行する。
3. GitHub PVRの公開時有効化・実受付確認と、公開後の匿名clone検証を完了する。必要な適用順序は運用手順で管理する。
4. Ownerの明示的PUBLIC GO後、Release EngineerがPublic化・保護設定/PVR実証・匿名clone/fresh smoke・CI/linksを確認する。merge後の実commit/treeを再検証し、artifact再生成・照合後にv2.0.0 tagとGitHub Releaseを作成する。全必須ゲート完了まではRelease ReadyをNOとする。

CoC窓口はOwnerの報告に基づき、AIやChatGPTの助言を受信確認・掲載承認の代替にしない。Public化、アカウント・plan変更、モデルの公開を本V2 source作業から推論しない。
