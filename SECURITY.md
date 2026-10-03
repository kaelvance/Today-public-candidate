# Security policy

## 対象

Today V2の個人端末上のローカル利用を対象とします。実験的なモデル・拡張契約には品質保証がありません。公開サーバー、多ユーザー運用、悪意ある同一OSユーザーへの防御は対象外です。[Threat model](docs/SECURITY_MODEL.md) を参照してください。

## 脆弱性の報告

公開repositoryでGitHubのPrivate vulnerability reportingを有効化しています。[kaelvance/Today-public-candidate のSecurity](https://github.com/kaelvance/Today-public-candidate/security) → Report a vulnerabilityから、GitHubへログインして非公開で報告してください。管理者のSecurity alerts通知を設定しています。外部reporterの実送信から管理者への通知配達は未検証で、受付設定の確認と区別します。

通常のIssueへ鍵、token、実メール、個人データを貼らないでください。非公開経路が表示されない場合は、公開Issueで「非公開連絡経路の提供」を求め、詳細や秘密情報を送らないでください。影響する版、再現する最小の架空データ、期待結果と実結果を示します。修正期限や監査認証は約束しません。

## 利用者側の境界

`.env.local`、暗号化token store、ブラウザデータ、バックアップは個人データです。保存先・端末アカウント・拡張機能を管理してください。モデルやPluginのコードを信頼できない場合は導入しないでください。ネットワーク公開やHostチェック解除を行わないでください。

CoC違反の報告は[Code of conduct](CODE_OF_CONDUCT.md)の専用窓口を利用してください。CoC窓口は脆弱性報告のPVRとは別の経路です。
