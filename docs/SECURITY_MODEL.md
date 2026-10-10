# Security model — V1.9

## V2.1 Chatの追加境界

ChatModelPort / Workerは推論のみ。決定的出力検査、選択Context・TTL・予算・中断、Coreの対象revision再確認・単回承認・durable saveを経て変更します。任意コード・削除・メール送信の実行権限は付与しません。API POSTは署名済みsession・正確なOrigin・request headerを必要とし、server-only endpoint/key、redirect禁止、同時1・30秒・100試行/process・明示送信同意で制限します。固定モデルrevisionは全tensorのSRI証明ではありません。小型モデルの誤回答や全言い換えの誤実行主張の検出を保証しません。[契約](V2_1_BROWSER_CHAT.md) / [追加監査](V2_1_SECURITY_REVIEW.md)。

## Assets, actors, boundary

守る対象はToday items/Context/訂正、Google token、AI credentials、session、model出力の権限、公開ソースの個人情報です。外部web origin、不正なservice応答、悪意あるメール/予定/モデル文、壊れた保存/設定を想定します。OS利用者とoperator設定、同一プロセスのPlugin/Providerコードは信頼境界の内側です。公開インターネット向けサーバーや多ユーザー分離ではありません。

## Threat register

| Threat                          | 判定          | 防御・根拠・残る境界                                                                                                                                    |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XSS                             | MITIGATED     | React文字列escape、未加工HTMLなし、production CSP、URL/action限定。将来の任意HTML機能は再監査                                                           |
| CSRF                            | MITIGATED     | exact Host/POST Origin/x-today-request、SameSite。security/integration tests                                                                            |
| OAuth state攻撃                 | MITIGATED     | CSPRNG state、session/cookie/TTL結合、検証後single-use、512件上限、expiry回収                                                                           |
| PKCE誤用                        | MITIGATED     | S256 verifier/challenge、callbackの保存verifier、固定redirect。架空OAuth tests                                                                          |
| token theft                     | ACCEPTED_RISK | AES-256-GCMと0600。鍵を持つ同一OSユーザー、侵害済み端末は保護対象外                                                                                     |
| session fixation                | MITIGATED     | random32bytes ID、HMAC署名、base64url厳密検証、無効cookie再発行、UTF8byte比較                                                                           |
| open redirect                   | MITIGATED     | server callbackは固定相対redirect。外部OAuth URLは固定Google origin                                                                                     |
| path traversal                  | MITIGATED     | static root検査、manifest file名限定+realpath root検査、browserからpath受入なし                                                                         |
| command injection               | MITIGATED     | spawn引数array、shellなし、operator指定Pythonだけ                                                                                                       |
| prototype pollution             | MITIGATED     | cookie/state map null-prototype、予約key拒否、schema正規化、regression tests                                                                            |
| unsafe deserialization          | MITIGATED     | JSONのみ、サイズ/schema/型検証、evalや任意class生成なし                                                                                                 |
| dependency confusion            | MITIGATED     | npm public package、固定lock integrity/frozen install、全graph台帳                                                                                      |
| supply chain compromise         | ACCEPTED_RISK | 固定lockとAction commit、audit snapshot、review。未知advisory/侵害済みregistryを完全否定できない                                                        |
| malicious model files           | ACCEPTED_RISK | 固定hash/bytes/filename/realpath検査、safetensors。hashは安全性の証明ではない、trusted上流/Python必須                                                   |
| malicious Plugin/Provider       | ACCEPTED_RISK | read-only契約・permission・正規化。same-processコードはsandboxでなく、operatorが信頼する必要                                                            |
| prompt injection                | MITIGATED     | modelはproposalのみ、schema/source/confidence/policy検証、tool実行権限なし                                                                              |
| indirect prompt injection       | MITIGATED     | 接続サービスremote送信拒否、modelに外部操作権限なし。意味の正確性は保証しない                                                                           |
| malicious email/calendar        | MITIGATED     | 正規化・長さ上限・文字列描画、safe action、競合/UNKNOWN保持、Google response4MiB上限                                                                    |
| schema bypass                   | MITIGATED     | sourceId/enum/数値/date/最大長検査。不正AI値は決定的fallback                                                                                            |
| model operation injection       | MITIGATED     | output schemaにoperation実行なし、ユーザー/Context authorityを維持                                                                                      |
| SSRF                            | ACCEPTED_RISK | local URLは127.0.0.1のみ、remoteはoperator HTTPS指定/redirect拒否。operator指定DNSの再解決/IP固定は未実装                                               |
| excessive permissions           | MITIGATED     | Google read-only scope、remote consent二重、Plugin permission、GitHub CI contents:read                                                                  |
| sensitive logging               | MITIGATED     | APIは固定error名、model reasoning返却なし、usageは整数counterだけ、child stdio ignore、body/tokenをログへ出さない                                       |
| secret exposure                 | MITIGATED     | env/token/model/研究除外、tree/history scanner+手動確認、API keyはNode側                                                                                |
| insecure local storage          | ACCEPTED_RISK | itemsは平文ブラウザ保存。OS/profile/extension管理、manual backup。application-level暗号化なし                                                           |
| OAuth replay                    | MITIGATED     | stateは検証成功後consume、期限/同一session結合。wrong-sessionではconsumeしない                                                                          |
| denial of service               | ACCEPTED_RISK | body16KiB等、HTTP応答64KiB/Google4MiB、manifest64KiB、推論1、待機512、ratebucket1024、期限と解放。ローカルOS利用者の大量接続/同期無限loopは完全隔離不可 |
| cache/state corruption          | MITIGATED     | mirror/IndexedDB正規化、migration、壊れたmirror fallback、online shell再取得。両方破損やoffline全cache破損はbackup/reset                                |
| cryptographic nonce             | MITIGATED     | 各書込みrandom96bit IV、GCM tag、serialized atomic rename、tamper/concurrency tests                                                                     |
| file permission TOCTOU          | ACCEPTED_RISK | temp wx0600、rename、newdir0700。書換可能なparent/同じOSユーザーに対する完全なTOCTOU防御なし                                                            |
| unavailable model configuration | MITIGATED     | optional構成を隔離しCore起動継続、manifestサイズ検査、hash欠損/非互換拒否                                                                               |
| hung availability/runtime       | MITIGATED     | availability+inferの同じdeadline、abort/finally、MLX owned child停止、遅延spawn禁止。available API自体の中断/同期CPU隔離は未実装                        |

## Resource and error policy

UI routerは設定されたcall/input/output/concurrency/latency予算で制御し、diagnostics100件・generations finally解放です。無期限のavailable Promiseは採用を止めますが、そのtrusted実装自体の内部workを強制終了するAPIはありません。local verifyは同時操作をdeduplicateし、hashはstreamです。MLXはmax384tokens・同時推論1・12秒、停止はSIGTERM→最大2秒→SIGKILL。初回大きなhash読取にはディスク/CPU負荷があります。

広いcatchはoptional provider拒否、privacy失敗、malformed cookie無視、保存のmirror/DB fallback、SW任意登録を目的にレビューしました。APIは固定エラーで個人データを漏らさず、UIには利用不可や保存失敗を示します。原文をdiagnosticsへ保存しません。全端末侵害・全保存破損・任意悪意コードのsandbox化をPASSの範囲へ含めません。

実credentialのないGoogle/remote/OllamaはNOT_CONFIGUREDで、Mock testの結果から実接続や完全安全性を主張しません。独立第三者による侵入テスト・形式検証・全OS検証は未実施です。
