# Today V2 release notes — draft

V2は毎日のタスク・予定・確認事項を、和紙と墨を基調とした静かな表示で整理するローカルファーストアプリです。Today / やること / カレンダー / ふりかえりから、今必要なことと残しておくことへ移動できます。

## 変更

- 自然光・植物影・serif Today・丸い主優先カード・予定timeline。
- mobile / tablet / desktopで画面幅に応じた配置と4画面ナビゲーション。
- 自然文quick input、確認前の下書き保持、日本語IME、見出しfocus、長文・文字拡大・reduced motion。
- 保存、取り消し、検索、Context訂正、任意Google / AI / local model、backupを維持。

## 起動

ソースアーカイブを展開し、Node 22.13以上の22系または24系、pnpm 11.19.0で次を実行します。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

[http://127.0.0.1:4173/](http://127.0.0.1:4173/) を開きます。CoreにAPIキー、Googleアカウント、Qwenは不要。既存の同じoriginのブラウザ保存を引き継ぎます。portの変更は別の保存領域になります。

## 公開条件と制約

現時点はPrivateの公開候補で、Public化の承認はありません。CoC専用窓口は未作成。実PVR受付と公開後の匿名cloneは別ゲートです。モデル・Adapter・学習データは非同梱。実Google認証や実Remote providerの成功は架空応答による検証で保証しません。GammaはExperimentalで品質未達です。

TodayソースはMIT、Copyright 2026 Kaito Kuon。依存のライセンスとnoticeは別扱い。[Test report](TODAY_V2_TEST_REPORT.md)、[Security / privacy](TODAY_V2_SECURITY_AND_PRIVACY_REPORT.md)、[OSS report](TODAY_V2_OSS_RELEASE_REPORT.md) を参照してください。最終commit / tree / archive SHA-256 / CI runはソース外のrelease receiptへ記録し、自己参照のcommit値をソースへ埋め込みません。
