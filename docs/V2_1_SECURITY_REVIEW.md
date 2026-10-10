# V2.1 Alpha セキュリティ監査記録

> 以下のAlpha実績は当時の履歴です。追加したオンデバイス / API経路と現在の仕様は[ブラウザChat仕様](V2_1_BROWSER_CHAT.md)を参照。AlphaのPASSを新candidateへ無条件に継承しません。

2026-10-10。実装diff、境界試験、既存保存/Provider回帰、実ブラウザE2E、公開依存監査を対象にした有限の内部レビュー。独立侵入試験・無脆弱性保証ではない。

## 実装した保護

| 脅威                                   | 実装と実行した試験                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| modelの直接実行・DB/credentialアクセス | ChatModelPort出力のみ、固定操作allowlist、unknown fields/tool calls拒否、OAuth token非提供                  |
| prompt injection / 偽system            | server生成system、client system/tool role拒否、文字列描画。モデルの拒否応答だけを安全境界としない           |
| SSRF / cloud漏洩                       | numeric loopback HTTP rootのみ、redirect error、任意endpoint/modelは入力不可、digest照合、pull/fallbackなし |
| 無断情報送信                           | 選択manual項目＋明示許可、履歴memory-only、外部AIなし、実Messagingなし                                      |
| stale/overbroad command                | 1 field update、全item内容再確認、期限、single-use receipt、source/schema再検査、同名複数/無変更拒否        |
| 保存失敗 / writer競合                  | 既存Web Locks、保存awaitとcommit gate。ブラウザで2つ目tabの操作不可・両保存先失敗時の中止を実測             |
| forged sender / echo / replay          | Mock trusted binding、credential/thread/sender一致、fromSelf/hops/TTL、rate/dedup、revocation中止           |
| 誤送信 / 不明ACK                       | immutable internal recipient、manual approval、UNKNOWNでretry禁止、FAILEDだけ有限manual retry               |
| resource exhaustion                    | 本文/履歴/Context/output bounds、timeout、同時1、cache上限、keep_alive0、cloud disabled                     |
| WebCSRF / DNS rebinding                | 既存Host、同origin、x-today-request、signed cookie境界をChat APIにも適用し、HTTP negative testを実行        |

## 実モデルから得た具体的な改修

初回Qwenに完了を求めた際、statusだけでなくdeadlineにもなるatを提案した。updateを1項目だけへ狭めた。別試験で実際の状態変更と説明が一致しないno-op title提案が出たためApplicationが無変更を拒否する。時刻は9時間誤る例が残り、承認画面に実際の現地日時を表示するが、モデル品質gateは未達のままとする。

同名2件へのモデル側選択を認可しない。選択範囲を絞り直す必要がある。自由文の正しさ・完全な個人情報検出は保証しない。外部auto返信には自由生成文を使用しない。

## 未解決・正式公開前gate

1. モデルの意味的正しさ、日本語多turn、日時、出典、正しいcommandを満たす固定評価・比較。現候補を採用したとは記さない。
2. crash/OS kill/実BFCache/eviction/低RAM/長時間Core共存。現在のmemory-only receiptでは再起動を跨ぐexactly-onceなし。
3. 実チャネル用Gateway auth/secure pairing、正本workspace、durable ledger/inbox/outbox、recipient/authの独立review。Mock UUIDを本番認証としない。
4. browser閉鎖時の常駐workspace・移行・単一writer。Web IDBをNodeで直接読む仮定禁止。
5. 実iMessageのSIP維持/本人binding/規約/OS適合。未成立なら未対応のまま。
6. 実機Safari/iPhone/Android、screen reader、focus/IME、axe incompleteの手動確認。有限axe passをWCAG認証としない。
7. Ubuntu Node22/24、公開CI、新identity source/archive正式qualification、第三者レビュー。公開は別承認。

npm公開監査APIへのパッケージ名/バージョン照会は今回実行。依存に既知advisoryがないことと、アプリに未知の脆弱性がないことは別。body/credentialをprodログへ出さず、実ユーザーデータ・学校資料・認証情報は試験しない。

### 外部規約・APIの根拠

- [Ollama Chat API](https://docs.ollama.com/api/chat): roles、JSON schema、stream/think、keep_alive。新コードはOllama専用契約で既存抽出endpointから分離。
- [Telegram Bot API](https://core.telegram.org/bots/api): private update/sendMessage contract。実接続をしていない。
- [BlueBubbles Private API installation](https://github.com/BlueBubblesApp/bluebubbles-docs/blob/master/private-api/installation.md): SIP無効化を必要とする仕様。採用しない。basic serverとmacOS Messages/AppleScriptの依存は[公式server文書](https://github.com/BlueBubblesApp/bluebubbles-docs/blob/master/server/README.md)参照。

このAlphaにメール送信・外部予定変更・任意ネットワーク・シェル・コード実行・OAuth追加の経路は追加していない。新接続は機能/データ/規約の別承認後にのみ検証する。
