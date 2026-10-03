# Today 2.0.1 release notes

## V2.0.1の修正

**インストールなしの利用URL: https://kaelvance.github.io/Today-public-candidate/**

V2.0.0ではソース公開とローカル起動のみを検証し、第三者がURLだけで操作できるサイトを用意していませんでした。V2.0.1はGitHub Pagesの静的ブラウザ版、subpath対応、scopeを限定したオフラインキャッシュ、公開URLの検証を追加します。READMEのlocalhostは、ローカルインストール後に開くURLです。

公開版のCoreはログイン・APIキーなしで利用でき、項目はそのブラウザに保存します。Google / Gmail / AI / local modelの任意連携はローカル版で利用してください。公開版は連携APIや開発者のMacへ接続しません。[公開ブラウザ版の保存・制約](docs/PUBLIC_BROWSER.md)を参照してください。

V2.0.0のtag・配布物は変更しません。新しいcommit / tree / source ZIPに対し、全qualificationと公開サイトの匿名smoke・独立した第三者役の試験を行い、実結果はV2.0.1 Releaseのreceiptへ記録します。

V2は毎日のタスク・予定・確認事項を、和紙と墨を基調とした静かな表示で整理するローカルファーストアプリです。Today / やること / カレンダー / ふりかえりから、今必要なことと残しておくことへ移動できます。

## 維持するV2の機能

- 自然光・植物影・serif Today・丸い主優先カード・予定timeline。
- mobile / tablet / desktopで画面幅に応じた配置と4画面ナビゲーション。
- 自然文quick input、確認前の下書き保持、日本語IME、見出しfocus、長文・文字拡大・reduced motion。
- 保存、取り消し、検索、Context訂正、任意Google / AI / local model、backupを維持。

## ローカル版の起動

ソースアーカイブを展開し、Node 22.13以上の22系または24系、pnpm 11.19.0で次を実行します。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

[http://127.0.0.1:4173/](http://127.0.0.1:4173/) を開きます。CoreにAPIキー、Googleアカウント、Qwenは不要。既存の同じoriginのブラウザ保存を引き継ぎます。portの変更は別の保存領域になります。

## 公開条件と制約

Ownerの明示的PUBLIC GOに基づきソースrepositoryをPublicへ移行しました。正式tag・Release・artifact identityの最終判定はGitHub Releaseへ添付するreport/receiptを参照してください。CoC専用窓口は[Code of conduct](CODE_OF_CONDUCT.md)へ掲載済み（Ownerの作成・受信確認・公開掲載承認に基づく）。PVRの有効化と公開受付、管理者のSecurity alerts設定、認証なしcloneを確認します。外部reporterからの実送信・通知配達は未検証です。モデル・Adapter・学習データは非同梱。実Google認証や実Remote providerの成功は架空応答による検証で保証しません。GammaはExperimentalで品質未達です。

TodayソースはMIT、Copyright 2026 Kaito Kuon。依存のライセンスとnoticeは別扱い。[Test report](TODAY_V2_TEST_REPORT.md)、[Security / privacy](TODAY_V2_SECURITY_AND_PRIVACY_REPORT.md)、[OSS report](TODAY_V2_OSS_RELEASE_REPORT.md) を参照してください。最終commit / tree / archive SHA-256 / CI runはソース外のrelease receiptへ記録し、自己参照のcommit値をソースへ埋め込みません。
