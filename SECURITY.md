# Security policy

## 対象

V2公開候補の個人端末上のローカル利用を対象とします。実験的なモデル・拡張契約には品質保証がありません。公開サーバー、多ユーザー運用、悪意ある同一OSユーザーへの防御は対象外です。[Threat model](docs/SECURITY_MODEL.md) を参照してください。

## 脆弱性の報告

V2は公開前です。公開先の管理者がGitHubのPrivate vulnerability reportingを有効化し、Securityタブから非公開報告できる状態を確認することを**V2公開の必須ゲート**とします。未開設の連絡先をここで存在すると表示しません。

現在のPrivate RCではこの受付は **NOT_CONFIGURED** です。公開時に有効化・確認済みの場合に限り、[kaelvance/Today-public-candidate のSecurity](https://github.com/kaelvance/Today-public-candidate/security) → Report a vulnerabilityを利用してください。通常のIssueへ鍵、token、実メール、個人データを貼らないでください。非公開経路が表示されない場合は、公開Issueで「非公開連絡経路の提供」を求め、詳細や秘密情報を送らないでください。影響する版、再現する最小の架空データ、期待結果と実結果を示します。修正期限や監査認証は約束しません。

## 利用者側の境界

`.env.local`、暗号化token store、ブラウザデータ、バックアップは個人データです。保存先・端末アカウント・拡張機能を管理してください。モデルやPluginのコードを信頼できない場合は導入しないでください。ネットワーク公開やHostチェック解除を行わないでください。
