# Today V2 changelog

## V1.9 rc.10 → V2

### 表示

- 和紙の背景、自然光と植物影、自作SVG、serifのToday、丸い主優先カード、時刻のtimeline、抑えた色と影。
- モバイル4画面ナビゲーション、tabletの2列、desktopのサイドナビゲーション。
- Washi Light / Sumi Dark、本文へのスキップリンク、移動先の見出しフォーカス、適切な見出し階層、44pxナビゲーション、reduced motion / forced colors。

### 操作

- Today / やること / カレンダー / ふりかえりの切り替え。
- 自然文を既存確認ダイアログへ渡す入力欄。キャンセルと画面移動時の下書き保持、IME変換中のEnter送信防止。
- 完了・整理済み項目の復元。既存の詳細・編集・取り消し・Context訂正・Provider設定を保持。
- カレンダー表示で日時の不正値を除外し、開始・締め切り・同時刻・ISO timezone offsetの表示順を定義。

### 検証と配布

- rc.3で200%文字拡大時の下部ナビゲーションを内容に応じた高さへ変更。ラベルがボタンと画面の範囲内に収まることを座標で検証し、診断JSONを保存する。

- V2 UI E2E、axe-core、長い日本語と英語、4画面・複数画面幅、200%文字拡大、下書き・フォーカス・保存失敗の検証を追加。
- Gmail E2EのUI時計を、過去と未来のfixtureを満たす既存scenarioと同じ2026-09-28へ固定。既存assertion・件数・pageerror検査を減らさない。
- 元のオフラインE2Eの見出し期待値を、新しい製品名Todayへ変更。オフライン動作の検証内容は維持。
- release qualificationとfresh source archiveにもV2 UI gateを追加。旧rc.10、失敗ログ、private evidence historyは維持する。
- GitHub Desktopの既存認証を使用。Device Flow停止を維持し、PAT貼付・token/cookie/keychain抽出を行わない。

### 維持した境界

保存schema、Google / Remote / Local Modelの境界、Coreのzero-key / AI-disabled / no-model、MIT Copyright Kaito Kuon。モデル学習・重み・Adapter・学習データ公開はこの変更に含まれない。

## 開発中に発見した失敗

原ログはソース外の証跡に保持する。CSPで拒否された初回axe注入は同originのテスト用routeへ修正。ナビゲーションのrAFフォーカスはReact commit後へ修正。自然文解析によるテストタイトル変換を訂正。やること一覧の見出し階層とサンプルバッジのコントラストを修正。ダーク測定はthemeのcomputed color / text-fill-colorとfont/render準備を待ち、測定ごとに新しいaxeを注入する。fresh darkとservice worker allow/blockを独立確認。保存失敗はIndexedDBとlocalStorage両方の障害を注入する。strangerは重複する追加ボタンをexact nameで区別する。検証assertionは削除しない。

## rc.2

rc.1のcold startはpageerror0のまま固定予定の見出し待機に失敗。UI時計を既存scenario suiteと同じ9/28へ固定し、実日付による表示移動を防ぐ。3 cold試行とpageerror検査は維持。rc.1の失敗receipt / ZIPは保持する。
