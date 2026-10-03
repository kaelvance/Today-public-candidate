# Today V2 test report

本書は検証のスコープと再現手順を定義します。コミット後の実行結果、Node版、exit code、CI run ID、archive hashはソース外のqualification / release receiptを最終の証拠とします。旧V1.9の台帳やLighthouseをV2の結果として扱いません。

## V2.0.1公開ブラウザgate

2.0.1の新identityで完全qualificationを再実行します。追加gateは`pnpm build:web`と`pnpm test:web -- <source外directory>`です。APIを提供しない静的subpathで初回表示・作成・再読込・完了/復元・4画面・backup・mobile保存分離・offlineを検証します。配布後は`TODAY_WEB_URL=https://kaelvance.github.io/Today-public-candidate/ pnpm test:web -- <source外directory>`でローカルサーバーを起動せず実URLを検証し、別の第三者役も未認証browserで試験します。端末を共有する独立browser contextは別の物理回線・端末の検証ではありません。実結果とaxeのincompleteもreceiptへ保存します。

## Phase 1

2026-09-30のPhase 1検証は成功。Vitest134件とNode33件（local6 / remote9 / Ollama3 / security11 / OSS4）、通常production E2E48フロー、V2追加20フロー、axe21回の違反0、別ディレクトリでのfrozen install / build / stranger6フローを確認しました。これは開発段階の結果です。固定RCのMac22 / 24、実Ubuntu CI、archive検証はソース外receiptを確認してください。

| 対象                                                                    | 方法                                          |
| ----------------------------------------------------------------------- | --------------------------------------------- |
| capture / persist / complete / undo / snooze / backup                   | 既存core UI・E2E                              |
| Google / Gmail / AI boundary                                            | 既存mock provider E2E、Node integration tests |
| Context compression / source recovery / user separation / time conflict | 既存scenario E2E                              |
| zero-key / no-model / disabled / offline / corrupt cache                | 既存release E2E                               |
| V2 navigation / focus / review restore / future calendar / search       | `test:v2`                                     |
| QuickEntry cancel / view draft / IME / long JP-English                  | `test:v2`                                     |
| 320 / 390 / 820 / 1440pxの4画面                                         | overflow・h1・nav target・axe                 |
| Light / Dark / reduced motion / text resize / storage error             | `test:v2` + 実画面確認                        |
| カレンダーの年跨ぎ / offset / 同時刻 / 不正値 / v3互換                  | `view-model.test.ts`                          |

200%検証はviewport固定で全HTML要素の実computed font-sizeを2倍にする文字拡大シミュレーションです。ブラウザのすべてのzoom実装を検証した意味ではありません。IME guardの自動検証はKeyboardEventのisComposingを用い、すべてのIME・OSの挙動を保証しません。

rc.2後の目視確認を受けた追加診断では、文字拡大時に下部ナビゲーションのラベルがボタン領域を越えるケースを座標で確認しました。rc.3は固定高さを解除し、4画面でラベルがクリック対象とviewport内に収まるassertionを追加します。初回の追加検査成功と次の失敗を両方保存し、rc.2の元のqualificationを消去しません。

## 完全qualification

```sh
pnpm release:qualify -- <source外の証跡directory>
```

install、format、lint、typecheck、unit、local、remote、Ollama、security、OSS scan、code audit、license / SBOM、dependency audit、build、既存E2E、V2 UI、packagingを順に実行します。package工程はcleanな固定commitをZIP化し、全tracked blobとmodeを照合して新しいdirectoryへ展開。install / build / tests / E2E / V2 UI / stranger / cold startを改めて実行します。並行したsuiteで同じportを使わないでください。

Mac Node22 / Node24と、実GitHub Actions Ubuntu24.04 Node22 / Node24の結果は別々の証跡です。GitHub Actionsはcontents:read、commit-pinned actions、checkout credentials非保持、失敗時もartifactを保存します。Private CIはPublic運用・匿名cloneの確認ではありません。

## Accessibility / performanceの限界

axe-core4.13.0のWCAG A/AAタグとbest-practice、keyboard、focus、dialog inert / trap / return、heading、touch targets、responsive、contrast、reduced-motion、目視・accessibility treeを組み合わせます。axeのincompleteを違反0へ隠さず記録し、decorative gradient等の色を独立確認します。VoiceOver / NVDAによる実読み上げ、Safari / Firefoxの全自動suiteは、実施証跡がない限り未検証です。WCAG認証を主張しません。

Lighthouse13.5.0は新しいproduction / empty / zero-key / no-model状態で測定。初回V2測定はPerformance99 / Accessibility100 / CLS0 / TBT0。最終の複数回測定とraw hashは別receiptに記録します。既存99 / 100 / CLS0は比較用のhistorical baselineです。

## 失敗保持

全attemptの原ログとfailure screenshotを保持。CSP注入失敗、focus timing、解析済みtitleの期待違い、見出し階層、badge contrast、theme復元の待機不足、dark contrast測定の不整合、初回strangerの重複ボタンselectorを記録します。ダーク測定ではtheme復元後のcomputed colorとtext-fill-color、font、renderの準備を待ち、各測定で新しいaxeを注入しました。fresh dark / service worker allow-blockの独立診断は違反0で、製品の色ルールやaxe assertionは削除していません。保存失敗はIndexedDBとlocalStorageを両方失敗させて検証します。rc.10 clean rootの実Ubuntu run `36689078462` は両NodeともE2E gate失敗。V2の成功証跡には流用しません。
