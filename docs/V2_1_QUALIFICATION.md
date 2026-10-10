# V2.1.0-alpha.1 Qualification / Release残課題

> 以下のAlpha実績は当時の履歴です。追加したオンデバイス / API経路と現在の仕様は[ブラウザChat仕様](V2_1_BROWSER_CHAT.md)を参照。AlphaのPASSを新candidateへ無条件に継承しません。

2026-10-10。ローカル開発候補。[実装](V2_1_IMPLEMENTATION.md)、[モデル評価](V2_1_MODEL_EVALUATION.md)、[セキュリティ](V2_1_SECURITY_REVIEW.md)。

`V2_1_ALPHA_IMPLEMENTED = YES`（Chat＋承認付きlocal操作＋Mock Messagingのvertical slice）。
`V2_1_MODEL_ADOPTED = NO` / `IMESSAGE_SUPPORTED = NO` / `V2_1_RELEASE_READY = NO`。

製品sourceは独立V2.1開発コピー。基準はV2.0.3だが、過去のqualificationを流用しない。最終commit/tree/source archive hashはsource外のdelivery receiptに記録する。本文が自身のarchive hashを含む循環参照は作らない。

## 実行した試験

最終件数とexit codeの機械証跡を `work/v2.1.0/evidence/` に保存。元の失敗ログも保持する。Nodeのlisten EPERM（実行sandbox制約）、fetchが上書きHostを送らず試験が誤った件、待機画面selector不一致、static deployment.jsonなしでrecoveryを呼んだ件は、元ログから原因を調べ、適切なruntime/selector/HTTP手段/build順で再試験した。gateを削除していない。

| 試験                                 | 確認範囲                                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lint / TypeScript / production build | 新しい製品sourceに実行                                                                                                                                              |
| Mac Node22/24 unit                   | 両Nodeで185/185（新Chat/approval/messaging43件＋既存142件）                                                                                                         |
| Mac Node22/24 server                 | 両Nodeで41/41。Chat HTTP host/origin、digest・role・size・cancel/rate、Telegram fixture、既存MLX/remote/Ollama/security回帰                                         |
| 既存6 E2E                            | Core、Provider integration、scenario、Gmail、Intelligence、release UI。すべて架空API/データ                                                                         |
| V2 UI E2E                            | 4画面・IME・保存・modal・320/390/820/1440・theme/resize・axe                                                                                                        |
| Chat E2E                             | 許可必須、承認前変更0、create/update→保存/reload、却下、Mock送信、履歴非保存、2tab writer、両保存先失敗の中止、3幅＋dark axe（Chromium/WebKit各4scan、violations0） |
| static web / recovery / update       | local subpath build、offline shell、15 fault probes、5 worker generation flows、単一writer/旧version移行                                                            |
| 実Qwen                               | 11課題、JSON structure11/11・品質6/11、browser2呼出し、Mock ingress→実推論→Mock egress。品質不合格を保持                                                            |
| OSS/privacy/license/SBOM             | source pattern scan、OSS fixture tests、application SBOM version/lock coverage、npm公開監査API                                                                      |
| 保護対象比較                         | 原V2.0.3＋V3文書、TacCityPark公式サイトの開始前hashを再照合                                                                                                         |

npm監査ではinfo/low/moderate/high/criticalすべて0（照会時点）。これはパッケージadvisoryについての結果。アプリの未知脆弱性や実サービス運用の安全性を保証しない。

## CIの変更と未実行

新 `v2_1-chat.yml` はUbuntu22/24のMock安全suite＋ブラウザE2Eを定義。既存qualificationへChat server/E2E gateを追加し、Firefox/WebKit workflowにもChatを追加した。新model自動download・paid API・secretは要求しない。

今回GitHub push/Actions実行なし。新identityのUbuntu22/24 CIは**未実行**。新workflowの定義をPASS済みCIとして記載しない。local Chromium/WebKitのChat E2Eは各9flows PASS。Mac Firefoxはcached Nightlyが「Could not find profile folder」で起動できず、正規化tmpで再試行しても同じエラー。機能PASSへ数えず、environment blockerとしてログを保存した。実Safari/iPhone/Android/screen readerは未検証。

## 正式公開までの残課題

1. ローカルChatモデル品質gate。Qwenは5課題失敗、他モデル比較なし、標準採用不可。
2. 実Messagingは未接続。公式APIはfixture契約だけ。実接続/外部sendは別承認、secure pairingと無料上限・off switchを実証する必要。
3. permanent GatewayWorkspace/durable ledger/inbox/outbox/再起動・配送不明処理。ブラウザ終了時のToday読取り・操作・自動返信は未対応。
4. iMessage安全basic Bridgeの実用性/OS/規約。SIP維持で成立しなければ未対応のまま。V2.1 releaseを無理に進めない。
5. 新source identityにMac/Ubuntu22/24、Firefox/WebKit/実機、source/archive正式qualification、CI required check整合性、第三者review、license/privacy/SBOMの最終照合。
6. AI操作のcrash/再起動/保存不明、長時間/低RAM/OS lifecycle、manual assistive technology。現在memory-only receiptの保証を超える説明をしない。
7. Release範囲をlocal Chat＋Web確認操作＋Mock Previewまでにするか、実Messagingを含めるか明確化。未実装を宣伝しない。公開は本指示の範囲外。

今後の順序は `alpha.2`（モデル品質・Chat usability/semantic validation）→ `beta`（durable操作/必要なら公式チャネル別承認）→ `rc`（全新identity qualification）を候補とする。model/iMessageの条件未達ならHOLDまたは対応範囲を縮小し、勝手に正式Releaseしない。

## 終了時の提供

ローカルsource、設計資料、証跡索引、identity付きsource ZIPを提供する。GitHub push/tag/Release/deployをしない。既存V2.0.3公開リンクは新Alphaの配信先ではない。公式サイトは変更しない。
