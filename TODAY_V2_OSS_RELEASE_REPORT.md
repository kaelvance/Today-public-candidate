# Today V2 OSS release report

## 状態

`TODAY_V2_RELEASE_READY = NO`

これはPrivateでの公開準備であり、正式Public releaseではありません。実行後の固定commit / tree / CI / archive / SHA-256 / 全ゲート判定はソース外receiptへ記録します。本書の予定を実施済みとして解釈しないでください。

## 公開候補

元の`kaelvance/Today`のprivate evidence historyは公開しない。独立root `9229313647722c2ccadeacb9025a6d824113e39b`から`kaelvance/Today-public-candidate`のPrivate候補へV2を配送する。GitHub Desktopの既存ログインを利用し、別の既存GitHub connectorでcommit / tree / noreplyを照合する。Device Flowは停止し、新しいPAT貼付やcredential抽出を行わない。

V1.9 rc.10のclean配送とCIはV2の合格証拠ではない。V2 source → V2 commit / tree → Private branch → 実Ubuntu CI → exact source archiveの対応を新しく作る。最終archiveは固定commitから生成し、self-referenceを避けてhashをソース外へ保持する。

## 権利とライセンス

Today source、自作SVG icons・CSS、架空回帰fixtureはMIT、Copyright 2026 Kaito Kuon。Ownerが承認した権利・名義を変更しない。依存はそれぞれのupstreamライセンスで、lockfile全component、integrity、SPDX表現、noticeをSBOM / inventoryへ収録する。

V2で追加したaxe-core4.13.0はMPL-2.0の検証用依存で、未改変のupstream取得とnoticeを保持する。MITソースのライセンス表示で依存のMPLを上書きしない。production bundleにはaxeをimportしない。モデル・Adapter・学習dataの再配布権利は、このMITソース候補の資格判定に含めない。

## GitHub工程

Private branch / PR / exact head CI、README / LICENSE / SECURITY / CONTRIBUTING / CoC / templates、pinned read-only Actions、SBOM、source archiveとhashを準備する。強制branch rulesetの適用可否は実画面で確認し、plan依存で強制不可の場合は未強制と明記した運用手順を残す。設定が存在することと実際に強制されることを混同しない。

PVRはpublic repository用のため、Private検証ではPublic側の実受付をPASSにしない。未開設のprivate窓口を捏造しない。公開後の匿名cloneも公開前に合格とは言わない。

## Ownerが完了する必要のある条件

1. 自身が管理する専用CoC窓口を作成し、受信確認と公開文書への掲載を承認する。現在は未作成。
2. その窓口を反映した最終候補の全qualificationを再実行する。
3. GitHub PVRの公開時有効化・実受付確認と、公開後の匿名clone検証を完了する。必要な適用順序は運用手順で管理する。
4. 最終Public化を明示承認し、最後の公開操作を行う。

CoCの未作成をAIやChatGPTの回答で解消したことにしない。Public化、アカウント・plan変更、モデルの公開を本V2 source作業から推論しない。
