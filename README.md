# Today V2.0.3

保存・復旧・更新の信頼性を改善する版です。変更と検証範囲は[V2.0.3リリースノート](docs/V2_0_3_RELEASE.md)、AI Chatの調査結果は[導入検討](docs/AI_CHAT_FEASIBILITY.md)を参照してください。正式公開と検証結果はGitHub Releasesのreceiptで確認してください。

同じ保存領域を編集できるタブは1つです。他のタブは待機し、編集タブを閉じると最新データで再開します。Web Locks対応ブラウザとHTTPS／localhostが必要です。旧V2.0.1のタブは閉じて更新してください。保存先の移行・制約は[公開ブラウザ版](docs/PUBLIC_BROWSER.md)を参照してください。

毎日のタスク・予定・確認事項を、端末に保存して整理するローカルファーストの日本語アプリです。AIやAPIキー、Googleアカウント、Qwenを用意しなくても使えます。V2のソースはPublic repositoryで公開しています。和紙と墨を基調としたToday / やること / カレンダー / ふりかえりへ刷新し、V1.9の機能基盤を維持しています。[V2仕様](TODAY_V2_SPECIFICATION.md)、[変更](TODAY_V2_CHANGELOG.md)、[検証](TODAY_V2_TEST_REPORT.md)、[公開条件](TODAY_V2_OSS_RELEASE_REPORT.md)を参照してください。[CoC専用窓口](CODE_OF_CONDUCT.md)はOwner承認済みです。PVRの設定・公開受付、保護設定、匿名cloneを確認し、正式tag・Release・配布物照合まで終えた時点の最終判定を[GitHub Releases](https://github.com/kaelvance/Today-public-candidate/releases)のrelease reportへ記録します。ソースのPublic公開と正式Releaseの完了を区別します。旧V1.9の文書・数値は履歴です。

## ブラウザで今すぐ使う（インストール不要）

**[Todayを開く](https://kaelvance.github.io/Today-public-candidate/)**

ログイン・Node.js・APIキーなしで、タスク・予定の登録／編集／完了、4画面の切替、バックアップを利用できます。項目はこのブラウザのIndexedDB／localStorageに保存し、サーバーへ送信しません。端末間の同期はありません。ブラウザのデータを消す前に設定からバックアップを書き出してください。シークレットモードでは終了時にデータが消える場合があります。

公開先はGitHub Pagesです。初回オンライン読込後はキャッシュ済みのCoreをオフラインで使えます。Google Calendar／Gmail・外部AI・MLX／Ollamaはローカル版が必要で、公開ブラウザ版では接続しません。提供機能と制限は[ブラウザ版の説明](docs/PUBLIC_BROWSER.md)を参照してください。

以下の `127.0.0.1` は**ソースから自分の端末で起動する場合だけ**のURLです。他の利用者や開発者のMacに接続するURLではありません。

## 必要環境

- Node.js **22.13以上の22系LTS**を推奨。24系も検証対象。Macと実Ubuntu CIの22/24系の結果はV2のqualification receiptへ記録します。`node --version` で確認します。
- pnpm **11.19.0**。通常は `npm install --global pnpm@11.19.0` で導入します。管理端末では管理者の手順を優先してください。
- Git、現行のChrome/Edge/Firefox/Safari等。最初の依存取得にはインターネットが必要です。
- Apple Silicon、Python、モデルは通常起動には不要です。Nodeサーバーは同じ端末の `127.0.0.1` で使います。

## 最初の起動（キーなし）

[kaelvance/Today-public-candidate](https://github.com/kaelvance/Today-public-candidate) のdefault branchは `public-candidate` です。元のTodayのprivate evidence historyは公開していません。ソースは次の手順で取得します。正式版の固定ソースはGitHub Releasesの配布物とreceiptを照合してください。現在の版はpackage.jsonで確認します。

```sh
git clone https://github.com/kaelvance/Today-public-candidate.git Today
cd Today
```

認証なしのpublic cloneからinstall・build・通常起動・初回利用を検証しています。ソースアーカイブを使う場合も展開先のルートで以下を実行します。Coreの実行にAPIキーは不要です。最終commitごとのqualification結果はrelease receiptを参照してください。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm start
```

ブラウザで **http://127.0.0.1:4173/** を開きます。`localhost` への置換やLANへの転送はできません。最初は空のTodayです。自然文の入力欄、PCの「追加する」、スマートフォンの「追加」から、確認ダイアログを経てタスク・予定を追加できます。下部または左のナビゲーションで4画面を切り替えます。設定のサンプルは架空データで、接続サービスではありません。起動するだけでモデルのダウンロードやロード、外部AIへの送信は行いません。

開発中は `pnpm dev` → [http://127.0.0.1:5173/](http://127.0.0.1:5173/)。終了はCtrl+C。ポートを変更する場合は `pnpm start -- --port 4273`。別ポートは別のブラウザ保存領域になるため、元のデータが消えたと誤認しないでください。

## 実装状態

| 対象                                                            | 状態                                                                   |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 手動タスク・予定、ローカル優先度、Context統合・ユーザー訂正     | 実装・回帰テストあり                                                   |
| IndexedDB＋localStorage、バックアップ、キャッシュ済みオフライン | 実装・E2Eあり                                                          |
| Gmail / Calendar読み取り                                        | 任意設定。実アカウントは未設定、架空応答で検証                         |
| 汎用Remote Provider / legacy OpenAI入力補助                     | 任意設定。実credentials未設定、Mock検証のみ                            |
| MLX / Ollamaローカルモデル                                      | Experimental、通常起動に不要                                           |
| Today Model Gamma                                               | Experimental。Fact 12/32、Temporal 9/32で品質未達。重み・Adapter非同梱 |
| Source Plugin / Provider / Model契約                            | Experimental。同一プロセスの信頼された拡張。sandboxではありません      |

Gmail/Calendarの取得内容はローカルに残ります。外部AIは手動入力・手動の提案要求を明示的に有効にした場合のみです。**2つの独立した設定**があります。すべてのAIを止めるには「AI アシスト＝オフ」と「処理方法＝AI無効」の両方を設定します。接続サービス由来データはRemote Modelのサーバー境界で拒否します。

## 任意の設定

`.env.example` の項目を [設定一覧](docs/CONFIGURATION.md) と照合し、必要なものだけ `.env.local` に保存します。秘密鍵・token・`.env.local` はGitへ入れません。環境変数も利用できます。モデル設定が不正でもCoreは起動し、そのモデルだけ利用不可になります。Googleの設定や接続は任意です。

- [Google / Providerの設定](docs/PROVIDERS.md)
- [ローカルモデルの取得・ハッシュ検証](docs/MODELS.md)
- [プライバシーと保存・リセット](docs/PRIVACY.md)
- [トラブルシューティング](docs/TROUBLESHOOTING.md)

## 開発・検証

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:local
pnpm test:remote
pnpm test:ollama
pnpm test:security
pnpm test:oss
pnpm build
pnpm licenses:check
pnpm audit --audit-level high
```

既存の通常E2Eに加え、`pnpm test:v2 -- <source外の証跡directory>` が4画面・長文・IME・下書き・21 axe checks等を検証します。件数は最終ログから集計します。追加の `pnpm test:stranger` はブラウザとサーバーの再起動を含む初回利用6フロー、`pnpm test:cold` はViteキャッシュを消して3回だけcold起動します。これらの検証は架空データと独立したブラウザprofileを使い、4173/5185ポートが空いている必要があります。

E2EにはChromiumが必要です。`pnpm exec playwright-core install chromium` でこの固定Playwright版のブラウザを取得した後、`pnpm test:e2e` を実行します。Linuxでシステムライブラリが不足する場合は `pnpm exec playwright-core install --with-deps chromium`。既存ブラウザを使う場合は `CHROME_PATH` に実行ファイルを指定します。通常のユーザー起動にはChromiumのテスト用導入は不要です。

依存台帳の再生成は `pnpm run sbom`（固定npm版のメタデータ照合にネット接続が必要）。全lockfileパッケージを対象にします。詳細は [testing](docs/TESTING.md)、[development](docs/DEVELOPMENT.md)、[release](docs/RELEASE.md)。ローカル検証とGitHub Actionsの成功は別の証拠です。実行していないCIの成功バッジは表示しません。

## 配布と権利

Todayソース・自作の架空回帰fixture・図形アイコンは [MIT](LICENSE)、Copyright 2026 Kaito Kuon。Qwenや依存ライブラリのライセンスは別です。[NOTICE](NOTICE)、[third-party notices](THIRD_PARTY_NOTICES.md)、[SBOM](SBOM.cdx.json)、[権利・配布範囲](docs/licensing/RIGHTS_PROVENANCE.md) を参照してください。モデル重み・Adapter・学習データ・秘密情報・端末ログ・node_modules・distはソース配布に含みません。production bundleを再配布する場合はTHIRD_PARTY_NOTICESも付けてください。

macOS用の`start.command`は任意のdevelopment起動補助です。通常は上記のターミナル手順を使い、起動にMac固有pathを要求しません。

## その他の資料

- [architecture](docs/ARCHITECTURE.md) / [security model](docs/SECURITY_MODEL.md)
- [extension contracts](docs/PLUGINS.md) / [model card](models/today-model/model-card/MODEL_CARD.md)
- [CONTRIBUTING](CONTRIBUTING.md) / [SECURITY](SECURITY.md) / [CODE_OF_CONDUCT](CODE_OF_CONDUCT.md) / [CHANGELOG](CHANGELOG.md)

[セキュリティ上の境界](docs/SECURITY_MODEL.md): 項目は平文のブラウザ保存です。trusted Pluginは同一プロセスで実行され、sandboxではありません。Remote endpointは管理者指定HTTPS・TLS検証・redirect拒否ですが、DNS解決先のIP固定はありません。任意サービスの実接続保証はありません。

項目を個人端末のブラウザへ保存するアプリです。ブラウザ版も各端末内で処理し、利用者データを共有する多ユーザーサーバーではありません。共有端末での利用は対象外です。オフラインの初回起動は、以前に同じoriginで正常なオンライン起動・キャッシュを完了している必要があります。
