# Today V2 design system

Ownerのcanonical画像とStitchの既存モバイル画面を基準に、実機能へ対応する表示を実装する。Stitchの追加desktop / tablet / empty-error framesは配置の参考とし、生成された架空の製品機能は採用しない。

## Semantic tokens

定義は`src/v2.css`、共通spacing / radius / motionは`src/styles.css`。

| Token              | Washi Light | Sumi Dark | 用途            |
| ------------------ | ----------- | --------- | --------------- |
| `--bg`             | #f3f0e9     | #1c211e   | 画面背景        |
| `--surface`        | #fcfbf7     | #282f29   | カード・入力    |
| `--surface-raised` | #f8f6ef     | #242b25   | 補助表示        |
| `--surface-muted`  | #eae6dc     | #333d33   | バッジ・図形    |
| `--text`           | #252621     | #eeeae0   | 主本文・見出し  |
| `--text-secondary` | #5e6259     | #c1c6b9   | 補足            |
| `--text-tertiary`  | #62655d     | #b3bbab   | 小さな補助文字  |
| `--accent`         | #586849     | #c0d1a9   | 主操作・選択    |
| `--accent-text`    | #ffffff     | #20271d   | 主操作上の文字  |
| `--focus`          | #485b80     | #bbcdec   | キーボードfocus |
| `--critical`       | #9a3838     | #ffb2a9   | エラー          |

装飾のgradient・透過は、意味を伝える唯一の手段にしない。透過カード・背景画像等で自動contrastが判定不能になる要素は、実computed colors・独立比率計算・目視で補足する。数値とスコープはテスト報告へ記載する。

## Typography / spacing / shape

- Todayと主要セクションは端末のserif font stack: Iowan Old Style / Palatino / Yu Mincho / Hiragino Mincho / Georgia。日本語本文は既存system sans stack。OSS配布にfont binaryを含めず、Web fontへの通信も行わない。
- 本文基準15px、予定・項目見出し16px、主優先見出し21px、セクション23px、Todayはmobile36–48px・desktop58px。補助文字11–13px。入力・buttonはfontを継承。
- spacingは4px基準の既存`--s1`〜`--s16`、container radius24px、pillは既存`--r-pill`。固定高さの文字カードを作らず、長文は自然に伸ばす。
- 境界は薄いsemantic border、主カードには控えたshadow。DaylightはCSSとオリジナルSVGの装飾で`aria-hidden=true`、pointer eventsなし。

## Components / breakpoints

| 幅         | 配置                                         |
| ---------- | -------------------------------------------- |
| 320–699px  | 1列、下部4画面ナビ、safe-area余白            |
| 700–1099px | 主優先・予定の2列、下部ナビ                  |
| 1100px以上 | 224pxサイドナビ、主コンテンツ最大1180px、2列 |

`Navigation`はaria-current、`TodaySurface`は1つのh1、`TodayItem`は項目h3、`QuickEntry`はlabel付きinputと確認操作。共通の`ModalFrame`はdialog / aria-modal / Escape / focus trap / 呼出し元focus復帰を維持する。装飾の「日」sealは追加の操作ではない。

## States / accessibility

emptyは追加と任意サンプルの導線、loadingは既存の明示表示、保存失敗はalert、offlineは保存済み情報を利用するstatus、Google disconnected / no-model / AI unavailableは設定内に理由を示す。すべての状態で架空の成功表示を作らない。

ナビゲーション44px以上、visible focus、本文スキップ、reduced motion、forced colors、意味あるheading hierarchyを使う。200%文字拡大と長い日本語・連続英語を確認する。axeの違反0はWCAG認証や全支援技術での動作保証ではない。VoiceOver / NVDA等の未実施範囲をテスト報告へ残す。
