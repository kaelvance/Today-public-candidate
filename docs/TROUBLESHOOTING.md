# Troubleshooting

| 症状                    | 確認                                                                          |
| ----------------------- | ----------------------------------------------------------------------------- |
| 起動/インストール不可   | Node22.13–24、pnpm11.19.0、rootでfrozen install。最初の依存取得はonlineが必要 |
| invalid_host            | `http://127.0.0.1:port/`を使う。localhost/LAN/reverse proxyは対象外           |
| 画面404                 | production前に`pnpm build`。壊れたstatic cacheはonlineでサイトデータを確認    |
| port使用中              | 別portを明示。別originなのでデータも別。developmentは次のportをHMRに使う      |
| Google未設定            | 全client/key/store、32byte key、callback exactorigin、APIとGoogle consent設定 |
| 接続期限切れ            | UIで本人が再接続。token/keyの値をIssueへ貼らない                              |
| model未導入/非互換/破損 | Coreは利用可能。dir/Python/manifest/sha256/idを照合。自動downloadなし         |
| 外部AIが動かない        | 任意key/model/endpoint、HTTPS、UI mode、serverpermission+consent、privacy分類 |
| offline初回が動かない   | onlineで同一originのSW/cacheを初期化後に再試験                                |
| dataが見えない          | port/browser profile/origin確認。削除・再初期化前にbackupとIndexedDBを確認    |

cacheとIndexedDBの両方が壊れた場合はbackup以外から復旧できる保証はありません。known limitationsはqualification reportにあります。実サービスのログには個人データを含めず、再現は架空データで作ってください。
