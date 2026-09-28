# Rights and distribution scope

## Today source

2026-09-28、権利者は公開対象のソース・完全架空fixture・自作図形アイコンを自身の権限でMIT公開でき、無許可の転載、学校/会社/共同開発者の権利がないと確認し、MIT採用を承認しました。公開名義は**Kaito Kuon**です。標準MIT本文をLICENSEに置き、NOTICEで第三者部分を分離します。これはユーザーの権利確認に基づく記録で、権利関係の外部鑑定ではありません。

自作資産は`public/icon.svg`、`src/ui.tsx`の図形paths、CSS。外部フォント・写真・商用iconpackはありません。fixtureは`src/data.ts`、`src/evaluation/scenarios.ts`、tests/E2E、`evals/`の5つの架空回帰JSONです。研究datasetは配布しません。

## Dependencies

固定298package graphのライセンス・用途・integrity・direct/transitive・既知vulnerability snapshotは`docs/qualification/dependencies.json`、SBOMはroot。runtimeのReact/ReactDOM/Scheduler、Viteのmodulepreload helperはMITで、Rollup生成helperの帰属も保守的に保持し、production bundleにも原文のcopyrightとpermissionを添付します。その他のpackageはsource archiveに本体を含めず、必要なinstalled上流LICENSE/NOTICEを`third-party/licenses/`へ保存しています。sourceのMITで依存やmodelを再許諾しません。Python/model optional runtimeはnpm inventory対象外です。

## Qwen / Gamma / data

Qwen3-1.7B-MLX-4bit固定revisionの上流LICENSEはApache-2.0として原文確認しました。同梱は参照LICENSEとhash manifestだけで、Qwen重みではありません。Apache-2.0の再配布ではLICENSEの添付、変更ファイルの表示、帰属表示、適用されるNOTICEの維持などを確認する必要があります。

Gamma Adapterと学習/蒸留datasetは今回**非配布**です。独立公開前のデータ来歴・各データの許諾・教師出力規約・変更表示・Adapter自体の配布条件をすべて確認したとは主張しません。manifestはidentity/hash/experimental metadataであり、その存在がAdapterの公開許諾を意味しません。Qwenを教師にした蒸留はしていません。Today CoreはQwen/Adapterなしで成立します。

## 原典

- [MIT](https://opensource.org/license/mit)
- [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)
- [Qwen固定LICENSE](https://huggingface.co/Qwen/Qwen3-1.7B-MLX-4bit/blob/21457c6f51ed54a7c16e988c0844db973815c137/LICENSE)
