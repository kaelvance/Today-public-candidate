# Testing

## V2.1 Chat

`pnpm test:chat`、`pnpm test:chat-server`、`pnpm test:chat-e2e -- <source外の証跡directory>` を通常qualificationに追加しています。実モデルは別の明示opt-in `TODAY_TEST_REAL_BROWSER_MODEL=true pnpm test:browser-model -- <source外directory>` で架空専用profileを使用します。約1GBの取得には個別承認が必要で、通常CIは実モデルを取得しません。契約・MockのPASSと実モデル品質を区別し、[実機評価](V2_1_MODEL_EVALUATION.md) を参照してください。

[README](../README.md)の環境を用意し、rootで以下を実行します。

```sh
pnpm install --frozen-lockfile
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
pnpm exec playwright-core install chromium
pnpm test:e2e
```

VitestはUI/domain/invariants/schema/provider契約/Google mockを検証します。Node testsはruntime/remote/Ollama/HTTP/OAuth/token/resource limitを検証します。E2Eは実際のproduction Nodeサーバーとブラウザ、架空service応答を使い、offline・保存・backup・設定・keyboard・responsiveを検証します。Mockは実アカウント検証ではありません。各suiteの失敗を無視しないでください。

モデルの実機テストは任意で、別導入したbaseとAdapterを`TODAY_EVAL_QWEN3_MODEL_DIR`、`TODAY_EVAL_PYTHON`、`TODAY_E2E_ADAPTER_DIR`に設定し、`TODAY_E2E_MODEL_VARIANT=gamma`などを指定して`pnpm test:e2e:model`。この候補版にAdapterは同梱されず、無設定では実行できません。通常CIにmodel download/training/本物の鍵を入れません。

secret scannerは自作のpattern scanで、完全なPII検出製品ではありません。台帳と手動確認を組み合わせます。依存auditは実行日の既知advisory snapshotで、未知の脆弱性を否定しません。Lighthouse測定はrelease reportの版・viewport・3回の条件で別途実行し、同一条件を比較します。

## RC最終ゲート

`pnpm test:stranger` は独立したブラウザprofileで初回入力、保存、完了/undo、ブラウザとNodeサーバーの再起動、AI無効Coreを確認します（6 flows）。通常48 E2Eとは別集計です。`pnpm test:cold` はVite cacheを除去して3回だけ初回development起動を検証します。pageerrorが出れば停止し、stack、prebundle metadata、実module URL、React依存graph、HMR/resolveログ、runtime情報を外部evidence directoryへ保存します。`MITIGATED / NOT REPRODUCED` は原因の証明ではありません。

検証用4173/5185ポートは空いている必要があります。実データのブラウザprofileや既存のサーバーを使い回しません。通常利用にはこの検証手順は不要です。

`pnpm release:qualify -- <source外のevidence directory>` は全ゲートを順番に実行し、exit codeと各ログを保存します。`pnpm release:package -- <source外のevidence directory>` はcleanな固定Git commitをZIP化し、全tracked blobと一致を確認、新しいdirectoryへ展開してinstall/build/各tests/既存E2E/V2 UI/stranger/coldを実行します。packaging検証にはGitとunzipが必要です。Node22/24・Ubuntu24.04の実Actions実行は、GitHubのrun IDと結果が得られて初めてPASSです。ローカルでの同じscript実行では代替しません。

最終qualification/archiveではNode test environmentをUTCに固定します。ブラウザの既存scenario fixtureはAsia/Tokyoを明示し、別UTC contextでcalendar 10:00 JST→01:00 UTC、mailのlocal 09:30とユーザー訂正を検証します。追加UTC1 flowのため通常E2Eは48、初期47はすべて維持します。unitのlocal calendar fixtureはlocal constructorで作り、JST/UTCで同じ日付の意味を持たせます。

## V2 UI

`pnpm test:v2 -- <source外のevidence directory>` を追加しました。320/390/820/1440、4画面、IME、下書き、focus、長文、200%文字拡大、light/dark、保存失敗、axe A/AA・best-practiceを検証します。ルールを無効化せず、theme・font・描画の確定を待って測定します。詳細・既知の未検証範囲は [V2 test report](../TODAY_V2_TEST_REPORT.md) を参照してください。
