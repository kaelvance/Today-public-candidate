# Development

`pnpm dev`でVite middlewareとNode bridgeを同一originに起動します。loopbackのHost/Origin保護を外さず、UIとDomainの型にGoogle/model SDKを持ち込まないでください。[Architecture](ARCHITECTURE.md)の不変条件が変更の制約です。

formatは`pnpm format`、検証は[TESTING](TESTING.md)。lockfileを手編集で省略しません。依存変更時は`pnpm run sbom`で全graphを再生成し、`pnpm licenses:check`とauditを確認します。SBOM生成はインストール済みメタデータと、未インストールplatform optional packageの固定npmメタデータ/integrityを照合します。V1.9のPrettierはMITのformat検証依存です。V2のaxe-core4.13.0はMPL-2.0のaccessibility検証依存で、未改変のlicenseを保持します。どちらもproduction runtimeへimportしません。

productionは`pnpm build`→`pnpm start`です。`dist`は生成物でsource archiveに含めません。再配布するproduction bundleにはNOTICE/THIRD_PARTY_NOTICESを付けてください。秘密・研究成果・端末ログをsource rootへ置かず、架空fixtureは実データと混ぜないでください。

最初のdevelopment起動の再現性のため、ViteはReact/ReactDOMをdedupeし、clientとjsxのentryを明示的にprebundleします。production生成物のSHAはこの設定追加前後で一致しています。初回cloneで一度観測したuseState例外のroot causeは断定していません。
