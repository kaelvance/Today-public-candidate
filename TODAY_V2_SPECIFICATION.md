# Today V2 specification

## 目的

毎日のタスク、予定、確認事項を、端末に保存して整理する日本語のローカルファーストアプリ。V1.9の動作基盤を維持し、Ownerの画像を基準とする和紙・墨・自然光・余白の表示へ刷新する。公開候補の検証とPublic公開は別工程で、公開の最終判断はOwnerが行う。

## 主要機能

- **Today**: 既存Context / priority projectionから主優先項目、今日の予定、気にしておく項目、あとで見る項目、完了済みを表示。
- **やること**: activeな投影項目を、将来の項目も含め表示。共通検索・詳細・明示操作を利用できる。
- **カレンダー**: activeな日時付き投影項目の一覧。開始時刻、開始がない場合は締め切りで昇順。月間グリッドや新しい外部カレンダーは実装しない。
- **ふりかえり**: done / dismissed項目と復元操作。統計、健康データ、集中時間の推測は表示しない。
- 自然文のクイック入力から既存の確認ダイアログへ。日本語IME変換中のEnterは送信を防ぐ。キャンセル・画面移動後も入力下書きは同一セッションで維持し、確定時に消す。未確定下書きは再読み込みを越えて保存しない。
- 手動入力、保存、完了、取り消し、保留、ピン、詳細編集、バックアップ、Context訂正、競合解決、任意Provider設定は既存の処理を利用。

## UIとデザイン

Reactの`Navigation`、`TodaySurface`、`QuickEntry`、`Timeline`、既存`TodayItem` / `ModalFrame`を組み合わせる。モバイルは4つの下部ナビゲーション、700px以上は情報を2列へ、1100px以上は固定サイドナビゲーションと主優先・予定の2列。CSSのsemantic tokensはWashi Light / Sumi Darkに対応する。

装飾は自作CSS・SVGで、外部画像・Web font取得はない。Stitchはデザイン探索に使用し、生成物の架空心拍、架空集中時間、音声入力、安全保証、未実装音楽等は採用しない。製品の表示は保存済みの実データと明示した架空サンプルだけに基づく。

## AIと連携

決定的なContext処理を優先し、IntelligenceRouter経由のモデルは提案のみを返す。Local / Remote / Custom Providerの契約は維持する。AIアシストとインテリジェンス処理方法は独立した設定で、両方を無効化することが全AI停止条件。Google Calendar / Gmail読み取りは任意で、実認証なしの検証は架空応答に限る。Googleの実アカウント接続成功を保証しない。

Today Model GammaはExperimentalで品質基準未達のまま。V2 UI作業ではモデル学習・蒸留・重み変更を行わない。Qwen、Adapter、学習データはこのソースに同梱しない。ローカルモデルを導入しなくてもCoreを利用できる。

## 保存と安全境界

`PersistedState.version = 3`と既存IndexedDB / localStorageキーは変更しない。V2の画面選択と入力下書きはメモリ上だけのUI state。保存失敗を通知し、入力・項目を表示に残す。ブラウザ保存は平文であり、共有端末・同一OSユーザー・バックアップ流出への暗号化保護を提供しない。

Node bridgeは同一端末の127.0.0.1限定で、Host / Origin / CSP / body limit / timeout等の既存境界を維持する。Provider由来の個人情報をRemote Modelへ送る要求はサーバーで拒否する。同一プロセスのtrusted Pluginはsandboxではない。

## オフラインと対応環境

初回インストールと初回キャッシュはネットワークが必要。同じoriginでオンライン起動・キャッシュを完了した後は、保存済み情報と手動操作をオフラインで利用できる。未取得のGoogle情報や未導入モデルはオフラインで生成されない。

Node 22.13以上の22系・24系、pnpm 11.19.0。実行サーバーは個人端末向けで、公開サーバーや多人数利用は対象外。検証済み環境は[TODAY_V2_TEST_REPORT](TODAY_V2_TEST_REPORT.md)へ記録する。対応を意図するブラウザと実検証したブラウザを混同しない。

## 未完了の公開条件

CoC専用の非公開窓口は[Code of conduct](CODE_OF_CONDUCT.md)へ掲載済み。Ownerが作成・受信確認・公開掲載承認を報告しました。GitHub PVRの実受付確認と公開後の匿名cloneも、Privateの検証で代替しない。これらが未完了の間、`TODAY_V2_RELEASE_READY = NO`。
